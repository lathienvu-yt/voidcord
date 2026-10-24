//! Typed encoder for verified settings-proto v1 scalar deltas.
//!
//! Discord requires the complete top-level message for every modified setting
//! scope. Before writing, this module fetches the current proto and merges the
//! requested leaf fields into their existing scope, retaining unknown fields.
//! It uses the explicitly selected primary account and never switches identity
//! on permission failures.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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
    // Fetch the authoritative current proto first. Sending a partial nested
    // scope would reset every omitted sibling field to its default on Discord.
    let current = state.router.rest(
        AccountIdentity::ReadOnly,
        reqwest::Method::GET,
        "users/@me/settings-proto/1",
        None,
    ).await.map_err(|error| format!("Could not read current settings proto: {error}"))?;
    let encoded_current = current
        .get("settings")
        .and_then(Value::as_str)
        .ok_or_else(|| "Discord settings-proto response did not contain Base64 settings".to_owned())?;
    let decoded_current = STANDARD
        .decode(encoded_current)
        .map_err(|_| "Discord returned invalid Base64 settings".to_owned())?;
    let mut fields = parse_fields(&decoded_current)?;
    // Use the data version from the snapshot we are about to merge, rather
    // than the UI's old placeholder, so Discord can reject stale writes safely.
    let required_data_version = extract_data_version(&fields)
        .unwrap_or(changes.required_data_version);

    let mut changed_scopes = Vec::new();
    if let Some(scope) = changes.appearance {
        apply_scope(&mut fields, 13, vec![
            (2, scope.developer_mode, false),
            (15, scope.dark_sidebar, false),
        ])?;
        changed_scopes.push(13);
    }
    if let Some(scope) = changes.privacy {
        apply_scope(&mut fields, 8, vec![
            (10, scope.contact_sync_enabled, true),
            (22, scope.hide_legacy_username, true),
        ])?;
        changed_scopes.push(8);
    }
    if let Some(scope) = changes.text_and_images {
        apply_scope(&mut fields, 6, vec![
            (9, scope.inline_attachment_media, true),
            (10, scope.inline_embed_media, true),
            (11, scope.gif_auto_play, true),
            (12, scope.render_embeds, true),
            (21, scope.convert_emoticons, true),
        ])?;
        changed_scopes.push(6);
    }
    if let Some(scope) = changes.clips {
        apply_scope(&mut fields, 19, vec![
            (1, scope.allow_voice_recording, true),
        ])?;
        changed_scopes.push(19);
    }
    if changed_scopes.is_empty() {
        return Err("No verified settings fields were provided".to_owned());
    }

    // Send only the top-level scopes actually changed. Each included scope is
    // complete, while unrelated scopes remain omitted to avoid needless writes.
    let mut wire = Vec::new();
    for field in fields.into_iter().filter(|field| changed_scopes.contains(&(field.number as u32))) {
        wire.extend_from_slice(&field.raw);
    }
    let envelope = SettingsProtoEnvelope {
        settings: STANDARD.encode(wire),
        required_data_version,
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

#[derive(Debug, Clone)]
struct WireField {
    number: u64,
    wire_type: u64,
    raw: Vec<u8>,
    payload: Option<Vec<u8>>,
}

/// Read PreloadedUserSettings.versions.data_version (top-level field 1,
/// nested uint32 field 3) from the snapshot. Unknown version layouts are left
/// alone and let the caller use its supplied fallback.
fn extract_data_version(fields: &[WireField]) -> Option<u32> {
    let versions = fields.iter().find(|field| field.number == 1 && field.wire_type == 2)?;
    let nested = parse_fields(versions.payload.as_deref()?).ok()?;
    let data_version = nested.iter().find(|field| field.number == 3 && field.wire_type == 0)?;
    let mut cursor = 0;
    let key = read_varint(&data_version.raw, &mut cursor).ok()?;
    if key >> 3 != 3 || key & 7 != 0 { return None; }
    u32::try_from(read_varint(&data_version.raw, &mut cursor).ok()?).ok()
}

/// Parse protobuf fields while retaining their original encoded bytes. Unknown
/// fields are deliberately opaque and survive the read/modify/write cycle.
fn parse_fields(bytes: &[u8]) -> Result<Vec<WireField>, String> {
    let mut cursor = 0usize;
    let mut fields = Vec::new();
    while cursor < bytes.len() {
        let start = cursor;
        let key = read_varint(bytes, &mut cursor)?;
        let number = key >> 3;
        let wire_type = key & 7;
        if number == 0 {
            return Err("Invalid protobuf field number 0".to_owned());
        }
        let payload = match wire_type {
            0 => {
                read_varint(bytes, &mut cursor)?;
                None
            }
            1 => {
                cursor = cursor.checked_add(8).ok_or_else(|| "Protobuf cursor overflow".to_owned())?;
                if cursor > bytes.len() { return Err("Truncated fixed64 protobuf field".to_owned()); }
                None
            }
            2 => {
                let length = usize::try_from(read_varint(bytes, &mut cursor)?)
                    .map_err(|_| "Protobuf field length is too large".to_owned())?;
                let end = cursor.checked_add(length).ok_or_else(|| "Protobuf field length overflow".to_owned())?;
                if end > bytes.len() { return Err("Truncated length-delimited protobuf field".to_owned()); }
                let value = bytes[cursor..end].to_vec();
                cursor = end;
                Some(value)
            }
            5 => {
                cursor = cursor.checked_add(4).ok_or_else(|| "Protobuf cursor overflow".to_owned())?;
                if cursor > bytes.len() { return Err("Truncated fixed32 protobuf field".to_owned()); }
                None
            }
            _ => return Err(format!("Unsupported protobuf wire type {wire_type}; refusing to rewrite settings")),
        };
        fields.push(WireField {
            number,
            wire_type,
            raw: bytes[start..cursor].to_vec(),
            payload,
        });
    }
    Ok(fields)
}

/// Merge leaf changes into a complete top-level settings scope, keeping every
/// unrelated known or unknown field from the latest server snapshot.
fn apply_scope(
    top_fields: &mut Vec<WireField>,
    scope_number: u32,
    updates: Vec<(u32, Option<bool>, bool)>,
) -> Result<(), String> {
    let matching: Vec<usize> = top_fields.iter().enumerate()
        .filter_map(|(index, field)| (field.number == u64::from(scope_number)).then_some(index))
        .collect();

    let insertion_index = matching.first().copied().unwrap_or(top_fields.len());
    let mut nested = Vec::new();
    for index in &matching {
        let field = &top_fields[*index];
        if field.wire_type != 2 {
            return Err(format!("Settings scope {scope_number} was not length-delimited"));
        }
        let payload = field.payload.as_deref().ok_or_else(|| "Missing protobuf scope payload".to_owned())?;
        nested.extend(parse_fields(payload)?);
    }

    for (leaf_number, value, wrapped) in updates {
        let Some(value) = value else { continue; };
        let first_match = nested.iter().position(|field| field.number == u64::from(leaf_number));
        nested.retain(|field| field.number != u64::from(leaf_number));

        // Proto3 scalar false is represented by absence; BoolValue false must
        // remain present as an empty wrapper message.
        if wrapped {
            let payload = if value { vec![8, 1] } else { Vec::new() };
            let replacement = WireField {
                number: u64::from(leaf_number),
                wire_type: 2,
                raw: encode_field(u64::from(leaf_number), 2, &payload),
                payload: Some(payload),
            };
            let position = first_match.unwrap_or(nested.len()).min(nested.len());
            nested.insert(position, replacement);
        } else if value {
            // Plain proto3 bool: true is varint 1; false is omitted.
            let mut raw = Vec::new();
            write_varint(u64::from(leaf_number) << 3, &mut raw);
            write_varint(1, &mut raw);
            let replacement = WireField {
                number: u64::from(leaf_number),
                wire_type: 0,
                raw,
                payload: None,
            };
            let position = first_match.unwrap_or(nested.len()).min(nested.len());
            nested.insert(position, replacement);
        }
    }

    let mut payload = Vec::new();
    for field in nested { payload.extend_from_slice(&field.raw); }
    let replacement = WireField {
        number: u64::from(scope_number),
        wire_type: 2,
        raw: encode_field(u64::from(scope_number), 2, &payload),
        payload: Some(payload),
    };

    let mut rebuilt = Vec::with_capacity(top_fields.len() + 1);
    let mut inserted = false;
    for (index, field) in top_fields.drain(..).enumerate() {
        if field.number == u64::from(scope_number) {
            if !inserted {
                rebuilt.push(replacement.clone());
                inserted = true;
            }
        } else {
            rebuilt.push(field);
        }
        // Keep the replacement near the original field to preserve wire order.
        if index + 1 == insertion_index && !inserted {
            rebuilt.push(replacement.clone());
            inserted = true;
        }
    }
    if !inserted { rebuilt.push(replacement); }
    *top_fields = rebuilt;
    Ok(())
}

fn encode_field(number: u64, wire_type: u64, payload: &[u8]) -> Vec<u8> {
    let mut output = Vec::new();
    write_varint((number << 3) | wire_type, &mut output);
    if wire_type == 2 {
        write_varint(payload.len() as u64, &mut output);
        output.extend_from_slice(payload);
    }
    output
}

fn read_varint(bytes: &[u8], cursor: &mut usize) -> Result<u64, String> {
    let mut value = 0u64;
    for shift in (0..70).step_by(7) {
        let byte = *bytes.get(*cursor).ok_or_else(|| "Truncated protobuf varint".to_owned())?;
        *cursor += 1;
        if shift == 63 && byte > 1 {
            return Err("Protobuf varint overflow".to_owned());
        }
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 { return Ok(value); }
    }
    Err("Protobuf varint is too long".to_owned())
}

fn write_varint(mut value: u64, output: &mut Vec<u8>) {
    while value >= 0x80 {
        output.push((value as u8) | 0x80);
        value >>= 7;
    }
    output.push(value as u8);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_merge_preserves_unmodified_fields_and_unknown_bytes() {
        // Appearance field 1 = theme 2; field 2 = developer_mode true;
        // field 99 is an unknown varint retained byte-for-byte.
        let appearance = vec![8, 2, 16, 1, 152, 6, 7];
        let mut top = parse_fields(&encode_field(13, 2, &appearance)).unwrap();
        apply_scope(&mut top, 13, vec![
            (2, Some(false), false),
            (15, Some(true), false),
        ]).unwrap();

        let encoded: Vec<u8> = top.iter().flat_map(|field| field.raw.clone()).collect();
        let top_parsed = parse_fields(&encoded).unwrap();
        let nested = parse_fields(top_parsed[0].payload.as_deref().unwrap()).unwrap();
        assert!(nested.iter().any(|field| field.number == 1 && field.raw == [8, 2]));
        assert!(!nested.iter().any(|field| field.number == 2));
        assert!(nested.iter().any(|field| field.number == 15 && field.raw == [120, 1]));
        assert!(nested.iter().any(|field| field.number == 99 && field.raw == [152, 6, 7]));
    }

    #[test]
    fn wrapped_false_keeps_presence_with_empty_message() {
        let mut top = Vec::new();
        apply_scope(&mut top, 19, vec![(1, Some(false), true)]).unwrap();
        assert_eq!(top.len(), 1);
        assert_eq!(top[0].number, 19);
        let nested = parse_fields(top[0].payload.as_deref().unwrap()).unwrap();
        assert_eq!(nested.len(), 1);
        assert_eq!(nested[0].number, 1);
        assert_eq!(nested[0].wire_type, 2);
        assert!(nested[0].payload.as_deref().unwrap().is_empty());
    }

    #[test]
    fn data_version_is_read_from_versions_scope() {
        // Top-level versions field 1, nested data_version field 3 = 42.
        let versions = vec![24, 42];
        let top = parse_fields(&encode_field(1, 2, &versions)).unwrap();
        assert_eq!(extract_data_version(&top), Some(42));
    }
}
