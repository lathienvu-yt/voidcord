import { DiscordChannel, DiscordMessage } from "./types";

export const MAX_CACHED_MESSAGES_PER_CHANNEL = 500;

const DB_NAME = "voidcord-local-cache";
const DB_VERSION = 7;

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
      if (!db.objectStoreNames.contains("editedMessages")) {
        const editedMessages = db.createObjectStore("editedMessages", { keyPath: "id" });
        editedMessages.createIndex("channelId", "channelId");
      }
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
      const messages = [...byId.values()].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      resolve(
        cached || channelDeleted.length
          ? messages.slice(-MAX_CACHED_MESSAGES_PER_CHANNEL)
          : undefined
      );
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
      store.put({
        channelId,
        messages: merged.slice(-MAX_CACHED_MESSAGES_PER_CHANNEL),
        savedAt: Date.now(),
      });
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

export interface EditedMessageLog {
  id: string;
  messageId: string;
  channelId: string;
  channelName: string;
  editedAt: number;
  message: DiscordMessage;
}

export async function readEditedMessages(): Promise<EditedMessageLog[]> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const request = db.transaction("editedMessages", "readonly").objectStore("editedMessages").getAll();
    request.onsuccess = () => {
      db.close();
      resolve((request.result as EditedMessageLog[]).sort((a, b) => b.editedAt - a.editedAt));
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function writeEditedMessage(entry: EditedMessageLog): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("editedMessages", "readwrite");
    tx.objectStore("editedMessages").put(entry);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function deleteEditedMessage(id: string): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["editedMessages", "archivedMedia"], "readwrite");
    tx.objectStore("editedMessages").delete(id);
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
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["messages", "appData", "deletedMessages", "editedMessages", "deletedChannels"], "readonly");
    const messagesReq = tx.objectStore("messages").getAll();
    const appDataReq = tx.objectStore("appData").getAll();
    const delMsgReq = tx.objectStore("deletedMessages").getAll();
    const editMsgReq = tx.objectStore("editedMessages").getAll();
    const delChanReq = tx.objectStore("deletedChannels").getAll();

    tx.oncomplete = () => {
      db.close();
      const bundle: VoidCordCacheBundle = {
        version: 1,
        format: "voidcord-cache",
        exportedAt: new Date().toISOString(),
        client: "VoidCord",
        messages: (messagesReq.result as any[]) || [],
        appData: (appDataReq.result as any[]) || [],
        deletedMessages: (delMsgReq.result as DeletedMessageLog[]) || [],
        editedMessages: (editMsgReq.result as EditedMessageLog[]) || [],
        deletedChannels: (delChanReq.result as DeletedChannelLog[]) || [],
      };
      resolve(JSON.stringify(bundle, null, 2));
    };

    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export function downloadVccFile(jsonContent: string, filename?: string): void {
  const blob = new Blob([jsonContent], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `voidcord-cache-${new Date().toISOString().slice(0, 10)}.vcc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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

  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["messages", "appData", "deletedMessages", "editedMessages", "deletedChannels"], "readwrite");
    const msgStore = tx.objectStore("messages");
    const appStore = tx.objectStore("appData");
    const delMsgStore = tx.objectStore("deletedMessages");
    const editMsgStore = tx.objectStore("editedMessages");
    const delChanStore = tx.objectStore("deletedChannels");

    let totalMessages = 0;
    for (const item of bundle.messages) {
      if (item && item.channelId && Array.isArray(item.messages)) {
        msgStore.put(item);
        totalMessages += item.messages.length;
      }
    }

    if (Array.isArray(bundle.appData)) {
      for (const item of bundle.appData) {
        if (item && item.key) appStore.put(item);
      }
    }

    if (Array.isArray(bundle.deletedMessages)) {
      for (const item of bundle.deletedMessages) {
        if (item && item.id) delMsgStore.put(item);
      }
    }

    if (Array.isArray(bundle.editedMessages)) {
      for (const item of bundle.editedMessages) {
        if (item && item.id) editMsgStore.put(item);
      }
    }

    if (Array.isArray(bundle.deletedChannels)) {
      for (const item of bundle.deletedChannels) {
        if (item && item.id) delChanStore.put(item);
      }
    }

    tx.oncomplete = () => {
      db.close();
      resolve({ messagesCount: totalMessages, channelsCount: bundle.messages.length });
    };

    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function getCacheStats(): Promise<{ channelsCount: number; messagesCount: number; deletedMessagesCount: number; editedMessagesCount: number }> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["messages", "deletedMessages", "editedMessages"], "readonly");
    const msgReq = tx.objectStore("messages").getAll();
    const delReq = tx.objectStore("deletedMessages").count();
    const editReq = tx.objectStore("editedMessages").count();

    tx.oncomplete = () => {
      db.close();
      const channels = (msgReq.result as any[]) || [];
      const totalMessages = channels.reduce((sum, ch) => sum + (Array.isArray(ch.messages) ? ch.messages.length : 0), 0);
      resolve({
        channelsCount: channels.length,
        messagesCount: totalMessages,
        deletedMessagesCount: delReq.result || 0,
        editedMessagesCount: editReq.result || 0,
      });
    };

    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
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
