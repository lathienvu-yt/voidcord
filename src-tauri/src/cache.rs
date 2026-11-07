use rocksdb::{Direction, IteratorMode, Options, WriteBatch, DB};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path, sync::Mutex};
use tauri::State;

const NAMESPACES: &[&str] = &[
    "messages",
    "drafts",
    "appData",
    "deletedMessages",
    "archivedMedia",
    "deletedIds",
    "deletedChannels",
    "editedMessages",
];
const MIGRATION_KEY: &[u8] = b"meta\0indexeddb-migration-v1";

pub struct LocalCache {
    db: DB,
    message_write_lock: Mutex<()>,
}

impl LocalCache {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create the local cache directory: {error}"))?;
        }
        let mut options = Options::default();
        options.create_if_missing(true);
        DB::open(&options, path)
            .map(|db| Self {
                db,
                message_write_lock: Mutex::new(()),
            })
            .map_err(|error| format!("Could not open the local RocksDB cache: {error}"))
    }

    fn record_key(namespace: &str, key: &str) -> Result<Vec<u8>, String> {
        if !NAMESPACES.contains(&namespace) {
            return Err(format!("Unknown cache namespace: {namespace}"));
        }
        if key.is_empty() {
            return Err("Cache keys cannot be empty".to_owned());
        }
        Ok(format!("{namespace}\0{key}").into_bytes())
    }

    fn get(&self, namespace: &str, key: &str) -> Result<Option<Value>, String> {
        let key = Self::record_key(namespace, key)?;
        self.db
            .get(key)
            .map_err(|error| error.to_string())?
            .map(|bytes| serde_json::from_slice(&bytes).map_err(|error| error.to_string()))
            .transpose()
    }

    fn get_all(&self, namespace: &str) -> Result<Vec<Value>, String> {
        self.get_by_prefix(namespace, "")
    }

    fn get_by_prefix(&self, namespace: &str, record_prefix: &str) -> Result<Vec<Value>, String> {
        if !NAMESPACES.contains(&namespace) {
            return Err(format!("Unknown cache namespace: {namespace}"));
        }
        let prefix = format!("{namespace}\0{record_prefix}");
        self.db
            .iterator(IteratorMode::From(prefix.as_bytes(), Direction::Forward))
            .take_while(|item| {
                item.as_ref()
                    .map(|(key, _)| key.starts_with(prefix.as_bytes()))
                    .unwrap_or(true)
            })
            .map(|item| {
                let (_, value) = item.map_err(|error| error.to_string())?;
                serde_json::from_slice(&value).map_err(|error| error.to_string())
            })
            .collect()
    }

    fn put(&self, namespace: &str, key: &str, value: &Value) -> Result<(), String> {
        let key = Self::record_key(namespace, key)?;
        let value = serde_json::to_vec(value).map_err(|error| error.to_string())?;
        if namespace == "deletedMessages" {
            let id = key
                .strip_prefix(b"deletedMessages\0")
                .ok_or_else(|| "Invalid deleted-message cache key".to_owned())?;
            let id = std::str::from_utf8(id).map_err(|error| error.to_string())?;
            let mut batch = WriteBatch::default();
            if let Some(old) = self.get(namespace, id)? {
                if let Some(channel_id) = old.get("channelId").and_then(Value::as_str) {
                    batch.delete(deleted_message_index_key(channel_id, id));
                }
            }
            batch.put(&key, &value);
            if let Some(channel_id) =
                serde_json::from_slice::<Value>(&value)
                    .ok()
                    .and_then(|entry| {
                        entry
                            .get("channelId")
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                    })
            {
                batch.put(
                    deleted_message_index_key(&channel_id, id),
                    serde_json::to_vec(id).map_err(|error| error.to_string())?,
                );
            }
            return self.db.write(batch).map_err(|error| error.to_string());
        }
        self.db.put(key, value).map_err(|error| error.to_string())
    }

    fn put_many(&self, namespace: &str, records: Vec<CacheRecord>) -> Result<(), String> {
        if !NAMESPACES.contains(&namespace) {
            return Err(format!("Unknown cache namespace: {namespace}"));
        }
        let mut batch = WriteBatch::default();
        for record in records {
            let key = Self::record_key(namespace, &record.key)?;
            let value = serde_json::to_vec(&record.value).map_err(|error| error.to_string())?;
            if namespace == "deletedMessages" {
                if let Some(old) = self.get(namespace, &record.key)? {
                    if let Some(channel_id) = old.get("channelId").and_then(Value::as_str) {
                        batch.delete(deleted_message_index_key(channel_id, &record.key));
                    }
                }
                if let Some(channel_id) = record.value.get("channelId").and_then(Value::as_str) {
                    batch.put(
                        deleted_message_index_key(channel_id, &record.key),
                        serde_json::to_vec(&record.key).map_err(|error| error.to_string())?,
                    );
                }
            }
            batch.put(key, value);
        }
        self.db.write(batch).map_err(|error| error.to_string())
    }

    fn delete(&self, namespace: &str, key: &str) -> Result<(), String> {
        let key = Self::record_key(namespace, key)?;
        self.db.delete(key).map_err(|error| error.to_string())
    }

    fn migration_complete(&self) -> Result<bool, String> {
        self.db
            .get(MIGRATION_KEY)
            .map(|value| value.is_some())
            .map_err(|error| error.to_string())
    }

    fn finish_migration(&self) -> Result<(), String> {
        self.db
            .put(MIGRATION_KEY, b"complete")
            .map_err(|error| error.to_string())
    }

    fn merge_messages(&self, channel_id: &str, incoming: Vec<Value>) -> Result<(), String> {
        let _guard = self
            .message_write_lock
            .lock()
            .map_err(|_| "Local message cache lock poisoned".to_owned())?;
        let stored = self.get("messages", channel_id)?;
        let mut messages = stored
            .and_then(|record| record.get("messages").and_then(Value::as_array).cloned())
            .unwrap_or_default();
        let tombstones = self.get_by_prefix("deletedIds", &format!("{channel_id}:"))?;
        let deleted_at_by_id = tombstones
            .into_iter()
            .filter(|entry| entry.get("channelId").and_then(Value::as_str) == Some(channel_id))
            .filter_map(|entry| {
                Some((
                    entry.get("messageId")?.as_str()?.to_owned(),
                    entry.get("deletedAt")?.as_u64()?,
                ))
            })
            .collect::<HashMap<_, _>>();
        let mut by_id = messages
            .drain(..)
            .filter_map(|message| {
                let id = message.get("id").and_then(Value::as_str)?.to_owned();
                Some((id, message))
            })
            .collect::<HashMap<_, _>>();

        for message in incoming {
            let Some(message_id) = message.get("id").and_then(Value::as_str).map(str::to_owned)
            else {
                continue;
            };
            let deleted_at = by_id
                .get(&message_id)
                .and_then(|old| old.get("deleted_at").and_then(Value::as_u64))
                .or_else(|| deleted_at_by_id.get(&message_id).copied());
            let mut merged = message;
            if let Some(deleted_at) = deleted_at {
                if let Some(object) = merged.as_object_mut() {
                    object.insert("deleted_at".to_owned(), json!(deleted_at));
                }
            }
            by_id.insert(message_id, merged);
        }

        for (message_id, deleted_at) in &deleted_at_by_id {
            if let Some(message) = by_id.get_mut(message_id) {
                if let Some(object) = message.as_object_mut() {
                    object.insert("deleted_at".to_owned(), json!(deleted_at));
                }
            }
        }

        let mut messages = by_id.into_values().collect::<Vec<_>>();
        messages.sort_by(|left, right| {
            left.get("timestamp")
                .and_then(Value::as_str)
                .unwrap_or("")
                .cmp(right.get("timestamp").and_then(Value::as_str).unwrap_or(""))
        });
        if messages.len() > 500 {
            messages.drain(..messages.len() - 500);
        }
        self.put(
            "messages",
            channel_id,
            &json!({
                "channelId": channel_id,
                "messages": messages,
                "savedAt": chrono_millis()
            }),
        )
    }

    fn mark_message_deleted(
        &self,
        channel_id: &str,
        message_id: &str,
        deleted_at: u64,
        message: Option<Value>,
    ) -> Result<(), String> {
        let _guard = self
            .message_write_lock
            .lock()
            .map_err(|_| "Local message cache lock poisoned".to_owned())?;
        let tombstone_key = format!("{channel_id}:{message_id}");
        let tombstone = json!({
            "id": tombstone_key,
            "channelId": channel_id,
            "messageId": message_id,
            "deletedAt": deleted_at
        });
        let mut batch = WriteBatch::default();
        batch.put(
            Self::record_key("deletedIds", &tombstone_key)?,
            serde_json::to_vec(&tombstone).map_err(|error| error.to_string())?,
        );

        let stored = self.get("messages", channel_id)?;
        let mut messages = stored
            .as_ref()
            .and_then(|record| record.get("messages").and_then(Value::as_array).cloned())
            .unwrap_or_default();
        if let Some(message) = message {
            if let Some(id) = message.get("id").and_then(Value::as_str) {
                if !messages
                    .iter()
                    .any(|cached| cached.get("id").and_then(Value::as_str) == Some(id))
                {
                    messages.push(message);
                }
            }
        }
        if stored.is_some() || !messages.is_empty() {
            for cached in &mut messages {
                if cached.get("id").and_then(Value::as_str) == Some(message_id) {
                    if let Some(object) = cached.as_object_mut() {
                        object.insert("deleted_at".to_owned(), json!(deleted_at));
                    }
                }
            }
            let key = Self::record_key("messages", channel_id)?;
            batch.put(
                key,
                serde_json::to_vec(&json!({
                    "channelId": channel_id,
                    "messages": messages,
                    "savedAt": chrono_millis()
                }))
                .map_err(|error| error.to_string())?,
            );
        }

        self.db.write(batch).map_err(|error| error.to_string())
    }

    fn delete_log_and_media(&self, namespace: &str, id: &str) -> Result<(), String> {
        if !matches!(namespace, "deletedMessages" | "editedMessages") {
            return Err("Only deleted or edited message logs can be removed this way".to_owned());
        }
        let mut batch = WriteBatch::default();
        batch.delete(Self::record_key(namespace, id)?);
        if namespace == "deletedMessages" {
            if let Some(entry) = self.get(namespace, id)? {
                if let Some(channel_id) = entry.get("channelId").and_then(Value::as_str) {
                    batch.delete(deleted_message_index_key(channel_id, id));
                }
            }
        }
        let prefix = b"archivedMedia\0";
        for item in self
            .db
            .iterator(IteratorMode::From(prefix, Direction::Forward))
            .take_while(|item| {
                item.as_ref()
                    .map(|(key, _)| key.starts_with(prefix))
                    .unwrap_or(true)
            })
        {
            let (key, _) = item.map_err(|error| error.to_string())?;
            let key = std::str::from_utf8(&key).map_err(|error| error.to_string())?;
            let Some(media_id) = key.strip_prefix("archivedMedia\0") else {
                continue;
            };
            if media_id.starts_with(&format!("{id}:")) {
                batch.delete(key.as_bytes());
            }
        }
        self.db.write(batch).map_err(|error| error.to_string())
    }

    fn deleted_messages_for_channel(&self, channel_id: &str) -> Result<Vec<Value>, String> {
        let prefix = format!("deletedMessagesByChannel\0{channel_id}\0");
        self.db
            .iterator(IteratorMode::From(prefix.as_bytes(), Direction::Forward))
            .take_while(|item| {
                item.as_ref()
                    .map(|(key, _)| key.starts_with(prefix.as_bytes()))
                    .unwrap_or(true)
            })
            .map(|item| {
                let (_, indexed_id) = item.map_err(|error| error.to_string())?;
                let id: String =
                    serde_json::from_slice(&indexed_id).map_err(|error| error.to_string())?;
                self.get("deletedMessages", &id).and_then(|entry| {
                    entry.ok_or_else(|| {
                        format!("Missing deleted-message cache entry for key '{id}'")
                    })
                })
            })
            .collect()
    }
}

fn deleted_message_index_key(channel_id: &str, message_id: &str) -> Vec<u8> {
    format!("deletedMessagesByChannel\0{channel_id}\0{message_id}").into_bytes()
}

fn chrono_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheRecord {
    key: String,
    value: Value,
}

#[tauri::command]
pub fn cache_get(
    namespace: String,
    key: String,
    cache: State<'_, LocalCache>,
) -> Result<Option<Value>, String> {
    cache.get(&namespace, &key)
}

#[tauri::command]
pub fn cache_get_all(
    namespace: String,
    cache: State<'_, LocalCache>,
) -> Result<Vec<Value>, String> {
    cache.get_all(&namespace)
}

#[tauri::command]
pub fn cache_put(
    namespace: String,
    key: String,
    value: Value,
    cache: State<'_, LocalCache>,
) -> Result<(), String> {
    cache.put(&namespace, &key, &value)
}

#[tauri::command]
pub fn cache_put_many(
    namespace: String,
    records: Vec<CacheRecord>,
    cache: State<'_, LocalCache>,
) -> Result<(), String> {
    cache.put_many(&namespace, records)
}

#[tauri::command]
pub fn cache_delete(
    namespace: String,
    key: String,
    cache: State<'_, LocalCache>,
) -> Result<(), String> {
    cache.delete(&namespace, &key)
}

#[tauri::command]
pub fn cache_merge_messages(
    channel_id: String,
    messages: Vec<Value>,
    cache: State<'_, LocalCache>,
) -> Result<(), String> {
    cache.merge_messages(&channel_id, messages)
}

#[tauri::command]
pub fn cache_mark_message_deleted(
    channel_id: String,
    message_id: String,
    deleted_at: u64,
    message: Option<Value>,
    cache: State<'_, LocalCache>,
) -> Result<(), String> {
    cache.mark_message_deleted(&channel_id, &message_id, deleted_at, message)
}

#[tauri::command]
pub fn cache_delete_log(
    namespace: String,
    id: String,
    cache: State<'_, LocalCache>,
) -> Result<(), String> {
    cache.delete_log_and_media(&namespace, &id)
}

#[tauri::command]
pub fn cache_migration_complete(cache: State<'_, LocalCache>) -> Result<bool, String> {
    cache.migration_complete()
}

#[tauri::command]
pub fn cache_finish_migration(cache: State<'_, LocalCache>) -> Result<(), String> {
    cache.finish_migration()
}

#[tauri::command]
pub fn cache_get_deleted_messages_for_channel(
    channel_id: String,
    cache: State<'_, LocalCache>,
) -> Result<Vec<Value>, String> {
    cache.deleted_messages_for_channel(&channel_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_cache() -> (LocalCache, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!("voidcord-rocksdb-{}", uuid::Uuid::new_v4()));
        (LocalCache::open(&path).unwrap(), path)
    }

    #[test]
    fn message_merge_preserves_deleted_markers() {
        let (cache, path) = temporary_cache();
        cache
            .put(
                "deletedIds",
                "123:2",
                &json!({"id":"123:2","channelId":"123","messageId":"2","deletedAt":10}),
            )
            .unwrap();
        cache
            .merge_messages(
                "123",
                vec![
                    json!({"id":"1","timestamp":"2026-01-01T00:00:00.000Z"}),
                    json!({"id":"2","timestamp":"2026-01-02T00:00:00.000Z"}),
                ],
            )
            .unwrap();
        let messages = cache.get("messages", "123").unwrap().unwrap()["messages"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1]["deleted_at"], 10);
        drop(cache);
        std::fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn message_cache_caps_history_at_five_hundred() {
        let (cache, path) = temporary_cache();
        let messages = (0..501)
            .map(|index| {
                json!({
                    "id": index.to_string(),
                    "timestamp": format!(
                        "2026-01-01T00:{:02}:{:02}.000Z",
                        index / 60,
                        index % 60
                    )
                })
            })
            .collect();
        cache.merge_messages("123", messages).unwrap();
        let stored = cache.get("messages", "123").unwrap().unwrap();
        let messages = stored["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 500);
        assert_eq!(messages[0]["id"], "1");
        drop(cache);
        std::fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn cache_namespaces_reject_unknown_values() {
        let (cache, path) = temporary_cache();
        assert!(cache.get("unknown", "key").is_err());
        drop(cache);
        std::fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn deleted_message_channel_index_tracks_writes_and_deletes() {
        let (cache, path) = temporary_cache();
        cache
            .put(
                "deletedMessages",
                "message-1",
                &json!({"id":"message-1","channelId":"channel-1","deletedAt":10}),
            )
            .unwrap();
        assert_eq!(
            cache
                .deleted_messages_for_channel("channel-1")
                .unwrap()
                .len(),
            1
        );
        cache
            .delete_log_and_media("deletedMessages", "message-1")
            .unwrap();
        assert!(cache
            .deleted_messages_for_channel("channel-1")
            .unwrap()
            .is_empty());
        drop(cache);
        std::fs::remove_dir_all(path).unwrap();
    }
}
