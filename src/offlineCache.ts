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

export interface VccExportFilters {
  from?: string | null;
  to?: string | null;
  serverIds?: string[];
  channelIds?: string[];
}

export interface VccExportCatalog {
  servers: Array<{ id: string; name: string }>;
  channels: Array<{ id: string; name: string; serverId?: string; serverName?: string }>;
  messagesCount: number;
}

export interface VoidCordCacheBundle {
  version: number;
  format: "voidcord-cache";
  exportedAt: string;
  client: "VoidCord";
  exportScope?: {
    partial: boolean;
    from: string | null;
    to: string | null;
    serverIds: string[];
    channelIds: string[];
    sourceChannelsCount: number;
    exportedChannelsCount: number;
    sourceMessagesCount: number;
    exportedMessagesCount: number;
  };
  messages: Array<{ channelId: string; messages: DiscordMessage[] }>;
  appData: Array<{ key: string; value: any }>;
  deletedMessages?: DeletedMessageLog[];
  editedMessages?: EditedMessageLog[];
  deletedChannels?: DeletedChannelLog[];
}

function messageTime(message: DiscordMessage): number {
  const parsed = Date.parse(message.timestamp || "");
  if (Number.isFinite(parsed)) return parsed;
  try { return Number((BigInt(message.id) >> 22n) + 1420070400000n); } catch { return 0; }
}

function parseFilterTime(value?: string | null, label = "date"): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`Invalid export ${label} date.`);
  return parsed;
}

function withinRange(timestamp: number, from: number | null, to: number | null): boolean {
  return (from === null || timestamp >= from) && (to === null || timestamp <= to);
}

async function readExportSource() {
  const [messages, appData, deletedMessages, editedMessages, deletedChannels] = await Promise.all([
    cacheGetAll<{ channelId: string; messages: DiscordMessage[] }>("messages"),
    cacheGetAll<{ key: string; value: any }>("appData"),
    cacheGetAll<DeletedMessageLog>("deletedMessages"),
    cacheGetAll<EditedMessageLog>("editedMessages"),
    cacheGetAll<DeletedChannelLog>("deletedChannels"),
  ]);
  return { messages, appData, deletedMessages, editedMessages, deletedChannels };
}

function channelIndex(appData: Array<{ key: string; value: any }>) {
  const byId = new Map<string, { serverId?: string; serverName?: string; name: string }>();
  const serverNames = new Map<string, string>();
  for (const entry of appData) {
    if (entry.key === "guilds" && Array.isArray(entry.value)) {
      for (const guild of entry.value) if (guild?.id) serverNames.set(String(guild.id), String(guild.name || guild.id));
    }
  }
  for (const entry of appData) {
    if (!entry.key.startsWith("guild-data:")) continue;
    const serverId = entry.key.slice("guild-data:".length);
    for (const channel of Array.isArray(entry.value?.channels) ? entry.value.channels : []) {
      if (channel?.id) {
        const channelServerId = String(channel.guild_id || serverId);
        byId.set(String(channel.id), {
          serverId: channelServerId,
          serverName: serverNames.get(channelServerId),
          name: String(channel.name || "Unknown channel"),
        });
      }
    }
  }
  return { byId, serverNames };
}

export async function getVccExportCatalog(): Promise<VccExportCatalog> {
  const { messages, appData } = await readExportSource();
  const { byId, serverNames } = channelIndex(appData);
  const serverIds = new Set<string>();
  const channelIds = new Set<string>();
  for (const item of messages) {
    if (!item?.channelId) continue;
    channelIds.add(item.channelId);
    const meta = byId.get(item.channelId);
    if (meta?.serverId) serverIds.add(meta.serverId);
  }
  const servers = [...serverIds].map(id => ({ id, name: serverNames.get(id) || id })).sort((a, b) => a.name.localeCompare(b.name));
  const channels = [...channelIds].map(id => {
    const meta = byId.get(id);
    return { id, name: meta?.name || id, serverId: meta?.serverId, serverName: meta?.serverName };
  }).sort((a, b) => (a.serverName || "").localeCompare(b.serverName || "") || a.name.localeCompare(b.name));
  return { servers, channels, messagesCount: messages.reduce((sum, item) => sum + (item.messages?.length || 0), 0) };
}

export async function previewVccExport(filters: VccExportFilters = {}): Promise<{ channelsCount: number; messagesCount: number }> {
  const { messages, appData } = await readExportSource();
  const { byId } = channelIndex(appData);
  const from = parseFilterTime(filters.from, "From");
  const to = parseFilterTime(filters.to, "To");
  if (from !== null && to !== null && from > to) throw new Error("From must be earlier than or equal to To.");
  const servers = new Set(filters.serverIds || []);
  const channels = new Set(filters.channelIds || []);
  const selected = messages.filter(item => {
    const meta = byId.get(item.channelId);
    if (servers.size && (!meta?.serverId || !servers.has(meta.serverId))) return false;
    if (channels.size && !channels.has(item.channelId)) return false;
    return (item.messages || []).some(message => withinRange(messageTime(message), from, to));
  }).map(item => ({ ...item, messages: item.messages.filter(message => withinRange(messageTime(message), from, to)) }));
  return { channelsCount: selected.length, messagesCount: selected.reduce((sum, item) => sum + item.messages.length, 0) };
}

export async function exportCacheToVcc(filters: VccExportFilters = {}): Promise<string> {
  const { messages: sourceMessages, appData: sourceAppData, deletedMessages: sourceDeleted, editedMessages: sourceEdited, deletedChannels: sourceDeletedChannels } = await readExportSource();
  const { byId } = channelIndex(sourceAppData);
  const from = parseFilterTime(filters.from, "From");
  const to = parseFilterTime(filters.to, "To");
  if (from !== null && to !== null && from > to) throw new Error("From must be earlier than or equal to To.");
  const servers = new Set(filters.serverIds || []);
  const channels = new Set(filters.channelIds || []);
  const selectedChannel = (channelId: string) => {
    const meta = byId.get(channelId);
    if (servers.size && (!meta?.serverId || !servers.has(meta.serverId))) return false;
    if (channels.size && !channels.has(channelId)) return false;
    return true;
  };
  const messages = sourceMessages.filter(item => selectedChannel(item.channelId))
    .map(item => ({ ...item, messages: (item.messages || []).filter(message => withinRange(messageTime(message), from, to)) }))
    .filter(item => item.messages.length > 0);
  const inRangeLog = (timestamp: number) => withinRange(timestamp, from, to);
  const deletedMessages = sourceDeleted.filter(item => selectedChannel(item.channelId) && inRangeLog(item.deletedAt));
  const editedMessages = sourceEdited.filter(item => selectedChannel(item.channelId) && inRangeLog(item.editedAt));
  const deletedChannels = sourceDeletedChannels.filter(item =>
    (!servers.size || (!!item.guildId && servers.has(item.guildId)))
    && (!channels.size || channels.has(item.id))
    && inRangeLog(item.deletedAt)
  );
  const appData = sourceAppData.flatMap(entry => {
    if (entry.key === "guilds" && Array.isArray(entry.value)) {
      const value = servers.size ? entry.value.filter((guild: any) => servers.has(String(guild?.id))) : entry.value;
      return [{ ...entry, value }];
    }
    if (entry.key.startsWith("guild-data:")) {
      const serverId = entry.key.slice("guild-data:".length);
      if (servers.size && !servers.has(serverId)) return [];
      const value = entry.value && typeof entry.value === "object" ? {
        ...entry.value,
        channels: (entry.value.channels || []).filter((channel: DiscordChannel) =>
          (!channels.size || channels.has(channel.id)) && (!servers.size || servers.has(String(channel.guild_id || serverId)))
        ),
      } : entry.value;
      return [{ ...entry, value }];
    }
    return [{ ...entry }];
  });
  const bundle: VoidCordCacheBundle = {
    version: 2,
    format: "voidcord-cache",
    exportedAt: new Date().toISOString(),
    client: "VoidCord",
    exportScope: {
      partial: !!(filters.from || filters.to || servers.size || channels.size),
      from: filters.from || null,
      to: filters.to || null,
      serverIds: [...servers],
      channelIds: [...channels],
      sourceChannelsCount: sourceMessages.length,
      exportedChannelsCount: messages.length,
      sourceMessagesCount: sourceMessages.reduce((sum, item) => sum + (item.messages?.length || 0), 0),
      exportedMessagesCount: messages.reduce((sum, item) => sum + item.messages.length, 0),
    },
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

export function parseVccBundle(vccContent: string): VoidCordCacheBundle {
  let parsed: any;
  try { parsed = JSON.parse(vccContent); }
  catch { throw new Error("Invalid .vcc file: file is not valid JSON."); }
  if (!parsed || parsed.format !== "voidcord-cache" || ![1, 2].includes(parsed.version) || !Array.isArray(parsed.messages)) {
    throw new Error("Invalid .vcc file: unsupported or unrecognized VoidCord Cache format.");
  }
  const messages = parsed.messages.filter((item: any) =>
    item && typeof item.channelId === "string" && Array.isArray(item.messages)
  ).map((item: any) => ({
    channelId: item.channelId,
    messages: item.messages.filter((message: any) => message && typeof message.id === "string" && typeof message.timestamp === "string"),
  }));
  return {
    ...parsed,
    messages,
    appData: Array.isArray(parsed.appData) ? parsed.appData.filter((item: any) => item && typeof item.key === "string") : [],
    deletedMessages: Array.isArray(parsed.deletedMessages) ? parsed.deletedMessages.filter((item: any) => item && item.id && item.message) : [],
    editedMessages: Array.isArray(parsed.editedMessages) ? parsed.editedMessages.filter((item: any) => item && item.id && item.message) : [],
    deletedChannels: Array.isArray(parsed.deletedChannels) ? parsed.deletedChannels.filter((item: any) => item && item.id && item.channel) : [],
  } as VoidCordCacheBundle;
}

export interface ReplayCoreEvent {
  id: string;
  channelId: string;
  timestamp: number;
  kind: "message" | "deleted" | "edited";
  message: DiscordMessage;
  channelName?: string;
}

export function buildReplayTimeline(bundle: VoidCordCacheBundle): ReplayCoreEvent[] {
  const events: ReplayCoreEvent[] = [];
  const channelNames = new Map<string, string>();
  for (const entry of bundle.appData || []) {
    if (!entry.key.startsWith("guild-data:")) continue;
    for (const channel of entry.value?.channels || []) {
      if (channel?.id) channelNames.set(channel.id, String(channel.name || channel.id));
    }
  }
  const includedMessages = new Set<string>();
  for (const group of bundle.messages || []) {
    for (const message of group.messages || []) {
      includedMessages.add(`${group.channelId}:${message.id}`);
      events.push({
        id: message.id,
        channelId: group.channelId,
        timestamp: messageTime(message),
        kind: message.deleted_at ? "deleted" : "message",
        message,
        channelName: channelNames.get(group.channelId),
      });
    }
  }
  for (const entry of bundle.deletedMessages || []) {
    const key = `${entry.channelId}:${entry.message.id}`;
    if (!includedMessages.has(key)) {
      events.push({ id: `deleted:${entry.id}`, channelId: entry.channelId, timestamp: entry.deletedAt, kind: "deleted", message: entry.message, channelName: entry.channelName });
    }
  }
  for (const entry of bundle.editedMessages || []) {
    events.push({ id: `edited:${entry.id}`, channelId: entry.channelId, timestamp: entry.editedAt, kind: "edited", message: entry.message, channelName: entry.channelName });
  }
  return events.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

export async function importCacheFromVcc(vccContent: string): Promise<{ messagesCount: number; channelsCount: number; bundle: VoidCordCacheBundle }> {
  const bundle = parseVccBundle(vccContent);
  const messages: CacheRecord[] = bundle.messages.map(item => ({ key: item.channelId, value: item }));
  const appData = bundle.appData.map(item => ({ key: item.key, value: item }));
  const deletedMessages = (bundle.deletedMessages || []).map(item => ({ key: item.id, value: item }));
  const editedMessages = (bundle.editedMessages || []).map(item => ({ key: item.id, value: item }));
  const deletedChannels = (bundle.deletedChannels || []).map(item => ({ key: item.id, value: item }));
  await Promise.all([
    cachePutMany("messages", messages),
    cachePutMany("appData", appData),
    cachePutMany("deletedMessages", deletedMessages),
    cachePutMany("editedMessages", editedMessages),
    cachePutMany("deletedChannels", deletedChannels),
  ]);
  return {
    messagesCount: bundle.messages.reduce((sum, item) => sum + item.messages.length, 0),
    channelsCount: bundle.messages.length,
    bundle,
  };
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
