//! Typed encoder for verified settings-proto v1 scalar deltas.
//!
//! The Tauri command serializes a typed delta into the observed request
//! envelope, then sends it through the app's explicitly selected primary
//! account. It never switches account identity on permission failures.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

use crate::{discord_router::AccountIdentity, AppState};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsProtoV1Delta {
    pub required_data_version: u32,
    #[serde(default)]
    pub appearance: Option<AppearanceDelta>,
    #[serde(default)]
    pub privacy: Option<PrivacyDelta>,
    #[serde(default)]
    pub text_and_images: Option<TextAndImagesDelta>,
    #[serde(default)]
    pub clips: Option<ClipsDelta>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceDelta {
    pub developer_mode: Option<bool>, // AppearanceSettings field 2
    pub dark_sidebar: Option<bool>,   // AppearanceSettings field 15
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyDelta {
    pub contact_sync_enabled: Option<bool>, // field 10: wrapped bool message
    pub hide_legacy_username: Option<bool>, // field 22: wrapped bool message
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TextAndImagesDelta {
    pub inline_attachment_media: Option<bool>, // field 9: wrapped bool message
    pub inline_embed_media: Option<bool>,      // field 10: wrapped bool message
    pub gif_auto_play: Option<bool>,           // field 11: wrapped bool message
    pub render_embeds: Option<bool>,           // field 12: wrapped bool message
    pub convert_emoticons: Option<bool>,       // field 21: wrapped bool message
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClipsDelta {
    pub allow_voice_recording: Option<bool>, // field 1: wrapped bool message
}

#[derive(Debug, Clone, Serialize)]
pub struct SettingsProtoEnvelope {
    pub settings: String,
    pub required_data_version: u32,
}

#[tauri::command]
pub async fn save_client_settings(
    changes: SettingsProtoV1Delta,
    state: State<'_, AppState>,
) -> Result<SettingsProtoEnvelope, String> {
    let mut wire = Vec::new();
    if let Some(scope) = changes.appearance {
        append_message(&mut wire, 13, &raw_bool_fields([
            (2, scope.developer_mode), (15, scope.dark_sidebar),
        ]));
    }
    if let Some(scope) = changes.privacy {
        append_message(&mut wire, 8, &wrapped_bool_fields([
            (10, scope.contact_sync_enabled), (22, scope.hide_legacy_username),
        ]));
    }
    if let Some(scope) = changes.text_and_images {
        append_message(&mut wire, 6, &wrapped_bool_fields([
            (9, scope.inline_attachment_media), (10, scope.inline_embed_media),
            (11, scope.gif_auto_play), (12, scope.render_embeds),
            (21, scope.convert_emoticons),
        ]));
    }
    if let Some(scope) = changes.clips {
        let mut clips = Vec::new();
        if let Some(value) = scope.allow_voice_recording {
            append_message(&mut clips, 1, &wrapped_bool(value));
        }
        append_message(&mut wire, 19, &clips);
    }
    if wire.is_empty() {
        return Err("No verified settings fields were provided".to_owned());
    }
    let envelope = SettingsProtoEnvelope {
        settings: STANDARD.encode(wire),
        required_data_version: changes.required_data_version,
    };
    state.router.rest(
        AccountIdentity::Primary,
        reqwest::Method::PATCH,
        "users/@me/settings-proto/1",
        Some(json!({
            "settings": envelope.settings,
            "required_data_version": envelope.required_data_version,
        })),
    ).await.map_err(|error| error.to_string())?;
    Ok(envelope)
}

fn raw_bool_fields<const N: usize>(fields: [(u32, Option<bool>); N]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for (number, value) in fields {
        // Match proto3's generated writer: plain false scalars are omitted.
        if let Some(true) = value {
            write_varint((number as u64) << 3, &mut bytes);
            write_varint(1, &mut bytes);
        }
    }
    bytes
}

fn wrapped_bool_fields<const N: usize>(fields: [(u32, Option<bool>); N]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for (number, value) in fields {
        if let Some(value) = value {
            append_message(&mut bytes, number, &wrapped_bool(value));
        }
    }
    bytes
}

fn wrapped_bool(value: bool) -> Vec<u8> {
    if !value {
        // The wrapper message's default false value serializes to zero bytes;
        // its zero-length presence still represents an explicit false value.
        return Vec::new();
    }
    vec![8, 1] // wrapper.message.value, field 1 / varint true
}

fn append_message(output: &mut Vec<u8>, number: u32, value: &[u8]) {
    write_varint(((number as u64) << 3) | 2, output);
    write_varint(value.len() as u64, output);
    output.extend_from_slice(value);
}

fn write_varint(mut value: u64, output: &mut Vec<u8>) {
    while value >= 0x80 {
        output.push((value as u8) | 0x80);
        value >>= 7;
    }
    output.push(value as u8);
}
