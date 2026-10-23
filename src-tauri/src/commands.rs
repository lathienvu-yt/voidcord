//! Tauri command handlers — thin glue between the frontend and DiscordRouter.
//!
//! All heavy networking lives in discord_router.rs. These commands just
//! translate between JSON payloads the frontend sends and what the router needs.

use reqwest::Method;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::voice_gateway::{VoiceGateway, VoiceGatewayConfig};
use crate::discord_router::{AccountIdentity, TokenManager};
use crate::settings_proto::SettingsProtoV1Envelope;
use crate::AppState;


// ── helpers ──────────────────────────────────────────────────────────────────

fn map_err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn emit_rust_log(app: &AppHandle, level: &str, target: &str, message: impl Into<String>) {
    let _ = app.emit(
        "voidcord:rust-log",
        json!({
            "level": level,
            "target": target,
            "message": message.into(),
        }),
    );
}

/// After the token is set we rebuild the router's token manager.
async fn rebuild_router(state: &AppState, token: &str) {
    state
        .router
        .update_tokens(TokenManager::new(
            Some(token.to_owned()),   // primary  (writes)
            None,                     // secondary
            Some(token.to_owned()),   // read-only (reads / gateway)
        ))
        .await;
}

// ── commands ──────────────────────────────────────────────────────────────────

/// Save a user token and validate it by fetching /users/@me.
/// Emits `discord:ready` with the user object on success.
#[tauri::command]
pub async fn set_token(
    token: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let previous_token = state.token.lock().await.clone();
    rebuild_router(&state, &token).await;
    let me = match state.router
        .rest(AccountIdentity::ReadOnly, Method::GET, "users/@me", None)
        .await
    {
        Ok(user) => user,
        Err(error) => {
            let message = map_err(error);
            // Keep the attempted token active while a CAPTCHA retry is pending,
            // because the router owns the paused request and its challenge state.
            if !message.starts_with("VOIDCORD_CAPTCHA:") {
                if let Some(previous) = previous_token {
                    rebuild_router(&state, &previous).await;
                } else {
                    state.router.update_tokens(TokenManager::default()).await;
                }
            }
            return Err(message);
        }
    };

    if let Some(gateway_task) = state.gateway_task.lock().await.take() {
        gateway_task.abort();
    }
    rebuild_router(&state, &token).await;
    *state.token.lock().await = Some(token.clone());

    let _ = app.emit("discord:ready", &me);
    Ok(me)
}

/// Fetch the current user object (/users/@me).
#[tauri::command]
pub async fn get_current_user(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .router
        .rest(AccountIdentity::ReadOnly, Method::GET, "users/@me", None)
        .await
        .map_err(map_err)
}

/// Fetch all guilds the current user is a member of.
#[tauri::command]
pub async fn get_guilds(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .router
        .rest(
            AccountIdentity::ReadOnly,
            Method::GET,
            "users/@me/guilds",
            None,
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn retry_captcha_request(
    request_id: String,
    captcha_key: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state.router.retry_captcha(&request_id, &captcha_key).await.map_err(map_err)
}

#[tauri::command]
pub async fn join_guild_invite(
    invite_code: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let code = invite_code
        .trim()
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .split(['?', '#'])
        .next()
        .unwrap_or_default();
    if code.is_empty() || !code.chars().all(|character| character.is_ascii_alphanumeric() || character == '-') {
        return Err("Enter a valid Discord invite code or URL".to_owned());
    }
    state.router.rest(
        AccountIdentity::Primary,
        Method::POST,
        &format!("invites/{code}"),
        Some(json!({})),
    ).await.map_err(map_err)
}

#[tauri::command]
pub async fn create_guild(
    name: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err("Server name must contain 1–100 characters".to_owned());
    }
    state.router.rest(
        AccountIdentity::Primary,
        Method::POST,
        "guilds",
        Some(json!({ "name": name })),
    ).await.map_err(map_err)
}



/// Fetch all channels in a guild.
#[tauri::command]
pub async fn get_channels(
    guild_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state
        .router
        .rest(
            AccountIdentity::ReadOnly,
            Method::GET,
            &format!("guilds/{guild_id}/channels"),
            None,
        )
        .await
        .map_err(map_err)
}

/// Fetch the 50 most-recent messages for a channel.
/// Returns Ok(array) on success, Err("MISSING_ACCESS") on 403, Err("MISSING_PERMS") on 50013, other errors as string.
#[tauri::command]
pub async fn get_messages(
    channel_id: String,
    before: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let path = if let Some(b) = before {
        format!("channels/{channel_id}/messages?limit=50&before={b}")
    } else {
        format!("channels/{channel_id}/messages?limit=50")
    };
    match state
        .router
        .rest(AccountIdentity::ReadOnly, Method::GET, &path, None)
        .await
    {
        Ok(mut msgs) => {
            // Discord returns newest-first; reverse so oldest is at index 0
            if let Some(arr) = msgs.as_array_mut() {
                arr.reverse();
            }
            Ok(msgs)
        }
        Err(crate::discord_router::DiscordError::Http { status, body }) => {
            if status.as_u16() == 403 {
                // Check for specific Discord error codes
                if body.contains("50013") {
                    Err("MISSING_PERMS".to_owned())
                } else {
                    Err("MISSING_ACCESS".to_owned())
                }
            } else {
                Err(format!("HTTP {status}: {body}"))
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn archive_message_media(url: String) -> Result<String, String> {
    const MAX_MEDIA_BYTES: usize = 12 * 1024 * 1024;
    let parsed = reqwest::Url::parse(&url).map_err(map_err)?;
    let host = parsed.host_str().unwrap_or_default();
    if parsed.scheme() != "https"
        || !matches!(host, "cdn.discordapp.com" | "media.discordapp.net")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only HTTPS Discord CDN media URLs can be archived".to_owned());
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(map_err)?;
    let mut response = client.get(parsed).send().await.map_err(map_err)?;
    if !response.status().is_success() {
        return Err(format!("Discord CDN returned HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MEDIA_BYTES as u64)
    {
        return Err("Media is larger than the 12 MiB archive limit".to_owned());
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.starts_with("image/") || value.starts_with("video/") || value.starts_with("audio/"))
        .unwrap_or("application/octet-stream")
        .to_owned();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(map_err)? {
        if bytes.len() + chunk.len() > MAX_MEDIA_BYTES {
            return Err("Media is larger than the 12 MiB archive limit".to_owned());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(format!("data:{content_type};base64,{}", encode_base64(&bytes)))
}

fn encode_base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        output.push(ALPHABET[(first >> 2) as usize] as char);
        output.push(ALPHABET[(((first & 0b11) << 4) | (second >> 4)) as usize] as char);
        output.push(if chunk.len() > 1 {
            ALPHABET[(((second & 0b1111) << 2) | (third >> 6)) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            ALPHABET[(third & 0b111111) as usize] as char
        } else {
            '='
        });
    }
    output
}

/// Send a message to a channel.
#[tauri::command]
pub async fn send_message(
    channel_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::POST,
            &format!("channels/{channel_id}/messages"),
            Some(json!({ "content": content })),
        )
        .await
        .map_err(map_err)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentSelection {
    upload_id: String,
    filename: String,
    size: u64,
}

#[tauri::command]
pub async fn select_attachment_files(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<AttachmentSelection>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_files(move |paths| { let _ = sender.send(paths); });
    let Some(paths) = receiver.await.map_err(|_| "File picker was cancelled".to_owned())? else { return Ok(Vec::new()); };
    if paths.len() > 10 { return Err("You can attach up to 10 files per message".to_owned()); }
    let mut result = Vec::with_capacity(paths.len());
    let mut stored_paths = Vec::with_capacity(paths.len());
    for path in paths {
        let path = path.into_path().map_err(|error| format!("Could not resolve selected file: {error}"))?;
        let metadata = tokio::fs::metadata(&path).await.map_err(|error| format!("Could not read selected file: {error}"))?;
        if !metadata.is_file() { return Err("Selected attachment is not a file".to_owned()); }
        let filename = path.file_name().and_then(|name| name.to_str()).unwrap_or("attachment").to_owned();
        let upload_id = format!("upload-{}", uuid::Uuid::new_v4());
        result.push(AttachmentSelection { upload_id, filename, size: metadata.len() });
        stored_paths.push(path);
    }
    let mut selections = state.selected_uploads.lock().await;
    selections.retain(|_, (created_at, _)| created_at.elapsed() < std::time::Duration::from_secs(3600));
    for (selection, path) in result.iter().zip(stored_paths) {
        selections.insert(selection.upload_id.clone(), (tokio::time::Instant::now(), vec![path]));
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_upload_limit(state: State<'_, AppState>) -> Result<u64, String> {
    let user = state.router.rest(AccountIdentity::Primary, Method::GET, "users/@me", None).await.map_err(map_err)?;
    let premium_type = user.get("premium_type").and_then(Value::as_u64).unwrap_or(0);
    Ok(match premium_type {
        2 => 500 * 1024 * 1024,
        1 | 3 => 50 * 1024 * 1024,
        _ => 20 * 1024 * 1024,
    })
}

/// Send a message with files selected by the native file picker.
#[tauri::command]
pub async fn send_message_with_files(
    channel_id: String,
    content: String,
    files: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if files.len() > 10 { return Err("You can attach up to 10 files".to_owned()); }
    let paths = {
        let mut selected = state.selected_uploads.lock().await;
        let mut paths = Vec::with_capacity(files.len());
        for upload_id in files {
            let Some((created_at, mut selected_paths)) = selected.remove(&upload_id) else {
                return Err("An attachment selection expired; please choose the file again".to_owned());
            };
            if created_at.elapsed() > std::time::Duration::from_secs(3600) {
                return Err("An attachment selection expired; please choose the file again".to_owned());
            }
            paths.append(&mut selected_paths);
        }
        paths
    };
    state.router.send_message_with_files(AccountIdentity::Primary, &channel_id, &content, paths).await.map_err(map_err)
}

/// Forward a readable source message using Discord's message-reference type FORWARD.
#[tauri::command]
pub async fn forward_message(
    destination_channel_id: String,
    source_channel_id: String,
    message_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if destination_channel_id.is_empty() || source_channel_id.is_empty() || message_id.is_empty() {
        return Err("Source channel, destination channel, and message IDs are required".to_owned());
    }
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::POST,
            &format!("channels/{destination_channel_id}/messages"),
            Some(json!({
                "message_reference": {
                    "type": 1,
                    "message_id": message_id,
                    "channel_id": source_channel_id
                }
            })),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn edit_message(
    channel_id: String,
    message_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if content.trim().is_empty() || content.chars().count() > 2000 {
        return Err("Message content must contain 1–2000 characters".to_owned());
    }
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::PATCH,
            &format!("channels/{channel_id}/messages/{message_id}"),
            Some(json!({ "content": content })),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn delete_message(
    channel_id: String,
    message_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::DELETE,
            &format!("channels/{channel_id}/messages/{message_id}"),
            None,
        )
        .await
        .map(|_| ())
        .map_err(map_err)
}

fn iso8601_after_seconds(seconds: u64) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .saturating_add(seconds);
    let days = (timestamp / 86_400) as i64;
    let seconds_in_day = timestamp % 86_400;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.000Z",
        seconds_in_day / 3_600,
        (seconds_in_day % 3_600) / 60,
        seconds_in_day % 60,
    )
}

#[tauri::command]
pub async fn moderate_guild_member(
    guild_id: String,
    user_id: String,
    action: String,
    timeout_seconds: Option<u64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = format!("guilds/{guild_id}/members/{user_id}");
    match action.as_str() {
        "timeout" => {
            let seconds = timeout_seconds.ok_or("Timeout duration is required")?;
            if seconds == 0 || seconds > 28 * 24 * 60 * 60 {
                return Err("Timeout must be between 1 second and 28 days".to_owned());
            }
            state.router.rest(
                AccountIdentity::Primary,
                Method::PATCH,
                &path,
                Some(json!({ "communication_disabled_until": iso8601_after_seconds(seconds) })),
            ).await.map_err(map_err)?;
        }
        "remove_timeout" => {
            state.router.rest(
                AccountIdentity::Primary,
                Method::PATCH,
                &path,
                Some(json!({ "communication_disabled_until": null })),
            ).await.map_err(map_err)?;
        }
        "kick" => {
            state.router.rest(AccountIdentity::Primary, Method::DELETE, &path, None)
                .await.map_err(map_err)?;
        }
        "ban" => {
            state.router.rest(
                AccountIdentity::Primary,
                Method::PUT,
                &format!("guilds/{guild_id}/bans/{user_id}"),
                Some(json!({ "delete_message_seconds": 0 })),
            ).await.map_err(map_err)?;
        }
        _ => return Err(format!("Unsupported member moderation action: {action}")),
    }
    Ok(())
}

#[tauri::command]
pub async fn set_guild_member_nickname(
    guild_id: String,
    user_id: String,
    nickname: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let nickname = nickname.map(|value| value.trim().to_owned()).filter(|value| !value.is_empty());
    if nickname.as_ref().is_some_and(|value| value.chars().count() > 32) {
        return Err("Nickname cannot exceed 32 characters".to_owned());
    }
    state.router.rest(
        AccountIdentity::Primary,
        Method::PATCH,
        &format!("guilds/{guild_id}/members/{user_id}"),
        Some(json!({ "nick": nickname })),
    ).await.map_err(map_err)
}

#[tauri::command]
pub async fn update_guild_channel(
    channel_id: String,
    name: Option<String>,
    topic: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let mut body = serde_json::Map::new();
    if let Some(name) = name {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 100 {
            return Err("Channel name must contain 1–100 characters".to_owned());
        }
        body.insert("name".to_owned(), json!(name));
    }
    if let Some(topic) = topic {
        if topic.chars().count() > 1024 {
            return Err("Channel topic cannot exceed 1024 characters".to_owned());
        }
        body.insert("topic".to_owned(), json!(topic));
    }
    if body.is_empty() {
        return Err("No channel changes were provided".to_owned());
    }
    state.router.rest(
        AccountIdentity::Primary,
        Method::PATCH,
        &format!("channels/{channel_id}"),
        Some(Value::Object(body)),
    ).await.map_err(map_err)
}

#[tauri::command]
pub async fn set_guild_channel_locked(
    channel_id: String,
    guild_id: String,
    locked: bool,
    restore_send_permission: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    const SEND_MESSAGES: u64 = 1 << 11;
    let channel = state.router.rest(
        AccountIdentity::ReadOnly,
        Method::GET,
        &format!("channels/{channel_id}"),
        None,
    ).await.map_err(map_err)?;
    let overwrite = channel.get("permission_overwrites")
        .and_then(Value::as_array)
        .and_then(|overwrites| overwrites.iter().find(|overwrite| {
            overwrite.get("type").and_then(Value::as_u64) == Some(0)
                && overwrite.get("id").and_then(Value::as_str) == Some(guild_id.as_str())
        }));
    let parse_bits = |key: &str| -> Result<u64, String> {
        match overwrite.and_then(|value| value.get(key)).and_then(Value::as_str) {
            Some(value) => value.parse::<u64>().map_err(map_err),
            None => Ok(0),
        }
    };
    let mut allow = parse_bits("allow")?;
    let mut deny = parse_bits("deny")?;
    if locked {
        allow &= !SEND_MESSAGES;
        deny |= SEND_MESSAGES;
    } else {
        deny &= !SEND_MESSAGES;
        if restore_send_permission {
            allow |= SEND_MESSAGES;
        }
    }
    state.router.rest(
        AccountIdentity::Primary,
        Method::PUT,
        &format!("channels/{channel_id}/permissions/{guild_id}"),
        Some(json!({ "type": 0, "allow": allow.to_string(), "deny": deny.to_string() })),
    ).await.map(|_| ()).map_err(map_err)
}

#[tauri::command]
pub async fn delete_guild_channel(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.router.rest(
        AccountIdentity::Primary,
        Method::DELETE,
        &format!("channels/{channel_id}"),
        None,
    ).await.map(|_| ()).map_err(map_err)
}

#[tauri::command]
pub async fn get_dm_channels(state: State<'_, AppState>) -> Result<Value, String> {
    let mut channels = state
        .router
        .rest(
            AccountIdentity::ReadOnly,
            Method::GET,
            "users/@me/channels",
            None,
        )
        .await
        .map_err(map_err)?;

    // Sắp xếp các DM channel theo last_message_id mới nhất lên đầu
    if let Some(arr) = channels.as_array_mut() {
        arr.retain(|channel| {
            channel.get("is_message_request").and_then(Value::as_bool) != Some(true)
                && channel
                    .get("is_message_request_timestamp")
                    .is_none_or(Value::is_null)
        });
        arr.sort_by(|a, b| {
            let id_a = a.get("last_message_id").and_then(|v| v.as_str()).unwrap_or("0");
            let id_b = b.get("last_message_id").and_then(|v| v.as_str()).unwrap_or("0");
            id_b.cmp(&id_a) // Giảm dần (snowflake lớn hơn = mới hơn)
        });
    }

    Ok(channels)
}

#[tauri::command]
pub async fn get_relationships(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .router
        .rest(
            AccountIdentity::ReadOnly,
            Method::GET,
            "users/@me/relationships",
            None,
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn create_dm(
    recipient_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::POST,
            "users/@me/channels",
            Some(json!({ "recipient_id": recipient_id })),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn add_friend(
    username: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::POST,
            "users/@me/relationships",
            Some(json!({ "username": username, "discriminator": "0" })),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn update_relationship(
    user_id: String,
    action: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let method = match action.as_str() {
        "accept" | "add" | "block" => Method::PUT,
        "ignore" | "remove" | "unblock" => Method::DELETE,
        _ => return Err(format!("Unsupported relationship action: {action}")),
    };
    let body = if method == Method::PUT {
        Some(json!({ "type": if action == "block" { 2 } else { 1 } }))
    } else {
        None
    };
    state
        .router
        .rest(
            AccountIdentity::Primary,
            method,
            &format!("users/@me/relationships/{user_id}"),
            body,
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn set_presence(
    status: String,
    custom_status: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !matches!(status.as_str(), "online" | "idle" | "dnd" | "invisible") {
        return Err(format!("Unsupported presence status: {status}"));
    }
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::PATCH,
            "users/@me/settings",
            Some(json!({
                "status": status,
                "custom_status": custom_status
                    .filter(|text| !text.trim().is_empty())
                    .map(|text| json!({
                        "text": text.trim(),
                        "emoji_name": null,
                        "expires_at": null
                    }))
            })),
        )
        .await
        .map(|_| ())
        .map_err(map_err)
}

#[tauri::command]
pub async fn update_bio(
    bio: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if bio.chars().count() > 190 {
        return Err("Bio must be 190 characters or fewer".to_owned());
    }

    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::PATCH,
            "users/@me/profile",
            Some(json!({ "bio": bio.trim() })),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn get_current_user_settings(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .router
        .rest(
            AccountIdentity::ReadOnly,
            Method::GET,
            "users/@me/settings",
            None,
        )
        .await
        .map_err(map_err)
}

/// Send an observed settings-proto/1 delta. The protobuf field payload remains
/// opaque because this capture does not establish its semantic field names.
#[tauri::command]
pub async fn sync_settings_proto_v1(
    settings_payload: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let envelope = SettingsProtoV1Envelope::from_base64(&settings_payload)
        .map_err(map_err)?;
    let body = serde_json::to_value(envelope).map_err(map_err)?;

    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::PATCH,
            "users/@me/settings-proto/1",
            Some(body),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn get_message_requests(state: State<'_, AppState>) -> Result<Value, String> {
    let channels = state
        .router
        .rest(
            AccountIdentity::ReadOnly,
            Method::GET,
            "users/@me/channels",
            None,
        )
        .await
        .map_err(map_err)?;
    Ok(Value::Array(
        channels
            .as_array()
            .into_iter()
            .flatten()
            .filter(|channel| {
                channel.get("is_message_request").and_then(Value::as_bool) == Some(true)
                    || channel.get("is_message_request_timestamp").is_some_and(|value| !value.is_null())
            })
            .cloned()
            .collect(),
    ))
}

#[tauri::command]
pub async fn update_message_request(
    channel_id: String,
    action: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let endpoint = match action.as_str() {
        "accept" => "accept",
        "ignore" => "dismiss",
        _ => return Err(format!("Unsupported message request action: {action}")),
    };
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::POST,
            &format!("users/@me/message-requests/{channel_id}/{endpoint}"),
            Some(json!({})),
        )
        .await
        .map_err(map_err)
}

/// Subscribe to a bounded window of the selected guild's gateway member lists.
#[tauri::command]
pub async fn request_guild_member_list(
    guild_id: String,
    channel_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if guild_id.is_empty() {
        return Err("A guild ID is required to request its member list".to_owned());
    }
    let channels = channel_ids
        .into_iter()
        .filter(|channel_id| !channel_id.is_empty())
        .take(3)
        .map(|channel_id| (channel_id, json!([[0, 99]])))
        .collect::<serde_json::Map<_, _>>();
    state
        .router
        .send_gateway_payload(json!({
            "op": 14,
            "d": {
                "guild_id": guild_id,
                "typing": true,
                "activities": true,
                "threads": true,
                "members": [],
                "channels": channels
            }
        }))
        .await
        .map_err(map_err)
}

/// Send a user voice-state update through the active gateway session.
/// Voice media negotiation is handled separately after Discord returns both
/// VOICE_STATE_UPDATE and VOICE_SERVER_UPDATE.
#[tauri::command]
pub async fn set_voice_state(
    guild_id: String,
    channel_id: Option<String>,
    self_mute: bool,
    self_deaf: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if guild_id.parse::<u64>().is_err() {
        return Err("A valid guild ID is required for voice channels".to_owned());
    }
    if channel_id.as_deref().is_some_and(|id| id.parse::<u64>().is_err()) {
        return Err("Channel ID must be a numeric Discord snowflake".to_owned());
    }
    state.router.send_gateway_payload(json!({
        "op": 4,
        "d": {
            "guild_id": guild_id,
            "channel_id": channel_id,
            "self_mute": self_mute,
            "self_deaf": self_deaf
        }
    })).await.map_err(map_err)
}

/// Fetch the current user's role IDs for accurate local channel permission checks.
#[tauri::command]
pub async fn get_current_guild_member(
    guild_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state
        .router
        .rest(
            AccountIdentity::ReadOnly,
            Method::GET,
            &format!("users/@me/guilds/{guild_id}/member"),
            None,
        )
        .await
        .map_err(map_err)
}
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DiscordBadge {
    pub id: String,
    pub description: String,
    pub icon: String,
    pub link: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UserProfileResponse {
    pub user: Value,
    pub badges: Vec<DiscordBadge>,
    pub user_profile: Option<Value>,
    pub connected_accounts: Option<Vec<Value>>,
    pub widgets: Option<Vec<Value>>,
}

/// Fetch và parse trọn gói profile kèm badges trực tiếp từ backend Rust
#[tauri::command]
pub async fn get_user_profile(
    user_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let mut profile_json = state
        .router
        .rest(
            AccountIdentity::ReadOnly,
            Method::GET,
            &format!("users/{user_id}/profile?with_mutual_guilds=false&with_mutual_friends=false"),
            None,
        )
        .await
        .map_err(map_err)?;

    // Có thể inject thêm logic xử lý, format hoặc map URL icon badge ngay tại đây nếu muốn!
    if let Some(obj) = profile_json.as_object_mut() {
        if let Some(badges) = obj.get_mut("badges").and_then(|b| b.as_array_mut()) {
            for badge in badges {
                if let Some(icon_hash) = badge.get("icon").and_then(|i| i.as_str()) {
                    // Inject sẵn CDN URL trực tiếp vào object để frontend chỉ việc render thẻ <img>
                    let full_url = format!("https://cdn.discordapp.com/badge-icons/{icon_hash}.png");
                    badge.as_object_mut().unwrap().insert("icon_url".to_string(), Value::String(full_url));
                }
            }
        }
    }

    Ok(profile_json)
}
/// Spawn a long-running gateway task. Real-time events are forwarded to the
/// frontend as Tauri events:
///
/// - `discord:message_create`  – { channel_id, message }
/// - `discord:message_update`  – { channel_id, message }
/// - `discord:message_delete`  – { channel_id, message_id }
/// - `discord:channel_delete`  – deleted channel object
/// - `discord:typing_start`    – { channel_id, user_id }
/// - `discord:guild_create`    – full guild object
/// - `discord:presence_update` – presence object
#[tauri::command]
pub async fn start_gateway(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if let Some(gateway_task) = state.gateway_task.lock().await.take() {
        gateway_task.abort();
    }
    // Clone router + app handle so they can move into the spawned task
    let router = state.router.clone();
    let app = app.clone();

    let gateway_task = tokio::spawn(async move {
        // Retry loop — reconnect on disconnect
        loop {
            emit_rust_log(&app, "debug", "gateway", "Connecting to Discord gateway");
            let _ = app.emit(
                "discord:gateway_status",
                json!({ "status": "connecting" }),
            );
            let app2 = app.clone();
            let result = router
                .listen_gateway(AccountIdentity::ReadOnly, move |event: serde_json::Value| {
                    let t = event.get("t").and_then(Value::as_str).unwrap_or("").to_owned();
                    let d = event.get("d").cloned().unwrap_or(Value::Null);
                    if !t.is_empty() {
                        emit_rust_log(&app2, "debug", "gateway", format!("Received dispatch: {t}"));
                    }

                    match t.as_str() {
                        "MESSAGE_CREATE" => {
                            let channel_id = d
                                .get("channel_id")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_owned();
                            let _ = app2.emit(
                                "discord:message_create",
                                json!({ "channel_id": channel_id, "message": d }),
                            );
                        }
                        "MESSAGE_UPDATE" => {
                            let channel_id = d
                                .get("channel_id")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_owned();
                            let _ = app2.emit(
                                "discord:message_update",
                                json!({ "channel_id": channel_id, "message": d }),
                            );
                        }
                        "MESSAGE_DELETE" => {
                            let channel_id = d
                                .get("channel_id")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_owned();
                            let message_id = d
                                .get("id")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_owned();
                            let _ = app2.emit(
                                "discord:message_delete",
                                json!({ "channel_id": channel_id, "message_id": message_id }),
                            );
                        }
                        "TYPING_START" => {
                            let channel_id = d
                                .get("channel_id")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_owned();
                            let user_id = d
                                .get("user_id")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_owned();
                            let _ = app2.emit(
                                "discord:typing_start",
                                json!({ "channel_id": channel_id, "user_id": user_id }),
                            );
                        }
                        "GUILD_CREATE" => {
                            let _ = app2.emit("discord:guild_create", d);
                        }
                        "GUILD_MEMBER_LIST_UPDATE" => {
                            let _ = app2.emit("discord:guild_member_list_update", d);
                        }
                        "GUILD_MEMBER_ADD" => {
                            let _ = app2.emit("discord:guild_member_add", d);
                        }
                        "GUILD_MEMBER_UPDATE" => {
                            let _ = app2.emit("discord:guild_member_update", d);
                        }
                        "GUILD_MEMBER_REMOVE" => {
                            let _ = app2.emit("discord:guild_member_remove", d);
                        }
                        "CHANNEL_DELETE" => {
                            let _ = app2.emit("discord:channel_delete", d);
                        }
                        "PRESENCE_UPDATE" => {
                            let _ = app2.emit("discord:presence_update", d);
                        }
                        "VOICE_STATE_UPDATE" => {
                            let _ = app2.emit("discord:voice_state_update", d);
                        }
                        "VOICE_SERVER_UPDATE" => {
                            let _ = app2.emit("discord:voice_server_update", d);
                        }
                        "READY" => {
                            emit_rust_log(&app2, "info", "gateway", "Gateway READY received");
                            let _ = app2.emit(
                                "discord:gateway_status",
                                json!({ "status": "connected" }),
                            );
                            let _ = app2.emit("discord:gateway_ready", d);
                        }
                        _ => {}
                    }
                })
                .await;

            if let Err(e) = result {
                eprintln!("[VoidCord gateway] disconnected: {e}. Reconnecting in 5s…");
                emit_rust_log(&app, "warn", "gateway", format!("Gateway disconnected: {e}; retrying in 5 seconds"));
                let _ = app.emit(
                    "discord:gateway_status",
                    json!({ "status": "reconnecting", "detail": e.to_string() }),
                );
            } else {
                emit_rust_log(&app, "warn", "gateway", "Gateway listener ended; retrying in 5 seconds");
                let _ = app.emit(
                    "discord:gateway_status",
                    json!({ "status": "reconnecting" }),
                );
            }
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });

    *state.gateway_task.lock().await = Some(gateway_task);

    Ok(())
}
/// Fetch all roles in a guild.
#[tauri::command]
pub async fn get_guild_roles(
    guild_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state
        .router
        .rest(
            AccountIdentity::ReadOnly,
            Method::GET,
            &format!("guilds/{guild_id}/roles"),
            None,
        )
        .await
        .map_err(map_err)
}



/// Kết nối tới Voice Channel bằng Voice Gateway & UDP Transport
#[tauri::command]
pub async fn connect_voice(
    guild_id: String,
    channel_id: String,
    endpoint: String,
    session_id: String,
    token: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    // 1. Ngắt voice session cũ nếu đang chạy
    if let Some(task) = state.voice_task.lock().await.take() {
        task.abort();
    }

    // 2. Lấy user_id hiện tại từ token session
    let user = state
        .router
        .rest(AccountIdentity::ReadOnly, Method::GET, "users/@me", None)
        .await
        .map_err(map_err)?;

    let user_id = user
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Could not resolve user ID")?
        .to_owned();

    let config = VoiceGatewayConfig {
        endpoint,
        guild_id,
        channel_id,
        user_id,
        session_id,
        token,
    };

    // 3. Khởi tạo VoiceGateway
    let gateway = VoiceGateway::new(config).await?;

    // 4. Spawn task chạy ngầm Voice Gateway session
    let voice_task = tokio::spawn(async move {
        emit_rust_log(&app, "info", "voice", "Starting Voice Gateway connection...");
        if let Err(err) = gateway.run().await {
            emit_rust_log(&app, "error", "voice", format!("Voice session error: {err}"));
        }
    });

    *state.voice_task.lock().await = Some(voice_task);
    Ok(())
}

/// Ngắt kết nối Voice Channel
#[tauri::command]
pub async fn disconnect_voice(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(task) = state.voice_task.lock().await.take() {
        task.abort();
    }
    Ok(())
}

/// Open or close Webview Developer Tools (Console).
#[tauri::command]
pub async fn toggle_devtools(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_devtools_open() {
            window.close_devtools();
        } else {
            window.open_devtools();
        }
    }
    Ok(())
}
