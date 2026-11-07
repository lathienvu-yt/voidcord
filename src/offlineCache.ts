import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { DiscordChannel, DiscordMessage } from "./types";

export const MAX_CACHED_MESSAGES_PER_CHANNEL = 500;

const LEGACY_DATABASE_NAME = "voidcord-local-cache";
const LEGACY_DATABASE_VERSION = 7;
const LEGACY_STORES = [
  "messages",
  "drafts",
  "appData",
  "deletedMessages",
  "archivedMedia",
  "deletedIds",
  "deletedChannels",
  "editedMessages",
] as const;

type CacheNamespace = typeof LEGACY_STORES[number];
type CacheRecord = { key: string; value: unknown };

let cacheMigration: Promise<void> | null = null;

function reportStartupProgress(message: string): void {
  window.dispatchEvent(new CustomEvent("voidcord-startup-progress", { detail: message }));
}

function openLegacyCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DATABASE_NAME, LEGACY_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("messages")) db.createObjectStore("messages", { keyPath: "channelId" });
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "channelId" });
      if (!db.objectStoreNames.contains("appData")) db.createObjectStore("appData", { keyPath: "key" });
      if (!db.objectStoreNames.contains("deletedMessages")) {
        const deletedMessages = db.createObjectStore("deletedMessages", { keyPath: "id" });
        deletedMessages.createIndex("channelId", "channelId");
      } else {
        const deletedMessages = request.transaction?.objectStore("deletedMessages");
        if (deletedMessages && !deletedMessages.indexNames.contains("channelId")) {
          deletedMessages.createIndex("channelId", "channelId");
        }
      }
      if (!db.objectStoreNames.contains("archivedMedia")) db.createObjectStore("archivedMedia", { keyPath: "id" });
      if (!db.objectStoreNames.contains("deletedIds")) {
        const deletedIds = db.createObjectStore("deletedIds", { keyPath: "id" });
        deletedIds.createIndex("channelId", "channelId");
      }
      if (!db.objectStoreNames.contains("deletedChannels")) db.createObjectStore("deletedChannels", { keyPath: "id" });
      if (!db.objectStoreNames.contains("editedMessages")) {
        const editedMessages = db.createObjectStore("editedMessages", { keyPath: "id" });
        editedMessages.createIndex("channelId", "channelId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the legacy local cache"));
  });
}

function migrateLegacyStore(db: IDBDatabase, namespace: CacheNamespace): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(namespace, "readonly");
    const request = transaction.objectStore(namespace).openCursor();
    let records: CacheRecord[] = [];
    let batchBytes = 0;
    let writes = Promise.resolve();
    let writeError: unknown;

    const flush = () => {
      if (records.length === 0) return;
      const batch = records;
      records = [];
      batchBytes = 0;
      writes = writes.then(async () => {
        if (writeError) return;
        try {
          await tauriInvoke("cache_put_many", { namespace, records: batch });
        } catch (error) {
          writeError = error;
          throw error;
        }
      });
      void writes.catch(() => {});
    };

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        flush();
        void writes.then(() => writeError ? reject(writeError) : resolve(), reject);
        return;
      }
      const value = cursor.value;
      if (value === undefined) {
        reject(new Error(`Invalid record in legacy cache store '${namespace}'`));
        return;
      }
      const record = { key: String(cursor.primaryKey), value };
      records.push(record);
      batchBytes += JSON.stringify(record).length;
      if (records.length >= 16 || batchBytes >= 512 * 1024) flush();
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error(`Could not read legacy cache store '${namespace}'`));
    transaction.onabort = () => reject(transaction.error || new Error(`Legacy cache migration aborted for '${namespace}'`));
    transaction.onerror = () => reject(transaction.error || new Error(`Could not migrate legacy cache store '${namespace}'`));
  });
}

async function migrateLegacyCache(): Promise<void> {
  if (await tauriInvoke<boolean>("cache_migration_complete")) return;
  reportStartupProgress("Migrating offline storage…");
  const db = await openLegacyCache();
  try {
    for (const namespace of LEGACY_STORES) {
      if (db.objectStoreNames.contains(namespace)) {
        reportStartupProgress(`Migrating offline storage (${namespace})…`);
        await migrateLegacyStore(db, namespace);
      }
    }
    await tauriInvoke("cache_finish_migration");
    reportStartupProgress("Offline storage is ready.");
  } finally {
    db.close();
  }
}

async function ensureCacheMigration(): Promise<void> {
  if (!cacheMigration) {
    cacheMigration = migrateLegacyCache().catch(error => {
      cacheMigration = null;
      throw error;
    });
  }
  await cacheMigration;
}

async function cacheGet<T>(namespace: CacheNamespace, key: string): Promise<T | undefined> {
  await ensureCacheMigration();
  const value = await tauriInvoke<T | null>("cache_get", { namespace, key });
  return value ?? undefined;
}

async function cacheGetAll<T>(namespace: CacheNamespace): Promise<T[]> {
  await ensureCacheMigration();
  return tauriInvoke<T[]>("cache_get_all", { namespace });
}

async function cacheGetDeletedMessagesForChannel(channelId: string): Promise<DeletedMessageLog[]> {
  await ensureCacheMigration();
  return tauriInvoke<DeletedMessageLog[]>("cache_get_deleted_messages_for_channel", { channelId });
}

async function cachePut(namespace: CacheNamespace, key: string, value: unknown): Promise<void> {
  await ensureCacheMigration();
  await tauriInvoke("cache_put", { namespace, key, value });
}

async function cachePutMany(namespace: CacheNamespace, records: CacheRecord[]): Promise<void> {
  await ensureCacheMigration();
  let batch: CacheRecord[] = [];
  let batchBytes = 0;
  for (const record of records) {
    batch.push(record);
    batchBytes += JSON.stringify(record).length;
    if (batch.length >= 16 || batchBytes >= 512 * 1024) {
      await tauriInvoke("cache_put_many", { namespace, records: batch });
      batch = [];
      batchBytes = 0;
    }
  }
  if (batch.length > 0) {
    await tauriInvoke("cache_put_many", { namespace, records: batch });
  }
}

async function cacheDelete(namespace: CacheNamespace, key: string): Promise<void> {
  await ensureCacheMigration();
  await tauriInvoke("cache_delete", { namespace, key });
}

export async function readCachedAppData<T>(key: string): Promise<T | undefined> {
  const record = await cacheGet<{ value?: T }>("appData", key);
  return record?.value;
}

export async function writeCachedAppData<T>(key: string, value: T): Promise<void> {
  await cachePut("appData", key, { key, value, savedAt: Date.now() });
}

export async function readCachedMessages(channelId: string): Promise<DiscordMessage[] | undefined> {
  const [record, deletedMessages] = await Promise.all([
    cacheGet<{ messages?: DiscordMessage[] }>("messages", channelId),
    cacheGetDeletedMessagesForChannel(channelId),
  ]);
  const cached = record?.messages;
  const channelDeleted = deletedMessages.filter(entry => entry.channelId === channelId);
  const byId = new Map((cached || []).map(message => [message.id, message]));
  channelDeleted.forEach(entry => {
    const existing = byId.get(entry.id);
    byId.set(entry.id, { ...entry.message, ...existing, deleted_at: existing?.deleted_at || entry.deletedAt });
  });
  const messages = [...byId.values()].sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
  return cached || channelDeleted.length
    ? messages.slice(-MAX_CACHED_MESSAGES_PER_CHANNEL)
    : undefined;
}

export async function writeCachedMessages(channelId: string, messages: DiscordMessage[]): Promise<void> {
  await ensureCacheMigration();
  await tauriInvoke("cache_merge_messages", { channelId, messages });
}

export async function markCachedMessageDeleted(
  channelId: string,
  messageId: string,
  deletedAt: number,
  message?: DiscordMessage,
): Promise<void> {
  await ensureCacheMigration();
  await tauriInvoke("cache_mark_message_deleted", { channelId, messageId, deletedAt, message: message || null });
}

export interface DeletedChannelLog {
  id: string;
  deletedAt: number;
  guildId?: string;
  guildName?: string;
  channel: DiscordChannel;
}

export async function readDeletedChannels(): Promise<DeletedChannelLog[]> {
  return (await cacheGetAll<DeletedChannelLog>("deletedChannels"))
    .sort((left, right) => right.deletedAt - left.deletedAt);
}

export async function writeDeletedChannel(entry: DeletedChannelLog): Promise<void> {
  await cachePut("deletedChannels", entry.id, entry);
}

export interface DeletedMessageLog {
  id: string;
  channelId: string;
  channelName: string;
  deletedAt: number;
  message: DiscordMessage;
}

export interface EditedMessageLog {
  id: string;
  messageId: string;
  channelId: string;
  channelName: string;
  editedAt: number;
  message: DiscordMessage;
}

export async function readEditedMessages(): Promise<EditedMessageLog[]> {
  return (await cacheGetAll<EditedMessageLog>("editedMessages"))
    .sort((left, right) => right.editedAt - left.editedAt);
}

export async function writeEditedMessage(entry: EditedMessageLog): Promise<void> {
  await cachePut("editedMessages", entry.id, entry);
}

export async function deleteEditedMessage(id: string): Promise<void> {
  await ensureCacheMigration();
  await tauriInvoke("cache_delete_log", { namespace: "editedMessages", id });
}

export async function readDeletedMessages(): Promise<DeletedMessageLog[]> {
  return (await cacheGetAll<DeletedMessageLog>("deletedMessages"))
    .sort((left, right) => right.deletedAt - left.deletedAt);
}

export async function writeDeletedMessage(entry: DeletedMessageLog): Promise<void> {
  await cachePut("deletedMessages", entry.id, entry);
}

export async function deleteDeletedMessage(id: string): Promise<void> {
  await ensureCacheMigration();
  await tauriInvoke("cache_delete_log", { namespace: "deletedMessages", id });
}

export async function readArchivedMedia(id: string): Promise<string | undefined> {
  const record = await cacheGet<{ dataUrl?: string }>("archivedMedia", id);
  return record?.dataUrl;
}

export async function writeArchivedMedia(id: string, dataUrl: string): Promise<void> {
  await cachePut("archivedMedia", id, { id, dataUrl, savedAt: Date.now() });
  window.dispatchEvent(new CustomEvent("voidcord-media-archived", { detail: { id, dataUrl } }));
}

export async function readCachedDraft(channelId: string): Promise<string> {
  const record = await cacheGet<{ content?: string }>("drafts", channelId);
  return record?.content || "";
}

export async function writeCachedDraft(channelId: string, content: string): Promise<void> {
  if (content) {
    await cachePut("drafts", channelId, { channelId, content, savedAt: Date.now() });
  } else {
    await cacheDelete("drafts", channelId);
  }
}

export interface VoidCordCacheBundle {
  version: number;
  format: "voidcord-cache";
  exportedAt: string;
  client: "VoidCord";
  messages: Array<{ channelId: string; messages: DiscordMessage[] }>;
  appData: Array<{ key: string; value: any }>;
  deletedMessages?: DeletedMessageLog[];
  editedMessages?: EditedMessageLog[];
  deletedChannels?: DeletedChannelLog[];
}

export async function exportCacheToVcc(): Promise<string> {
  const [messages, appData, deletedMessages, editedMessages, deletedChannels] = await Promise.all([
    cacheGetAll<{ channelId: string; messages: DiscordMessage[] }>("messages"),
    cacheGetAll<{ key: string; value: any }>("appData"),
    cacheGetAll<DeletedMessageLog>("deletedMessages"),
    cacheGetAll<EditedMessageLog>("editedMessages"),
    cacheGetAll<DeletedChannelLog>("deletedChannels"),
  ]);
  const bundle: VoidCordCacheBundle = {
    version: 1,
    format: "voidcord-cache",
    exportedAt: new Date().toISOString(),
    client: "VoidCord",
    messages,
    appData,
    deletedMessages,
    editedMessages,
    deletedChannels,
  };
  return JSON.stringify(bundle, null, 2);
}

export function downloadVccFile(jsonContent: string, filename?: string): void {
  const blob = new Blob([jsonContent], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || `voidcord-cache-${new Date().toISOString().slice(0, 10)}.vcc`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function importCacheFromVcc(vccContent: string): Promise<{ messagesCount: number; channelsCount: number }> {
  let bundle: VoidCordCacheBundle;
  try {
    bundle = JSON.parse(vccContent);
  } catch {
    throw new Error("Invalid .vcc file: file is not valid JSON.");
  }

  if (bundle.format !== "voidcord-cache" || !Array.isArray(bundle.messages)) {
    throw new Error("Invalid .vcc file: not a recognized VoidCord Cache format.");
  }

  const messages: CacheRecord[] = [];
  let totalMessages = 0;
  for (const item of bundle.messages) {
    if (item && item.channelId && Array.isArray(item.messages)) {
      messages.push({ key: item.channelId, value: item });
      totalMessages += item.messages.length;
    }
  }
  const appData = (Array.isArray(bundle.appData) ? bundle.appData : [])
    .filter(item => item && item.key)
    .map(item => ({ key: item.key, value: item }));
  const deletedMessages = (Array.isArray(bundle.deletedMessages) ? bundle.deletedMessages : [])
    .filter(item => item && item.id)
    .map(item => ({ key: item.id, value: item }));
  const editedMessages = (Array.isArray(bundle.editedMessages) ? bundle.editedMessages : [])
    .filter(item => item && item.id)
    .map(item => ({ key: item.id, value: item }));
  const deletedChannels = (Array.isArray(bundle.deletedChannels) ? bundle.deletedChannels : [])
    .filter(item => item && item.id)
    .map(item => ({ key: item.id, value: item }));

  await Promise.all([
    cachePutMany("messages", messages),
    cachePutMany("appData", appData),
    cachePutMany("deletedMessages", deletedMessages),
    cachePutMany("editedMessages", editedMessages),
    cachePutMany("deletedChannels", deletedChannels),
  ]);
  return { messagesCount: totalMessages, channelsCount: bundle.messages.length };
}

export async function getCacheStats(): Promise<{ channelsCount: number; messagesCount: number; deletedMessagesCount: number; editedMessagesCount: number }> {
  const [channels, deletedMessages, editedMessages] = await Promise.all([
    cacheGetAll<{ messages?: DiscordMessage[] }>("messages"),
    cacheGetAll("deletedMessages"),
    cacheGetAll("editedMessages"),
  ]);
  const messagesCount = channels.reduce((sum, channel) => sum + (Array.isArray(channel.messages) ? channel.messages.length : 0), 0);
  return {
    channelsCount: channels.length,
    messagesCount,
    deletedMessagesCount: deletedMessages.length,
    editedMessagesCount: editedMessages.length,
  };
}

export async function readCachedCommands(): Promise<any[] | undefined> {
  const cached = await readCachedAppData<any[]>("cached-commands").catch(() => undefined);
  if (cached && Array.isArray(cached)) return cached;
  try {
    const raw = localStorage.getItem("voidcord:cached-commands");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return undefined;
}

export async function writeCachedCommands(commands: any[]): Promise<void> {
  await writeCachedAppData("cached-commands", commands).catch(() => {});
  try {
    localStorage.setItem("voidcord:cached-commands", JSON.stringify(commands.slice(0, 500)));
  } catch {}
}
