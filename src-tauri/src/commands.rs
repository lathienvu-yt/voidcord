//! Tauri command handlers — thin glue between the frontend and DiscordRouter.
//!
//! All heavy networking lives in discord_router.rs. These commands just
//! translate between JSON payloads the frontend sends and what the router needs.

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::discord_router::{AccountIdentity, TokenManager};
use crate::settings_proto::SettingsProtoV1Envelope;
use crate::voice_gateway::{
    list_audio_devices as enumerate_audio_devices, VoiceControlState, VoiceGatewayConfig,
    VoiceSession,
};
use crate::AppState;
use crate::gateway_ipc::{GatewayIpc, GatewayIpcConfig};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountReadCredential {
    account_id: String,
    token: String,
}

fn validate_account_read_credentials(
    accounts: Vec<AccountReadCredential>,
) -> Result<Vec<AccountReadCredential>, String> {
    if accounts.len() > 10 {
        return Err("At most 10 accounts can be read at once".to_owned());
    }
    let mut seen = HashSet::new();
    let accounts = accounts
        .into_iter()
        .filter(|account| {
            !account.account_id.is_empty()
                && account.account_id.chars().all(|c| c.is_ascii_digit())
                && !account.token.is_empty()
                && account.token.len() <= 4096
                && seen.insert(account.account_id.clone())
        })
        .collect::<Vec<_>>();
    if accounts.is_empty() {
        return Err("No authenticated accounts are available".to_owned());
    }
    Ok(accounts)
}

fn merge_account_dm_channels(account_channels: Vec<(String, Vec<Value>)>) -> Value {
    let mut channels = Vec::new();
    for (account_id, account_channels) in account_channels {
        for mut channel in account_channels {
            if is_message_request(&channel) {
                continue;
            }
            if let Some(object) = channel.as_object_mut() {
                object.insert("account_id".to_owned(), Value::String(account_id.clone()));
            }
            channels.push(channel);
        }
    }

    let mut seen = HashSet::new();
    channels.retain(|channel| {
        channel
            .get("id")
            .and_then(Value::as_str)
            .map(|id| seen.insert(id.to_owned()))
            .unwrap_or(false)
    });
    channels.sort_by(|a, b| {
        let id_a = a
            .get("last_message_id")
            .and_then(Value::as_str)
            .unwrap_or("0");
        let id_b = b
            .get("last_message_id")
            .and_then(Value::as_str)
            .unwrap_or("0");
        id_b.cmp(id_a)
    });
    Value::Array(channels)
}

#[tauri::command]
pub async fn open_rust_console(app: AppHandle) -> Result<(), String> {
    log::info!("Rust console toggle requested from toolbar");
    crate::open_rust_console_window(&app)
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn map_err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn is_bot_credential(token: &str) -> bool {
    token.split_once(' ').is_some_and(|(scheme, value)| {
        scheme.eq_ignore_ascii_case("bot") && !value.trim().is_empty()
    })
}

async fn ensure_credential_available(state: &AppState, token: &str) -> Result<(), String> {
    if state.router.account_credential_available(token).await {
        Ok(())
    } else {
        Err("This Discord account is unavailable or requires verification".to_owned())
    }
}

fn encode_query_component(input: &str) -> String {
    let mut encoded = String::new();
    for byte in input.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn emit_rust_log(app: &AppHandle, level: &str, target: &str, message: impl Into<String>) {
    let app = app.clone();
    let level = level.to_owned();
    let target = target.to_owned();
    let message = message.into();

    // Spawn off completely decoupled from the gateway dispatch execution context
    tauri::async_runtime::spawn(async move {
        let _ = app.emit(
            "voidcord:rust-log",
            json!({
                "level": level,
                "target": target,
                "message": message,
            }),
        );
    });
}

/// After the token is set we rebuild the router's token manager.
async fn rebuild_router(state: &AppState, token: &str) {
    state
        .router
        .update_tokens(TokenManager::new(
            Some(token.to_owned()), // primary  (writes)
            None,                   // secondary
            Some(token.to_owned()), // read-only (reads / gateway)
        ))
        .await;
}

// ── commands ──────────────────────────────────────────────────────────────────

/// Save a user or bot token and validate it by fetching /users/@me.
/// Emits `discord:ready` with the user object on success.
#[tauri::command]
pub async fn set_token(
    token: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    emit_rust_log(&app, "debug", "auth", "Validating Discord credentials");
    log::debug!("Validating Discord credentials");

    // Safely scope the token lock acquisition so it drops immediately after cloning
    let previous_token = {
        let token_guard = state.token.lock().await;
        token_guard.clone()
    };

    rebuild_router(&state, &token).await;

    let me = match state
        .router
        .rest(AccountIdentity::Primary, Method::GET, "users/@me", None)
        .await
    {
        Ok(user) => user,
        Err(error) => {
            emit_rust_log(&app, "warn", "auth", "Discord credential validation failed");
            log::warn!("Discord credential validation failed");
            let message = map_err(error);

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
    state.router.record_credential_health(&token, true).await;

    // Clean up existing background tasks cleanly without deadlocking locks
    if let Some(gateway_task) = state.gateway_task.lock().await.take() {
        gateway_task.abort();
    }
    state
        .voice_controls
        .generation
        .fetch_add(1, Ordering::SeqCst);
    if let Some(voice_task) = state.voice_task.lock().await.take() {
        voice_task.abort();
    }

    rebuild_router(&state, &token).await;

    {
        let mut token_guard = state.token.lock().await;
        *token_guard = Some(token.clone());
    }

    emit_rust_log(
        &app,
        "info",
        "auth",
        "Discord credentials validated successfully",
    );
    log::info!("Discord credentials validated successfully");
    let _ = app.emit("discord:ready", &me);
    Ok(me)
}

/// Fetch the current user object (/users/@me).
#[tauri::command]
pub async fn get_current_user(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .router
        .rest(AccountIdentity::Primary, Method::GET, "users/@me", None)
        .await
        .map_err(map_err)
}

/// Fetch OAuth2 authorize prompt info (GET /oauth2/authorize?...).
#[tauri::command]
pub async fn get_oauth2_authorize(
    query: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let path = format!("oauth2/authorize?{query}");
    state
        .router
        .rest(AccountIdentity::Primary, Method::GET, &path, None)
        .await
        .map_err(map_err)
}

/// Submit OAuth2 authorize prompt (POST /oauth2/authorize?...).
#[tauri::command]
pub async fn submit_oauth2_authorize(
    query: String,
    authorize: bool,
    permissions: Option<String>,
    guild_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let path = format!("oauth2/authorize?{query}");
    let mut body = serde_json::json!({
        "authorize": authorize,
        "permissions": permissions.unwrap_or_else(|| "0".to_owned())
    });
    if let Some(gid) = guild_id {
        body["guild_id"] = serde_json::json!(gid);
    }
    state
        .router
        .rest(AccountIdentity::Primary, Method::POST, &path, Some(body))
        .await
        .map_err(map_err)
}

/// Follow an OAuth2 redirect URL with Accept: application/json (e.g. ReviewDB code exchange).
#[tauri::command]
pub async fn complete_oauth2_redirect(
    url: String,
    client_mod: Option<String>,
) -> Result<Value, String> {
    let mut parsed = url::Url::parse(&url).map_err(|e| format!("Invalid redirect URL: {e}"))?;
    if let Some(cm) = client_mod {
        parsed.query_pairs_mut().append_pair("clientMod", &cm);
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(parsed.as_str())
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("OAuth redirect request failed: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("OAuth redirect returned status {status}: {text}"));
    }
    serde_json::from_str(&text).or_else(|_| Ok(serde_json::json!({ "raw": text })))
}

/// Fetch notification center items for the current user.
#[tauri::command]
pub async fn get_notification_center_items(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::GET,
            "users/@me/notification-center/items?limit=50&with_mentions=true",
            None,
        )
        .await
        .map_err(map_err)
}

/// Acknowledge one notification center item.
#[tauri::command]
pub async fn ack_notification_center_item(
    item_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if item_id.parse::<u64>().is_err() {
        return Err("A valid notification ID is required".to_owned());
    }
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::POST,
            &format!("users/@me/notification-center/items/{item_id}/ack"),
            Some(json!({})),
        )
        .await
        .map_err(map_err)
}

/// Acknowledge the latest visible message in a channel.
#[tauri::command]
pub async fn acknowledge_message(
    channel_id: String,
    message_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if channel_id.parse::<u64>().is_err() || message_id.parse::<u64>().is_err() {
        return Err("A valid channel ID and message ID are required".to_owned());
    }
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::POST,
            &format!("channels/{channel_id}/messages/{message_id}/ack"),
            Some(json!({ "token": null })),
        )
        .await
        .map_err(map_err)
}

/// Fetch Discord's client-internal content inventory for the current user's activity feed.
/// The optional refresh token is kept in the frontend session and is never logged.
#[tauri::command]
pub async fn get_content_inventory(
    refresh_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let mut path =
        String::from("api-v9/content-inventory/users/@me?for_game_profile=false&feature=inbox");
    if let Some(token) = refresh_token.filter(|value| !value.is_empty()) {
        path.push_str("&refresh_token=");
        path.push_str(&encode_query_component(&token));
    }
    state
        .router
        .rest(AccountIdentity::Primary, Method::GET, &path, None)
        .await
        .map_err(map_err)
}

/// Fetch the full guild object for the server settings view.
#[tauri::command]
pub async fn get_guild_settings(guild_id: String, state: State<'_, AppState>) -> Result<Value, String> {
    if guild_id.parse::<u64>().is_err() { return Err("A valid server ID is required".to_owned()); }
    state.router.rest(AccountIdentity::ReadOnly, Method::GET, &format!("guilds/{guild_id}?with_counts=true"), None).await.map_err(map_err)
}

/// Update a validated subset of documented guild configuration fields.
#[tauri::command]
pub async fn update_guild_settings(guild_id: String, settings: Value, state: State<'_, AppState>) -> Result<Value, String> {
    if guild_id.parse::<u64>().is_err() { return Err("A valid server ID is required".to_owned()); }
    let object = settings.as_object().ok_or_else(|| "Guild settings must be a JSON object".to_owned())?;
    const ALLOWED: &[&str] = &["name", "description", "verification_level", "default_message_notifications", "explicit_content_filter", "afk_channel_id", "afk_timeout", "system_channel_id", "system_channel_flags", "rules_channel_id", "public_updates_channel_id", "preferred_locale", "premium_progress_bar_enabled", "safety_alerts_channel_id", "banner"];
    if object.is_empty() || object.keys().any(|key| !ALLOWED.contains(&key.as_str())) { return Err("The settings payload is empty or contains unsupported fields".to_owned()); }
    if let Some(value) = object.get("name") { let name = value.as_str().ok_or("Server name must be text")?; if name.trim().is_empty() || name.chars().count() > 100 { return Err("Server name must contain 1–100 characters".to_owned()); } }
    for (field, max) in [("verification_level", 4_i64), ("explicit_content_filter", 2), ("default_message_notifications", 1)] { if let Some(value) = object.get(field) { let number = value.as_i64().ok_or_else(|| format!("{field} must be an integer"))?; if number < 0 || number > max { return Err(format!("{field} is outside the supported range")); } } }
    if let Some(value) = object.get("afk_timeout") { let timeout = value.as_i64().ok_or("AFK timeout must be an integer")?; if ![60, 300, 900, 1800, 3600].contains(&timeout) { return Err("AFK timeout must be 60, 300, 900, 1800, or 3600 seconds".to_owned()); } }
    for field in ["description", "preferred_locale"] { if let Some(value) = object.get(field) { if !value.is_null() { let value = value.as_str().ok_or_else(|| format!("{field} must be text or null"))?; let limit = if field == "description" { 120 } else { 16 }; if value.chars().count() > limit { return Err(format!("{field} is too long")); } } } }
    for field in ["afk_channel_id", "system_channel_id", "rules_channel_id", "public_updates_channel_id", "safety_alerts_channel_id"] { if let Some(value) = object.get(field) { if !value.is_null() && value.as_str().and_then(|id| id.parse::<u64>().ok()).is_none() { return Err(format!("{field} must be a valid channel ID or null")); } } }
    if let Some(value) = object.get("premium_progress_bar_enabled") { if !value.is_boolean() { return Err("premium_progress_bar_enabled must be a boolean".to_owned()); } }
    if let Some(value) = object.get("banner") {
        if !value.is_null() {
            let image = value.as_str().ok_or("banner must be an image data URI or null")?;
            let valid_prefix = ["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/gif;base64,"].iter().any(|prefix| image.starts_with(prefix));
            if !valid_prefix || image.len() > 14 * 1024 * 1024 { return Err("Banner must be a PNG, JPEG, or GIF data URI no larger than 10 MB".to_owned()); }
        }
    }
    state.router.rest(AccountIdentity::Primary, Method::PATCH, &format!("guilds/{guild_id}"), Some(settings)).await.map_err(map_err)
}

/// Leave a guild for the authenticated current user.
#[tauri::command]
pub async fn leave_guild(guild_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if guild_id.parse::<u64>().is_err() {
        return Err("A valid server ID is required".to_owned());
    }
    state.router.rest(AccountIdentity::Primary, Method::DELETE, &format!("users/@me/guilds/{guild_id}"), None).await.map(|_| ()).map_err(map_err)
}

/// Fetch all guilds the current user is a member of.
#[tauri::command]
pub async fn get_guilds(
    as_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if let Some(token) = as_token.as_deref() {
        ensure_credential_available(&state, token).await?;
        state
            .router
            .rest_with_auth(
                Some(token),
                AccountIdentity::Primary,
                Method::GET,
                "users/@me/guilds",
                None,
            )
            .await
            .map_err(map_err)
    } else {
        if let Some(token) = state.token.lock().await.clone() {
            ensure_credential_available(&state, &token).await?;
        }
        state
            .router
            .rest(
                AccountIdentity::Primary,
                Method::GET,
                "users/@me/guilds",
                None,
            )
            .await
            .map_err(map_err)
    }
}

#[tauri::command]
pub async fn retry_captcha_request(
    request_id: String,
    captcha_key: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state
        .router
        .retry_captcha(&request_id, &captcha_key)
        .await
        .map_err(map_err)
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
    if code.is_empty()
        || !code
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Enter a valid Discord invite code or URL".to_owned());
    }
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::POST,
            &format!("invites/{code}"),
            Some(json!({})),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn create_guild(name: String, state: State<'_, AppState>) -> Result<Value, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err("Server name must contain 1–100 characters".to_owned());
    }
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::POST,
            "guilds",
            Some(json!({ "name": name })),
        )
        .await
        .map_err(map_err)
}

/// Fetch all channels in a guild.
#[tauri::command]
pub async fn get_channels(guild_id: String, state: State<'_, AppState>) -> Result<Value, String> {
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

/// Fetch threads for a channel (forums and text channels).
/// Uses user-facing /channels/{channel_id}/threads/search, falling back to /channels/{channel_id}/threads/archived/public.
#[tauri::command]
pub async fn get_channel_threads(
    channel_id: String,
    archived: Option<bool>,
    query: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if channel_id.parse::<u64>().is_err() {
        return Err("A valid channel ID is required".to_owned());
    }

    let mut search_endpoint = format!(
        "channels/{channel_id}/threads/search?sort_by=last_message_time&sort_order=desc&limit=50"
    );
    if let Some(archived_flag) = archived {
        search_endpoint.push_str(&format!("&archived={archived_flag}"));
    }
    if let Some(ref q) = query {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            let encoded: String =
                url::form_urlencoded::byte_serialize(trimmed.as_bytes()).collect();
            search_endpoint.push_str(&format!("&name={encoded}"));
        }
    }

    let search_result = state
        .router
        .rest(
            AccountIdentity::ReadOnly,
            Method::GET,
            &search_endpoint,
            None,
        )
        .await;

    match search_result {
        Ok(val) => {
            if val.get("threads").and_then(Value::as_array).is_some() {
                return Ok(val);
            }
            // If 202 Index not yet available, try archived/public endpoint
            let archived_result = state
                .router
                .rest(
                    AccountIdentity::ReadOnly,
                    Method::GET,
                    &format!("channels/{channel_id}/threads/archived/public"),
                    None,
                )
                .await;
            if let Ok(archived_val) = archived_result {
                return Ok(archived_val);
            }
            Ok(val)
        }
        Err(_) => {
            // Fallback to archived/public endpoint
            state
                .router
                .rest(
                    AccountIdentity::ReadOnly,
                    Method::GET,
                    &format!("channels/{channel_id}/threads/archived/public"),
                    None,
                )
                .await
                .map_err(map_err)
        }
    }
}

/// Legacy command kept for safety: Discord GET guilds/{guild_id}/threads/active is bot-only (code 20002).
/// Returns an empty list so user accounts do not receive HTTP 403 Forbidden.
#[tauri::command]
pub async fn get_active_guild_threads(
    guild_id: String,
    _state: State<'_, AppState>,
) -> Result<Value, String> {
    if guild_id.parse::<u64>().is_err() {
        return Err("A valid server ID is required".to_owned());
    }
    Ok(serde_json::json!({ "threads": [], "members": [] }))
}

fn find_message_by_id(messages: Value, message_id: &str) -> Result<Value, String> {
    messages
        .as_array()
        .and_then(|messages| {
            messages
                .iter()
                .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))
        })
        .cloned()
        .ok_or_else(|| {
            format!("Message {message_id} was not returned by the surrounding message query")
        })
}

/// Re-fetch one message via the user-accessible channel message-list endpoint.
#[tauri::command]
pub async fn get_message(
    channel_id: String,
    message_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if channel_id.parse::<u64>().is_err() || message_id.parse::<u64>().is_err() {
        return Err("A valid channel ID and message ID are required".to_owned());
    }
    let messages = state
        .router
        .rest(
            AccountIdentity::ReadOnly,
            Method::GET,
            &format!("channels/{channel_id}/messages?limit=5&around={message_id}"),
            None,
        )
        .await
        .map_err(map_err)?;
    find_message_by_id(messages, &message_id)
}

/// Fetch the 50 most-recent messages for a channel.
/// Returns Ok(array) on success, Err("MISSING_ACCESS") on 403, Err("MISSING_PERMS") on 50013, other errors as string.
#[tauri::command]
pub async fn get_messages(
    channel_id: String,
    before: Option<String>,
    as_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let path = if let Some(b) = before {
        format!("channels/{channel_id}/messages?limit=50&before={b}")
    } else {
        format!("channels/{channel_id}/messages?limit=50")
    };
    if let Some(token) = as_token.as_deref() {
        ensure_credential_available(&state, token).await?;
    }
    match state
        .router
        .rest_with_auth(
            as_token.as_deref(),
            AccountIdentity::ReadOnly,
            Method::GET,
            &path,
            None,
        )
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

fn is_snowflake(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn is_message_request(channel: &Value) -> bool {
    channel.get("is_message_request").and_then(Value::as_bool) == Some(true)
        || channel.get("is_spam").and_then(Value::as_bool) == Some(true)
        || (channel.get("flags").and_then(Value::as_i64).unwrap_or(0) & (1 << 5)) != 0
}

fn merge_supplemental_message_requests(channels: &[Value], supplemental: &Value) -> Vec<Value> {
    // Supplemental data supplies previews; it does NOT establish request status.
    // Only enrich channels already identified as pending requests by channel metadata.
    let channels_by_id = channels
        .iter()
        .filter(|channel| is_message_request(channel))
        .filter_map(|channel| {
            Some((channel.get("id")?.as_str()?.to_owned(), channel))
        })
        .collect::<std::collections::HashMap<_, _>>();
    supplemental
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let channel_id = entry.get("channel_id")?.as_str()?;
            let preview = entry.get("message_preview")?;
            let mut channel = channels_by_id.get(channel_id)?.to_owned().clone();
            channel["message_preview"] = preview.clone();
            channel["is_message_request"] = Value::Bool(true);
            Some(channel)
        })
        .collect()
}

#[cfg(test)]
mod message_request_tests {
    use super::{
        find_message_by_id, is_bot_credential, is_message_request,
        merge_supplemental_message_requests,
    };
    use serde_json::json;

    #[test]
    fn identifies_bot_tokens_without_misclassifying_user_tokens() {
        assert!(is_bot_credential("Bot bot-token"));
        assert!(is_bot_credential("bot bot-token"));
        assert!(!is_bot_credential("user-token"));
        assert!(!is_bot_credential("Bot "));
    }

    #[test]
    fn explicit_false_request_status_overrides_stale_timestamp() {
        assert!(!is_message_request(&json!({
            "is_message_request": false,
            "is_message_request_timestamp": "2026-11-01T00:00:00Z",
            "is_spam": false,
            "flags": 0
        })));
    }

    #[test]
    fn timestamp_alone_does_not_identify_a_pending_request() {
        assert!(!is_message_request(&json!({
            "is_message_request_timestamp": "2026-11-01T00:00:00Z"
        })));
    }

    #[test]
    fn spam_flag_is_still_a_message_request() {
        assert!(is_message_request(&json!({ "flags": 1 << 5 })));
        assert!(is_message_request(&json!({ "is_spam": true })));
    }

    #[test]
    fn regular_dm_without_request_metadata_is_not_a_request() {
        assert!(!is_message_request(&json!({
            "is_message_request": false,
            "is_message_request_timestamp": null,
            "is_spam": false,
            "flags": 0
        })));
    }

    #[test]
    fn supplemental_data_never_promotes_an_ordinary_dm_to_a_request() {
        let channels = vec![
            json!({ "id": "123", "type": 1, "is_message_request": false, "flags": 0 }),
            json!({ "id": "456", "type": 1, "is_message_request": true, "flags": 0 }),
        ];
        let supplemental = json!([
            { "channel_id": "123", "message_preview": { "id": "789", "content": "Ordinary DM" } },
            { "channel_id": "456", "message_preview": { "id": "790", "content": "Pending request" } }
        ]);

        let requests = merge_supplemental_message_requests(&channels, &supplemental);
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0]["id"], "456");
        assert_eq!(requests[0]["message_preview"]["content"], "Pending request");
        assert!(is_message_request(&requests[0]));
    }

    #[test]
    fn stale_timestamp_without_request_flag_is_not_enough() {
        assert!(!is_message_request(&json!({
            "is_message_request_timestamp": "2026-11-01T00:00:00Z",
            "is_spam": false,
            "flags": 0
        })));
    }
    #[test]
    fn surrounding_message_query_selects_the_exact_target() {
        let messages = json!([
            { "id": "101" },
            { "id": "102" },
            { "id": "103" },
            { "id": "104" },
            { "id": "105" }
        ]);
        assert_eq!(find_message_by_id(messages, "103").unwrap()["id"], "103");
    }

    #[test]
    fn surrounding_message_query_does_not_return_a_neighbor_when_target_is_missing() {
        let messages = json!([{ "id": "101" }, { "id": "102" }]);
        assert!(find_message_by_id(messages, "103").is_err());
    }
}

#[cfg(test)]
mod game_activity_tests {
    use super::{
        build_custom_rpc_activity, first_running_game, validate_game_process_mappings,
        CustomRpcActivity, CustomRpcButton, GameProcessMapping,
    };
    use serde_json::json;
    use std::collections::HashSet;

    #[test]
    fn game_detection_matches_configured_process_names_case_insensitively() {
        let mappings = vec![
            GameProcessMapping {
                process_name: "GameA.exe".to_owned(),
                display_name: "Game A".to_owned(),
            },
            GameProcessMapping {
                process_name: "gameb.exe".to_owned(),
                display_name: "Game B".to_owned(),
            },
        ];
        let running = HashSet::from(["gameb.exe".to_owned()]);
        assert_eq!(first_running_game(&mappings, &running), Some("Game B"));
    }

    #[test]
    fn game_detection_rejects_paths_and_empty_names() {
        assert!(validate_game_process_mappings(&[GameProcessMapping {
            process_name: "C:\\Games\\game.exe".to_owned(),
            display_name: "Game".to_owned(),
        }])
        .is_err());
        assert!(validate_game_process_mappings(&[GameProcessMapping {
            process_name: "game.exe".to_owned(),
            display_name: "  ".to_owned(),
        }])
        .is_err());
    }

    #[test]
    fn custom_rpc_builder_preserves_rich_presence_fields() {
        let activity = build_custom_rpc_activity(CustomRpcActivity {
            application_id: "123456789012345678".to_owned(),
            name: "My Game".to_owned(),
            activity_type: 0,
            stream_url: None,
            details: Some("In a match".to_owned()),
            state: Some("Ranked".to_owned()),
            large_image: Some("game_logo".to_owned()),
            large_text: Some("Game logo".to_owned()),
            small_image: None,
            small_text: None,
            start_timestamp: Some(1_700_000_000_000),
            end_timestamp: None,
            party_size: Some(2),
            party_max: Some(4),
            buttons: vec![CustomRpcButton {
                label: "Join".to_owned(),
                url: "https://example.com/join".to_owned(),
            }],
        })
        .unwrap();

        assert_eq!(activity["application_id"], "123456789012345678");
        assert_eq!(activity["details"], "In a match");
        assert_eq!(activity["state"], "Ranked");
        assert_eq!(activity["assets"]["large_image"], "game_logo");
        assert_eq!(activity["timestamps"]["start"], 1_700_000_000_000i64);
        assert_eq!(activity["party"]["size"], json!([2, 4]));
        assert_eq!(activity["buttons"][0]["label"], "Join");
    }

    #[test]
    fn custom_rpc_rejects_insecure_button_urls_and_invalid_party_sizes() {
        let activity = CustomRpcActivity {
            application_id: "123".to_owned(),
            name: "Game".to_owned(),
            activity_type: 0,
            stream_url: None,
            details: None,
            state: None,
            large_image: None,
            large_text: None,
            small_image: None,
            small_text: None,
            start_timestamp: None,
            end_timestamp: None,
            party_size: Some(5),
            party_max: Some(4),
            buttons: vec![CustomRpcButton {
                label: "Unsafe".to_owned(),
                url: "http://example.com".to_owned(),
            }],
        };
        assert!(build_custom_rpc_activity(activity).is_err());
    }

    #[test]
    fn streaming_custom_rpc_requires_and_includes_an_https_url() {
        let activity = CustomRpcActivity {
            application_id: "123".to_owned(),
            name: "Live stream".to_owned(),
            activity_type: 1,
            stream_url: None,
            details: None,
            state: None,
            large_image: None,
            large_text: None,
            small_image: None,
            small_text: None,
            start_timestamp: None,
            end_timestamp: None,
            party_size: None,
            party_max: None,
            buttons: Vec::new(),
        };
        assert!(build_custom_rpc_activity(activity).is_err());
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
        .timeout(std::time::Duration::from_secs(5))
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
        .filter(|value| {
            value.starts_with("image/")
                || value.starts_with("video/")
                || value.starts_with("audio/")
        })
        .unwrap_or("application/octet-stream")
        .to_owned();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(map_err)? {
        if bytes.len() + chunk.len() > MAX_MEDIA_BYTES {
            return Err("Media is larger than the 12 MiB archive limit".to_owned());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(format!(
        "data:{content_type};base64,{}",
        encode_base64(&bytes)
    ))
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
    reply_to_message_id: Option<String>,
    as_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let mut payload = json!({ "content": content });
    if let Some(message_id) = reply_to_message_id {
        if message_id.parse::<u64>().is_err() {
            return Err("A valid message ID is required to reply".to_owned());
        }
        payload["message_reference"] = json!({
            "message_id": message_id,
            "channel_id": channel_id,
            "fail_if_not_exists": false
        });
    }
    if let Some(token) = as_token.as_deref() {
        ensure_credential_available(&state, token).await?;
    }
    state
        .router
        .rest_with_auth(
            as_token.as_deref(),
            AccountIdentity::Primary,
            Method::POST,
            &format!("channels/{channel_id}/messages"),
            Some(payload),
        )
        .await
        .map_err(map_err)
}

/// Create a native Discord poll message.
#[tauri::command]
pub async fn create_poll(
    channel_id: String,
    question: String,
    answers: Vec<String>,
    duration: u64,
    allow_multiselect: bool,
    as_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let valid_id = |value: &str| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
    if !valid_id(&channel_id) {
        return Err("A valid channel ID is required".to_owned());
    }
    let question = question.trim();
    if question.is_empty() || question.chars().count() > 300 {
        return Err("Poll questions must contain 1–300 characters".to_owned());
    }
    if !(2..=10).contains(&answers.len()) {
        return Err("Polls need between 2 and 10 answers".to_owned());
    }
    let answers = answers.into_iter().map(|answer| answer.trim().to_owned()).collect::<Vec<_>>();
    if answers.iter().any(|answer| answer.is_empty() || answer.chars().count() > 55) {
        return Err("Each poll answer must contain 1–55 characters".to_owned());
    }
    if ![1, 4, 8, 24, 72, 168].contains(&duration) {
        return Err("Choose a supported poll duration".to_owned());
    }
    if let Some(token) = as_token.as_deref() {
        ensure_credential_available(&state, token).await?;
    }
    let payload = json!({
        "poll": {
            "question": { "text": question },
            "answers": answers.into_iter().map(|answer| json!({ "poll_media": { "text": answer } })).collect::<Vec<_>>(),
            "duration": duration,
            "allow_multiselect": allow_multiselect,
            "layout_type": 1
        }
    });
    state.router.rest_with_auth(
        as_token.as_deref(),
        AccountIdentity::Primary,
        Method::POST,
        &format!("channels/{channel_id}/messages"),
        Some(payload),
    ).await.map_err(map_err)
}

/// Submit the current user's selected answers for a poll.
#[tauri::command]
pub async fn vote_poll(
    channel_id: String,
    message_id: String,
    answer_ids: Vec<u64>,
    as_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let valid_id = |value: &str| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
    if !valid_id(&channel_id) || !valid_id(&message_id) {
        return Err("Channel and message IDs must be numeric Discord IDs".to_owned());
    }
    if answer_ids.len() > 10 {
        return Err("Too many poll answers selected".to_owned());
    }
    if let Some(token) = as_token.as_deref() {
        ensure_credential_available(&state, token).await?;
    }
    state.router.rest_with_auth(
        as_token.as_deref(),
        AccountIdentity::Primary,
        Method::PUT,
        &format!("channels/{channel_id}/polls/{message_id}/answers/@me"),
        Some(json!({ "answer_ids": answer_ids })),
    ).await.map(|_| ()).map_err(map_err)
}

/// End a poll created by the current user.
#[tauri::command]
pub async fn end_poll(
    channel_id: String,
    message_id: String,
    as_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let valid_id = |value: &str| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
    if !valid_id(&channel_id) || !valid_id(&message_id) {
        return Err("Channel and message IDs must be numeric Discord IDs".to_owned());
    }
    if let Some(token) = as_token.as_deref() {
        ensure_credential_available(&state, token).await?;
    }
    state.router.rest_with_auth(
        as_token.as_deref(),
        AccountIdentity::Primary,
        Method::POST,
        &format!("channels/{channel_id}/polls/{message_id}/expire"),
        None,
    ).await.map_err(map_err)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentSelection {
    upload_id: String,
    filename: String,
    size: u64,
}

#[tauri::command]
pub async fn select_attachment_files(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<AttachmentSelection>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_files(move |paths| {
        let _ = sender.send(paths);
    });
    let Some(paths) = receiver
        .await
        .map_err(|_| "File picker was cancelled".to_owned())?
    else {
        return Ok(Vec::new());
    };
    if paths.len() > 10 {
        return Err("You can attach up to 10 files per message".to_owned());
    }
    let mut result = Vec::with_capacity(paths.len());
    let mut stored_paths = Vec::with_capacity(paths.len());
    for path in paths {
        let path = path
            .into_path()
            .map_err(|error| format!("Could not resolve selected file: {error}"))?;
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|error| format!("Could not read selected file: {error}"))?;
        if !metadata.is_file() {
            return Err("Selected attachment is not a file".to_owned());
        }
        let filename = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("attachment")
            .to_owned();
        let upload_id = format!("upload-{}", uuid::Uuid::new_v4());
        result.push(AttachmentSelection {
            upload_id,
            filename,
            size: metadata.len(),
        });
        stored_paths.push(path);
    }
    let mut selections = state.selected_uploads.lock().await;
    selections
        .retain(|_, (created_at, _)| created_at.elapsed() < std::time::Duration::from_secs(3600));
    for (selection, path) in result.iter().zip(stored_paths) {
        selections.insert(
            selection.upload_id.clone(),
            (tokio::time::Instant::now(), vec![path]),
        );
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_upload_limit(state: State<'_, AppState>) -> Result<u64, String> {
    let user = state
        .router
        .rest(AccountIdentity::Primary, Method::GET, "users/@me", None)
        .await
        .map_err(map_err)?;
    let premium_type = user
        .get("premium_type")
        .and_then(Value::as_u64)
        .unwrap_or(0);
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
    reply_to_message_id: Option<String>,
    as_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if files.len() > 10 {
        return Err("You can attach up to 10 files".to_owned());
    }
    if let Some(token) = as_token.as_deref() {
        ensure_credential_available(&state, token).await?;
    }
    let paths = {
        let mut selected = state.selected_uploads.lock().await;
        let mut paths = Vec::with_capacity(files.len());
        for upload_id in files {
            let Some((created_at, mut selected_paths)) = selected.remove(&upload_id) else {
                return Err(
                    "An attachment selection expired; please choose the file again".to_owned(),
                );
            };
            if created_at.elapsed() > std::time::Duration::from_secs(3600) {
                return Err(
                    "An attachment selection expired; please choose the file again".to_owned(),
                );
            }
            paths.append(&mut selected_paths);
        }
        paths
    };
    state
        .router
        .send_message_with_files(
            as_token.as_deref(),
            AccountIdentity::Primary,
            &channel_id,
            &content,
            paths,
            reply_to_message_id.as_deref(),
        )
        .await
        .map_err(map_err)
}

/// List global application commands for an application.
/// The application ID must belong to an application the authenticated user can manage.
#[tauri::command]
pub async fn get_global_application_commands(
    application_id: String,
    with_localizations: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if application_id.parse::<u64>().is_err() {
        return Err("A valid application ID is required".to_owned());
    }
    let with_localizations = with_localizations.unwrap_or(true);
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::GET,
            &format!(
                "applications/{application_id}/commands?with_localizations={with_localizations}"
            ),
            None,
        )
        .await
        .map_err(map_err)
}

/// Fetch public application metadata used to resolve profile game widget IDs.
#[tauri::command]
pub async fn get_rpc_application(application_id: String) -> Result<Value, String> {
    if application_id.is_empty()
        || !application_id
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err("A valid application ID is required".to_owned());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(map_err)?;
    let response = client
        .get(format!(
            "https://discord.com/api/v10/applications/{application_id}/rpc"
        ))
        .send()
        .await
        .map_err(map_err)?
        .error_for_status()
        .map_err(map_err)?;
    response.json().await.map_err(map_err)
}

/// List application commands registered to a specific guild.
#[tauri::command]
pub async fn get_guild_application_commands(
    application_id: String,
    guild_id: String,
    with_localizations: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if application_id.parse::<u64>().is_err() || guild_id.parse::<u64>().is_err() {
        return Err("Valid application and guild IDs are required".to_owned());
    }
    let with_localizations = with_localizations.unwrap_or(true);
    state.router.rest(
        AccountIdentity::Primary,
        Method::GET,
        &format!("applications/{application_id}/guilds/{guild_id}/commands?with_localizations={with_localizations}"),
        None,
    ).await.map_err(map_err)
}

/// List configured command permissions for an application in a guild.
#[tauri::command]
pub async fn get_guild_application_command_permissions(
    application_id: String,
    guild_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if application_id.parse::<u64>().is_err() || guild_id.parse::<u64>().is_err() {
        return Err("Valid application and guild IDs are required".to_owned());
    }
    state
        .router
        .rest(
            AccountIdentity::ReadOnly,
            Method::GET,
            &format!("applications/{application_id}/guilds/{guild_id}/commands/permissions"),
            None,
        )
        .await
        .map_err(map_err)
}

/// Invoke a discovered application command through Discord's interactions endpoint.
#[tauri::command]
pub async fn execute_application_command(
    channel_id: String,
    guild_id: Option<String>,
    session_id: String,
    command: Value,
    options: Vec<Value>,
    nonce: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if channel_id.parse::<u64>().is_err() || session_id.trim().is_empty() {
        return Err("A connected gateway session and valid channel are required".to_owned());
    }
    let command_id = command
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Command is missing its ID")?
        .to_owned();
    let application_id = command
        .get("application_id")
        .and_then(Value::as_str)
        .ok_or("Command is missing its application ID")?
        .to_owned();
    let command_name = command
        .get("name")
        .and_then(Value::as_str)
        .ok_or("Command is missing its name")?
        .to_owned();
    let command_version = command
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or(&command_id)
        .to_owned();
    let command_type = command.get("type").and_then(Value::as_u64).unwrap_or(1);
    let payload = json!({
        "type": 2,
        "application_id": application_id,
        "guild_id": guild_id,
        "channel_id": channel_id,
        "session_id": session_id,
        "nonce": nonce,
        "analytics_location": "slash_ui",
        "data": {
            "version": command_version,
            "id": command_id,
            "name": command_name,
            "type": command_type,
            "options": options,
            "application_command": command,
            "attachments": []
        }
    });
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::POST,
            "interactions",
            Some(payload),
        )
        .await
        .map_err(map_err)
}

/// Invoke a Discord message component interaction (button click, select menu, etc.)
#[tauri::command]
pub async fn execute_component_interaction(
    channel_id: String,
    guild_id: Option<String>,
    session_id: String,
    message_id: String,
    application_id: String,
    message_flags: Option<u64>,
    component_type: u64,
    custom_id: String,
    values: Option<Vec<String>>,
    nonce: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if channel_id.parse::<u64>().is_err() || session_id.trim().is_empty() {
        return Err("A connected gateway session and valid channel are required".to_owned());
    }
    let mut data = json!({
        "component_type": component_type,
        "custom_id": custom_id,
    });
    if let Some(v) = values {
        data["values"] = json!(v);
    }
    let mut payload = json!({
        "type": 3,
        "application_id": application_id,
        "channel_id": channel_id,
        "message_id": message_id,
        "session_id": session_id,
        "nonce": nonce,
        "data": data,
    });
    if let Some(gid) = guild_id {
        payload["guild_id"] = json!(gid);
    }
    if let Some(flags) = message_flags {
        payload["message_flags"] = json!(flags);
    }
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::POST,
            "interactions",
            Some(payload),
        )
        .await
        .map_err(map_err)
}

/// Submit a modal opened by an INTERACTION_MODAL_CREATE Gateway dispatch.
#[tauri::command]
pub async fn submit_interaction_modal(
    modal: Value,
    session_id: String,
    components: Value,
    nonce: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if session_id.trim().is_empty() || nonce.trim().is_empty() {
        return Err("A connected gateway session is required to submit this modal".to_owned());
    }
    let channel_id = modal
        .get("channel_id")
        .and_then(Value::as_str)
        .ok_or("Modal is missing its channel ID")?
        .to_owned();
    if channel_id.parse::<u64>().is_err() {
        return Err("Modal contains an invalid channel ID".to_owned());
    }
    let application_id = modal
        .pointer("/application/bot/id")
        .and_then(Value::as_str)
        .or_else(|| modal.get("application_id").and_then(Value::as_str))
        .ok_or("Modal is missing its application ID")?
        .to_owned();
    let modal_id = modal
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Modal is missing its interaction ID")?
        .to_owned();
    let custom_id = modal
        .get("custom_id")
        .and_then(Value::as_str)
        .ok_or("Modal is missing its custom ID")?
        .to_owned();
    if !components.is_array() {
        return Err("Modal component values must be an array".to_owned());
    }
    let payload = json!({
        "type": 5,
        "application_id": application_id,
        "channel_id": channel_id,
        "session_id": session_id,
        "nonce": nonce,
        "data": { "id": modal_id, "custom_id": custom_id, "components": components }
    });
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::POST,
            "interactions",
            Some(payload),
        )
        .await
        .map_err(map_err)
}

/// Decline/end a private call for the selected DM channel.
#[tauri::command]
pub async fn decline_private_call(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if channel_id.parse::<u64>().is_err() {
        return Err("A valid private-call channel ID is required".to_owned());
    }
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::DELETE,
            &format!("channels/{channel_id}/call"),
            None,
        )
        .await
        .map_err(map_err)?;
    Ok(())
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

#[tauri::command]
pub async fn react_to_message(
    channel_id: String,
    message_id: String,
    emoji: String,
    remove: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let is_snowflake =
        |value: &str| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
    if !is_snowflake(&channel_id) || !is_snowflake(&message_id) {
        return Err("Channel and message IDs must be numeric Discord snowflakes".to_owned());
    }
    if emoji.is_empty() || emoji.chars().count() > 100 || emoji.chars().any(char::is_control) {
        return Err("Choose a valid emoji".to_owned());
    }
    if let Some((name, id)) = emoji.split_once(':') {
        if name.is_empty()
            || name.len() > 32
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            || !is_snowflake(id)
        {
            return Err("Custom emoji must use the format name:id".to_owned());
        }
    } else if emoji.contains(':') || emoji.contains('/') || emoji.contains('\\') {
        return Err("Choose a valid Unicode or custom emoji".to_owned());
    }

    let encoded_emoji = emoji
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b':') {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect::<String>();
    let method = if remove { Method::DELETE } else { Method::PUT };
    state
        .router
        .rest(
            AccountIdentity::Primary,
            method,
            &format!("channels/{channel_id}/messages/{message_id}/reactions/{encoded_emoji}/@me"),
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
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
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
            state
                .router
                .rest(
                    AccountIdentity::Primary,
                    Method::PATCH,
                    &path,
                    Some(json!({ "communication_disabled_until": iso8601_after_seconds(seconds) })),
                )
                .await
                .map_err(map_err)?;
        }
        "remove_timeout" => {
            state
                .router
                .rest(
                    AccountIdentity::Primary,
                    Method::PATCH,
                    &path,
                    Some(json!({ "communication_disabled_until": null })),
                )
                .await
                .map_err(map_err)?;
        }
        "kick" => {
            state
                .router
                .rest(AccountIdentity::Primary, Method::DELETE, &path, None)
                .await
                .map_err(map_err)?;
        }
        "ban" => {
            state
                .router
                .rest(
                    AccountIdentity::Primary,
                    Method::PUT,
                    &format!("guilds/{guild_id}/bans/{user_id}"),
                    Some(json!({ "delete_message_seconds": 0 })),
                )
                .await
                .map_err(map_err)?;
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
    let nickname = nickname
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if nickname
        .as_ref()
        .is_some_and(|value| value.chars().count() > 32)
    {
        return Err("Nickname cannot exceed 32 characters".to_owned());
    }
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::PATCH,
            &format!("guilds/{guild_id}/members/{user_id}"),
            Some(json!({ "nick": nickname })),
        )
        .await
        .map_err(map_err)
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
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::PATCH,
            &format!("channels/{channel_id}"),
            Some(Value::Object(body)),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn set_voice_channel_status(
    channel_id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if channel_id.parse::<u64>().is_err() {
        return Err("A valid voice channel ID is required".to_owned());
    }
    if status.chars().count() > 500 {
        return Err("Voice channel status cannot exceed 500 characters".to_owned());
    }
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::PUT,
            &format!("channels/{channel_id}/voice-status"),
            Some(json!({ "status": status })),
        )
        .await
        .map_err(map_err)
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
    let channel = state
        .router
        .rest(
            AccountIdentity::ReadOnly,
            Method::GET,
            &format!("channels/{channel_id}"),
            None,
        )
        .await
        .map_err(map_err)?;
    let overwrite = channel
        .get("permission_overwrites")
        .and_then(Value::as_array)
        .and_then(|overwrites| {
            overwrites.iter().find(|overwrite| {
                overwrite.get("type").and_then(Value::as_u64) == Some(0)
                    && overwrite.get("id").and_then(Value::as_str) == Some(guild_id.as_str())
            })
        });
    let parse_bits = |key: &str| -> Result<u64, String> {
        match overwrite
            .and_then(|value| value.get(key))
            .and_then(Value::as_str)
        {
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
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::PUT,
            &format!("channels/{channel_id}/permissions/{guild_id}"),
            Some(json!({ "type": 0, "allow": allow.to_string(), "deny": deny.to_string() })),
        )
        .await
        .map(|_| ())
        .map_err(map_err)
}

#[tauri::command]
pub async fn delete_guild_channel(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::DELETE,
            &format!("channels/{channel_id}"),
            None,
        )
        .await
        .map(|_| ())
        .map_err(map_err)
}

#[tauri::command]
pub async fn get_dm_channels(
    accounts: Option<Vec<AccountReadCredential>>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let Some(accounts) = accounts.filter(|accounts| !accounts.is_empty()) else {
        if let Some(token) = state.token.lock().await.clone() {
            if is_bot_credential(&token) {
                return Ok(json!([]));
            }
            ensure_credential_available(&state, &token).await?;
        }
        let mut channels = state
            .router
            .rest(
                AccountIdentity::Primary,
                Method::GET,
                "users/@me/channels",
                None,
            )
            .await
            .map_err(map_err)?;
        if let Some(arr) = channels.as_array_mut() {
            arr.retain(|channel| !is_message_request(channel));
            arr.sort_by(|a, b| {
                let id_a = a
                    .get("last_message_id")
                    .and_then(Value::as_str)
                    .unwrap_or("0");
                let id_b = b
                    .get("last_message_id")
                    .and_then(Value::as_str)
                    .unwrap_or("0");
                id_b.cmp(id_a)
            });
        }
        return Ok(channels);
    };

    let accounts = validate_account_read_credentials(accounts)?
        .into_iter()
        .filter(|account| !is_bot_credential(&account.token))
        .collect::<Vec<_>>();
    if accounts.is_empty() {
        return Ok(json!([]));
    }
    let mut account_channels = Vec::new();
    let mut failures = Vec::new();
    for account in accounts {
        if !state
            .router
            .account_credential_available(&account.token)
            .await
        {
            log::debug!(
                "Skipping DM aggregation for unavailable account {}",
                account.account_id
            );
            failures.push(account.account_id);
            continue;
        }
        match state
            .router
            .rest_with_auth_quiet_auth_failure(
                &account.token,
                AccountIdentity::ReadOnly,
                Method::GET,
                "users/@me/channels",
            )
            .await
        {
            Ok(Value::Array(channels)) => account_channels.push((account.account_id, channels)),
            Ok(_) => failures.push(account.account_id),
            Err(error) => {
                log::debug!(
                    "DM aggregation read failed for account {}: {}",
                    account.account_id,
                    error
                );
                failures.push(account.account_id);
            }
        }
    }
    if account_channels.is_empty() && !failures.is_empty() {
        return Err("Failed to load DMs from all configured accounts".to_owned());
    }
    if !failures.is_empty() {
        log::debug!("DM aggregation succeeded with partial account failures");
    }
    Ok(merge_account_dm_channels(account_channels))
}

#[tauri::command]
pub async fn get_relationships(state: State<'_, AppState>) -> Result<Value, String> {
    if let Some(token) = state.token.lock().await.clone() {
        if is_bot_credential(&token) {
            return Ok(json!([]));
        }
        ensure_credential_available(&state, &token).await?;
    }
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::GET,
            "users/@me/relationships",
            None,
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn create_dm(recipient_id: String, state: State<'_, AppState>) -> Result<Value, String> {
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
pub async fn add_friend(username: String, state: State<'_, AppState>) -> Result<Value, String> {
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
    if !is_snowflake(&user_id) {
        return Err("A valid user ID is required".to_owned());
    }
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
pub async fn set_user_ignored(
    user_id: String,
    ignored: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !is_snowflake(&user_id) {
        return Err("A valid user ID is required".to_owned());
    }
    let method = if ignored { Method::PUT } else { Method::DELETE };
    state
        .router
        .rest(
            AccountIdentity::Primary,
            method,
            &format!("users/@me/relationships/{user_id}/ignore"),
            None,
        )
        .await
        .map(|_| ())
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
    let custom_status = custom_status
        .filter(|text| !text.trim().is_empty())
        .map(|text| text.trim().to_owned());
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::PATCH,
            "users/@me/settings",
            Some(json!({
                "status": status,
                "custom_status": custom_status
                    .as_deref()
                    .map(|text| json!({
                        "text": text,
                        "emoji_name": null,
                        "expires_at": null
                    }))
            })),
        )
        .await
        .map_err(map_err)?;
    if let Err(error) = state
        .rpc
        .update_base_presence(&state.router, &status, custom_status.as_deref())
        .await
    {
        log::warn!(
            "Discord status was saved, but active RPC activity could not be refreshed: {error}"
        );
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameProcessMapping {
    process_name: String,
    display_name: String,
}

fn validate_game_process_mappings(mappings: &[GameProcessMapping]) -> Result<(), String> {
    if mappings.len() > 100 {
        return Err("You can configure up to 100 game processes".to_owned());
    }
    for mapping in mappings {
        let process_name = mapping.process_name.trim();
        let display_name = mapping.display_name.trim();
        if process_name.is_empty()
            || process_name.len() > 260
            || process_name
                .chars()
                .any(|character| matches!(character, '/' | '\\' | '\0'))
        {
            return Err("Game process names must be executable file names".to_owned());
        }
        if display_name.is_empty() || display_name.chars().count() > 128 {
            return Err("Game names must contain between 1 and 128 characters".to_owned());
        }
    }
    Ok(())
}

fn first_running_game<'a>(
    mappings: &'a [GameProcessMapping],
    running_processes: &HashSet<String>,
) -> Option<&'a str> {
    mappings.iter().find_map(|mapping| {
        running_processes
            .contains(&mapping.process_name.trim().to_lowercase())
            .then_some(mapping.display_name.trim())
    })
}

#[tauri::command]
pub async fn detect_running_game(
    mappings: Vec<GameProcessMapping>,
) -> Result<Option<String>, String> {
    validate_game_process_mappings(&mappings)?;
    tokio::task::spawn_blocking(move || {
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::All, true);
        let running_processes = system
            .processes()
            .values()
            .map(|process| process.name().to_string_lossy().to_lowercase())
            .collect::<HashSet<_>>();
        first_running_game(&mappings, &running_processes).map(str::to_owned)
    })
    .await
    .map_err(|error| format!("Could not inspect running processes: {error}"))
}

#[tauri::command]
pub async fn set_game_activity(
    game_name: Option<String>,
    status: String,
    custom_status: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !matches!(status.as_str(), "online" | "idle" | "dnd" | "invisible") {
        return Err(format!("Unsupported presence status: {status}"));
    }
    if game_name
        .as_deref()
        .is_some_and(|name| name.trim().is_empty() || name.chars().count() > 128)
    {
        return Err("Game names must contain between 1 and 128 characters".to_owned());
    }
    if custom_status
        .as_deref()
        .is_some_and(|text| text.chars().count() > 128)
    {
        return Err("Custom status must be 128 characters or fewer".to_owned());
    }
    state
        .rpc
        .set_process_activity(&state.router, game_name, &status, custom_status.as_deref())
        .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomRpcButton {
    label: String,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomRpcActivity {
    application_id: String,
    name: String,
    #[serde(rename = "type")]
    activity_type: u8,
    stream_url: Option<String>,
    details: Option<String>,
    state: Option<String>,
    large_image: Option<String>,
    large_text: Option<String>,
    small_image: Option<String>,
    small_text: Option<String>,
    start_timestamp: Option<i64>,
    end_timestamp: Option<i64>,
    party_size: Option<u32>,
    party_max: Option<u32>,
    buttons: Vec<CustomRpcButton>,
}

fn build_custom_rpc_activity(config: CustomRpcActivity) -> Result<Value, String> {
    let application_id = config.application_id.trim();
    if application_id.is_empty()
        || application_id.len() > 32
        || !application_id.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err("Application ID must be a numeric Discord application ID".to_owned());
    }

    let name = config.name.trim();
    if name.is_empty() || name.chars().count() > 128 {
        return Err("Activity name must contain between 1 and 128 characters".to_owned());
    }
    if !matches!(config.activity_type, 0 | 1 | 2 | 3 | 5) {
        return Err("Choose a supported activity type".to_owned());
    }
    let stream_url = config
        .stream_url
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if config.activity_type == 1 && stream_url.is_none() {
        return Err("Streaming activities require an HTTPS stream URL".to_owned());
    }
    if let Some(stream_url) = stream_url.as_deref() {
        let url = reqwest::Url::parse(stream_url)
            .map_err(|_| "Stream URL must be a valid HTTPS link".to_owned())?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Stream URL must be a valid HTTPS link".to_owned());
        }
    }

    let optional_text = |value: Option<String>, field: &str, max: usize| {
        let value = value
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        if value
            .as_ref()
            .is_some_and(|value| value.chars().count() > max)
        {
            Err(format!("{field} must be {max} characters or fewer"))
        } else {
            Ok(value)
        }
    };
    let details = optional_text(config.details, "Details", 128)?;
    let state = optional_text(config.state, "State", 128)?;
    let large_image = optional_text(config.large_image, "Large image key", 256)?;
    let large_text = optional_text(config.large_text, "Large image tooltip", 128)?;
    let small_image = optional_text(config.small_image, "Small image key", 256)?;
    let small_text = optional_text(config.small_text, "Small image tooltip", 128)?;

    if config
        .start_timestamp
        .is_some_and(|timestamp| timestamp <= 0)
        || config.end_timestamp.is_some_and(|timestamp| timestamp <= 0)
    {
        return Err("Activity timestamps must be positive Unix milliseconds".to_owned());
    }
    if let (Some(start), Some(end)) = (config.start_timestamp, config.end_timestamp) {
        if end <= start {
            return Err("Activity end time must be after its start time".to_owned());
        }
    }

    let party = match (config.party_size, config.party_max) {
        (None, None) => None,
        (Some(size), Some(max)) if size > 0 && max >= size && max <= 100_000 => {
            Some(json!([size, max]))
        }
        _ => return Err("Party size and maximum must be valid and provided together".to_owned()),
    };

    if config.buttons.len() > 2 {
        return Err("Rich Presence supports up to two buttons".to_owned());
    }
    let mut buttons = Vec::with_capacity(config.buttons.len());
    for button in config.buttons {
        let label = button.label.trim();
        if label.is_empty() || label.chars().count() > 32 {
            return Err("Button labels must contain between 1 and 32 characters".to_owned());
        }
        let url = reqwest::Url::parse(button.url.trim())
            .map_err(|_| "Button URLs must be valid HTTPS links".to_owned())?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Button URLs must be valid HTTPS links".to_owned());
        }
        buttons.push(json!({ "label": label, "url": url.as_str() }));
    }

    let mut activity = json!({
        "application_id": application_id,
        "name": name,
        "type": config.activity_type
    });
    if let Some(stream_url) = stream_url {
        activity["url"] = json!(stream_url);
    }
    for (key, value) in [("details", details), ("state", state)] {
        if let Some(value) = value {
            activity[key] = json!(value);
        }
    }
    let mut assets = serde_json::Map::new();
    for (key, value) in [
        ("large_image", large_image),
        ("large_text", large_text),
        ("small_image", small_image),
        ("small_text", small_text),
    ] {
        if let Some(value) = value {
            assets.insert(key.to_owned(), json!(value));
        }
    }
    if !assets.is_empty() {
        activity["assets"] = Value::Object(assets);
    }
    let mut timestamps = serde_json::Map::new();
    if let Some(start) = config.start_timestamp {
        timestamps.insert("start".to_owned(), json!(start));
    }
    if let Some(end) = config.end_timestamp {
        timestamps.insert("end".to_owned(), json!(end));
    }
    if !timestamps.is_empty() {
        activity["timestamps"] = Value::Object(timestamps);
    }
    if let Some(party) = party {
        activity["party"] = json!({ "size": party });
    }
    if !buttons.is_empty() {
        activity["buttons"] = json!(buttons);
    }
    Ok(activity)
}

#[tauri::command]
pub async fn set_custom_rpc_activity(
    activity: Option<CustomRpcActivity>,
    status: String,
    custom_status: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !matches!(status.as_str(), "online" | "idle" | "dnd" | "invisible") {
        return Err(format!("Unsupported presence status: {status}"));
    }
    let custom_status = custom_status
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty());
    if custom_status
        .as_ref()
        .is_some_and(|text| text.chars().count() > 128)
    {
        return Err("Custom status must be 128 characters or fewer".to_owned());
    }
    let activity = activity.map(build_custom_rpc_activity).transpose()?;
    state
        .rpc
        .set_custom_rpc_activity(&state.router, activity, &status, custom_status.as_deref())
        .await
}

#[tauri::command]
pub async fn set_rpc_listener_enabled(
    enabled: bool,
    status: String,
    custom_status: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if !matches!(status.as_str(), "online" | "idle" | "dnd" | "invisible") {
        return Err(format!("Unsupported presence status: {status}"));
    }
    state
        .rpc
        .set_listener_enabled(app, enabled, &status, custom_status.as_deref())
        .await
}

#[tauri::command]
pub async fn update_bio(bio: String, state: State<'_, AppState>) -> Result<Value, String> {
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
            AccountIdentity::Primary,
            Method::GET,
            "users/@me/settings",
            None,
        )
        .await
        .map_err(map_err)
}

/// Fetch the current protobuf settings used to mirror Discord's guild folder layout.
#[tauri::command]
pub async fn get_guild_folder_settings(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::GET,
            "users/@me/settings-proto/1",
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
    let envelope = SettingsProtoV1Envelope::from_base64(&settings_payload).map_err(map_err)?;
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
    if let Some(token) = state.token.lock().await.clone() {
        if is_bot_credential(&token) {
            return Ok(json!([]));
        }
        ensure_credential_available(&state, &token).await?;
    }
    let channels = state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::GET,
            "users/@me/channels",
            None,
        )
        .await
        .map_err(map_err)?;
    let private_channels = channels
        .as_array()
        .into_iter()
        .flatten()
        .filter(|channel| {
            channel.get("type").and_then(Value::as_i64) == Some(1)
                && is_message_request(channel)
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut requests = Vec::new();
    for batch in private_channels.chunks(25) {
        let channel_ids = batch
            .iter()
            .map(|channel| {
                channel
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .ok_or_else(|| {
                        "Discord returned a message request without a channel ID".to_owned()
                    })
            })
            .collect::<Result<Vec<_>, _>>()?;
        if channel_ids
            .iter()
            .any(|channel_id| !is_snowflake(channel_id))
        {
            return Err("Discord returned an invalid message request channel ID".to_owned());
        }
        let query = channel_ids
            .iter()
            .map(|channel_id| format!("channel_ids={channel_id}"))
            .collect::<Vec<_>>()
            .join("&");
        let supplemental = state
            .router
            .rest(
                AccountIdentity::Primary,
                Method::GET,
                &format!("users/@me/message-requests/supplemental-data?{query}"),
                None,
            )
            .await
            .map_err(map_err)?;
        requests.extend(merge_supplemental_message_requests(batch, &supplemental));
    }
    Ok(Value::Array(requests))
}

#[tauri::command]
pub async fn update_message_request(
    channel_id: String,
    action: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if !is_snowflake(&channel_id) {
        return Err("A valid message request channel ID is required".to_owned());
    }
    match action.as_str() {
        "accept" => state
            .router
            .rest(
                AccountIdentity::Primary,
                Method::PUT,
                &format!("channels/{channel_id}/recipients/@me"),
                Some(json!({ "consent_status": 2 })),
            )
            .await
            .map_err(map_err),
        "ignore" | "dismiss" | "reject" => state
            .router
            .rest(
                AccountIdentity::Primary,
                Method::DELETE,
                &format!("channels/{channel_id}/recipients/@me"),
                None,
            )
            .await
            .map_err(map_err),
        _ => Err(format!("Unsupported message request action: {action}")),
    }
}

#[tauri::command]
pub async fn batch_reject_message_requests(
    channel_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if channel_ids.iter().any(|id| !is_snowflake(id)) {
        return Err("Message request channel IDs must be valid snowflakes".to_owned());
    }
    let mut rejected = Vec::new();
    for batch in channel_ids.chunks(50) {
        let response = state
            .router
            .rest(
                AccountIdentity::Primary,
                Method::PUT,
                "channels/recipients/@me/batch-reject",
                Some(json!({ "channel_ids": batch })),
            )
            .await
            .map_err(map_err)?;
        if let Some(channels) = response.as_array() {
            rejected.extend(channels.iter().cloned());
        }
    }
    Ok(Value::Array(rejected))
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
    guild_id: Option<String>,
    channel_id: Option<String>,
    self_mute: bool,
    self_deaf: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if guild_id
        .as_deref()
        .is_some_and(|id| id.parse::<u64>().is_err())
    {
        return Err("Guild ID must be a numeric Discord snowflake".to_owned());
    }
    if channel_id
        .as_deref()
        .is_some_and(|id| id.parse::<u64>().is_err())
    {
        return Err("Channel ID must be a numeric Discord snowflake".to_owned());
    }
    state
        .voice_controls
        .muted
        .store(self_mute, Ordering::Relaxed);
    state
        .voice_controls
        .deafened
        .store(self_deaf, Ordering::Relaxed);
    if channel_id.is_none() {
        state
            .voice_controls
            .generation
            .fetch_add(1, Ordering::SeqCst);
        if let Some(task) = state.voice_task.lock().await.take() {
            task.abort();
        }
    }
    state
        .router
        .send_gateway_payload(json!({
            "op": 4,
            "d": {
                "guild_id": guild_id,
                "channel_id": channel_id,
                "self_mute": self_mute,
                "self_deaf": self_deaf
            }
        }))
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn list_audio_devices() -> Result<crate::voice_gateway::AudioDeviceList, String> {
    enumerate_audio_devices()
}

/// Fetch the current account's role IDs for accurate local channel permission checks.
#[tauri::command]
pub async fn get_current_guild_member(
    guild_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if let Some(token) = state.token.lock().await.clone() {
        if is_bot_credential(&token) {
            ensure_credential_available(&state, &token).await?;
            let user = state
                .router
                .rest_with_auth(
                    Some(&token),
                    AccountIdentity::Primary,
                    Method::GET,
                    "users/@me",
                    None,
                )
                .await
                .map_err(map_err)?;
            let bot_id = user
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "Discord did not return the bot user ID".to_owned())?;
            return state
                .router
                .rest_with_auth(
                    Some(&token),
                    AccountIdentity::Primary,
                    Method::GET,
                    &format!("guilds/{guild_id}/members/{bot_id}"),
                    None,
                )
                .await
                .map_err(map_err);
        }
    }
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::GET,
            &format!("users/@me/guilds/{guild_id}/member"),
            None,
        )
        .await
        .map_err(map_err)
}
#[allow(dead_code)]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DiscordBadge {
    pub id: String,
    pub description: String,
    pub icon: String,
    pub link: Option<String>,
}

#[allow(dead_code)]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UserProfileResponse {
    pub user: Value,
    pub badges: Vec<DiscordBadge>,
    pub user_profile: Option<Value>,
    pub connected_accounts: Option<Vec<Value>>,
    pub widgets: Option<Vec<Value>>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ScreenSource {
    pub id: String,
    pub name: String,
    pub kind: String, // "screen" or "window"
}

/// List available desktop screens and windows for screen sharing.
#[tauri::command]
pub async fn get_screen_sources(app: AppHandle) -> Result<Vec<ScreenSource>, String> {
    // Enumerate windows/screens via Tauri window / monitor APIs or desktop capturer
    let monitors = app.primary_monitor().map_err(map_err)?;
    let mut sources = Vec::new();

    if let Some(monitor) = monitors {
        sources.push(ScreenSource {
            id: format!("screen:{}", monitor.name().map_or("Primary Display", |v| v)),
            name: format!(
                "Primary Display ({0}x{1})",
                monitor.size().width,
                monitor.size().height
            ),
            kind: "screen".to_owned(),
        });
    }

    if let Some(windows) = app.webview_windows().values().next() {
        sources.push(ScreenSource {
            id: format!("window:{}", windows.label()),
            name: format!("VoidCord Window ({})", windows.label()),
            kind: "window".to_owned(),
        });
    }

    Ok(sources)
}

#[tauri::command]
pub async fn start_screen_share(
    guild_id: Option<String>,
    channel_id: String,
    source_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if channel_id.parse::<u64>().is_err() {
        return Err("A valid voice channel ID is required for screen sharing".to_owned());
    }

    let stream_key = if let Some(ref g_id) = guild_id {
        format!("guild:{g_id}:{channel_id}:1")
    } else {
        format!("call:{channel_id}:1")
    };

    // Send Discord Gateway Stream Create / Connect payload (Opcode 18)
    state
        .router
        .send_gateway_payload(json!({
            "op": 18,
            "d": {
                "type": "screen",
                "guild_id": guild_id,
                "channel_id": channel_id,
                "preferred_region": null
            }
        }))
        .await
        .map_err(map_err)?;

    Ok(json!({
        "status": "sharing",
        "stream_key": stream_key,
        "source_id": source_id
    }))
}

/// Stop the active screen share stream.
#[tauri::command]
pub async fn stop_screen_share(
    guild_id: Option<String>,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .router
        .send_gateway_payload(json!({
            "op": 19,
            "d": {
                "guild_id": guild_id,
                "channel_id": channel_id,
                "paused": true
            }
        }))
        .await
        .map_err(map_err)
}

/// Fetch và parse trọn gói profile kèm badges trực tiếp từ backend Rust
#[tauri::command]
pub async fn get_user_profile(
    user_id: String,
    accounts: Option<Vec<AccountReadCredential>>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if user_id.is_empty() || !user_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("A valid user ID is required".to_owned());
    }
    let path =
        format!("users/{user_id}/profile?with_mutual_guilds=false&with_mutual_friends=false");
    let mut profile_json = if let Some(accounts) = accounts.filter(|accounts| !accounts.is_empty())
    {
        let accounts = validate_account_read_credentials(accounts)?
            .into_iter()
            .filter(|account| !is_bot_credential(&account.token))
            .collect::<Vec<_>>();
        if accounts.is_empty() {
            return Err("No user account is available for profile reads".to_owned());
        }
        let mut profiles = Vec::new();
        let mut failures = 0usize;
        for account in accounts {
            if !state
                .router
                .account_credential_available(&account.token)
                .await
            {
                failures += 1;
                log::debug!(
                    "Skipping profile aggregation for unavailable account {}",
                    account.account_id
                );
                continue;
            }
            match state
                .router
                .rest_with_auth_quiet_auth_failure(
                    &account.token,
                    AccountIdentity::ReadOnly,
                    Method::GET,
                    &path,
                )
                .await
            {
                Ok(profile) => profiles.push(profile),
                Err(error) => {
                    failures += 1;
                    log::debug!(
                        "Profile aggregation read failed for account {}: {}",
                        account.account_id,
                        error
                    );
                }
            }
        }
        if profiles.is_empty() {
            return Err("Failed to load the profile from all configured accounts".to_owned());
        }
        if failures > 0 {
            log::debug!("Profile aggregation succeeded with partial account failures");
        }
        merge_account_profiles(profiles)
    } else {
        if let Some(token) = state.token.lock().await.clone() {
            ensure_credential_available(&state, &token).await?;
        }
        state
            .router
            .rest(AccountIdentity::ReadOnly, Method::GET, &path, None)
            .await
            .map_err(map_err)?
    };

    // Có thể inject thêm logic xử lý, format hoặc map URL icon badge ngay tại đây nếu muốn!
    if let Some(obj) = profile_json.as_object_mut() {
        if let Some(badges) = obj.get_mut("badges").and_then(|b| b.as_array_mut()) {
            for badge in badges {
                if let Some(icon_hash) = badge.get("icon").and_then(|i| i.as_str()) {
                    // Inject sẵn CDN URL trực tiếp vào object để frontend chỉ việc render thẻ <img>
                    let full_url =
                        format!("https://cdn.discordapp.com/badge-icons/{icon_hash}.png");
                    badge
                        .as_object_mut()
                        .unwrap()
                        .insert("icon_url".to_string(), Value::String(full_url));
                }
            }
        }
    }

    Ok(profile_json)
}

fn merge_account_profiles(mut profiles: Vec<Value>) -> Value {
    let mut merged = profiles.remove(0);
    let Some(merged_object) = merged.as_object_mut() else {
        return merged;
    };
    for profile in profiles {
        let Some(profile_object) = profile.as_object() else {
            continue;
        };
        for (key, value) in profile_object {
            if merged_object.get(key).map_or(true, Value::is_null) {
                merged_object.insert(key.clone(), value.clone());
            } else if key == "user" {
                if let (Some(existing), Some(incoming)) = (
                    merged_object.get_mut(key).and_then(Value::as_object_mut),
                    value.as_object(),
                ) {
                    for (field, field_value) in incoming {
                        if existing.get(field).map_or(true, Value::is_null) {
                            existing.insert(field.clone(), field_value.clone());
                        } else if field == "display_name_styles" {
                            if let (Some(existing_style), Some(incoming_style)) = (
                                existing.get_mut(field).and_then(Value::as_object_mut),
                                field_value.as_object(),
                            ) {
                                for (style_field, style_value) in incoming_style {
                                    if existing_style.get(style_field).map_or(true, Value::is_null)
                                    {
                                        existing_style
                                            .insert(style_field.clone(), style_value.clone());
                                    }
                                }
                            }
                        }
                    }
                }
            } else if key == "badges" {
                if let (Some(existing), Some(incoming)) = (
                    merged_object.get_mut(key).and_then(Value::as_array_mut),
                    value.as_array(),
                ) {
                    let mut badge_ids = existing
                        .iter()
                        .filter_map(|badge| badge.get("id").and_then(Value::as_str))
                        .map(str::to_owned)
                        .collect::<HashSet<_>>();
                    existing.extend(
                        incoming
                            .iter()
                            .filter(|badge| {
                                badge
                                    .get("id")
                                    .and_then(Value::as_str)
                                    .map(|id| badge_ids.insert(id.to_owned()))
                                    .unwrap_or(true)
                            })
                            .cloned(),
                    );
                }
            } else if key == "widgets" {
                if let (Some(existing), Some(incoming)) = (
                    merged_object.get_mut(key).and_then(Value::as_array_mut),
                    value.as_array(),
                ) {
                    let mut widget_ids = existing
                        .iter()
                        .filter_map(|widget| widget.get("id").and_then(Value::as_str))
                        .map(str::to_owned)
                        .collect::<HashSet<_>>();
                    existing.extend(
                        incoming
                            .iter()
                            .filter(|widget| {
                                widget
                                    .get("id")
                                    .and_then(Value::as_str)
                                    .map(|id| widget_ids.insert(id.to_owned()))
                                    .unwrap_or(true)
                            })
                            .cloned(),
                    );
                }
            } else if key == "user_profile" {
                if let (Some(existing), Some(incoming)) = (
                    merged_object.get_mut(key).and_then(Value::as_object_mut),
                    value.as_object(),
                ) {
                    for (field, field_value) in incoming {
                        if existing.get(field).map_or(true, Value::is_null) {
                            existing.insert(field.clone(), field_value.clone());
                        }
                    }
                }
            }
        }
    }
    merged
}

#[cfg(test)]
mod account_read_tests {
    use super::{
        merge_account_dm_channels, merge_account_profiles, validate_account_read_credentials,
        AccountReadCredential,
    };
    use serde_json::json;

    #[test]
    fn account_profile_merge_keeps_primary_values_and_fills_missing_fields() {
        let merged = merge_account_profiles(vec![
            json!({
                "user": {
                    "id": "1",
                    "display_name_styles": {"colors": [123]}
                },
                "user_profile": {"bio": "primary bio", "pronouns": null},
                "badges": [{"id": "a"}],
                "widgets": [{"id": "widget-a"}]
            }),
            json!({
                "user": {
                    "id": "2",
                    "display_name_styles": {"font_id": 14, "effect_id": 3}
                },
                "user_profile": {"bio": "secondary bio", "pronouns": "they/them"},
                "badges": [{"id": "a"}, {"id": "b"}],
                "widgets": [{"id": "widget-a"}, {"id": "widget-b"}],
                "extra": true
            }),
        ]);

        assert_eq!(merged["user"]["id"], "1");
        assert_eq!(merged["user"]["display_name_styles"]["font_id"], 14);
        assert_eq!(merged["user"]["display_name_styles"]["effect_id"], 3);
        assert_eq!(merged["user"]["display_name_styles"]["colors"][0], 123);
        assert_eq!(merged["user_profile"]["bio"], "primary bio");
        assert_eq!(merged["user_profile"]["pronouns"], "they/them");
        assert_eq!(merged["badges"].as_array().unwrap().len(), 2);
        assert_eq!(merged["widgets"].as_array().unwrap().len(), 2);
        assert_eq!(merged["extra"], true);
    }

    #[test]
    fn account_dm_merge_filters_requests_deduplicates_and_tracks_owner() {
        let merged = merge_account_dm_channels(vec![
            (
                "primary".to_owned(),
                vec![
                    json!({"id": "10", "last_message_id": "100", "type": 1}),
                    json!({"id": "20", "last_message_id": "200", "type": 1, "is_spam": true}),
                ],
            ),
            (
                "secondary".to_owned(),
                vec![
                    json!({"id": "10", "last_message_id": "100", "type": 1}),
                    json!({"id": "30", "last_message_id": "300", "type": 1}),
                ],
            ),
        ]);

        assert_eq!(merged.as_array().unwrap().len(), 2);
        assert_eq!(merged[0]["id"], "30");
        assert_eq!(merged[0]["account_id"], "secondary");
        assert_eq!(merged[1]["id"], "10");
        assert_eq!(merged[1]["account_id"], "primary");
    }

    #[test]
    fn account_credentials_reject_invalid_entries_and_duplicate_ids() {
        let accounts = validate_account_read_credentials(vec![
            AccountReadCredential {
                account_id: "123".to_owned(),
                token: "first".to_owned(),
            },
            AccountReadCredential {
                account_id: "123".to_owned(),
                token: "second".to_owned(),
            },
            AccountReadCredential {
                account_id: "not-an-id".to_owned(),
                token: "third".to_owned(),
            },
        ])
        .unwrap();

        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].token, "first");
    }
}

#[tauri::command]
pub async fn get_safety_hub(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::GET,
            "safety-hub/@me",
            None,
        )
        .await
        .map_err(map_err)
}

fn validate_report_target(
    user_id: Option<&str>,
    channel_id: Option<&str>,
    message_id: Option<&str>,
) -> Result<(), String> {
    let is_snowflake =
        |value: &str| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
    match (user_id, channel_id, message_id) {
        (Some(user_id), None, None) if is_snowflake(user_id) => Ok(()),
        (None, Some(channel_id), Some(message_id))
            if is_snowflake(channel_id) && is_snowflake(message_id) =>
        {
            Ok(())
        }
        (None, None, None) => Err("Choose a user or message to report".to_owned()),
        _ => Err("Report either one user or one message with its channel".to_owned()),
    }
}

#[tauri::command]
pub async fn get_report_reasons(
    user_id: Option<String>,
    channel_id: Option<String>,
    message_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    validate_report_target(
        user_id.as_deref(),
        channel_id.as_deref(),
        message_id.as_deref(),
    )?;
    let query = if let Some(user_id) = user_id {
        format!("report?user_id={user_id}")
    } else {
        format!(
            "report?channel_id={}&message_id={}",
            channel_id.as_deref().unwrap_or_default(),
            message_id.as_deref().unwrap_or_default()
        )
    };
    state
        .router
        .rest(AccountIdentity::Primary, Method::GET, &query, None)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn create_report(
    user_id: Option<String>,
    channel_id: Option<String>,
    message_id: Option<String>,
    reason: i64,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    validate_report_target(
        user_id.as_deref(),
        channel_id.as_deref(),
        message_id.as_deref(),
    )?;
    if reason < 0 {
        return Err("Choose a valid report reason".to_owned());
    }
    let mut body = serde_json::Map::new();
    if let Some(user_id) = user_id {
        body.insert("user_id".to_owned(), json!(user_id));
    }
    if let (Some(channel_id), Some(message_id)) = (channel_id, message_id) {
        body.insert("channel_id".to_owned(), json!(channel_id));
        body.insert("message_id".to_owned(), json!(message_id));
    }
    body.insert("reason".to_owned(), json!(reason));
    state
        .router
        .rest(
            AccountIdentity::Primary,
            Method::POST,
            "report",
            Some(Value::Object(body)),
        )
        .await
        .map_err(map_err)
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
fn emit_gateway_event(app: &AppHandle, event: &str, payload: Value) {
    app.state::<GatewayIpc>().publish(event, payload);
}

#[tauri::command]
pub fn get_gateway_ipc_config(state: State<'_, GatewayIpc>) -> GatewayIpcConfig {
    state.config()
}

#[tauri::command]
pub async fn start_gateway(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
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
            emit_gateway_event(&app, "discord:gateway_status", json!({ "status": "connecting" }));
            let app2 = app.clone();
            let result = router
                .listen_gateway(AccountIdentity::Primary, move |event: serde_json::Value| {
                    let t = event.get("t").and_then(Value::as_str).unwrap_or("").to_owned();
                    let d = event.get("d").cloned().unwrap_or(Value::Null);

                    match t.as_str() {
                        "MESSAGE_CREATE" => {
                            let channel_id = d
                                .get("channel_id")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_owned();
                            emit_gateway_event(&app2, "discord:message_create", json!({ "channel_id": channel_id, "message": d }),);
                        }
                        "MESSAGE_UPDATE" => {
                            let channel_id = d
                                .get("channel_id")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_owned();
                            emit_gateway_event(&app2, "discord:message_update", json!({ "channel_id": channel_id, "message": d }),);
                        }
                        "MESSAGE_POLL_VOTE_ADD" | "MESSAGE_POLL_VOTE_REMOVE" => {
                            let channel_id = d.get("channel_id").and_then(Value::as_str).unwrap_or("").to_owned();
                            let message_id = d.get("message_id").and_then(Value::as_str).unwrap_or("").to_owned();
                            let event_name = if t == "MESSAGE_POLL_VOTE_ADD" {
                                "discord:message_poll_vote_add"
                            } else {
                                "discord:message_poll_vote_remove"
                            };
                            emit_gateway_event(&app2, event_name, json!({
                                "channel_id": channel_id,
                                "message_id": message_id,
                                "answer_id": d.get("answer_id").cloned().unwrap_or(Value::Null),
                                "user_id": d.get("user_id").cloned().unwrap_or(Value::Null)
                            }));
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
                            emit_gateway_event(&app2, "discord:message_delete", json!({ "channel_id": channel_id, "message_id": message_id }),);
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
                            emit_gateway_event(&app2, "discord:typing_start", json!({ "channel_id": channel_id, "user_id": user_id }),);
                        }
                        "GUILD_CREATE" => {
                            emit_gateway_event(&app2, "discord:guild_create", d);
                        }
                        "GUILD_MEMBER_LIST_UPDATE" => {
                            emit_gateway_event(&app2, "discord:guild_member_list_update", d);
                        }
                        "GUILD_MEMBER_ADD" => {
                            emit_gateway_event(&app2, "discord:guild_member_add", d);
                        }
                        "GUILD_MEMBER_UPDATE" => {
                            emit_gateway_event(&app2, "discord:guild_member_update", d);
                        }
                        "GUILD_MEMBER_REMOVE" => {
                            emit_gateway_event(&app2, "discord:guild_member_remove", d);
                        }
                        "CHANNEL_DELETE" => {
                            emit_gateway_event(&app2, "discord:channel_delete", d);
                        }
                        "THREAD_CREATE" => {
                            emit_gateway_event(&app2, "discord:thread_create", d);
                        }
                        "THREAD_UPDATE" => {
                            emit_gateway_event(&app2, "discord:thread_update", d);
                        }
                        "THREAD_DELETE" => {
                            emit_gateway_event(&app2, "discord:thread_delete", d);
                        }
                        "THREAD_LIST_SYNC" => {
                            emit_gateway_event(&app2, "discord:thread_list_sync", d);
                        }
                        "THREAD_MEMBER_UPDATE" => {
                            emit_gateway_event(&app2, "discord:thread_member_update", d);
                        }
                        "THREAD_MEMBERS_UPDATE" => {
                            emit_gateway_event(&app2, "discord:thread_members_update", d);
                        }
                        "PRESENCE_UPDATE" => {
                            emit_gateway_event(&app2, "discord:presence_update", d);
                        }
                        "VOICE_STATE_UPDATE" => {
                            emit_gateway_event(&app2, "discord:voice_state_update", d);
                        }
                        "VOICE_SERVER_UPDATE" => {
                            emit_gateway_event(&app2, "discord:voice_server_update", d);
                        }
                        "VOICE_CHANNEL_STATUS_UPDATE" => {
                            emit_gateway_event(&app2, "discord:voice_channel_status_update", d);
                        }
                        "CALL_CREATE" => {
                            emit_gateway_event(&app2, "discord:call_create", d);
                        }
                        "CALL_UPDATE" => {
                            emit_gateway_event(&app2, "discord:call_update", d);
                        }
                        "CALL_DELETE" => {
                            emit_gateway_event(&app2, "discord:call_delete", d);
                        }
                        "NOTIFICATION_CENTER_ITEM_CREATE" | "NOTIFICATION_CENTER_ITEM_DELETE" | "NOTIFICATION_CENTER_ITEMS_ACK" | "RELATIONSHIP_ADD" | "RELATIONSHIP_REMOVE" => {
                            emit_gateway_event(&app2, "discord:notification_center_update", json!({ "event": t.clone(), "data": d }));
                        }
                        "INTERACTION_MODAL_CREATE" => {
                            emit_gateway_event(&app2, "discord:interaction_modal_create", d);
                        }
                        "INTERACTION_IFRAME_MODAL_CREATE" => {
                            emit_gateway_event(&app2, "discord:interaction_iframe_modal_create", d);
                        }
                        "READY" => {
                            emit_rust_log(&app2, "info", "gateway", "Gateway READY received");
                            emit_gateway_event(&app2, "discord:gateway_status", json!({ "status": "connected" }),);
                            emit_gateway_event(&app2, "discord:gateway_ready", d);
                            let presence_app = app2.clone();
                            tauri::async_runtime::spawn(async move {
                                let state = presence_app.state::<AppState>();
                                if let Err(error) = state.rpc.republish(&state.router).await {
                                    log::warn!("Could not restore local game activity after Gateway READY: {error}");
                                }
                            });
                        }
                        "RESUMED" => {
                            emit_rust_log(&app2, "info", "gateway", "Gateway session resumed");
                            emit_gateway_event(&app2, "discord:gateway_status", json!({ "status": "connected", "resumed": true }),);
                            let presence_app = app2.clone();
                            tauri::async_runtime::spawn(async move {
                                let state = presence_app.state::<AppState>();
                                if let Err(error) = state.rpc.republish(&state.router).await {
                                    log::warn!("Could not restore local game activity after Gateway resume: {error}");
                                }
                            });
                        }
                        _ => {}
                    }
                })
                .await;

            if let Err(e) = result {
                eprintln!("[VoidCord gateway] disconnected: {e}. Reconnecting in 5s…");
                emit_rust_log(
                    &app,
                    "warn",
                    "gateway",
                    format!("Gateway disconnected: {e}; retrying in 5 seconds"),
                );
                emit_gateway_event(&app, "discord:gateway_status", json!({ "status": "reconnecting", "detail": e.to_string() }),);
            } else {
                emit_rust_log(
                    &app,
                    "warn",
                    "gateway",
                    "Gateway listener ended; retrying in 5 seconds",
                );
                emit_gateway_event(&app, "discord:gateway_status", json!({ "status": "reconnecting" }),);
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
    server_id: String,
    channel_id: String,
    user_id: String,
    endpoint: String,
    session_id: String,
    token: String,
    input_device_id: Option<String>,
    output_device_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let generation = state
        .voice_controls
        .generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    if let Some(task) = state.voice_task.lock().await.take() {
        task.abort();
    }

    let config = VoiceGatewayConfig {
        endpoint,
        server_id,
        channel_id,
        user_id,
        session_id,
        token,
    };

    let session = match VoiceSession::connect(
        config,
        &app,
        state.voice_controls.deafened.clone(),
        input_device_id,
        output_device_id,
    )
    .await
    {
        Ok(session) => session,
        Err(error) => return Err(error),
    };

    let mut voice_task_slot = state.voice_task.lock().await;
    if state.voice_controls.generation.load(Ordering::SeqCst) != generation {
        drop(voice_task_slot);
        session.close().await;
        return Err("Voice connection was superseded by a newer request".to_owned());
    }
    if let Some(task) = voice_task_slot.take() {
        task.abort();
    }

    let controls: VoiceControlState = state.voice_controls.clone();
    let task_app = app.clone();
    let voice_task = tokio::spawn(async move {
        if let Err(error) = session.run(task_app.clone(), controls).await {
            emit_rust_log(
                &task_app,
                "error",
                "voice",
                format!("Voice session error: {error}"),
            );
            let _ = task_app.emit(
                "discord:voice_status",
                json!({ "status": "failed", "message": error }),
            );
        }
    });

    *voice_task_slot = Some(voice_task);
    Ok(())
}

/// Ngắt kết nối Voice Channel
#[tauri::command]
pub async fn disconnect_voice(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    state
        .voice_controls
        .generation
        .fetch_add(1, Ordering::SeqCst);
    if let Some(task) = state.voice_task.lock().await.take() {
        task.abort();
    }
    let _ = app.emit(
        "discord:voice_status",
        json!({ "status": "disconnected", "message": "Disconnected from voice" }),
    );
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

#[tauri::command]
pub async fn export_vcc_file(
    app: AppHandle,
    content: String,
    custom_path: Option<String>,
) -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;
    use tauri_plugin_dialog::DialogExt;

    let target_path = if let Some(p) = custom_path.filter(|s| !s.trim().is_empty()) {
        Some(PathBuf::from(p))
    } else {
        let default_name = format!(
            "voidcord-cache-{}.vcc",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        );

        // Use async save_file instead of blocking_save_file to prevent thread stalling
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.dialog()
            .file()
            .set_file_name(&default_name)
            .add_filter("VoidCord Cache", &["vcc"])
            .save_file(move |chosen| {
                let _ = sender.send(chosen);
            });

        receiver
            .await
            .map_err(|_| "Dialog channel closed unexpectedly".to_string())?
            .and_then(|p| p.into_path().ok())
    };

    match target_path {
        Some(path) => {
            if path.as_os_str().is_empty() {
                return Err("Export cancelled: no path chosen".to_string());
            }
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::write(&path, content).map_err(|e| format!("Failed to write .vcc file: {e}"))?;
            Ok(path.to_string_lossy().into_owned())
        }
        None => Err("Export cancelled by user".to_string()),
    }
}

#[tauri::command]
pub async fn pick_vcc_file(app: AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    // Use async pick_file instead of blocking_pick_file
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("VoidCord Cache", &["vcc", "json"])
        .pick_file(move |chosen| {
            let _ = sender.send(chosen);
        });

    let chosen = receiver
        .await
        .map_err(|_| "Dialog channel closed unexpectedly".to_string())?;

    match chosen.and_then(|p| p.into_path().ok()) {
        Some(path) => std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read .vcc file at {}: {e}", path.display())),
        None => Err("Import cancelled by user".to_string()),
    }
}
/// Update the token router with Primary, Secondary, and ReadOnly identities.
#[tauri::command]
pub async fn set_router_accounts(
    primary: Option<String>,
    secondary: Option<String>,
    read_only: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .router
        .update_tokens(TokenManager::new(primary, secondary, read_only))
        .await;
    Ok(())
}

#[tauri::command]
pub async fn save_secure_token(account_id: String, token: String) -> Result<(), String> {
    let key = format!("discord_token_{account_id}");
    let entry = keyring::Entry::new("voidcord", &key).map_err(|e| e.to_string())?;
    entry.set_password(&token).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_secure_token(account_id: String) -> Result<Option<String>, String> {
    let key = format!("discord_token_{account_id}");
    let entry = keyring::Entry::new("voidcord", &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn delete_secure_token(account_id: String) -> Result<(), String> {
    let key = format!("discord_token_{account_id}");
    let entry = keyring::Entry::new("voidcord", &key).map_err(|e| e.to_string())?;
    let _ = entry.delete_credential();
    Ok(())
}

#[tauri::command]
pub async fn get_or_create_guild_invite(
    guild_id: String,
    as_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if guild_id.parse::<u64>().is_err() {
        return Err("A valid server ID is required".to_owned());
    }

    let token_ref = as_token.as_deref();
    if let Some(token) = token_ref {
        ensure_credential_available(&state, token).await?;
    }

    // Reuse a vanity URL when the guild has one.
    let guild_val = state
        .router
        .rest_with_auth(
            token_ref,
            AccountIdentity::ReadOnly,
            Method::GET,
            &format!("guilds/{guild_id}"),
            None,
        )
        .await
        .ok();

    if let Some(vanity) = guild_val
        .as_ref()
        .and_then(|guild| guild.get("vanity_url_code"))
        .and_then(Value::as_str)
        .filter(|code| !code.is_empty())
    {
        return Ok(vanity.to_owned());
    }

    // Reuse an existing invite before creating anything.
    if let Ok(invites_val) = state
        .router
        .rest_with_auth(
            token_ref,
            AccountIdentity::ReadOnly,
            Method::GET,
            &format!("guilds/{guild_id}/invites"),
            None,
        )
        .await
    {
        if let Some(code) = invites_val.as_array().and_then(|invites| {
            invites.iter().find_map(|invite| {
                invite
                    .get("code")
                    .and_then(Value::as_str)
                    .filter(|code| !code.is_empty())
            })
        }) {
            return Ok(code.to_owned());
        }
    }

    // Select exactly one eligible channel. Never POST to a second channel
    // if this channel rejects invite creation.
    let channels_val = state
        .router
        .rest_with_auth(
            token_ref,
            AccountIdentity::ReadOnly,
            Method::GET,
            &format!("guilds/{guild_id}/channels"),
            None,
        )
        .await
        .map_err(map_err)?;

    let channels = channels_val
        .as_array()
        .ok_or_else(|| "Discord returned an invalid channel list".to_owned())?;

    let preferred_channel_id = guild_val
        .as_ref()
        .and_then(|guild| guild.get("system_channel_id"))
        .and_then(Value::as_str);

    let eligible = |channel: &&Value| {
        matches!(channel.get("type").and_then(Value::as_i64), Some(0 | 5))
            && channel.get("id").and_then(Value::as_str).is_some()
    };

    let selected_channel = preferred_channel_id
        .and_then(|preferred| {
            channels.iter().find(|channel| {
                eligible(channel) && channel.get("id").and_then(Value::as_str) == Some(preferred)
            })
        })
        .or_else(|| channels.iter().find(eligible))
        .ok_or_else(|| {
            "No eligible text or announcement channel is available for invite creation".to_owned()
        })?;

    let channel_id = selected_channel
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Selected channel has no valid ID".to_owned())?;

    // Exactly one invite-creation request per invocation. Any error is returned
    // to the caller; there is deliberately no retry or channel-scanning fallback.
    let invite = state
        .router
        .rest_with_auth(
            token_ref,
            AccountIdentity::Primary,
            Method::POST,
            &format!("channels/{channel_id}/invites"),
            Some(json!({
                "max_age": 86400,
                "max_uses": 0,
                "temporary": false,
                "unique": false
            })),
        )
        .await
        .map_err(map_err)?;

    invite
        .get("code")
        .and_then(Value::as_str)
        .filter(|code| !code.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "Discord created no invite code in its response".to_owned())
}
