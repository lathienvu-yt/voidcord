import { DiscordChannel, DiscordMessage } from "./types";

const DB_NAME = "voidcord-local-cache";
const DB_VERSION = 6;

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open VoidCord's local cache"));
  });
}

export async function readCachedAppData<T>(key: string): Promise<T | undefined> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const request = db.transaction("appData", "readonly").objectStore("appData").get(key);
    request.onsuccess = () => { db.close(); resolve(request.result?.value as T | undefined); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function writeCachedAppData<T>(key: string, value: T): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("appData", "readwrite");
    tx.objectStore("appData").put({ key, value, savedAt: Date.now() });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function readCachedMessages(channelId: string): Promise<DiscordMessage[] | undefined> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["messages", "deletedMessages"], "readonly");
    const request = tx.objectStore("messages").get(channelId);
    const deletedRequest = tx.objectStore("deletedMessages").index("channelId").getAll(channelId);
    let cached: DiscordMessage[] | undefined;
    let deleted: DeletedMessageLog[] = [];
    let cacheLoaded = false;
    let deletedLoaded = false;
    const resolveWhenLoaded = () => {
      if (!cacheLoaded || !deletedLoaded) return;
      db.close();
      const byId = new Map((cached || []).map(message => [message.id, message]));
      const channelDeleted = deleted.filter(entry => entry.channelId === channelId);
      channelDeleted.forEach(entry => {
        const existing = byId.get(entry.id);
        byId.set(entry.id, { ...entry.message, ...existing, deleted_at: existing?.deleted_at || entry.deletedAt });
      });
      resolve(cached || channelDeleted.length ? [...byId.values()].sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      ) : undefined);
    };
    request.onsuccess = () => {
      cached = request.result?.messages as DiscordMessage[] | undefined;
      cacheLoaded = true;
      resolveWhenLoaded();
    };
    deletedRequest.onsuccess = () => {
      deleted = deletedRequest.result as DeletedMessageLog[];
      deletedLoaded = true;
      resolveWhenLoaded();
    };
    request.onerror = () => { db.close(); reject(request.error); };
    deletedRequest.onerror = () => { db.close(); reject(deletedRequest.error); };
  });
}

export async function writeCachedMessages(channelId: string, messages: DiscordMessage[]): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["messages", "deletedIds"], "readwrite");
    const store = tx.objectStore("messages");
    const deletedIds = tx.objectStore("deletedIds");
    const request = store.get(channelId);
    const deletedRequest = deletedIds.index("channelId").getAll(channelId);
    let existing: { messages?: DiscordMessage[] } | undefined;
    let tombstones: { messageId: string; deletedAt: number }[] = [];
    let existingLoaded = false;
    let tombstonesLoaded = false;
    let wrote = false;
    const writeMerged = () => {
      if (wrote || !existingLoaded || !tombstonesLoaded) return;
      wrote = true;
      const deleted = new Map(tombstones.map(item => [item.messageId, item.deletedAt]));
      const previous = (existing?.messages || []) as DiscordMessage[];
      const byId = new Map(previous.map(message => [message.id, message]));
      messages.forEach(message => {
        const oldMessage = byId.get(message.id);
        const deletedAt = oldMessage?.deleted_at || deleted.get(message.id);
        byId.set(message.id, deletedAt ? { ...message, deleted_at: deletedAt } : message);
      });
      for (const [messageId, deletedAt] of deleted) {
        const message = byId.get(messageId);
        if (message && !message.deleted_at) byId.set(messageId, { ...message, deleted_at: deletedAt });
      }
      const merged = [...byId.values()].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      store.put({ channelId, messages: merged, savedAt: Date.now() });
    };
    request.onsuccess = () => {
      existing = request.result;
      existingLoaded = true;
      writeMerged();
    };
    deletedRequest.onsuccess = () => {
      tombstones = deletedRequest.result;
      tombstonesLoaded = true;
      writeMerged();
    };
    request.onerror = () => { db.close(); reject(request.error); };
    deletedRequest.onerror = () => { db.close(); reject(deletedRequest.error); };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function markCachedMessageDeleted(
  channelId: string,
  messageId: string,
  deletedAt: number,
  message?: DiscordMessage,
): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["messages", "deletedIds"], "readwrite");
    const store = tx.objectStore("messages");
    tx.objectStore("deletedIds").put({ id: `${channelId}:${messageId}`, channelId, messageId, deletedAt });
    const request = store.get(channelId);
    request.onsuccess = () => {
      const cached = request.result?.messages as DiscordMessage[] | undefined;
      if (!cached && !message) return;
      const messages = cached || [];
      if (message && !messages.some(item => item.id === messageId)) {
        messages.push(message);
      }
      store.put({
        channelId,
        messages: messages.map(item => item.id === messageId ? { ...item, deleted_at: deletedAt } : item),
        savedAt: Date.now(),
      });
    };
    request.onerror = () => { db.close(); reject(request.error); };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export interface DeletedChannelLog {
  id: string;
  deletedAt: number;
  guildId?: string;
  guildName?: string;
  channel: DiscordChannel;
}

export async function readDeletedChannels(): Promise<DeletedChannelLog[]> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const request = db.transaction("deletedChannels", "readonly").objectStore("deletedChannels").getAll();
    request.onsuccess = () => {
      db.close();
      resolve((request.result as DeletedChannelLog[]).sort((a, b) => b.deletedAt - a.deletedAt));
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function writeDeletedChannel(entry: DeletedChannelLog): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("deletedChannels", "readwrite");
    tx.objectStore("deletedChannels").put(entry);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export interface DeletedMessageLog {
  id: string;
  channelId: string;
  channelName: string;
  deletedAt: number;
  message: DiscordMessage;
}

export async function readDeletedMessages(): Promise<DeletedMessageLog[]> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const request = db.transaction("deletedMessages", "readonly").objectStore("deletedMessages").getAll();
    request.onsuccess = () => {
      db.close();
      resolve((request.result as DeletedMessageLog[]).sort((a, b) => b.deletedAt - a.deletedAt));
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function writeDeletedMessage(entry: DeletedMessageLog): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("deletedMessages", "readwrite");
    tx.objectStore("deletedMessages").put(entry);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function deleteDeletedMessage(id: string): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["deletedMessages", "archivedMedia"], "readwrite");
    tx.objectStore("deletedMessages").delete(id);
    const mediaStore = tx.objectStore("archivedMedia");
    const request = mediaStore.getAll();
    request.onsuccess = () => {
      (request.result as { id: string }[])
        .filter(media => media.id.startsWith(`${id}:`))
        .forEach(media => mediaStore.delete(media.id));
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function readArchivedMedia(id: string): Promise<string | undefined> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const request = db.transaction("archivedMedia", "readonly").objectStore("archivedMedia").get(id);
    request.onsuccess = () => { db.close(); resolve(request.result?.dataUrl as string | undefined); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function writeArchivedMedia(id: string, dataUrl: string): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("archivedMedia", "readwrite");
    tx.objectStore("archivedMedia").put({ id, dataUrl, savedAt: Date.now() });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function readCachedDraft(channelId: string): Promise<string> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const request = db.transaction("drafts", "readonly").objectStore("drafts").get(channelId);
    request.onsuccess = () => { db.close(); resolve((request.result?.content as string | undefined) || ""); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function writeCachedDraft(channelId: string, content: string): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", "readwrite");
    if (content) tx.objectStore("drafts").put({ channelId, content, savedAt: Date.now() });
    else tx.objectStore("drafts").delete(channelId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
