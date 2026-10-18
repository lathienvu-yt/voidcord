//! Lossless-enough model for the single observed `/users/@me/settings-proto/1`
//! PATCH shape. The capture reveals only an opaque protobuf field, so this
//! module deliberately does not invent names for the bytes inside it.
//!
//! Evidence from HAR record 453:
//! - JSON wrapper key `settings`, whose value is a padded standard Base64 string.
//! - Decoded request is 1,015 bytes.
//! - The protobuf wire stream contains one field: field number 14, wire type 2
//!   (length-delimited), with a 1,012-byte value.
//! - That value contains 70 occurrences of field number 1, wire type 2. Their
//!   encoded lengths are 10 (65 occurrences), 26 (1), 41 (2), 52 (1), and 62
//!   (1), including each child tag and length prefix.
//!
//! Treating field 14 and its repeated field-1 values as nested messages is an
//! inference from their protobuf-compatible wire encoding. The value formats
//! inside field 1 are unknown and are retained as bytes.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{de, Deserialize, Deserializer, Serialize, Serializer};

const OBSERVED_FIELD_NUMBER: u64 = 14;
const OBSERVED_WIRE_TYPE: u64 = 2;

/// Opaque value of the only field observed in the settings-proto/1 PATCH.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettingsProtoV1Delta {
    /// Verified field 14 contains repeated length-delimited field-1 entries.
    pub field_14: Vec<SettingsProtoV1Entry>,
}

/// Wire-level field 1 found repeatedly inside observed field 14.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettingsProtoV1Entry {
    /// Opaque value bytes; their semantic message/string format is not known.
    pub field_1: Vec<u8>,
}

impl SettingsProtoV1Delta {
    /// Decode the observed one-field protobuf shape; reject unknown fields so a
    /// caller cannot accidentally send a payload that this model would alter.
    pub fn decode_wire(bytes: &[u8]) -> Result<Self, String> {
        let mut cursor = 0;
        let key = read_varint(bytes, &mut cursor)?;
        let field_number = key >> 3;
        let wire_type = key & 0b111;
        if field_number != OBSERVED_FIELD_NUMBER || wire_type != OBSERVED_WIRE_TYPE {
            return Err(format!(
                "Expected the observed protobuf field 14 (wire type 2), got field {field_number} (wire type {wire_type})"
            ));
        }

        let length = usize::try_from(read_varint(bytes, &mut cursor)?)
            .map_err(|_| "Protobuf field length is too large".to_owned())?;
        let end = cursor
            .checked_add(length)
            .ok_or_else(|| "Protobuf field length overflow".to_owned())?;
        if end != bytes.len() {
            return Err("Expected exactly one complete field-14 payload".to_owned());
        }

        let mut nested_cursor = cursor;
        let mut entries = Vec::new();
        while nested_cursor < end {
            let child_key = read_varint(&bytes[..end], &mut nested_cursor)?;
            let child_number = child_key >> 3;
            let child_wire_type = child_key & 0b111;
            if child_number != 1 || child_wire_type != 2 {
                return Err(format!(
                    "Expected repeated protobuf field 1 (wire type 2) inside field 14, got field {child_number} (wire type {child_wire_type})"
                ));
            }
            let child_length = usize::try_from(read_varint(&bytes[..end], &mut nested_cursor)?)
                .map_err(|_| "Nested protobuf field length is too large".to_owned())?;
            let child_end = nested_cursor
                .checked_add(child_length)
                .ok_or_else(|| "Nested protobuf field length overflow".to_owned())?;
            if child_end > end {
                return Err("Truncated field-1 value inside field 14".to_owned());
            }
            entries.push(SettingsProtoV1Entry {
                field_1: bytes[nested_cursor..child_end].to_vec(),
            });
            nested_cursor = child_end;
        }

        Ok(Self { field_14: entries })
    }

    /// Encode field 14 with a canonical protobuf varint header, preserving its
    /// captured opaque value byte-for-byte.
    pub fn encode_wire(&self) -> Result<Vec<u8>, String> {
        let mut nested = Vec::new();
        for entry in &self.field_14 {
            write_varint((1 << 3) | 2, &mut nested);
            write_varint(
                u64::try_from(entry.field_1.len())
                    .map_err(|_| "Nested protobuf field length is too large".to_owned())?,
                &mut nested,
            );
            nested.extend_from_slice(&entry.field_1);
        }

        let mut output = Vec::with_capacity(nested.len() + 4);
        write_varint((OBSERVED_FIELD_NUMBER << 3) | OBSERVED_WIRE_TYPE, &mut output);
        write_varint(
            u64::try_from(nested.len())
                .map_err(|_| "Protobuf field length is too large".to_owned())?,
            &mut output,
        );
        output.extend_from_slice(&nested);
        Ok(output)
    }
}

/// Exact JSON wrapper observed in the request: `{ "settings": "<base64>" }`.
/// Serde presents `settings` as a parsed field-14 delta to Rust callers while
/// keeping the JSON representation Base64, as Discord's endpoint expects.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SettingsProtoV1Envelope {
    #[serde(with = "base64_wire")]
    pub settings: SettingsProtoV1Delta,
}

impl SettingsProtoV1Envelope {
    /// Parse a Base64 value supplied by the frontend and validate its observed
    /// protobuf wire shape before it can be sent to Discord.
    pub fn from_base64(encoded: &str) -> Result<Self, String> {
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|_| "settings_payload must be valid standard Base64".to_owned())?;
        let settings = SettingsProtoV1Delta::decode_wire(&bytes)?;
        Ok(Self { settings })
    }
}

mod base64_wire {
    use super::*;

    pub fn serialize<S>(value: &SettingsProtoV1Delta, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let wire = value.encode_wire().map_err(serde::ser::Error::custom)?;
        serializer.serialize_str(&STANDARD.encode(wire))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<SettingsProtoV1Delta, D::Error>
    where
        D: Deserializer<'de>,
    {
        let encoded = String::deserialize(deserializer)?;
        let wire = STANDARD.decode(encoded).map_err(de::Error::custom)?;
        SettingsProtoV1Delta::decode_wire(&wire).map_err(de::Error::custom)
    }
}

fn read_varint(bytes: &[u8], cursor: &mut usize) -> Result<u64, String> {
    let mut value = 0u64;
    for shift in (0..70).step_by(7) {
        let byte = *bytes
            .get(*cursor)
            .ok_or_else(|| "Truncated protobuf varint".to_owned())?;
        *cursor += 1;
        if shift == 63 && byte > 1 {
            return Err("Protobuf varint overflow".to_owned());
        }
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
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
