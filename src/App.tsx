import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { load } from "@tauri-apps/plugin-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Archive, Ban, BellOff, Check, ChevronDown, ChevronRight, Compass, Copy, Download, Edit3, ExternalLink, Flame, Flag, Gamepad2, Gift, Hash, History,
  Headphones, Loader2, LockKeyhole, MessageSquare, Mic, MoreHorizontal, Pause, Phone, Pin, Play, Search, Send, Settings, ShoppingBag,
  Maximize2, RotateCcw, ShieldCheck, SmilePlus, Sparkles, Sticker, Terminal, Trash2, Trophy, UserPlus, UserX, Users, Volume2, VolumeX, WifiOff, Wrench, X,
  ZoomIn, ZoomOut
} from "lucide-react";

import {
  avatarDecorationUrl, avatarUrl, bannerUrl, displayName, formatTimestamp, guildIconUrl, primaryGuildBadgeUrl,
  DiscordChannel, DiscordGuild, DiscordMessage, DiscordReaction, DiscordRelationship, DiscordUser,
  CHANNEL_TYPE_CATEGORY, CHANNEL_TYPE_DM, CHANNEL_TYPE_GROUP_DM, CHANNEL_TYPE_TEXT, CHANNEL_TYPE_VOICE,
  CHANNEL_TYPE_ANNOUNCEMENT, CHANNEL_TYPE_STAGE,
} from "./types";
import { DiscordMarkdown } from "./DiscordMarkdown";
import { DiscordEmbedView } from "./DiscordEmbedView";
import { DiscordComponents } from "./DiscordComponents";
import SettingsMenu from "./SettingsMenu";
import {
  deleteDeletedMessage, deleteEditedMessage, markCachedMessageDeleted, readArchivedMedia, readCachedAppData, readCachedDraft,
  readCachedMessages, readDeletedChannels, readDeletedMessages, readEditedMessages, writeArchivedMedia, writeCachedAppData,
  writeCachedDraft, writeCachedMessages, writeDeletedChannel, writeDeletedMessage, DeletedChannelLog,
  DeletedMessageLog, EditedMessageLog, writeEditedMessage,
} from "./offlineCache";
import "./style.css";

// ── helpers ────────────────────────────────────────────────────────────────

function isTextChannel(c: DiscordChannel) {
  return c.type === CHANNEL_TYPE_TEXT || c.type === CHANNEL_TYPE_ANNOUNCEMENT;
}

const EMOJI_PICKER_ITEMS = [
  { category: "Smileys", items: ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😍","🥰","😘","😋","😎","🤔","🙄","😴","😭","😡","🤯","🥳","😬","🤗","🫡","💀","🤡","👀","🙏","👏","🙌","👍","👎","❤️","🧡","💛","💚","💙","💜","🖤","🤍","💯","✨","🔥","🎉","✅","❌"] },
  { category: "Nature", items: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐸","🐵","🐧","🐦","🦄","🐝","🦋","🌸","🌹","🌻","🌈","☀️","🌙","⭐","⚡"] },
  { category: "Food", items: ["🍎","🍊","🍋","🍉","🍇","🍓","🫐","🍒","🍑","🥭","🍍","🥝","🍕","🍔","🍟","🌭","🍿","🍩","🍪","🎂","☕","🧋"] },
  { category: "Activities", items: ["⚽","🏀","🏈","⚾","🎮","🕹️","🎯","🎨","🎤","🎧","🎬","🏆","🎁","🎈","🎵","🎶"] },
  { category: "Travel", items: ["🚗","🚕","🚌","🚎","🏎️","🚲","✈️","🚀","🚂","🚢","🏠","🏖️","🌍","🗽"] },
];
const EMOJI_SEARCH_TERMS: Record<string, string> = {
  "😀": "grinning smile happy", "😃": "smile happy", "😄": "smile happy", "😁": "grin happy", "😆": "laugh", "😅": "sweat laugh", "😂": "joy laugh tears", "🤣": "rofl laugh", "😊": "blush smile", "😉": "wink", "😍": "heart eyes love", "🥰": "love hearts", "😘": "kiss", "😋": "yum", "😎": "cool sunglasses", "🤔": "think", "🙄": "eyeroll", "😴": "sleep", "😭": "cry sad", "😡": "angry mad", "🥳": "party celebrate", "🤗": "hug", "🙏": "pray thanks", "👏": "clap", "👍": "thumbs up yes", "👎": "thumbs down no", "❤️": "heart love red", "💯": "100 perfect", "✨": "sparkles", "🔥": "fire hot", "🎉": "party celebrate", "✅": "check yes", "❌": "cross no", "🐶": "dog", "🐱": "cat", "🦊": "fox", "🐻": "bear", "🐼": "panda", "🐸": "frog", "🦄": "unicorn", "🌸": "flower", "🌈": "rainbow", "⭐": "star", "🍕": "pizza", "🍔": "burger", "🍟": "fries", "🍩": "donut", "☕": "coffee", "🎮": "game controller gaming", "⚽": "soccer football", "🏀": "basketball", "🎁": "gift", "🎵": "music", "🚗": "car", "✈️": "airplane plane", "🚀": "rocket",
};

type ComposerAttachment = { uploadId: string; filename: string; size: number };
type VoiceHandshake = {
  attempt: number;
  guildId: string | null;
  serverId: string;
  channelId: string;
  sessionId?: string;
  endpoint?: string;
  token?: string;
  connecting: boolean;
};
type AudioDevice = { id: string; name: string };
type AudioDeviceList = { inputs: AudioDevice[]; outputs: AudioDevice[] };
type GatewayVoiceState = {
  guild_id?: string | null;
  channel_id?: string | null;
  user_id: string;
  member?: { user?: DiscordUser; nick?: string };
  user?: DiscordUser;
  self_mute?: boolean;
  self_deaf?: boolean;
};

function readVoiceDevicePreference(key: string) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function isMessageChannel(c: DiscordChannel) {
  return isTextChannel(c) || c.type === CHANNEL_TYPE_DM || c.type === CHANNEL_TYPE_GROUP_DM;
}
function channelDisplayName(c: DiscordChannel) {
  if (!c || typeof c !== "object") return "Select a channel";
  if (c.name) return c.name;
  if (c.type === CHANNEL_TYPE_DM) {
    const recipient = c.recipients?.[0];
    return recipient ? displayName(recipient) : "Direct Message";
  }
  if (c.type === CHANNEL_TYPE_GROUP_DM) {
    return c.recipients?.map(displayName).join(", ") || "Group Message";
  }
  return "Select a channel";
}
function isVoiceChannel(c: DiscordChannel) {
  return c.type === CHANNEL_TYPE_VOICE || c.type === CHANNEL_TYPE_STAGE;
}
function isPrivateCallChannel(c: DiscordChannel) {
  return c.type === CHANNEL_TYPE_DM || c.type === CHANNEL_TYPE_GROUP_DM;
}

function snowflakeTime(id?: string | null): string | null {
  if (!id) return null;
  try { return new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toLocaleString(); }
  catch { return null; }
}

function getInitials(name: string) {
  return name
    .split(/[\s_-]+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("");
}

// Chuyển đổi mã màu decimal của role sang chuỗi Hex CSS
function roleColorToHex(colorDec?: number): string | undefined {
  if (!colorDec || colorDec === 0) return undefined;
  return `#${colorDec.toString(16).padStart(6, "0")}`;
}

function getChannelPermissions(
  channel: DiscordChannel,
  guildId: string,
  userId: string,
  memberRoleIds: string[],
  roles: any[],
  isOwner: boolean,
): {
  canView: boolean;
  canSend: boolean;
  canManageMessages: boolean;
  canManageChannels: boolean;
  canManageRoles: boolean;
} | undefined {
  if (isOwner) return { canView: true, canSend: true, canManageMessages: true, canManageChannels: true, canManageRoles: true };

  const everyoneRole = roles.find(role => role.id === guildId);
  if (!everyoneRole || typeof everyoneRole.permissions !== "string") return undefined;
  let permissions = BigInt(everyoneRole.permissions);
  for (const roleId of memberRoleIds) {
    const role = roles.find(candidate => candidate.id === roleId);
    if (typeof role?.permissions === "string") permissions |= BigInt(role.permissions);
  }

  const administrator = 1n << 3n;
  const viewChannel = 1n << 10n;
  const sendMessages = 1n << 11n;
  if ((permissions & administrator) !== 0n) {
    return { canView: true, canSend: true, canManageMessages: true, canManageChannels: true, canManageRoles: true };
  }

  const overwrites = channel.permission_overwrites || [];
  const everyoneOverwrite = overwrites.find(overwrite => overwrite.type === 0 && overwrite.id === guildId);
  if (everyoneOverwrite) {
    permissions &= ~BigInt(everyoneOverwrite.deny || "0");
    permissions |= BigInt(everyoneOverwrite.allow || "0");
  }

  let roleDeny = 0n;
  let roleAllow = 0n;
  for (const overwrite of overwrites) {
    if (overwrite.type !== 0 || !memberRoleIds.includes(overwrite.id)) continue;
    roleDeny |= BigInt(overwrite.deny || "0");
    roleAllow |= BigInt(overwrite.allow || "0");
  }
  permissions &= ~roleDeny;
  permissions |= roleAllow;

  const memberOverwrite = overwrites.find(overwrite => overwrite.type === 1 && overwrite.id === userId);
  if (memberOverwrite) {
    permissions &= ~BigInt(memberOverwrite.deny || "0");
    permissions |= BigInt(memberOverwrite.allow || "0");
  }

  return {
    canView: (permissions & viewChannel) !== 0n,
    canSend: (permissions & sendMessages) !== 0n,
    canManageMessages: (permissions & (1n << 13n)) !== 0n,
    canManageChannels: (permissions & (1n << 4n)) !== 0n,
    canManageRoles: (permissions & (1n << 28n)) !== 0n,
  };
}

function hasGuildPermission(
  permissionBit: number,
  guildId: string,
  memberRoleIds: string[],
  roles: any[],
  isOwner: boolean,
): boolean {
  if (isOwner) return true;
  const everyone = roles.find(role => role.id === guildId);
  if (typeof everyone?.permissions !== "string") return false;
  let permissions = BigInt(everyone.permissions);
  for (const roleId of memberRoleIds) {
    const role = roles.find(candidate => candidate.id === roleId);
    if (typeof role?.permissions === "string") permissions |= BigInt(role.permissions);
  }
  return (permissions & (1n << 3n)) !== 0n || (permissions & (1n << BigInt(permissionBit))) !== 0n;
}

function getUserRoleColor(authorId: string, guildMembers: unknown[], guildRoles: unknown[], roleIdsFromMessage?: string[]): string | undefined {
  const member = guildMembers.find((entry): entry is { user?: { id?: string }; id?: string; roles?: unknown } =>
    !!entry && typeof entry === "object"
      && ((entry as { user?: { id?: string } }).user?.id === authorId || (entry as { id?: string }).id === authorId)
  );
  const memberRoleIds = Array.isArray(member?.roles)
    ? member.roles.filter((roleId): roleId is string => typeof roleId === "string")
    : roleIdsFromMessage || [];
  if (memberRoleIds.length === 0) return undefined;

  const roles = guildRoles.filter((entry): entry is { id: string; color?: number; position?: number } =>
    !!entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string"
  );
  const roleIds = new Set(memberRoleIds);
  const highestColoredRole = roles
    .filter(role => roleIds.has(role.id) && typeof role.color === "number" && role.color > 0)
    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))[0];
  return highestColoredRole ? roleColorToHex(highestColoredRole.color) : undefined;
}

const SYSTEM_MESSAGE_LABELS: Record<number, string> = {
  1: "added someone to the group",
  2: "removed someone from the group",
  4: "changed the channel name",
  5: "changed the channel icon",
  6: "pinned a message",
  7: "joined the server",
  8: "boosted the server",
  9: "boosted the server to Level 1",
  10: "boosted the server to Level 2",
  11: "boosted the server to Level 3",
  12: "followed a channel",
  18: "created a thread",
  22: "sent an invite reminder",
  24: "triggered an AutoMod action",
  27: "started a stage",
  28: "ended a stage",
  29: "joined a stage as a speaker",
  30: "updated the stage topic",
};

function parseSlashCommandOptions(command: any, rawArguments: string): any[] {
  const tokens = [...rawArguments.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g)]
    .map(match => (match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["\\])/g, "$1"));
  let options = Array.isArray(command?.options) ? command.options : [];
  if (options.some((option: any) => option.type === 1 || option.type === 2)) {
    let selected = options.find((option: any) => option.name === tokens[0] && (option.type === 1 || option.type === 2));
    if (!selected) throw new Error("Choose a subcommand from the command's available options.");
    tokens.shift();
    if (selected.type === 2) {
      const subcommandName = tokens.shift();
      selected = (selected.options || []).find((option: any) => option.name === subcommandName && option.type === 1);
      if (!selected) throw new Error("Choose a subcommand from the selected group.");
    }
    options = Array.isArray(selected.options) ? selected.options : [];
  }
  const result: any[] = [];
  for (const option of options) {
    if (option.type === 1 || option.type === 2) continue;
    const token = tokens.shift();
    if (token === undefined) {
      if (option.required) throw new Error("Missing required option: " + option.name);
      continue;
    }
    let value: any = token;
    if (option.type === 4) {
      value = Number(token);
      if (!Number.isInteger(value)) throw new Error(option.name + " must be an integer.");
    } else if (option.type === 10) {
      value = Number(token);
      if (!Number.isFinite(value)) throw new Error(option.name + " must be a number.");
    } else if (option.type === 5) {
      if (!/^(true|false)$/i.test(token)) throw new Error(option.name + " must be true or false.");
      value = token.toLowerCase() === "true";
    } else if ([6, 7, 8, 9].includes(option.type)) {
      const match = token.match(/\d{15,22}/);
      if (!match) throw new Error(option.name + " needs a Discord mention or ID.");
      value = match[0];
    }
    result.push({ name: option.name, type: option.type, value });
  }
  if (tokens.length) throw new Error("Too many arguments for /" + command.name + ".");
  return result;
}

function canForwardMessage(message: DiscordMessage): boolean {
  return [0, 19, 20, 23].includes(message.type)
    && !message.poll
    && !message.call
    && !message.activity
    && !message.deleted_at;
}

// Group consecutive messages from the same author (< 7-min gap → compact)
function groupMessages(msgs: DiscordMessage[], ignoredUserIds: Set<string> = new Set()) {
  const groups: DiscordMessage[][] = [];
  for (const m of msgs) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    const gap =
      prev &&
      new Date(m.timestamp).getTime() - new Date(prev.timestamp).getTime() < 7 * 60_000;
    if (last && prev?.author.id === m.author.id && gap
      && !ignoredUserIds.has(m.author?.id || "") && !ignoredUserIds.has(prev.author?.id || "")) {
      last.push(m);
    } else {
      groups.push([m]);
    }
  }
  return groups;
}

function messageMentionsUser(message: DiscordMessage, userId: string): boolean {
  return message.mentions?.some(user => user.id === userId)
    || new RegExp(`<@!?${userId}>`).test(message.content);
}

function messageMentionsRole(message: DiscordMessage, roleIds: string[]): boolean {
  if (roleIds.length === 0) return false;
  const mentionedRoles = new Set(message.mention_roles || []);
  for (const match of message.content.matchAll(/<@&(\d+)>/g)) {
    mentionedRoles.add(match[1]);
  }
  return roleIds.some(roleId => mentionedRoles.has(roleId));
}

type ContextMenuTarget =
  | { kind: "channel"; channel: DiscordChannel }
  | { kind: "user"; user: DiscordUser; source: "member" | "profile"; guildId?: string }
  | { kind: "message"; message: DiscordMessage; channel: DiscordChannel };

type ContextMenuState = ContextMenuTarget & { x: number; y: number };
type NoticeState = { id: number; message: string; duration: number; exiting: boolean };
type MediaViewerState = { url: string; kind: "image" | "video"; name?: string };
type MediaLensState = { left: number; top: number; backgroundSize: string; backgroundPosition: string };
type CaptchaChallenge = { request_id: string; service: string; site_key: string | null; rq_data: string | null };
type CaptchaPromptState = { challenge: CaptchaChallenge; onSolve: (captchaKey: string) => void; onCancel: () => void };
type AppPreferences = {
  accent: "blurple" | "violet" | "emerald";
  compactMessages: boolean;
  reduceMotion: boolean;
  autoplayVideos: boolean;
  channelSidebarWidth: number;
  chatFontScale: number;
  serverOrder: string[];
  serverFolders: Record<string, string>;
};

const CAPTCHA_ERROR_PREFIX = "VOIDCORD_CAPTCHA:";

function parseCaptchaChallenge(error: unknown): CaptchaChallenge | null {
  const text = typeof error === "string" ? error : String(error);
  const marker = text.indexOf(CAPTCHA_ERROR_PREFIX);
  if (marker === -1) return null;
  try {
    const challenge = JSON.parse(text.slice(marker + CAPTCHA_ERROR_PREFIX.length)) as Partial<CaptchaChallenge>;
    if (typeof challenge.request_id !== "string" || typeof challenge.service !== "string") return null;
    return {
      request_id: challenge.request_id,
      service: challenge.service,
      site_key: typeof challenge.site_key === "string" ? challenge.site_key : null,
      rq_data: typeof challenge.rq_data === "string" ? challenge.rq_data : null,
    };
  } catch {
    return null;
  }
}

type HCaptchaWidget = {
  render: (container: HTMLElement, options: {
    sitekey: string;
    rqdata?: string;
    callback: (token: string) => void;
    "error-callback"?: (error: string) => void;
    "expired-callback"?: () => void;
  }) => string | number;
  remove: (widgetId: string | number) => void;
  reset: (widgetId?: string | number) => void;
};

declare global {
  interface Window {
    hcaptcha?: HCaptchaWidget;
  }
}

let hcaptchaScriptPromise: Promise<void> | null = null;

function loadHCaptchaScript(): Promise<void> {
  if (window.hcaptcha) return Promise.resolve();
  if (hcaptchaScriptPromise) return hcaptchaScriptPromise;
  hcaptchaScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-voidcord-hcaptcha="true"]');
    const script = existing || document.createElement("script");
    const cleanup = () => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      if (window.hcaptcha) resolve();
      else {
        hcaptchaScriptPromise = null;
        reject(new Error("The hCaptcha widget did not initialize"));
      }
    };
    const onError = () => {
      cleanup();
      hcaptchaScriptPromise = null;
      reject(new Error("Could not load the official hCaptcha widget"));
    };
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = "https://js.hcaptcha.com/1/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.voidcordHcaptcha = "true";
      document.head.appendChild(script);
    }
  });
  return hcaptchaScriptPromise;
}

function readPreferences(): AppPreferences {
  const defaults: AppPreferences = { accent: "blurple", compactMessages: false, reduceMotion: false, autoplayVideos: false, channelSidebarWidth: 228, chatFontScale: 100, serverOrder: [], serverFolders: {} };
  try {
    const saved = JSON.parse(localStorage.getItem("voidcord:preferences") || "{}");
    return {
      accent: ["blurple", "violet", "emerald"].includes(saved.accent) ? saved.accent : defaults.accent,
      compactMessages: typeof saved.compactMessages === "boolean" ? saved.compactMessages : defaults.compactMessages,
      reduceMotion: typeof saved.reduceMotion === "boolean" ? saved.reduceMotion : defaults.reduceMotion,
      autoplayVideos: typeof saved.autoplayVideos === "boolean" ? saved.autoplayVideos : defaults.autoplayVideos,
      channelSidebarWidth: Number.isFinite(saved.channelSidebarWidth) ? Math.max(180, Math.min(360, saved.channelSidebarWidth)) : defaults.channelSidebarWidth,
      chatFontScale: Number.isFinite(saved.chatFontScale) ? Math.max(85, Math.min(125, saved.chatFontScale)) : defaults.chatFontScale,
      serverOrder: Array.isArray(saved.serverOrder) ? saved.serverOrder.filter((id: unknown): id is string => typeof id === "string") : [],
      serverFolders: saved.serverFolders && typeof saved.serverFolders === "object" && !Array.isArray(saved.serverFolders) ? saved.serverFolders : {},
    };
  } catch {
    return defaults;
  }
}

function isImageAttachment(attachment: DiscordMessage["attachments"][number]): boolean {
  return attachment.content_type?.startsWith("image/")
    || /\.(apng|avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(attachment.filename);
}

function isVideoAttachment(attachment: DiscordMessage["attachments"][number]): boolean {
  return attachment.content_type?.startsWith("video/")
    || /\.(m4v|mkv|mov|mp4|ogv|webm)$/i.test(attachment.filename);
}

function AvatarDecorationOverlay({ user, className = "" }: { user: DiscordUser; className?: string }) {
  const url = avatarDecorationUrl(user.avatar_decoration_data);
  return url ? <img src={url} alt="" aria-hidden="true" className={`avatar-decoration-overlay ${className}`} /> : null;
}

function normalizeGuildList(value: unknown): DiscordGuild[] {
  if (!Array.isArray(value)) return [];
  return value.filter((guild): guild is DiscordGuild =>
    !!guild && typeof guild === "object" && typeof guild.id === "string" && guild.id.length > 0 &&
    typeof guild.name === "string" && guild.name.length > 0
  );
}

type UserPlatform = "desktop" | "mobile" | "web" | "voidcord";
function platformsFromPresence(presence: any): UserPlatform[] {
  const clientStatus = presence?.client_status || {};
  const activities = Array.isArray(presence?.activities) ? presence.activities : [];
  const marker = activities.some((activity: any) =>
    /voidcord/i.test(`${activity?.name || ""} ${activity?.state || ""} ${activity?.details || ""}`)
  );
  const platforms: UserPlatform[] = [];
  if (marker || clientStatus.voidcord) platforms.push("voidcord");
  if (clientStatus.desktop) platforms.push("desktop");
  if (clientStatus.mobile) platforms.push("mobile");
  if (clientStatus.web) platforms.push("web");
  return platforms;
}

function PlatformIndicators({ platforms }: { platforms: UserPlatform[] }) {
  if (!platforms.length) return null;
  const labels: Record<UserPlatform, string> = { desktop: "PC", mobile: "Mobile", web: "Web", voidcord: "VoidCord" };
  const symbols: Record<UserPlatform, string> = { desktop: "▣", mobile: "▯", web: "◎", voidcord: "V" };
  return <span className="platform-indicators" aria-label={`Active on ${platforms.map(platform => labels[platform]).join(", ")}`}>
    {platforms.map(platform => <span key={platform} className={`platform-indicator platform-${platform}`} title={labels[platform]} aria-hidden="true">{symbols[platform]}</span>)}
  </span>;
}

// ── Login screen ────────────────────────────────────────────────────────────

type SavedDiscordAccount = { user: DiscordUser; token: string };

async function persistDiscordAccount(user: DiscordUser, token: string): Promise<SavedDiscordAccount[]> {
  const store = await load("voidcord-v1.json", { autoSave: true, defaults: {} });
  const current = await store.get<SavedDiscordAccount[]>("accounts") || [];
  const next = [{ user, token }, ...current.filter(account => account.user?.id !== user.id)];
  await store.set("accounts", next);
  await store.set("token", token);
  return next;
}

function LoginScreen({ onLogin }: { onLogin: (user: DiscordUser, accounts: SavedDiscordAccount[]) => void }) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [captchaPrompt, setCaptchaPrompt] = useState<CaptchaPromptState | null>(null);

  const submit = async () => {
    if (!token.trim()) return;
    setLoading(true);
    setError("");
    try {
      let user: DiscordUser;
      try {
        user = await tauriInvoke<DiscordUser>("set_token", { token: token.trim() });
      } catch (requestError) {
        const challenge = parseCaptchaChallenge(requestError);
        if (!challenge) throw requestError;
        user = await new Promise<DiscordUser>((resolve, reject) => {
          setCaptchaPrompt({
            challenge,
            onSolve: captchaKey => {
              setCaptchaPrompt(null);
              void tauriInvoke<DiscordUser>("retry_captcha_request", { requestId: challenge.request_id, captchaKey }).then(resolve, reject);
            },
            onCancel: () => {
              setCaptchaPrompt(null);
              reject(new Error("CAPTCHA challenge cancelled"));
            },
          });
        });
      }
      const accounts = await persistDiscordAccount(user, token.trim());
      onLogin(user, accounts);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <header className="titlebar" onMouseDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("titlebar-drag-handle")) getCurrentWindow().startDragging(); }}>
        <div className="titlebar-brand">
          <div className="titlebar-logo">V</div>
          <span className="titlebar-name">VoidCord</span>
          <span className="build-tag">PREVIEW</span>
        </div>
        <div className="titlebar-drag-handle" />
        <div className="window-controls">
          <button title="Dev Console" className="dev-console-btn" onClick={() => tauriInvoke("toggle_devtools")}><Terminal size={12} /></button>
          <button title="Minimize" onClick={() => getCurrentWindow().minimize()}>─</button>
          <button title="Maximize" onClick={() => getCurrentWindow().toggleMaximize()}>□</button>
          <button className="close-btn-wc" title="Close" onClick={() => getCurrentWindow().close()}><X size={13} /></button>
        </div>
      </header>
      <div className="login-body">
        <div className="login-card">
          <div className="login-logo">V</div>
          <h1 className="login-title">Welcome to VoidCord</h1>
          <p className="login-sub">
            Enter your Discord user token to connect.<br />
            <span className="login-warn">⚠ Keep your token private. Never share it.</span>
          </p>
          <label className="login-label">User Token</label>
          <input
            className="login-input"
            type="password"
            placeholder="Paste your token here…"
            value={token}
            onChange={e => setToken(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            autoFocus
          />
          {error && <div className="login-error">{error}</div>}
          <button className="login-btn" onClick={submit} disabled={loading || !token.trim()}>
            {loading ? <Loader2 size={16} className="spinning" /> : "Connect"}
          </button>
          <p className="login-hint">
            Find your token in DevTools → Network → any Discord request → Authorization header.
          </p>
        </div>
      </div>
      {captchaPrompt && <CaptchaDialog challenge={captchaPrompt.challenge} onSolve={captchaPrompt.onSolve} onCancel={captchaPrompt.onCancel} />}
    </div>
  );
}

function CaptchaDialog({
  challenge,
  onSolve,
  onCancel,
}: {
  challenge: CaptchaChallenge;
  onSolve: (captchaKey: string) => void;
  onCancel: () => void;
}) {
  const widgetContainer = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const supported = challenge.service.toLowerCase() === "hcaptcha";

  useEffect(() => {
    if (!supported) {
      setLoading(false);
      setError(`VoidCord does not have an interactive widget for the "${challenge.service}" provider yet.`);
      return;
    }
    if (!challenge.site_key || !widgetContainer.current) {
      setLoading(false);
      setError("Discord did not include the site key required to display this CAPTCHA.");
      return;
    }

    let disposed = false;
    let widgetId: string | number | null = null;
    void loadHCaptchaScript().then(() => {
      if (disposed || !widgetContainer.current || !window.hcaptcha) return;
      widgetId = window.hcaptcha.render(widgetContainer.current, {
        sitekey: challenge.site_key!,
        ...(challenge.rq_data ? { rqdata: challenge.rq_data } : {}),
        callback: token => {
          if (token) onSolve(token);
          else setError("The CAPTCHA did not return a response. Please try again.");
        },
        "error-callback": () => setError("The CAPTCHA widget encountered an error. Reload the challenge to try again."),
        "expired-callback": () => setError("The CAPTCHA expired. Complete it again to continue."),
      });
      widgetIdRef.current = widgetId;
      setLoading(false);
    }).catch(reason => {
      if (!disposed) {
        setLoading(false);
        setError(String(reason));
      }
    });
    return () => {
      disposed = true;
      if (widgetId !== null) window.hcaptcha?.remove(widgetId);
      widgetIdRef.current = null;
    };
  }, [challenge.request_id, challenge.service, challenge.site_key, challenge.rq_data, onSolve, supported]);

  return (
    <div className="captcha-backdrop">
      <section className="captcha-dialog" role="dialog" aria-modal="true" aria-labelledby="captcha-dialog-title">
        <div className="captcha-dialog-icon"><ShieldCheck size={22} /></div>
        <h2 id="captcha-dialog-title">Discord verification required</h2>
        <p>Discord asked you to complete a CAPTCHA before this request can continue. Complete the challenge below to retry the same request.</p>
        <div className="captcha-widget-wrap">
          <div ref={widgetContainer} />
          {loading && <div className="captcha-loading"><Loader2 size={18} className="spinning" /> Loading CAPTCHA…</div>}
        </div>
        {error && <div className="captcha-error" role="alert">{error}</div>}
        {error && supported && widgetIdRef.current !== null && (
          <button type="button" className="captcha-retry" onClick={() => {
            setError("");
            window.hcaptcha?.reset(widgetIdRef.current!);
          }}>Reload challenge</button>
        )}
        {!supported && <p className="captcha-support-note">This provider is not supported in VoidCord yet. Cancel, complete the requested action through Discord, then retry it here.</p>}
        <div className="captcha-actions">
          <button type="button" onClick={onCancel}>Cancel request</button>
        </div>
        <small className="captcha-privacy-note">The CAPTCHA is provided by {challenge.service}. Your response is sent to Discord only to retry the paused request.</small>
      </section>
    </div>
  );
}

function AccountSwitcher({
  activeUser,
  accounts,
  onClose,
  onConnected,
}: {
  activeUser: DiscordUser;
  accounts: SavedDiscordAccount[];
  onClose: () => void;
  onConnected: (user: DiscordUser, token: string, accounts: SavedDiscordAccount[]) => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [captchaPrompt, setCaptchaPrompt] = useState<CaptchaPromptState | null>(null);

  const authenticate = async (candidate: string) => {
    try {
      return await tauriInvoke<DiscordUser>("set_token", { token: candidate });
    } catch (requestError) {
      const challenge = parseCaptchaChallenge(requestError);
      if (!challenge) throw requestError;
      return await new Promise<DiscordUser>((resolve, reject) => {
        setCaptchaPrompt({
          challenge,
          onSolve: captchaKey => {
            setCaptchaPrompt(null);
            void tauriInvoke<DiscordUser>("retry_captcha_request", { requestId: challenge.request_id, captchaKey }).then(resolve, reject);
          },
          onCancel: () => {
            setCaptchaPrompt(null);
            reject(new Error("CAPTCHA challenge cancelled"));
          },
        });
      });
    }
  };

  const connect = async (candidate: string) => {
    if (!candidate.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const user = await authenticate(candidate.trim());
      const next = await persistDiscordAccount(user, candidate.trim());
      onConnected(user, candidate.trim(), next);
    } catch (reason) {
      const activeToken = accounts.find(account => account.user.id === activeUser.id)?.token;
      if (activeToken) await tauriInvoke("set_token", { token: activeToken }).catch(() => undefined);
      setError(String(reason));
    } finally {
      setBusy(false);
      setBusyId(null);
    }
  };

  const removeAccount = async (userId: string) => {
    const next = accounts.filter(account => account.user.id !== userId);
    const store = await load("voidcord-v1.json", { autoSave: true, defaults: {} });
    await store.set("accounts", next);
    onConnected(activeUser, "", next);
  };

  return (
    <div className="account-switcher-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="account-switcher-modal" role="dialog" aria-modal="true" aria-labelledby="account-switcher-title">
        <header className="account-switcher-header">
          <div><h2 id="account-switcher-title">Switch accounts</h2><p>Save as many accounts as you need on this device.</p></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close account switcher"><X size={17} /></button>
        </header>
        <div className="account-switcher-list">
          {accounts.map(account => {
            const current = account.user.id === activeUser.id;
            return (
              <div className={`account-switcher-row ${current ? "current" : ""}`} key={account.user.id}>
                <img src={avatarUrl(account.user, 48)} alt="" />
                <div className="account-switcher-name"><strong>{displayName(account.user)}</strong><small>@{account.user.username}{current ? " · Current" : ""}</small></div>
                {current
                  ? <span className="account-current-badge">Current</span>
                  : <>
                    <button type="button" className="account-switch-button" disabled={busy} onClick={() => { setBusyId(account.user.id); void connect(account.token); }}>Switch</button>
                    <button type="button" className="account-remove-button" title={`Remove ${displayName(account.user)} from saved accounts`} onClick={() => void removeAccount(account.user.id)}><X size={14} /></button>
                  </>}
              </div>
            );
          })}
          {accounts.length === 0 && <p className="account-switcher-empty">No saved accounts yet.</p>}
        </div>
        <form className="account-add-form" onSubmit={event => { event.preventDefault(); void connect(token); }}>
          <label htmlFor="add-account-token">Add another account</label>
          <div className="account-add-row"><input id="add-account-token" type="password" autoComplete="off" placeholder="Paste account token" value={token} onChange={event => setToken(event.target.value)} /><button type="submit" disabled={busy || !token.trim()}>{busy && !busyId ? <Loader2 size={14} className="spinning" /> : "Add"}</button></div>
          {busy && <small className="account-switcher-progress">{busyId ? "Switching account…" : "Connecting account…"}</small>}
          {error && <p className="account-switcher-error">{error}</p>}
        </form>
      </section>
      {captchaPrompt && <CaptchaDialog challenge={captchaPrompt.challenge} onSolve={captchaPrompt.onSolve} onCancel={captchaPrompt.onCancel} />}
    </div>
  );
}

// ── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [me, setMe] = useState<DiscordUser | null>(null);
  const [savedAccounts, setSavedAccounts] = useState<SavedDiscordAccount[]>([]);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const [accountSessionVersion, setAccountSessionVersion] = useState(0);
  const [authLoading, setAuthLoading] = useState(true);

  const [guilds, setGuilds] = useState<DiscordGuild[]>([]);
  const [selectedGuild, setSelectedGuild] = useState<DiscordGuild | null>(null);
  const [dmChannels, setDmChannels] = useState<DiscordChannel[]>([]);
  const [recentlyMessaged, setRecentlyMessaged] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("voidcord:recently-messaged") || "[]");
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
    } catch { return []; }
  });
  const [isDmView, setIsDmView] = useState(true);
  const [activeDmTab, setActiveDmTab] = useState<"friends" | "friend-requests" | "message-requests" | "nitro" | "shop" | "quests" | "chat">("friends");
  const [relationships, setRelationships] = useState<DiscordRelationship[]>([]);
  const [ignoredUserIds, setIgnoredUserIds] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("voidcord:ignored-users") || "[]");
      return new Set(Array.isArray(saved) ? saved.filter((id: unknown): id is string => typeof id === "string") : []);
    } catch { return new Set(); }
  });
  const [revealedIgnoredMessageIds, setRevealedIgnoredMessageIds] = useState<Set<string>>(() => new Set());
  const [revealedIgnoredProfileIds, setRevealedIgnoredProfileIds] = useState<Set<string>>(() => new Set());
  const [friendRequestView, setFriendRequestView] = useState<"incoming" | "outgoing">("incoming");
  const [messageRequests, setMessageRequests] = useState<DiscordChannel[]>([]);
  const [messageRequestsLoading, setMessageRequestsLoading] = useState(false);
  const [messageRequestsError, setMessageRequestsError] = useState("");
  const [selectedMessageRequest, setSelectedMessageRequest] = useState<DiscordChannel | null>(null);
  const [requestMessages, setRequestMessages] = useState<DiscordMessage[]>([]);
  const [requestMessagesLoading, setRequestMessagesLoading] = useState(false);
  const [requestMessagesError, setRequestMessagesError] = useState("");
  const [requestBusy, setRequestBusy] = useState<string | null>(null);
  const [friendView, setFriendView] = useState<"online" | "all" | "add">("online");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [friendUsername, setFriendUsername] = useState("");
  const [relationshipBusy, setRelationshipBusy] = useState<string | null>(null);
  const [friendSearchError, setFriendSearchError] = useState("");

  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("voidcord:unread-channels") || "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch {
      return {};
    }
  });
  const [selectedChannel, setSelectedChannel] = useState<DiscordChannel | null>(null);
  const selectedChannelRef = useRef<DiscordChannel | null>(null);
  const [channelAccess, setChannelAccess] = useState<"ok" | "MISSING_ACCESS" | "MISSING_PERMS">("ok");
  const [knownLockedChannels, setKnownLockedChannels] = useState<Set<string>>(new Set());
  const [offlineCache, setOfflineCache] = useState(false);
  const [cacheReadyChannel, setCacheReadyChannel] = useState<string | null>(null);
  const [draftReadyChannel, setDraftReadyChannel] = useState<string | null>(null);
  const [canSend, setCanSend] = useState(true);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [userProfile, setUserProfile] = useState<any>(null);

  const [selfPresence, setSelfPresence] = useState<{ status: string; customStatus: string }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("voidcord:presence") || "{}");
      return {
        status: typeof saved.status === "string" ? saved.status : "online",
        customStatus: typeof saved.customStatus === "string" ? saved.customStatus : "",
      };
    } catch {
      return { status: "online", customStatus: "" };
    }
  });
  
  const [guildMembers, setGuildMembers] = useState<any[]>([]);
  const [gatewayVoiceStates, setGatewayVoiceStates] = useState<GatewayVoiceState[]>([]);
  const [privateVoiceCalls, setPrivateVoiceCalls] = useState<Set<string>>(() => new Set());
  const [incomingCallChannels, setIncomingCallChannels] = useState<Record<string, any>>({});
  const [guildRoles, setGuildRoles] = useState<any[]>([]);
  const [memberPresences, setMemberPresences] = useState<Record<string, string>>({});
  const [memberPlatforms, setMemberPlatforms] = useState<Record<string, UserPlatform[]>>({});
  const [memberCustomStatuses, setMemberCustomStatuses] = useState<Record<string, string>>({});
  
  
  const [selectedMemberProfile, setSelectedMemberProfile] = useState<any | null>(null);
  const [memberProfileData, setMemberProfileData] = useState<any | null>(null);
  const [memberProfileLoading, setMemberProfileLoading] = useState(false);

  const [messages, setMessages] = useState<DiscordMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [dmProfileData, setDmProfileData] = useState<any>(null);
  const [dmProfileLoading, setDmProfileLoading] = useState(false);
  const [messageLoggerOpen, setMessageLoggerOpen] = useState(false);
  const [messageLoggerMode, setMessageLoggerMode] = useState<"deleted" | "edited">("deleted");
  const [deletedLogs, setDeletedLogs] = useState<DeletedMessageLog[]>([]);
  const [editedLogs, setEditedLogs] = useState<EditedMessageLog[]>([]);
  const [loggerLoading, setLoggerLoading] = useState(false);
  const [loggerError, setLoggerError] = useState("");
  const [selectedDeletedLog, setSelectedDeletedLog] = useState<DeletedMessageLog | null>(null);
  const [restoredDeletedMessage, setRestoredDeletedMessage] = useState<DiscordMessage | null>(null);
  const [selectedEditedLog, setSelectedEditedLog] = useState<EditedMessageLog | null>(null);
  const [restoredEditedMessage, setRestoredEditedMessage] = useState<DiscordMessage | null>(null);
  const [deletedChannelViewerOpen, setDeletedChannelViewerOpen] = useState(false);
  const [deletedChannelLogs, setDeletedChannelLogs] = useState<DeletedChannelLog[]>([]);
  const [deletedChannelLogsLoading, setDeletedChannelLogsLoading] = useState(false);
  const [selectedDeletedChannel, setSelectedDeletedChannel] = useState<DeletedChannelLog | null>(null);
  const [deletedChannelMessages, setDeletedChannelMessages] = useState<DiscordMessage[]>([]);

  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const [composerFiles, setComposerFiles] = useState<ComposerAttachment[]>([]);
  const [accountUploadLimitBytes, setAccountUploadLimitBytes] = useState(20 * 1024 * 1024);
  const [composerPicker, setComposerPicker] = useState<"gif" | "emoji" | null>(null);
  const [emojiQuery, setEmojiQuery] = useState("");
  const [gifQuery, setGifQuery] = useState("");
  const [gifUrl, setGifUrl] = useState("");
  const [memberOpen, setMemberOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [protoSettingsOpen, setProtoSettingsOpen] = useState(false);
  const [settingsTheme, setSettingsTheme] = useState<"dark" | "light">("dark");
  const [settingsTab, setSettingsTab] = useState<"account" | "themes">("account");
  const [preferences, setPreferences] = useState<AppPreferences>(readPreferences);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [mediaViewer, setMediaViewer] = useState<MediaViewerState | null>(null);
  const [mediaZoom, setMediaZoom] = useState(1);
  const [mediaZoomOrigin, setMediaZoomOrigin] = useState("50% 50%");
  const [mediaLens, setMediaLens] = useState<MediaLensState | null>(null);
  const [captchaPrompt, setCaptchaPrompt] = useState<CaptchaPromptState | null>(null);
  const [mediaLensActive, setMediaLensActive] = useState(false);
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const [serverDialogMode, setServerDialogMode] = useState<"join" | "create">("join");
  const [serverInvite, setServerInvite] = useState("");
  const [newServerName, setNewServerName] = useState("");
  const [serverActionBusy, setServerActionBusy] = useState(false);
  const [serverActionError, setServerActionError] = useState("");
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [profileCardOpen, setProfileCardOpen] = useState(false);
  const [ownProfileLoading, setOwnProfileLoading] = useState(false);
  const [fullProfileOpen, setFullProfileOpen] = useState(false);
  const [bioEditing, setBioEditing] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [bioSaving, setBioSaving] = useState(false);
  const [customStatusDraft, setCustomStatusDraft] = useState("");
  const [customStatusEditing, setCustomStatusEditing] = useState(false);
  const [mentionCaret, setMentionCaret] = useState(0);
  const [mentionSelection, setMentionSelection] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceList>({ inputs: [], outputs: [] });
  const [audioDevicesLoading, setAudioDevicesLoading] = useState(false);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState(() => readVoiceDevicePreference("voidcord:voice-input"));
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState(() => readVoiceDevicePreference("voidcord:voice-output"));
  const [activeVoiceChannel, setActiveVoiceChannel] = useState<DiscordChannel | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<"disconnected" | "connecting" | "connected" | "failed">("disconnected");
  const [voiceStatusMessage, setVoiceStatusMessage] = useState("");
  const voiceHandshakeRef = useRef<VoiceHandshake | null>(null);
  const voiceAttemptRef = useRef(0);
  const [query, setQuery] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [gatewayStatus, setGatewayStatus] = useState<"connecting" | "connected" | "reconnecting" | "offline">(
    navigator.onLine ? "connecting" : "offline",
  );
  const [toast, setToast] = useState<NoticeState | null>(null);
  const [systemNotice, setSystemNotice] = useState<NoticeState | null>(null);
  const notificationSequence = useRef(0);
  const [sending, setSending] = useState(false);
  const [replyToMessage, setReplyToMessage] = useState<DiscordMessage | null>(null);
  const [slashCommands, setSlashCommands] = useState<any[]>([]);
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<any | null>(null);
  const [gatewaySessionId, setGatewaySessionId] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [forwardTarget, setForwardTarget] = useState<{ message: DiscordMessage; channel: DiscordChannel } | null>(null);
  const [forwardBusy, setForwardBusy] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const directorySearchRef = useRef<HTMLInputElement>(null);
  const channelLoadRequest = useRef(0);
  const guildLoadRequest = useRef(0);
  const olderMessagesLoadingRef = useRef(false);
  const hasOlderMessagesRef = useRef(false);
  const messageHistoryRef = useRef<Record<string, DiscordMessage[]>>({});
  const reactionRequestsRef = useRef(new Set<string>());
  const messageArchivePromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const guildRoleDataRef = useRef<any[]>([]);
  const guildMembersRef = useRef<any[]>([]);
  const pendingGuildDataRef = useRef<Map<string, {
    channels: DiscordChannel[];
    roles: any[];
    memberRoles: string[];
    guildMembers: any[];
  }>>(new Map());
  const pendingGuildDataTimerRef = useRef<number | null>(null);
  const currentGuildMemberRolesRef = useRef<string[]>([]);
  const selectedGuildRef = useRef<DiscordGuild | null>(null);
  const mediaViewerRef = useRef<HTMLDivElement>(null);
  guildMembersRef.current = guildMembers;
  

  const invoke = useCallback(async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const execute = async (name: string, payload?: Record<string, unknown>): Promise<T> => {
      try {
        return await tauriInvoke<T>(name, payload);
      } catch (error) {
        const challenge = parseCaptchaChallenge(error);
        if (!challenge) throw error;
        return new Promise<T>((resolve, reject) => {
          const onCancel = () => {
            setCaptchaPrompt(current => current?.challenge.request_id === challenge.request_id ? null : current);
            reject(new Error("CAPTCHA challenge cancelled"));
          };
          const onSolve = (captchaKey: string) => {
            setCaptchaPrompt(null);
            void execute("retry_captcha_request", {
              requestId: challenge.request_id,
              captchaKey,
            }).then(resolve, reject);
          };
          setCaptchaPrompt({ challenge, onSolve, onCancel });
        });
      }
    };
    return execute(command, args);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", closeOnKey);
    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [contextMenu]);

  const notify = useCallback((msg: string, ms = 2600) => {
    setToast({ id: ++notificationSequence.current, message: msg, duration: ms, exiting: false });
  }, []);

  const notifySystem = useCallback((msg: string, ms = 4200) => {
    setSystemNotice({ id: ++notificationSequence.current, message: msg, duration: ms, exiting: false });
  }, []);

  useEffect(() => {
    const match = draft.match(/^\/([^\s]*)$);
    if (!match || !selectedChannel || selectedSlashCommand) {
      setSlashCommands([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await invoke<any>("search_application_commands", { channelId: selectedChannel.id, query: match[1] });
        const commands = Array.isArray(response) ? response : Array.isArray(response?.application_commands) ? response.application_commands : Array.isArray(response?.commands) ? response.commands : [];
        if (!cancelled) setSlashCommands(commands.filter((command: any) => typeof command?.name === "string" && typeof command?.id === "string" && typeof command?.application_id === "string").slice(0, 15));
      } catch (error) {
        if (!cancelled) { setSlashCommands([]); console.debug("Slash command search unavailable", error); }
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [draft, selectedChannel?.id, selectedSlashCommand, invoke]);

  const refreshAudioDevices = useCallback(async () => {
    setAudioDevicesLoading(true);
    try {
      setAudioDevices(await tauriInvoke<AudioDeviceList>("list_audio_devices"));
    } catch (error) {
      notify(`Could not list audio devices: ${error}`);
    } finally {
      setAudioDevicesLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void refreshAudioDevices();
  }, [refreshAudioDevices]);

  const connectVoiceFromGateway = useCallback(async () => {
    const handshake = voiceHandshakeRef.current;
    if (
      !me?.id
      || !handshake
      || handshake.connecting
      || !handshake.sessionId
      || !handshake.endpoint
      || !handshake.token
    ) return;

    handshake.connecting = true;
    setVoiceStatus("connecting");
    setVoiceStatusMessage("Negotiating encrypted voice transport…");
    try {
      await invoke("connect_voice", {
        serverId: handshake.serverId,
        channelId: handshake.channelId,
        userId: me.id,
        endpoint: handshake.endpoint,
        sessionId: handshake.sessionId,
        token: handshake.token,
        inputDeviceId: selectedInputDeviceId || null,
        outputDeviceId: selectedOutputDeviceId || null,
      });
    } catch (error) {
      if (voiceHandshakeRef.current?.attempt !== handshake.attempt) return;
      handshake.connecting = false;
      setVoiceStatus("failed");
      setVoiceStatusMessage(String(error));
      notify(`Voice connection failed: ${error}`);
    }
  }, [invoke, me?.id, notify, selectedInputDeviceId, selectedOutputDeviceId]);

  const updateVoiceDeviceSelection = (
    direction: "input" | "output",
    deviceId: string,
  ) => {
    const storageKey = direction === "input" ? "voidcord:voice-input" : "voidcord:voice-output";
    try {
      if (deviceId) localStorage.setItem(storageKey, deviceId);
      else localStorage.removeItem(storageKey);
    } catch (error) {
      notify(`Could not save audio device preference: ${error}`);
    }
    if (direction === "input") setSelectedInputDeviceId(deviceId);
    else setSelectedOutputDeviceId(deviceId);
  };

  const requestVoiceConnection = async (channel: DiscordChannel, guildId: string | null) => {
    if (!me?.id) {
      notify("An account is required to join voice");
      return;
    }
    const attempt = ++voiceAttemptRef.current;
    const serverId = guildId || channel.id;
    voiceHandshakeRef.current = {
      attempt,
      guildId,
      serverId,
      channelId: channel.id,
      connecting: false,
    };
    setActiveVoiceChannel(channel);
    setVoiceStatus("connecting");
    setVoiceStatusMessage(`Joining ${channelDisplayName(channel)}…`);
    setSelectedChannel(channel);
    selectedChannelRef.current = channel;

    try {
      await invoke("disconnect_voice");
      if (voiceHandshakeRef.current?.attempt !== attempt) return;
      await invoke("set_voice_state", {
        guildId,
        channelId: channel.id,
        selfMute: micMuted,
        selfDeaf: deafened,
      });
    } catch (error) {
      if (voiceHandshakeRef.current?.attempt !== attempt) return;
      voiceHandshakeRef.current = null;
      setVoiceStatus("failed");
      setVoiceStatusMessage(String(error));
      notify(`Could not join voice channel: ${error}`);
    }
  };

  const joinVoiceChannel = async (channel: DiscordChannel) => {
    if (!channel.guild_id) {
      notify("This voice channel is missing its guild ID");
      return;
    }
    await requestVoiceConnection(channel, channel.guild_id);
  };

  const joinPrivateCall = async (channel: DiscordChannel) => {
    if (!isPrivateCallChannel(channel)) return;
    await requestVoiceConnection(channel, null);
  };

  const leaveVoiceChannel = async () => {
    const handshake = voiceHandshakeRef.current;
    voiceHandshakeRef.current = null;
    ++voiceAttemptRef.current;
    try {
      if (handshake) {
        await invoke("set_voice_state", {
          guildId: handshake.guildId,
          channelId: null,
          selfMute: false,
          selfDeaf: false,
        });
      } else {
        await invoke("disconnect_voice");
      }
      setMicMuted(false);
      setDeafened(false);
      setVoiceStatus("disconnected");
      setVoiceStatusMessage("Disconnected from voice");
      setActiveVoiceChannel(null);
    } catch (error) {
      notify(`Could not leave voice cleanly: ${error}`);
    }
  };

  const updateVoiceControls = async (nextMuted: boolean, nextDeafened: boolean) => {
    const channel = activeVoiceChannel;
    const handshake = voiceHandshakeRef.current;
    if (channel && handshake && voiceStatus !== "disconnected") {
      try {
        await invoke("set_voice_state", {
          guildId: handshake.guildId,
          channelId: channel.id,
          selfMute: nextMuted,
          selfDeaf: nextDeafened,
        });
      } catch (error) {
        notify(`Could not update voice controls: ${error}`);
        return;
      }
    }
    setMicMuted(nextMuted);
    setDeafened(nextDeafened);
  };

  const changeVoiceChannelStatus = async (channel: DiscordChannel) => {
    const status = window.prompt(
      "Set a short status for this voice channel (up to 500 characters). Leave blank to clear it.",
      channel.status || "",
    );
    if (status === null) return;
    if (status.length > 500) {
      notify("Voice channel status cannot exceed 500 characters");
      return;
    }
    try {
      await invoke("set_voice_channel_status", { channelId: channel.id, status });
      setChannels(previous => previous.map(item =>
        item.id === channel.id ? { ...item, status: status || null } : item
      ));
      setSelectedChannel(previous =>
        previous?.id === channel.id ? { ...previous, status: status || null } : previous
      );
      notify(status ? "Voice channel status updated" : "Voice channel status cleared");
    } catch (error) {
      notify(`Could not update voice channel status: ${error}`);
    }
  };

  useEffect(() => {
    if (!toast) return;
    const fadeTimer = window.setTimeout(() => {
      setToast(current => current?.id === toast.id ? { ...current, exiting: true } : current);
    }, toast.duration);
    const removeTimer = window.setTimeout(() => {
      setToast(current => current?.id === toast.id ? null : current);
    }, toast.duration + 260);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [toast]);

  useEffect(() => {
    if (!systemNotice) return;
    const fadeTimer = window.setTimeout(() => {
      setSystemNotice(current => current?.id === systemNotice.id ? { ...current, exiting: true } : current);
    }, systemNotice.duration);
    const removeTimer = window.setTimeout(() => {
      setSystemNotice(current => current?.id === systemNotice.id ? null : current);
    }, systemNotice.duration + 260);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [systemNotice]);

  const showMedia = useCallback((url: string, kind: "image" | "video", name?: string) => {
    setMediaZoom(1);
    setMediaZoomOrigin("50% 50%");
    setMediaLens(null);
    setMediaLensActive(false);
    setMediaViewer({ url, kind, name });
  }, []);

  const zoomMediaAtPointer = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const zoomTarget = mediaViewerRef.current?.querySelector(".media-image-zoom");
    const bounds = zoomTarget?.getBoundingClientRect() || event.currentTarget.getBoundingClientRect();
    setMediaZoomOrigin(`${((event.clientX - bounds.left) / bounds.width) * 100}% ${((event.clientY - bounds.top) / bounds.height) * 100}%`);
    setMediaZoom(zoom => Math.max(0.5, Math.min(4, Number((zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)).toFixed(3)))));
  };

  const updateMediaLens = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!mediaLensActive || event.buttons !== 1) {
      setMediaLens(null);
      return;
    }
    const image = event.currentTarget;
    const bounds = image.getBoundingClientRect();
    if (!image.naturalWidth || !image.naturalHeight || !bounds.width || !bounds.height) return;
    const imageRatio = image.naturalWidth / image.naturalHeight;
    const frameRatio = bounds.width / bounds.height;
    const imageWidth = imageRatio > frameRatio ? bounds.width : bounds.height * imageRatio;
    const imageHeight = imageRatio > frameRatio ? bounds.width / imageRatio : bounds.height;
    const offsetX = (bounds.width - imageWidth) / 2;
    const offsetY = (bounds.height - imageHeight) / 2;
    const x = Math.max(0, Math.min(imageWidth, event.clientX - bounds.left - offsetX));
    const y = Math.max(0, Math.min(imageHeight, event.clientY - bounds.top - offsetY));
    const lensSize = 190;
    const magnification = 2.5;
    const stage = mediaViewerRef.current?.querySelector(".media-viewer-stage");
    const stageBounds = stage?.getBoundingClientRect();
    setMediaLens({
      left: stageBounds ? event.clientX - stageBounds.left - lensSize / 2 : event.clientX - bounds.left - lensSize / 2,
      top: stageBounds ? event.clientY - stageBounds.top - lensSize / 2 : event.clientY - bounds.top - lensSize / 2,
      backgroundSize: `${imageWidth * magnification}px ${imageHeight * magnification}px`,
      backgroundPosition: `${lensSize / 2 - x * magnification}px ${lensSize / 2 - y * magnification}px`,
    });
  };

  const handleMediaImageWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (mediaViewer?.kind === "image") zoomMediaAtPointer(event);
  };

  const toggleMediaFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await mediaViewerRef.current?.requestFullscreen();
    } catch (error) {
      notify(`Could not toggle full-screen media: ${error}`);
    }
  };

  const submitServerAction = async (event: React.FormEvent) => {
    event.preventDefault();
    setServerActionError("");
    setServerActionBusy(true);
    try {
      const result = serverDialogMode === "join"
        ? await invoke<any>("join_guild_invite", { inviteCode: serverInvite })
        : await invoke<any>("create_guild", { name: newServerName });
      const guildId = serverDialogMode === "create" ? result?.id : result?.guild?.id;
      const refreshedGuilds = normalizeGuildList(await invoke<DiscordGuild[]>("get_guilds"));
      setGuilds(refreshedGuilds);
      void writeCachedAppData("guilds", refreshedGuilds);
      const joinedGuild = refreshedGuilds.find(guild => guild.id === guildId);
      if (joinedGuild) {
        setIsDmView(false);
        await selectGuild(joinedGuild);
      }
      setServerDialogOpen(false);
      setServerInvite("");
      setNewServerName("");
      notify(serverDialogMode === "join" ? "Joined server" : "Server created");
    } catch (error) {
      setServerActionError(String(error));
    } finally {
      setServerActionBusy(false);
    }
  };

  useEffect(() => {
    localStorage.setItem("voidcord:preferences", JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    if (!settingsOpen && !serverDialogOpen && !mediaViewer) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (mediaViewer) setMediaViewer(null);
        else if (serverDialogOpen && !serverActionBusy) setServerDialogOpen(false);
        else setSettingsOpen(false);
      } else if (mediaViewer?.kind === "image" && (event.key === "+" || event.key === "=" || event.key === "-" || event.key === "0")) {
        event.preventDefault();
        if (event.key === "0") setMediaZoom(1);
        else setMediaZoom(zoom => Math.max(0.25, Math.min(3, Number((zoom + (event.key === "-" ? -0.25 : 0.25)).toFixed(2)))));
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen, serverDialogOpen, serverActionBusy, mediaViewer]);

  const archiveMessageMedia = useCallback((message: DiscordMessage): Promise<void> => {
    const media = new Map<string, string>();
    (message.attachments || []).forEach(attachment => {
      if (attachment.url) media.set(`${message.id}:${attachment.id}`, attachment.url);
    });
    message.embeds?.forEach((embed, index) => {
      if (embed.image?.url && /^https:\/\/(?:[^/]+\.)?discordapp\.(?:com|net)\//.test(embed.image.url)) {
        media.set(`${message.id}:embed:${index}:image`, embed.image.url);
      }
      if (embed.thumbnail?.url && /^https:\/\/(?:[^/]+\.)?discordapp\.(?:com|net)\//.test(embed.thumbnail.url)) {
        media.set(`${message.id}:embed:${index}:thumbnail`, embed.thumbnail.url);
      }
    });
    let promise: Promise<void>;
    promise = Promise.all([...media].map(async ([key, url]) => {
      try {
        const dataUrl = await invoke<string>("archive_message_media", { url });
        await writeArchivedMedia(key, dataUrl);
      } catch (error) {
        console.warn(`Could not archive media for message ${message.id}`, error);
      }
    })).then(() => undefined).finally(() => {
      if (messageArchivePromisesRef.current.get(message.id) === promise) {
        messageArchivePromisesRef.current.delete(message.id);
      }
    });
    messageArchivePromisesRef.current.set(message.id, promise);
    return promise;
  }, []);

  const openMessageLogger = async () => {
    setMessageLoggerOpen(true);
    setMessageLoggerMode("deleted");
    setLoggerLoading(true);
    setLoggerError("");
    try {
      const logs = await readDeletedMessages();
      setDeletedLogs(logs);
      if (logs[0]) await selectDeletedLog(logs[0]);
    } catch (error) {
      setLoggerError(`Could not read the local message log: ${error}`);
    } finally {
      setLoggerLoading(false);
    }
  };

  const openEditedMessageLogger = async () => {
    setMessageLoggerOpen(true);
    setMessageLoggerMode("edited");
    setLoggerLoading(true);
    setLoggerError("");
    try {
      const logs = await readEditedMessages();
      setEditedLogs(logs);
      if (logs[0]) await selectEditedLog(logs[0]);
      else { setSelectedEditedLog(null); setRestoredEditedMessage(null); }
    } catch (error) {
      setLoggerError(`Could not read the local edit log: ${error}`);
    } finally {
      setLoggerLoading(false);
    }
  };

  const selectDeletedLog = async (entry: DeletedMessageLog) => {
    setSelectedDeletedLog(entry);
    try {
      const attachments = await Promise.all((entry.message.attachments || []).map(async attachment => {
        const url = await readArchivedMedia(`${entry.id}:${attachment.id}`);
        return url ? { ...attachment, url, proxy_url: url } : attachment;
      }));
      const embeds = await Promise.all((entry.message.embeds || []).map(async (embed, index) => {
        const [image, thumbnail] = await Promise.all([
          readArchivedMedia(`${entry.id}:embed:${index}:image`),
          readArchivedMedia(`${entry.id}:embed:${index}:thumbnail`),
        ]);
        return {
          ...embed,
          image: image && embed.image ? { ...embed.image, url: image, proxy_url: image } : embed.image,
          thumbnail: thumbnail && embed.thumbnail ? { ...embed.thumbnail, url: thumbnail, proxy_url: thumbnail } : embed.thumbnail,
        };
      }));
      setRestoredDeletedMessage({ ...entry.message, attachments, embeds });
    } catch (error) {
      setRestoredDeletedMessage(entry.message);
      notify(`Could not restore deleted media: ${error}`);
    }
  };

  const selectEditedLog = async (entry: EditedMessageLog) => {
    setSelectedEditedLog(entry);
    try {
      const attachments = await Promise.all((entry.message.attachments || []).map(async attachment => {
        const url = await readArchivedMedia(`${entry.id}:${attachment.id}`);
        return url ? { ...attachment, url, proxy_url: url } : attachment;
      }));
      const embeds = await Promise.all((entry.message.embeds || []).map(async (embed, index) => {
        const [image, thumbnail] = await Promise.all([
          readArchivedMedia(`${entry.id}:embed:${index}:image`),
          readArchivedMedia(`${entry.id}:embed:${index}:thumbnail`),
        ]);
        return {
          ...embed,
          image: image && embed.image ? { ...embed.image, url: image, proxy_url: image } : embed.image,
          thumbnail: thumbnail && embed.thumbnail ? { ...embed.thumbnail, url: thumbnail, proxy_url: thumbnail } : embed.thumbnail,
        };
      }));
      setRestoredEditedMessage({ ...entry.message, attachments, embeds });
    } catch (error) {
      setRestoredEditedMessage(entry.message);
      notify(`Could not restore edited media: ${error}`);
    }
  };

  const removeEditedLog = async (entry: EditedMessageLog) => {
    try {
      await deleteEditedMessage(entry.id);
      setEditedLogs(previous => previous.filter(item => item.id !== entry.id));
      if (selectedEditedLog?.id === entry.id) {
        setSelectedEditedLog(null);
        setRestoredEditedMessage(null);
      }
    } catch (error) {
      notify(`Could not remove edit log entry: ${error}`);
    }
  };

  const removeDeletedLog = async (entry: DeletedMessageLog) => {
    try {
      await deleteDeletedMessage(entry.id);
      setDeletedLogs(previous => previous.filter(item => item.id !== entry.id));
      if (selectedDeletedLog?.id === entry.id) {
        setSelectedDeletedLog(null);
        setRestoredDeletedMessage(null);
      }
    } catch (error) {
      notify(`Could not remove log entry: ${error}`);
    }
  };

  const openDeletedChannelViewer = async () => {
    setDeletedChannelViewerOpen(true);
    setDeletedChannelLogsLoading(true);
    try {
      const entries = await readDeletedChannels();
      setDeletedChannelLogs(entries);
      if (entries[0]) await selectDeletedChannel(entries[0]);
      else {
        setSelectedDeletedChannel(null);
        setDeletedChannelMessages([]);
      }
    } catch (error) {
      notify(`Could not load deleted channels: ${error}`);
    } finally {
      setDeletedChannelLogsLoading(false);
    }
  };

  const selectDeletedChannel = async (entry: DeletedChannelLog) => {
    setSelectedDeletedChannel(entry);
    try {
      const cached = await readCachedMessages(entry.id) || [];
      const restored = await Promise.all(cached.map(async message => {
        const attachments = await Promise.all((message.attachments || []).map(async attachment => {
          const url = await readArchivedMedia(`${message.id}:${attachment.id}`);
          return url ? { ...attachment, url, proxy_url: url } : attachment;
        }));
        const embeds = await Promise.all((message.embeds || []).map(async (embed, index) => {
          const [image, thumbnail] = await Promise.all([
            readArchivedMedia(`${message.id}:embed:${index}:image`),
            readArchivedMedia(`${message.id}:embed:${index}:thumbnail`),
          ]);
          return {
            ...embed,
            image: image && embed.image ? { ...embed.image, url: image, proxy_url: image } : embed.image,
            thumbnail: thumbnail && embed.thumbnail ? { ...embed.thumbnail, url: thumbnail, proxy_url: thumbnail } : embed.thumbnail,
          };
        }));
        return { ...message, attachments, embeds };
      }));
      setDeletedChannelMessages(restored);
    } catch (error) {
      notify(`Could not read cached messages for deleted channel: ${error}`);
      setDeletedChannelMessages([]);
    }
  };

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, []);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      setGatewayStatus("connecting");
      notifySystem("Internet connection restored");
    };
    const dn = () => {
      setOnline(false);
      setGatewayStatus("offline");
      notifySystem("Internet connection lost");
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", dn);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", dn); };
  }, [notifySystem]);

  useEffect(() => {
    if (!selectedChannel?.id || cacheReadyChannel !== selectedChannel.id || channelAccess !== "ok") return;
    void writeCachedMessages(selectedChannel.id, messages)
      .catch(error => notify(`Could not write the offline message cache: ${error}`));
  }, [selectedChannel?.id, cacheReadyChannel, channelAccess, messages, notify]);

  useEffect(() => {
    if (selectedChannel?.id) messageHistoryRef.current[selectedChannel.id] = messages;
  }, [selectedChannel?.id, messages]);

  useEffect(() => {
    selectedChannelRef.current = selectedChannel;
  }, [selectedChannel]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!selectedChannel?.id || draftReadyChannel !== selectedChannel.id) return;
    void writeCachedDraft(selectedChannel.id, draft).catch(() => {});
  }, [selectedChannel?.id, draftReadyChannel, draft]);

  useEffect(() => {
    (async () => {
      try {
        const store = await load("voidcord-v1.json", { autoSave: true, defaults: {} });
        const accounts = await store.get<SavedDiscordAccount[]>("accounts") || [];
        setSavedAccounts(accounts);
        const saved = await store.get<string>("token") || accounts[0]?.token;
        if (saved) {
          const cachedUser = await readCachedAppData<DiscordUser>("current-user").catch(() => undefined);
          if (cachedUser) {
            setMe(cachedUser);
            setAuthLoading(false);
            const migratedAccounts = await persistDiscordAccount(cachedUser, saved).catch(() => accounts);
            setSavedAccounts(migratedAccounts);
          }
          try {
            const user = await invoke<DiscordUser>("set_token", { token: saved });
            setMe(user);
            void writeCachedAppData("current-user", user);
            const migratedAccounts = await persistDiscordAccount(user, saved);
            setSavedAccounts(migratedAccounts);
          } catch {
            if (!cachedUser) throw new Error("No cached user profile");
          }
        }
      } catch {
        // no-op
      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!me?.id) return;
    (async () => {
      let lastReadChannel: { channelId: string; guildId?: string } | null = null;
      try {
        const saved = JSON.parse(localStorage.getItem("voidcord:last-read-channel") || "null");
        if (accountSessionVersion === 0 && saved && typeof saved.channelId === "string") {
          lastReadChannel = {
            channelId: saved.channelId,
            ...(typeof saved.guildId === "string" ? { guildId: saved.guildId } : {}),
          };
        }
      } catch {
        // Ignore malformed optional local navigation state.
      }

      const [cachedGuilds, cachedDms] = accountSessionVersion === 0
        ? await Promise.all([
          readCachedAppData<DiscordGuild[]>("guilds").catch(() => undefined),
          readCachedAppData<DiscordChannel[]>("dm-channels").catch(() => undefined),
        ])
        : [undefined, undefined];
      const validCachedGuilds = normalizeGuildList(cachedGuilds);
      if (cachedGuilds) setGuilds(validCachedGuilds);
      if (cachedDms) setDmChannels(cachedDms);
      if (!navigator.onLine) {
        const cachedDm = cachedDms?.find(channel => channel.id === lastReadChannel?.channelId);
        if (cachedDm) {
          void selectChannel(cachedDm);
        } else if (lastReadChannel?.guildId) {
          const cachedGuild = validCachedGuilds.find(guild => guild.id === lastReadChannel?.guildId);
          if (cachedGuild) void selectGuild(cachedGuild, lastReadChannel.channelId);
        }
        return;
      }

      let availableGuilds = validCachedGuilds;
      try {
        const list = await invoke<DiscordGuild[]>("get_guilds");
        availableGuilds = normalizeGuildList(list);
        setGuilds(availableGuilds);
        void writeCachedAppData("guilds", availableGuilds);
      } catch (e) {
        notify(`Failed to load servers: ${e}`);
      }

      let availableDms = cachedDms || [];
      try {
        const dms = await invoke<DiscordChannel[]>("get_dm_channels");
        availableDms = dms;
        setDmChannels(dms);
        void writeCachedAppData("dm-channels", dms);
      } catch (e) {
        console.error("Failed to load DMs", e);
      }

      if (lastReadChannel) {
        const savedDm = availableDms.find(channel => channel.id === lastReadChannel?.channelId);
        if (savedDm) {
          void selectChannel(savedDm);
        } else if (lastReadChannel.guildId) {
          const savedGuild = availableGuilds.find(guild => guild.id === lastReadChannel?.guildId);
          if (savedGuild) void selectGuild(savedGuild, lastReadChannel.channelId);
        }
      }

      try {
        const list = await invoke<DiscordRelationship[]>("get_relationships");
        setRelationships(list.filter(relationship => relationship.user));
      } catch (e) {
        notify(`Failed to load friends and requests: ${e}`);
      }

      setMessageRequestsLoading(true);
      try {
        const requests = await invoke<DiscordChannel[]>("get_message_requests");
        setMessageRequests(requests);
        setMessageRequestsError("");
      } catch (e) {
        setMessageRequestsError(String(e));
      } finally {
        setMessageRequestsLoading(false);
      }

      try {
        const prof = await invoke<any>("get_user_profile", { userId: me.id });
        if (prof) setUserProfile(prof);
      } catch (e) {
        console.error("Failed to load extended profile", e);
      }

      try {
        setGatewayStatus("connecting");
        await invoke("start_gateway");
      } catch (e) {
        setGatewayStatus("reconnecting");
        notify(`Gateway error: ${e}`);
      }
    })();
  }, [me?.id, online, accountSessionVersion]);

  useEffect(() => {
    let subscriptionsDisposed = false;
    const unsubs = {
      registered: [] as UnlistenFn[],
      push(unsubscribe: UnlistenFn) {
        if (subscriptionsDisposed) {
          unsubscribe();
          return this.registered.length;
        }
        return this.registered.push(unsubscribe);
      },
      forEach(callback: (unsubscribe: UnlistenFn) => void) {
        this.registered.forEach(callback);
      },
    };

    listen<{ level: string; target: string; message: string }>(
      "voidcord:rust-log",
      ({ payload }) => {
        const prefix = `[Rust:${payload.target}]`;
        if (payload.level === "error") console.error(prefix, payload.message);
        else if (payload.level === "warn") console.warn(prefix, payload.message);
        else if (payload.level === "info") console.info(prefix, payload.message);
        else console.debug(prefix, payload.message);
      },
    ).then(unsub => unsubs.push(unsub));

    listen<{ status: "connecting" | "connected" | "reconnecting"; detail?: string }>(
      "discord:gateway_status",
      ({ payload }) => {
        setGatewayStatus(navigator.onLine ? payload.status : "offline");
        if (payload.status === "connected") notifySystem("Connected to Discord");
        else if (payload.status === "reconnecting") notifySystem("Reconnecting to Discord");
      },
    ).then(unsub => unsubs.push(unsub));

    listen<any>("discord:voice_state_update", ({ payload }) => {
      if (typeof payload?.user_id === "string") {
        const guildId = payload.guild_id == null ? null : String(payload.guild_id);
        const channelId = payload.channel_id == null ? null : String(payload.channel_id);
        setGatewayVoiceStates(previous => {
          const remaining = previous.filter(state =>
            !(state.user_id === payload.user_id && (state.guild_id ?? null) === guildId)
          );
          if (!channelId) return remaining;
          return [...remaining, { ...payload, guild_id: guildId, channel_id: channelId }].slice(-2048);
        });
      }
      const handshake = voiceHandshakeRef.current;
      const eventGuildId = payload?.guild_id == null ? null : String(payload.guild_id);
      if (
        !handshake
        || payload?.user_id !== me?.id
        || eventGuildId !== handshake.guildId
        || String(payload?.channel_id || "") !== handshake.channelId
      ) return;
      if (typeof payload.session_id === "string" && payload.session_id) {
        handshake.sessionId = payload.session_id;
        void connectVoiceFromGateway();
      }
    }).then(unsub => unsubs.push(unsub));

    listen<any>("discord:voice_server_update", ({ payload }) => {
      const handshake = voiceHandshakeRef.current;
      const eventGuildId = payload?.guild_id == null ? null : String(payload.guild_id);
      const eventChannelId = payload?.channel_id == null ? null : String(payload.channel_id);
      if (
        !handshake
        || eventGuildId !== handshake.guildId
        || (handshake.guildId === null && eventChannelId !== handshake.channelId)
      ) return;
      if (
        typeof payload.endpoint === "string"
        && payload.endpoint
        && typeof payload.token === "string"
        && payload.token
      ) {
        handshake.endpoint = payload.endpoint;
        handshake.token = payload.token;
        void connectVoiceFromGateway();
      }
    }).then(unsub => unsubs.push(unsub));

    const onPrivateCall = ({ payload }: { payload: any }) => {
      const channelId = typeof payload?.channel_id === "string" ? payload.channel_id : "";
      if (!channelId) return;
      setPrivateVoiceCalls(previous => new Set(previous).add(channelId));
      const ringingIds = Array.isArray(payload?.ringing) ? payload.ringing.map((entry: any) => typeof entry === "string" ? entry : String(entry?.id || entry?.user_id || "")) : [];
      if (me?.id && ringingIds.includes(me.id)) setIncomingCallChannels(previous => ({ ...previous, [channelId]: payload }));
      if (Array.isArray(payload.voice_states)) {
        setGatewayVoiceStates(previous => {
          const states = (payload.voice_states as GatewayVoiceState[])
            .filter(state => typeof state?.user_id === "string")
            .map(state => ({
              ...state,
              guild_id: null,
              channel_id: channelId,
            }));
          const participants = new Set(states.map(state => state.user_id));
          return [
            ...previous.filter(state =>
              state.guild_id != null
              || state.channel_id !== channelId
              || !participants.has(state.user_id)
            ),
            ...states,
          ].slice(-2048);
        });
      }
    };
    listen<any>("discord:call_create", onPrivateCall).then(unsub => unsubs.push(unsub));
    listen<any>("discord:call_update", onPrivateCall).then(unsub => unsubs.push(unsub));
    listen<any>("discord:call_delete", ({ payload }) => {
      const channelId = typeof payload?.channel_id === "string" ? payload.channel_id : "";
      if (channelId) {
        setIncomingCallChannels(previous => { const next = { ...previous }; delete next[channelId]; return next; });
        setPrivateVoiceCalls(previous => {
          const next = new Set(previous);
          next.delete(channelId);
          return next;
        });
        setGatewayVoiceStates(previous => previous.filter(state =>
          state.guild_id != null || state.channel_id !== channelId
        ));
      }
    }).then(unsub => unsubs.push(unsub));

    listen<any>("discord:voice_channel_status_update", ({ payload }) => {
      const channelId = String(payload?.channel_id || payload?.id || "");
      if (!channelId) return;
      const status = typeof payload?.status === "string" ? payload.status : "";
      setChannels(previous => previous.map(channel =>
        channel.id === channelId ? { ...channel, status: status || null } : channel
      ));
      setSelectedChannel(previous =>
        previous?.id === channelId ? { ...previous, status: status || null } : previous
      );
    }).then(unsub => unsubs.push(unsub));

    listen<{ status: "connecting" | "connected" | "failed" | "disconnected"; message?: string }>(
      "discord:voice_status",
      ({ payload }) => {
        if (payload.status === "disconnected" && voiceHandshakeRef.current) return;
        setVoiceStatus(payload.status);
        if (payload.message) setVoiceStatusMessage(payload.message);
        if (payload.status === "failed" && payload.message) notify(payload.message);
      },
    ).then(unsub => unsubs.push(unsub));

    listen<{ channel_id: string; message: DiscordMessage }>(
      "discord:message_create",
      ({ payload }) => {
        const channelHistory = messageHistoryRef.current[payload.channel_id] || [];
        if (!channelHistory.some(message => message.id === payload.message.id)) {
          const updatedHistory = [...channelHistory, payload.message].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          messageHistoryRef.current[payload.channel_id] = updatedHistory;
          void writeCachedMessages(payload.channel_id, [payload.message])
            .catch(error => notify(`Could not cache message: ${error}`));
          void archiveMessageMedia(payload.message);
        }
        if (payload.message?.author?.id === me?.id) {
          setRecentlyMessaged(order => [payload.channel_id, ...order.filter(id => id !== payload.channel_id)]);
        } else if (payload.channel_id !== selectedChannel?.id || (isDmView && activeDmTab !== "chat")) {
          setUnreadByChannel(previous => {
            const next = { ...previous, [payload.channel_id]: (previous[payload.channel_id] || 0) + 1 };
            try { localStorage.setItem("voidcord:unread-channels", JSON.stringify(next)); } catch { /* optional cache */ }
            return next;
          });
        }

        setDmChannels(prevDms => {
          const index = prevDms.findIndex(dm => dm.id === payload.channel_id);
          if (index === -1) return prevDms;
          const targetDm = { ...prevDms[index], last_message_id: payload.message.id };
          const filtered = prevDms.filter(dm => dm.id !== payload.channel_id);
          return [targetDm, ...filtered];
        });

        if (payload.channel_id === selectedChannel?.id) {
          setMessages(prev => {
            if (prev.some(message => message.id === payload.message.id)) return prev;
            return [...prev, payload.message];
          });
          if (payload.message?.author?.id === me?.id) scrollToBottom();
        }
      }
    ).then(u => unsubs.push(u));

    listen<{ channel_id: string; message: DiscordMessage }>(
      "discord:message_update",
      ({ payload }) => {
        void (async () => {
          const cached = messageHistoryRef.current[payload.channel_id] || [];
          let previous = cached.find(message => message.id === payload.message.id);
          if (!previous) {
            previous = (await readCachedMessages(payload.channel_id).catch(() => undefined))
              ?.find(message => message.id === payload.message.id);
          }
          const changed = !!previous && (
            previous.content !== payload.message.content
            || JSON.stringify(previous.attachments || []) !== JSON.stringify(payload.message.attachments || [])
            || JSON.stringify(previous.embeds || []) !== JSON.stringify(payload.message.embeds || [])
          );
          if (previous && changed) {
            const editedAt = payload.message.edited_timestamp ? new Date(payload.message.edited_timestamp).getTime() : Date.now();
            const id = `${payload.message.id}:${editedAt}:${Math.random().toString(36).slice(2, 8)}`;
            const channel = dmChannels.find(item => item.id === payload.channel_id)
              || channels.find(item => item.id === payload.channel_id)
              || (selectedChannelRef.current?.id === payload.channel_id ? selectedChannelRef.current : undefined);
            const entry: EditedMessageLog = {
              id,
              messageId: previous.id,
              channelId: payload.channel_id,
              channelName: channel ? channelDisplayName(channel) : payload.channel_id,
              editedAt,
              message: previous,
            };
            try {
              await archiveMessageMedia({ ...previous, id });
              await writeEditedMessage(entry);
              if (messageLoggerOpen && messageLoggerMode === "edited") setEditedLogs(logs => [entry, ...logs.filter(item => item.id !== entry.id)]);
            } catch (error) {
              notify(`Could not save edited message history: ${error}`);
            }
          }

          const nextMessage = previous
            ? { ...previous, ...payload.message, deleted_at: previous.deleted_at }
            : payload.message;
          const existing = messageHistoryRef.current[payload.channel_id] || [];
          messageHistoryRef.current[payload.channel_id] = existing.some(message => message.id === payload.message.id)
            ? existing.map(message => message.id === payload.message.id ? nextMessage : message)
            : [...existing, nextMessage].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          void writeCachedMessages(payload.channel_id, [nextMessage])
            .catch(error => notify(`Could not cache edited message: ${error}`));
          if (payload.channel_id === selectedChannelRef.current?.id) {
            setMessages(prev => prev.map(message => message.id === payload.message.id ? nextMessage : message));
          }
        })();
      }
    ).then(u => unsubs.push(u));

    listen<{ channel_id: string; message_id: string; message?: DiscordMessage }>(
      "discord:message_delete",
      ({ payload }) => {
        const deletedAt = Date.now();
        if (payload.channel_id === selectedChannel?.id) {
          setMessages(previous => previous.map(message =>
            message.id === payload.message_id ? { ...message, deleted_at: message.deleted_at || deletedAt } : message
          ));
        }
        void (async () => {
          let deleted = payload.message
            || messageHistoryRef.current[payload.channel_id]?.find(message => message.id === payload.message_id);
          if (!deleted) {
            const cached = await readCachedMessages(payload.channel_id).catch(error => {
              console.warn("Could not look up deleted message in local cache", error);
              return undefined;
            });
            deleted = cached?.find(message => message.id === payload.message_id);
          }

          const archivePromise = messageArchivePromisesRef.current.get(payload.message_id);
          if (deleted) {
            deleted = { ...deleted, deleted_at: deleted.deleted_at || deletedAt };
            if (archivePromise) await archivePromise;
            else await archiveMessageMedia(deleted);
            const channel = dmChannels.find(item => item.id === payload.channel_id)
              || channels.find(item => item.id === payload.channel_id)
              || (selectedChannel?.id === payload.channel_id ? selectedChannel : undefined);
            const entry: DeletedMessageLog = {
              id: deleted.id,
              channelId: payload.channel_id,
              channelName: channel ? channelDisplayName(channel) : payload.channel_id,
              deletedAt,
              message: deleted,
            };
            try {
              await writeDeletedMessage(entry);
              if (messageLoggerOpen) setDeletedLogs(previous => [entry, ...previous.filter(item => item.id !== entry.id)]);
            } catch (error) {
              notify(`Could not save deleted message to the local log: ${error}`);
            }
            const history = messageHistoryRef.current[payload.channel_id] || [];
            const inHistory = history.some(message => message.id === payload.message_id);
            messageHistoryRef.current[payload.channel_id] = inHistory
              ? history.map(message => message.id === payload.message_id ? deleted! : message)
              : [...history, deleted].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            if (payload.channel_id === selectedChannel?.id) {
              setMessages(previous => {
                const found = previous.some(message => message.id === payload.message_id);
                return found
                  ? previous.map(message => message.id === payload.message_id ? deleted! : message)
                  : [...previous, deleted!].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
              });
            }
            await markCachedMessageDeleted(payload.channel_id, payload.message_id, deletedAt, deleted)
              .catch(error => notify(`Could not mark deleted message in local cache: ${error}`));
          } else {
            console.info(`Deleted message ${payload.message_id} was not in local cache; content unavailable to log`);
          }
        })();
      }
    ).then(u => unsubs.push(u));

    listen<{ channel_id: string; user_id: string }>(
      "discord:typing_start",
      ({ payload }) => {
        if (payload.channel_id !== selectedChannel?.id) return;
        setTypingUsers(s => { const n = new Set(s); n.add(payload.user_id); return n; });
        setTimeout(() => {
          setTypingUsers(s => { const n = new Set(s); n.delete(payload.user_id); return n; });
        }, 8000);
      }
    ).then(u => unsubs.push(u));

    listen<DiscordChannel>("discord:channel_delete", ({ payload }) => {
      if (!payload?.id) return;
      const guild = guilds.find(item => item.id === payload.guild_id)
        || (selectedGuild?.id === payload.guild_id ? selectedGuild : undefined);
      const entry: DeletedChannelLog = {
        id: payload.id,
        deletedAt: Date.now(),
        guildId: payload.guild_id,
        guildName: guild?.name,
        channel: payload,
      };
      void writeDeletedChannel(entry)
        .then(() => {
          if (deletedChannelViewerOpen) {
            setDeletedChannelLogs(previous => [entry, ...previous.filter(item => item.id !== entry.id)]);
          }
        })
        .catch(error => notify(`Could not save deleted channel metadata: ${error}`));
      setChannels(previous => previous.filter(channel => channel.id !== payload.id));
    }).then(u => unsubs.push(u));

    const applyPresenceUpdates = (presences: any[]) => {
      const updates = presences.filter((presence: any) =>
        presence?.user?.id && typeof presence.status === "string"
      );
      if (updates.length === 0) return;

      setMemberPresences(previous => {
        const next = { ...previous };
        for (const presence of updates) next[presence.user.id] = presence.status;
        return next;
      });
      setMemberPlatforms(previous => {
        const next = { ...previous };
        for (const presence of updates) next[presence.user.id] = platformsFromPresence(presence);
        return next;
      });
      setMemberCustomStatuses(previous => {
        const next = { ...previous };
        for (const presence of updates) {
          next[presence.user.id] = presence.activities?.find((activity: any) => activity.type === 4)?.state || "";
        }
        return next;
      });

      const ownPresence = updates.find((presence: any) => presence.user.id === me?.id);
      if (ownPresence) {
        const customStatus = ownPresence.activities?.find((activity: any) => activity.type === 4)?.state || "";
        setSelfPresence({ status: ownPresence.status, customStatus });
      }
    };

    listen<any>("discord:presence_update", ({ payload }) => {
      applyPresenceUpdates([payload]);
    }).then(u => unsubs.push(u));

    listen<any>("discord:gateway_ready", ({ payload }) => {
      if (typeof payload?.session_id === "string") setGatewaySessionId(payload.session_id);
      const guild = selectedGuildRef.current;
      if (!guild) return;
      const channelIds = channels
        .filter(channel => isTextChannel(channel) && getChannelPermissions(
          channel,
          guild.id,
          me?.id || "",
          currentGuildMemberRolesRef.current,
          guildRoleDataRef.current,
          !!guild.owner
        )?.canView !== false)
        .map(channel => channel.id);
      void invoke("request_guild_member_list", { guildId: guild.id, channelIds })
        .catch(error => console.warn("Could not request guild members after gateway reconnect", error));
    }).then(u => unsubs.push(u));

    const mergeGatewayMembers = (guildId: string, incoming: any[], removedIds: string[] = []) => {
      if (guildId !== selectedGuildRef.current?.id) return;
      const removed = new Set(removedIds);
      const byId = new Map<string, any>();
      for (const member of guildMembersRef.current) {
        const id = member?.user?.id || member?.id;
        if (id && !removed.has(id)) byId.set(id, member);
      }
      for (const member of incoming) {
        const id = member?.user?.id || member?.id;
        if (id && !removed.has(id)) {
          const existing = byId.get(id);
          byId.set(id, {
            ...existing,
            ...member,
            user: { ...existing?.user, ...member.user },
            roles: member.roles ?? existing?.roles,
          });
        }
      }
      const merged = [...byId.values()];
      guildMembersRef.current = merged;
      setGuildMembers(merged);
      pendingGuildDataRef.current.set(guildId, {
        channels,
        roles: guildRoles,
        memberRoles: currentGuildMemberRolesRef.current,
        guildMembers: merged,
      });
      if (pendingGuildDataTimerRef.current === null) {
        pendingGuildDataTimerRef.current = window.setTimeout(() => {
          pendingGuildDataTimerRef.current = null;
          const pending = [...pendingGuildDataRef.current.entries()];
          pendingGuildDataRef.current.clear();
          for (const [pendingGuildId, data] of pending) {
            void writeCachedAppData(`guild-data:${pendingGuildId}`, data)
              .catch(error => console.warn("Could not cache gateway guild members", error));
          }
        }, 250);
      }
    };

    listen<any>("discord:guild_member_list_update", ({ payload }) => {
      const items = (payload?.ops || []).flatMap((operation: any) => operation?.items || []);
      const incoming = items
        .map((item: any) => item?.member)
        .filter((member: any) => member?.user?.id);
      const presences = items
        .map((item: any) => item?.presence || item?.member?.presence)
        .filter((presence: any) => presence?.user?.id && typeof presence.status === "string");
      applyPresenceUpdates(presences);
      void mergeGatewayMembers(payload?.guild_id || "", incoming);
    }).then(u => unsubs.push(u));

    listen<any>("discord:guild_create", ({ payload }) => {
      if (Array.isArray(payload?.members)) {
        void mergeGatewayMembers(payload.id || "", payload.members);
      }
      if (Array.isArray(payload?.presences)) {
        applyPresenceUpdates(payload.presences);
      }
    }).then(u => unsubs.push(u));

    listen<any>("discord:guild_member_add", ({ payload }) => {
      if (payload?.user?.id) void mergeGatewayMembers(payload.guild_id || "", [payload]);
    }).then(u => unsubs.push(u));

    listen<any>("discord:guild_member_update", ({ payload }) => {
      if (payload?.user?.id) void mergeGatewayMembers(payload.guild_id || "", [payload]);
    }).then(u => unsubs.push(u));

    listen<any>("discord:guild_member_remove", ({ payload }) => {
      const userId = payload?.user?.id;
      if (userId) void mergeGatewayMembers(payload.guild_id || "", [], [userId]);
    }).then(u => unsubs.push(u));

    return () => {
      subscriptionsDisposed = true;
      unsubs.forEach(unsubscribe => unsubscribe());
      unsubs.registered.length = 0;
    };
  }, [selectedChannel?.id, scrollToBottom, me?.id, dmChannels, channels, guildRoles, selectedChannel, selectedGuild, guilds, isDmView, activeDmTab, archiveMessageMedia, messageLoggerOpen, messageLoggerMode, deletedChannelViewerOpen, notify, notifySystem, connectVoiceFromGateway]);

  const selectGuild = async (guild: DiscordGuild, preferredChannelId?: string) => {
    if (!guild?.id || typeof guild.name !== "string") {
      console.warn("Ignored a server selection without a valid guild ID");
      return;
    }
    const requestId = ++guildLoadRequest.current;
    ++channelLoadRequest.current;
    olderMessagesLoadingRef.current = false;
    hasOlderMessagesRef.current = false;
    setOlderMessagesLoading(false);
    setHasOlderMessages(false);
    setSelectedGuild(guild);
    selectedGuildRef.current = guild;
    setSelectedChannel(null);
    setMessages([]);
    setMsgLoading(false);
    setChannels([]);
    setGuildMembers([]);
    guildMembersRef.current = [];
    setGuildRoles([]);
    setMemberPresences({});
    setMemberPlatforms({});
    setMemberCustomStatuses({});
    guildRoleDataRef.current = [];
    currentGuildMemberRolesRef.current = [];

    const cacheKey = `guild-data:${guild.id}`;
    const cachedGuildData = await readCachedAppData<{
      channels: DiscordChannel[];
      roles: any[];
      memberRoles: string[];
      guildMembers?: any[];
    }>(cacheKey).catch(() => undefined);
    if (requestId !== guildLoadRequest.current) return;
    let cachedMembers = cachedGuildData?.guildMembers || [];
    if (cachedGuildData) {
      const cachedChannels = (cachedGuildData.channels || []).filter(channel => channel?.id);
      const roles = (cachedGuildData.roles || []).filter(role => role?.id);
      const memberRoles = cachedGuildData.memberRoles || [];
      cachedMembers = cachedMembers.filter(member => member?.user?.id || member?.id);
      setChannels(cachedChannels);
      setGuildMembers(cachedMembers);
      guildMembersRef.current = cachedMembers;
      setGuildRoles(roles);
      guildRoleDataRef.current = roles;
      currentGuildMemberRolesRef.current = memberRoles;
      setKnownLockedChannels(new Set(cachedChannels.filter(channel =>
        getChannelPermissions(channel, guild.id, me?.id || "", memberRoles, roles, !!guild.owner)?.canView === false
      ).map(channel => channel.id)));
      const cachedTarget = preferredChannelId
        ? cachedChannels.find(channel => channel.id === preferredChannelId && isTextChannel(channel))
        : cachedChannels.find(isTextChannel);
      if (cachedTarget) void selectChannel(cachedTarget);
    }
    if (!navigator.onLine) {
      if (!cachedGuildData) notify("No cached server channels are available while offline");
      return;
    }

    try {
      await new Promise(resolve => window.setTimeout(resolve, 300));
      if (requestId !== guildLoadRequest.current) return;
      const list = await invoke<DiscordChannel[]>("get_channels", { guildId: guild.id });
      if (requestId !== guildLoadRequest.current) return;
      const sorted = (Array.isArray(list) ? list : [])
        .filter(channel => channel?.id)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const rolesAndMember = cachedGuildData
        ? [
            { status: "fulfilled", value: cachedGuildData.roles || [] },
            { status: "fulfilled", value: { roles: cachedGuildData.memberRoles || [] } },
          ] as const
        : await Promise.allSettled([
            invoke<any[]>("get_guild_roles", { guildId: guild.id }),
            invoke<{ roles?: string[] }>("get_current_guild_member", { guildId: guild.id }),
          ]);
      const [rolesResult, currentMemberResult] = rolesAndMember;
      if (requestId !== guildLoadRequest.current) return;
      if (requestId !== guildLoadRequest.current) return;
      if (rolesResult.status === "fulfilled") {
        const roles = Array.isArray(rolesResult.value) ? rolesResult.value.filter(role => role?.id) : [];
        guildRoleDataRef.current = roles;
        setGuildRoles(roles);
      } else {
        console.warn("Could not load guild roles for channel permissions", rolesResult.reason);
      }
      if (currentMemberResult.status === "fulfilled") {
        const roles = currentMemberResult.value?.roles || [];
        currentGuildMemberRolesRef.current = roles;
      } else {
        console.warn("Could not load current member roles for channel permissions", currentMemberResult.reason);
      }

      const roles = guildRoleDataRef.current;
      const memberRoles = currentGuildMemberRolesRef.current;
      if (requestId !== guildLoadRequest.current) return;
      setChannels(sorted);
      setKnownLockedChannels(new Set(sorted.filter(channel =>
        getChannelPermissions(channel, guild.id, me?.id || "", memberRoles, roles, !!guild.owner)?.canView === false
      ).map(channel => channel.id)));
      void writeCachedAppData(cacheKey, { channels: sorted, roles, memberRoles, guildMembers: cachedMembers })
        .catch(error => notify(`Could not cache server channel metadata: ${error}`));

      const memberListChannels = sorted
        .filter(channel => isTextChannel(channel) && getChannelPermissions(
          channel, guild.id, me?.id || "", memberRoles, roles, !!guild.owner
        )?.canView !== false)
        .map(channel => channel.id);
      void invoke("request_guild_member_list", { guildId: guild.id, channelIds: memberListChannels })
        .catch(error => console.warn("Could not request guild members over the gateway", error));

      const target = preferredChannelId
        ? sorted.find(channel => channel.id === preferredChannelId && isTextChannel(channel))
        : sorted.find(isTextChannel);
      if (target && requestId === guildLoadRequest.current) await selectChannel(target);
    } catch (e) {
      if (requestId !== guildLoadRequest.current) return;
      notify(`Failed to load server data: ${e}`);
    }
  };

  const activeMembers = useMemo(() => {
    if (isDmView && selectedChannel?.type === CHANNEL_TYPE_GROUP_DM) {
      return selectedChannel.recipients || [];
    }
    return guildMembers;
  }, [isDmView, selectedChannel, guildMembers]);

  const voiceParticipants = useMemo(() => {
    if (!selectedChannel || (!isVoiceChannel(selectedChannel) && !isPrivateCallChannel(selectedChannel))) return [];
    const users = new Map<string, { state: GatewayVoiceState; user: DiscordUser | undefined }>();
    for (const state of gatewayVoiceStates) {
      if (state.channel_id !== selectedChannel.id) continue;
      const userId = state.user_id;
      const guildMember = guildMembers.find(member => (member?.user?.id || member?.id) === userId);
      const user = state.member?.user
        || state.user
        || guildMember?.user
        || selectedChannel.recipients?.find(recipient => recipient.id === userId)
        || (userId === me?.id ? me : undefined);
      users.set(userId, { state, user });
    }
    return [...users.values()].sort((a, b) =>
      Number(a.state.self_mute || a.state.self_deaf) - Number(b.state.self_mute || b.state.self_deaf)
      || (a.state.member?.nick || a.user?.global_name || a.user?.username || "")
        .localeCompare(b.state.member?.nick || b.user?.global_name || b.user?.username || "")
    );
  }, [gatewayVoiceStates, guildMembers, me, selectedChannel]);

  const memberRoleGroups = useMemo(() => {
    if (isDmView) {
      return activeMembers.length ? [{ id: "group-members", name: "GROUP MEMBERS", position: 0, members: activeMembers }] : [];
    }
    const rolesById = new Map<string, { id: string; name?: string; position?: number }>(
      guildRoles.filter((role): role is { id: string; name?: string; position?: number } =>
        typeof role?.id === "string"
      ).map(role => [role.id, role])
    );
    const groups = new Map<string, { name: string; position: number; members: any[] }>();
    for (const member of activeMembers) {
      const user = member?.user || member;
      if (!user?.id) continue;
      const roleIds: string[] = Array.isArray(member?.roles)
        ? member.roles.filter((roleId: unknown): roleId is string => typeof roleId === "string")
        : [];
      const topRole = roleIds
        .map(roleId => rolesById.get(roleId))
        .filter((role): role is { id: string; name?: string; position?: number } => !!role)
        .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))[0];
      const roleId = topRole?.id || selectedGuild?.id || "everyone";
      const group = groups.get(roleId) || {
        name: topRole?.name || "@everyone",
        position: topRole?.position ?? -1,
        members: [],
      };
      group.members.push(member);
      groups.set(roleId, group);
    }
    return [...groups.entries()]
      .sort(([, a], [, b]) => b.position - a.position || a.name.localeCompare(b.name))
      .map(([id, group]) => ({
        id,
        ...group,
        members: [...group.members].sort((a, b) => {
          const aUser = a?.user || a;
          const bUser = b?.user || b;
          const aOnline = (memberPresences[aUser.id] || "offline") !== "offline";
          const bOnline = (memberPresences[bUser.id] || "offline") !== "offline";
          if (aOnline !== bOnline) return aOnline ? -1 : 1;
          const aName = a.nick || aUser.global_name || aUser.username || "";
          const bName = b.nick || bUser.global_name || bUser.username || "";
          return aName.localeCompare(bName, undefined, { sensitivity: "base" });
        }),
      }));
  }, [activeMembers, guildRoles, isDmView, memberPresences, selectedGuild?.id]);

  const forwardTargets = useMemo(() => {
    const candidates = [
      ...dmChannels.filter(channel => channel.type === CHANNEL_TYPE_DM || channel.type === CHANNEL_TYPE_GROUP_DM),
      ...channels.filter(channel => isTextChannel(channel) && channel.id !== selectedChannel?.id),
    ];
    return candidates.filter(channel => {
      if (!channel.id || channel.id === forwardTarget?.channel.id) return false;
      if (!channel.guild_id) return true;
      return getChannelPermissions(
        channel,
        channel.guild_id,
        me?.id || "",
        currentGuildMemberRolesRef.current,
        guildRoleDataRef.current,
        !!guilds.find(guild => guild.id === channel.guild_id)?.owner
      )?.canSend !== false;
    });
  }, [channels, dmChannels, forwardTarget?.channel.id, guilds, me?.id, selectedChannel?.id]);

  const selectChannel = async (channel: DiscordChannel) => {
    if (isVoiceChannel(channel) && voiceHandshakeRef.current?.channelId !== channel.id) {
      void joinVoiceChannel(channel);
    } else if (!isMessageChannel(channel) && !isVoiceChannel(channel)) {
      return;
    }
    try {
      localStorage.setItem("voidcord:last-read-channel", JSON.stringify({
        channelId: channel.id,
        ...(channel.guild_id ? { guildId: channel.guild_id } : {}),
      }));
    } catch {
      // Channel restoration is an optional local convenience.
    }
    const requestId = ++channelLoadRequest.current;
    olderMessagesLoadingRef.current = false;
    hasOlderMessagesRef.current = false;
    setOlderMessagesLoading(false);
    setHasOlderMessages(false);
    setSelectedChannel(channel);
    setEditingMessageId(null);
    setMessages([]);
    setUnreadByChannel(previous => {
      if (!previous[channel.id]) return previous;
      const next = { ...previous };
      delete next[channel.id];
      try { localStorage.setItem("voidcord:unread-channels", JSON.stringify(next)); } catch { /* optional cache */ }
      return next;
    });
    const permissionGuild = selectedGuildRef.current;
    const permissions = channel.guild_id && permissionGuild?.id === channel.guild_id && me?.id
      ? getChannelPermissions(
        channel,
        channel.guild_id,
        me.id,
        currentGuildMemberRolesRef.current,
        guildRoleDataRef.current,
        !!permissionGuild.owner,
      )
      : { canView: true, canSend: true };
    setChannelAccess(permissions?.canView === false ? "MISSING_ACCESS" : permissions?.canSend === false ? "MISSING_PERMS" : "ok");
    setCanSend(permissions?.canSend !== false);
    setOfflineCache(false);
    setCacheReadyChannel(null);
    setDraftReadyChannel(null);
    if (permissions?.canView === false) {
      setMsgLoading(false);
      setKnownLockedChannels(previous => new Set(previous).add(channel.id));
      return;
    }
    setKnownLockedChannels(previous => {
      if (!previous.has(channel.id)) return previous;
      const next = new Set(previous);
      next.delete(channel.id);
      return next;
    });
    const cachedDraft = await readCachedDraft(channel.id).catch(() => "");
    if (requestId !== channelLoadRequest.current) return;
    setDraft(cachedDraft);
    setDraftReadyChannel(channel.id);
    const cachedMessages = await readCachedMessages(channel.id).catch(() => undefined);
    if (requestId !== channelLoadRequest.current) return;
    if (cachedMessages) {
      messageHistoryRef.current[channel.id] = cachedMessages;
      setMessages(cachedMessages);
      cachedMessages.forEach(message => void archiveMessageMedia(message));
      setCacheReadyChannel(channel.id);
      setMsgLoading(false);
      scrollToBottom();
    }
    if (!navigator.onLine) {
      messageHistoryRef.current[channel.id] = cachedMessages || [];
      setMessages(cachedMessages || []);
      (cachedMessages || []).forEach(message => void archiveMessageMedia(message));
      setCacheReadyChannel(channel.id);
      setOfflineCache(true);
      setMsgLoading(false);
      return;
    }
    setMsgLoading(!cachedMessages);
    try {
      const msgs = await invoke<DiscordMessage[]>("get_messages", { channelId: channel.id });
      if (requestId !== channelLoadRequest.current) return;
      const onlineIds = new Set(msgs.map(message => message.id));
      const oldestOnlineTimestamp = msgs[0] ? new Date(msgs[0].timestamp).getTime() : Number.POSITIVE_INFINITY;
      const olderCachedMessages = msgs.length === 0
        ? []
        : (cachedMessages || []).filter(message =>
          !onlineIds.has(message.id) && new Date(message.timestamp).getTime() < oldestOnlineTimestamp
        );
      const mergedById = new Map(olderCachedMessages.map(message => [message.id, message]));
      msgs.forEach(message => mergedById.set(message.id, message));
      const refreshedMessages = [...mergedById.values()].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      messageHistoryRef.current[channel.id] = refreshedMessages;
      setMessages(refreshedMessages);
      msgs.forEach(message => void archiveMessageMedia(message));
      hasOlderMessagesRef.current = msgs.length === 50;
      setHasOlderMessages(msgs.length === 50);
      setCacheReadyChannel(channel.id);
      setKnownLockedChannels(prev => { const next = new Set(prev); next.delete(channel.id); return next; });
      setOfflineCache(false);
      if (!cachedMessages) scrollToBottom();
    } catch (e: any) {
      if (requestId !== channelLoadRequest.current) return;
      const errStr = String(e);
      if (errStr.includes("MISSING_ACCESS")) {
        setChannelAccess("MISSING_ACCESS");
        setCanSend(false);
        setMessages([]);
        setKnownLockedChannels(prev => new Set(prev).add(channel.id));
      } else if (errStr.includes("MISSING_PERMS")) {
        setChannelAccess("MISSING_PERMS");
        setCanSend(false);
        messageHistoryRef.current[channel.id] = cachedMessages || [];
        setMessages(cachedMessages || []);
        (cachedMessages || []).forEach(message => void archiveMessageMedia(message));
        setCacheReadyChannel(channel.id);
        setKnownLockedChannels(prev => { const next = new Set(prev); next.delete(channel.id); return next; });
      } else {
        if (cachedMessages) {
          messageHistoryRef.current[channel.id] = cachedMessages;
          setMessages(cachedMessages);
          cachedMessages.forEach(message => void archiveMessageMedia(message));
          setCacheReadyChannel(channel.id);
          setOfflineCache(true);
          notify("Discord is unreachable; showing messages saved on this device");
        } else {
          setMessages([]);
          setOfflineCache(true);
          notify(`Offline and no cached messages are available: ${errStr}`);
        }
      }
    } finally {
      if (requestId === channelLoadRequest.current) setMsgLoading(false);
    }
  };

  const loadOlderMessages = async () => {
    const channel = selectedChannel;
    const firstMessageId = messages[0]?.id;
    const requestId = channelLoadRequest.current;
    const scrollElement = listRef.current;
    if (
      !channel
      || !firstMessageId
      || !scrollElement
      || !hasOlderMessagesRef.current
      || olderMessagesLoadingRef.current
      || !navigator.onLine
    ) return;

    olderMessagesLoadingRef.current = true;
    setOlderMessagesLoading(true);
    const previousHeight = scrollElement.scrollHeight;
    const previousTop = scrollElement.scrollTop;
    try {
      const older = await invoke<DiscordMessage[]>("get_messages", {
        channelId: channel.id,
        before: firstMessageId,
      });
      if (requestId !== channelLoadRequest.current || channel.id !== selectedChannel?.id) return;

      const existingIds = new Set(messages.map(message => message.id));
      const uniqueOlder = older.filter(message => !existingIds.has(message.id));
      hasOlderMessagesRef.current = older.length === 50;
      setHasOlderMessages(older.length === 50);
      if (uniqueOlder.length > 0) {
        uniqueOlder.forEach(message => void archiveMessageMedia(message));
        messageHistoryRef.current[channel.id] = [...uniqueOlder, ...(messageHistoryRef.current[channel.id] || messages)];
        setMessages(previous => {
          const previousIds = new Set(previous.map(message => message.id));
          return [...uniqueOlder.filter(message => !previousIds.has(message.id)), ...previous];
        });
        requestAnimationFrame(() => {
          if (listRef.current && channel.id === selectedChannel?.id) {
            listRef.current.scrollTop = previousTop + listRef.current.scrollHeight - previousHeight;
          }
        });
      }
    } catch (error) {
      if (requestId === channelLoadRequest.current) notify(`Could not load older messages: ${error}`);
    } finally {
      if (requestId === channelLoadRequest.current) {
        olderMessagesLoadingRef.current = false;
        setOlderMessagesLoading(false);
      }
    }
  };

  const jumpToChannel = async (channelId: string) => {
    let target = channels.find(channel => channel.id === channelId);
    let targetGuild = target?.guild_id
      ? guilds.find(guild => guild.id === target?.guild_id)
      : selectedGuild;

    if (!target) {
      for (const guild of guilds) {
        const cached = await readCachedAppData<{ channels: DiscordChannel[] }>(`guild-data:${guild.id}`)
          .catch(() => undefined);
        target = cached?.channels.find(channel => channel.id === channelId);
        if (target) {
          targetGuild = guild;
          break;
        }
      }
    }

    if (!target && navigator.onLine) {
      const results = await Promise.allSettled(guilds.map(guild =>
        invoke<DiscordChannel[]>("get_channels", { guildId: guild.id })
      ));
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        if (result.status !== "fulfilled") continue;
        const guildChannels = result.value;
        const guild = guilds[index];
        if (guildChannels.some(channel => channel.id === channelId)) {
          target = guildChannels.find(channel => channel.id === channelId);
          targetGuild = guild;
          break;
        }
      }
    }

    if (!target || !targetGuild) {
      notify("That channel isn't available in your cached or accessible servers");
      return;
    }

    setIsDmView(false);
    if (selectedGuildRef.current?.id !== targetGuild.id) {
      await selectGuild(targetGuild);
      if (selectedGuildRef.current?.id !== targetGuild.id) return;
    }
    await selectChannel(target);
  };

  useEffect(() => {
    const recipient = isDmView && selectedChannel?.type === CHANNEL_TYPE_DM
      ? selectedChannel.recipients?.find(user => user.id !== me?.id)
      : undefined;
    if (!recipient) {
      setDmProfileData(null);
      setDmProfileLoading(false);
      return;
    }

    let cancelled = false;
    setDmProfileLoading(true);
    setDmProfileData(null);
    invoke<any>("get_user_profile", { userId: recipient.id })
      .then(profile => {
        if (!cancelled) setDmProfileData(profile);
      })
      .catch(error => {
        if (!cancelled) {
          setDmProfileData(null);
          notify(`Could not load DM profile: ${error}`);
        }
      })
      .finally(() => {
        if (!cancelled) setDmProfileLoading(false);
      });
    return () => { cancelled = true; };
  }, [isDmView, selectedChannel?.id, me?.id, notify]);

  const handleOpenMemberProfile = async (userObj: any, openFullProfile = false) => {
    if (ignoredUserIds.has(userObj.id)) {
      setRevealedIgnoredProfileIds(current => { const next = new Set(current); next.delete(userObj.id); return next; });
    }
    setSelectedMemberProfile(userObj);
    setMemberProfileData(null);
    setFullProfileOpen(false);
    setMemberProfileLoading(true);
    try {
      const prof = await invoke<any>("get_user_profile", { userId: userObj.id });
      setMemberProfileData(prof);
      if (openFullProfile) setFullProfileOpen(true);
    } catch (e) {
      console.error("Failed to load member profile", e);
      notify(`Failed to load profile: ${e}`);
    } finally {
      setMemberProfileLoading(false);
    }
  };

  const refreshRelationships = async () => {
    const list = await invoke<DiscordRelationship[]>("get_relationships");
    setRelationships(list.filter(relationship => relationship.user));
  };

  const refreshMessageRequests = async () => {
    const requests = await invoke<DiscordChannel[]>("get_message_requests");
    setMessageRequests(requests);
    setMessageRequestsError("");
  };

  const loadRequestMessages = async (channel: DiscordChannel) => {
    setSelectedMessageRequest(channel);
    setRequestMessages([]);
    setRequestMessagesError("");
    setRequestMessagesLoading(true);
    try {
      const list = await invoke<DiscordMessage[]>("get_messages", { channelId: channel.id });
      setRequestMessages(list);
    } catch (e) {
      setRequestMessagesError(String(e));
    } finally {
      setRequestMessagesLoading(false);
    }
  };

  const updateMessageRequest = async (channel: DiscordChannel, action: "accept" | "ignore") => {
    setRequestBusy(channel.id);
    try {
      await invoke("update_message_request", { channelId: channel.id, action });
      setMessageRequests(previous => previous.filter(request => request.id !== channel.id));
      if (selectedMessageRequest?.id === channel.id) {
        setSelectedMessageRequest(null);
        setRequestMessages([]);
        setRequestMessagesError("");
      }
      if (action === "accept") {
        setDmChannels(previous => [channel, ...previous.filter(item => item.id !== channel.id)]);
        setActiveDmTab("chat");
        await selectChannel(channel);
      }
      notify(action === "accept" ? "Message request accepted" : "Message request ignored");
    } catch (e) {
      notify(`Could not ${action} message request: ${e}`);
      try {
        await refreshMessageRequests();
      } catch (refreshError) {
        setMessageRequestsError(`Could not refresh message requests: ${refreshError}`);
      }
    } finally {
      setRequestBusy(null);
    }
  };

  const changeRelationship = async (userId: string, action: "accept" | "ignore" | "add" | "remove" | "block" | "unblock") => {
    setRelationshipBusy(userId);
    try {
      await invoke("update_relationship", { userId, action });
      await refreshRelationships();
      notify(action === "accept" || action === "add" ? "Friend added" : action === "ignore" ? "Request ignored" : action === "block" ? "User blocked" : action === "unblock" ? "User unblocked" : "Friend removed");
    } catch (e) {
      notify(`Could not update friend: ${e}`);
    } finally {
      setRelationshipBusy(null);
    }
  };

  const toggleIgnoredUser = (userId: string) => {
    const next = new Set(ignoredUserIds);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setIgnoredUserIds(next);
    try { localStorage.setItem("voidcord:ignored-users", JSON.stringify([...next])); } catch { /* optional local preference */ }
    setRevealedIgnoredProfileIds(current => { const updated = new Set(current); updated.delete(userId); return updated; });
    notify(next.has(userId) ? "User ignored on this device" : "User unignored");
  };

  const openDiscordReportFlow = async (userId?: string, message?: DiscordMessage, channel?: DiscordChannel) => {
    const reportUrl = "https://discord.com/safety/360044103651-reporting-abusive-behavior-to-discord";
    try {
      if (message && channel) {
        await navigator.clipboard.writeText(`https://discord.com/channels/${channel.guild_id || "@me"}/${channel.id}/${message.id}`);
        notify("Message link copied. Discord’s report guide is opening.");
      } else if (userId) {
        await navigator.clipboard.writeText(userId);
        notify("User ID copied. Discord’s report guide is opening.");
      }
    } catch {
      notify("Opening Discord’s report guide");
    }
    try { await openUrl(reportUrl); }
    catch (error) { notify(`Could not open Discord’s report guide: ${error}`); }
  };

  const sendFriendRequest = async () => {
    const username = friendUsername.trim().replace(/^@/, "");
    if (!username) {
      setFriendSearchError("Enter the exact Discord username to send a request.");
      return;
    }
    setRelationshipBusy("new-friend");
    setFriendSearchError("");
    try {
      await invoke("add_friend", { username });
      setFriendUsername("");
      await refreshRelationships();
      notify(`Friend request sent to ${username}`);
    } catch (e) {
      setFriendSearchError(String(e));
    } finally {
      setRelationshipBusy(null);
    }
  };

  const startDirectMessage = async (user: DiscordUser) => {
    try {
      const dm = await invoke<DiscordChannel>("create_dm", { recipientId: user.id });
      setDmChannels(previous => [dm, ...previous.filter(channel => channel.id !== dm.id)]);
      ++guildLoadRequest.current;
      ++channelLoadRequest.current;
      setIsDmView(true);
      setSelectedGuild(null);
      selectedGuildRef.current = null;
      setActiveDmTab("chat");
      setSelectedMemberProfile(null);
      setFullProfileOpen(false);
      await selectChannel(dm);
    } catch (e) {
      notify(`Could not open direct message: ${e}`);
    }
  };

  const changePresence = async (status: string, customStatus = selfPresence.customStatus) => {
    const previous = selfPresence;
    const next = { status, customStatus: customStatus.trim() };
    setSelfPresence(next);
    try {
      await invoke("set_presence", { status, customStatus: next.customStatus || null });
      try { localStorage.setItem("voidcord:presence", JSON.stringify(next)); } catch { /* optional preference */ }
      return true;
    } catch (e) {
      setSelfPresence(previous);
      notify(`Could not change status: ${e}`);
      return false;
    }
  };

  const saveBio = async () => {
    if (!me) return;
    const bio = bioDraft.trim();
    if ([...bio].length > 190) {
      notify("Bio must be 190 characters or fewer");
      return;
    }

    setBioSaving(true);
    try {
      await invoke("update_bio", { bio });
      const profile = await invoke<any>("get_user_profile", { userId: me.id });
      if (profile) setUserProfile(profile);
      setBioDraft(profile?.user_profile?.bio ?? profile?.user?.bio ?? bio);
      setBioEditing(false);
      notify("Bio updated");
    } catch (error) {
      notify(`Could not update bio: ${error}`);
    } finally {
      setBioSaving(false);
    }
  };

  const toggleOwnProfileCard = async () => {
    if (!me) return;
    if (profileCardOpen) {
      setProfileCardOpen(false);
      return;
    }
    setProfileCardOpen(true);
    setCustomStatusDraft(selfPresence.customStatus);
    setOwnProfileLoading(true);
    const [profileResult, settingsResult] = await Promise.allSettled([
      invoke<any>("get_user_profile", { userId: me.id }),
      invoke<any>("get_current_user_settings"),
    ]);
    if (profileResult.status === "fulfilled" && profileResult.value) {
      setUserProfile(profileResult.value);
    } else if (profileResult.status === "rejected") {
      notify(`Could not load your profile card: ${profileResult.reason}`);
    }
    if (settingsResult.status === "fulfilled") {
      const settings = settingsResult.value;
      const customStatus = typeof settings?.custom_status?.text === "string"
        ? settings.custom_status.text
        : "";
      const status = ["online", "idle", "dnd", "invisible"].includes(settings?.status)
        ? settings.status
        : selfPresence.status;
      const updated = { status, customStatus };
      setSelfPresence(updated);
      setCustomStatusDraft(customStatus);
      try { localStorage.setItem("voidcord:presence", JSON.stringify(updated)); } catch { /* optional preference */ }
    } else {
      notify(`Could not read your custom status: ${settingsResult.reason}`);
    }
    setOwnProfileLoading(false);
  };

  const handleAccountConnected = (user: DiscordUser, token: string, accounts: SavedDiscordAccount[]) => {
    setSavedAccounts(accounts);
    if (!token) return;
    ++guildLoadRequest.current;
    ++channelLoadRequest.current;
    setAccountSwitcherOpen(false);
    setProfileCardOpen(false);
    setIsDmView(true);
    setActiveDmTab("friends");
    setSelectedGuild(null);
    selectedGuildRef.current = null;
    setSelectedChannel(null);
    selectedChannelRef.current = null;
    setChannels([]);
    setDmChannels([]);
    setMessages([]);
    setGuilds([]);
    setGuildMembers([]);
    setGuildRoles([]);
    setRelationships([]);
    setMessageRequests([]);
    setSelectedMessageRequest(null);
    setSelectedDeletedChannel(null);
    setRequestMessages([]);
    setDraft("");
    setComposerFiles([]);
    setEditingMessageId(null);
    setCanSend(true);
    setTypingUsers(new Set());
    messageHistoryRef.current = {};
    try { localStorage.removeItem("voidcord:last-read-channel"); } catch { /* optional navigation preference */ }
    setMe(user);
    setAccountSessionVersion(version => version + 1);
    setGatewayStatus("connecting");
    void writeCachedAppData("current-user", user);
  };

  const sendMessage = async () => {
    const content = draft.trim();
    if ((!content && composerFiles.length === 0) || !selectedChannel || sending) return;
    if (officialDiscordDm) {
      notify("This official Discord conversation is read-only in VoidCord");
      return;
    }
    const sendingChannel = selectedChannel;
    if (editingMessageId) {
      setSending(true);
      try {
        const updated = await invoke<DiscordMessage>("edit_message", {
          channelId: selectedChannel.id,
          messageId: editingMessageId,
          content,
        });
        const nextMessages = messages.map(message => message.id === updated.id ? { ...message, ...updated } : message);
        messageHistoryRef.current[selectedChannel.id] = nextMessages;
        setMessages(nextMessages);
        void writeCachedMessages(selectedChannel.id, nextMessages)
          .catch(error => notify(`Could not cache edited message: ${error}`));
        setDraft("");
        setEditingMessageId(null);
        notify("Message edited");
      } catch (error) {
        notify(`Could not edit message: ${error}`);
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
      return;
    }
    if (content.startsWith("/")) {
      const commandName = content.slice(1).split(/\s/, 1)[0];
      const command = selectedSlashCommand?.name === commandName ? selectedSlashCommand : slashCommands.find(candidate => candidate.name === commandName);
      if (!command) { notify("Pick a command from the slash-command suggestions first."); return; }
      if (!gatewaySessionId) { notify("The Discord gateway session is not ready yet. Reconnect and try again."); return; }
      setSending(true);
      try {
        const rawArguments = content.slice(commandName.length + 1).trim();
        const options = parseSlashCommandOptions(command, rawArguments);
        const nonce = String((BigInt(Date.now()) << 12n) + BigInt(Math.floor(Math.random() * 4096)));
        await invoke("execute_application_command", { channelId: sendingChannel.id, guildId: sendingChannel.guild_id || null, sessionId: gatewaySessionId, command, options, nonce });
        setDraft(""); setSelectedSlashCommand(null); setSlashCommands([]);
        void writeCachedDraft(sendingChannel.id, "");
        notify("/" + command.name + " submitted");
      } catch (error) { notify("Slash command failed: " + error); }
      finally { setSending(false); inputRef.current?.focus(); }
      return;
    }
    setSending(true);
    try {
      const replyToMessageId = replyToMessage?.channel_id === sendingChannel.id ? replyToMessage.id : null;
      const sent = composerFiles.length
        ? await invoke<DiscordMessage>("send_message_with_files", { channelId: sendingChannel.id, content, files: composerFiles.map(file => file.uploadId), replyToMessageId })
        : await invoke<DiscordMessage>("send_message", { channelId: sendingChannel.id, content, replyToMessageId });
      if (sent && sent.id) {
        if (draftRef.current.trim() === content) {
          setDraft("");
          void writeCachedDraft(sendingChannel.id, "");
        }
        setComposerFiles([]);
        setReplyToMessage(null);
        if (selectedChannelRef.current?.id === sendingChannel.id) {
          setMessages(prev => {
            if (prev.some(m => m.id === sent.id)) return prev;
            return [...prev, sent];
          });
          scrollToBottom();
        }
        setRecentlyMessaged(order => [sendingChannel.id, ...order.filter(id => id !== sendingChannel.id)]);
      }
    } catch (e) {
      notify(`Send failed: ${e}`);
    } finally {
      setSending(false);
      if (selectedChannelRef.current?.id === sendingChannel.id) inputRef.current?.focus();
    }
  };

  const toggleMessageReaction = async (
    channelId: string,
    message: DiscordMessage,
    emoji: string,
  ) => {
    const requestKey = `${channelId}:${message.id}:${emoji}`;
    if (reactionRequestsRef.current.has(requestKey)) return;
    reactionRequestsRef.current.add(requestKey);
    const matchesEmoji = (reaction: DiscordReaction) => {
      const existingEmoji = reaction.emoji;
      if (!existingEmoji) return false;
      const value = existingEmoji.id
        ? `${existingEmoji.name || ""}:${existingEmoji.id}`
        : existingEmoji.name || "";
      return value === emoji;
    };
    const existing = message.reactions?.find(matchesEmoji);
    const remove = existing?.me === true;

    try {
      await invoke("react_to_message", {
        channelId,
        messageId: message.id,
        emoji,
        remove,
      });
      const currentHistory = messageHistoryRef.current[channelId] || [];
      const currentMessage = currentHistory.find(item => item.id === message.id) || message;
      const reactions = [...(currentMessage.reactions || [])];
      const index = reactions.findIndex(matchesEmoji);
      if (index >= 0) {
        const reaction = reactions[index];
        const count = Math.max(0, reaction.count + (remove ? -1 : 1));
        if (count === 0) reactions.splice(index, 1);
        else reactions[index] = { ...reaction, count, me: !remove };
      } else if (!remove) {
        const [name, id] = emoji.split(":");
        reactions.push({
          count: 1,
          me: true,
          emoji: id ? { id, name } : { id: null, name: emoji },
        });
      }
      const updatedMessage = { ...currentMessage, reactions };
      messageHistoryRef.current[channelId] = currentHistory.some(item => item.id === message.id)
        ? currentHistory.map(item => item.id === message.id ? updatedMessage : item)
        : [...currentHistory, updatedMessage].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      if (selectedChannelRef.current?.id === channelId) {
        setMessages(previous => previous.map(item =>
          item.id === message.id ? updatedMessage : item
        ));
      }
      void writeCachedMessages(channelId, [updatedMessage])
        .catch(error => notify(`Could not cache message reaction: ${error}`));
    } catch (error) {
      notify(`Could not update reaction: ${error}`);
    } finally {
      reactionRequestsRef.current.delete(requestKey);
    }
  };

  const uploadLimitLabel = `${Math.floor(accountUploadLimitBytes / (1024 * 1024))} MiB`;

  const chooseComposerFiles = async () => {
    try {
      const uploadLimitBytes = await invoke<number>("get_upload_limit");
      setAccountUploadLimitBytes(uploadLimitBytes);
      const selectedLimitLabel = `${Math.floor(uploadLimitBytes / (1024 * 1024))} MiB`;
      const incoming = await invoke<ComposerAttachment[]>("select_attachment_files");
      if (!incoming.length) return;
      const combined = [...composerFiles, ...incoming];
      if (combined.length > 10) {
        notify("You can attach up to 10 files per message");
        return;
      }
      const tooLarge = combined.find(file => file.size > uploadLimitBytes);
      if (tooLarge) {
        notify(`${tooLarge.filename} exceeds this account's ${selectedLimitLabel} file limit`);
        return;
      }
      setComposerFiles(combined);
    } catch (error) {
      notify(`Could not select attachments: ${error}`);
    }
  };

  const insertComposerText = (text: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? start;
    const next = `${draft.slice(0, start)}${text}${draft.slice(end)}`;
    const caret = start + text.length;
    setDraft(next);
    setComposerPicker(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  };

  const insertUserMention = (user: DiscordUser) => {
    if (!mentionQuery) return;
    const mention = `<@${user.id}> `;
    const nextDraft = `${draft.slice(0, mentionQuery.start)}${mention}${draft.slice(mentionCaret)}`;
    const nextCaret = mentionQuery.start + mention.length;
    setDraft(nextDraft);
    setMentionCaret(nextCaret);
    setMentionSelection(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && editingMessageId) {
      event.preventDefault();
      setEditingMessageId(null);
      setDraft("");
      return;
    }
    if (mentionSuggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setMentionSelection(index => (index + (event.key === "ArrowDown" ? 1 : mentionSuggestions.length - 1)) % mentionSuggestions.length);
      return;
    }
    if (mentionSuggestions.length && (event.key === "Tab" || (event.key === "Enter" && mentionQuery))) {
      event.preventDefault();
      insertUserMention(mentionSuggestions[mentionSelection] || mentionSuggestions[0]);
      return;
    }
    if (event.key === "Escape" && mentionQuery) {
      setMentionCaret(0);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const channelTree = useMemo(() => {
    const orderByOwnSend = (items: DiscordChannel[]) => [...items].sort((a, b) => {
      const ai = recentlyMessaged.indexOf(a.id);
      const bi = recentlyMessaged.indexOf(b.id);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      return (a.position ?? 0) - (b.position ?? 0);
    });
    const categories = channels.filter(c => c.type === CHANNEL_TYPE_CATEGORY);
    const uncategorized = orderByOwnSend(channels.filter(
      c => (isTextChannel(c) || isVoiceChannel(c)) && !c.parent_id
    ));
    return {
      uncategorized,
      categories: categories.map(cat => ({
        category: cat,
        children: orderByOwnSend(channels.filter(
          c => c.parent_id === cat.id && (isTextChannel(c) || isVoiceChannel(c))
        )),
      })),
    };
  }, [channels, recentlyMessaged]);

  const orderedDmChannels = useMemo(() => {
    return [...dmChannels].sort((a, b) => {
      const ai = recentlyMessaged.indexOf(a.id);
      const bi = recentlyMessaged.indexOf(b.id);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      return 0;
    });
  }, [dmChannels, recentlyMessaged]);

  const friendRelationships = useMemo(
    () => relationships.filter(relationship => relationship.type === 1),
    [relationships]
  );
  const incomingRequests = useMemo(
    () => relationships.filter(relationship => relationship.type === 3),
    [relationships]
  );
  const outgoingRequests = useMemo(
    () => relationships.filter(relationship => relationship.type === 4),
    [relationships]
  );
  const visibleFriends = useMemo(() => {
    const term = directoryQuery.trim().toLowerCase();
    return friendRelationships.filter(relationship => {
      const user = relationship.user;
      const matchesQuery = !term || `${displayName(user)} ${user.username}`.toLowerCase().includes(term);
      const isOnline = (memberPresences[user.id] || "offline") !== "offline";
      return matchesQuery && (friendView !== "online" || isOnline);
    });
  }, [directoryQuery, friendRelationships, friendView, memberPresences]);
  const mentionUsers = useMemo(() => {
    const allUsers = [
      me,
      ...guildMembers.map(member => member.user || member),
      ...activeMembers.map(member => member.user || member),
      ...friendRelationships.map(relationship => relationship.user),
      ...dmChannels.flatMap(channel => channel.recipients || []),
      ...messages.flatMap(message => [message.author, ...(message.mentions || [])]),
    ].filter((user): user is DiscordUser => !!user?.id);
    return [...new Map(allUsers.map(user => [user.id, user])).values()];
  }, [me, guildMembers, activeMembers, friendRelationships, dmChannels, messages]);
  const mentionQuery = useMemo(() => {
    const beforeCaret = draft.slice(0, mentionCaret);
    const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/);
    return match ? { query: match[2].toLowerCase(), start: beforeCaret.length - match[2].length - 1 } : null;
  }, [draft, mentionCaret]);
  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery) return [];
    return mentionUsers
      .filter(user => {
        const display = (user.global_name || "").toLowerCase();
        return user.username.toLowerCase().includes(mentionQuery.query) || display.includes(mentionQuery.query);
      })
      .slice(0, 8);
  }, [mentionQuery, mentionUsers]);
  const showingDirectory = isDmView
    && (activeDmTab === "friends" || activeDmTab === "friend-requests" || activeDmTab === "message-requests");

  useEffect(() => {
    try { localStorage.setItem("voidcord:recently-messaged", JSON.stringify(recentlyMessaged)); }
    catch { /* no-op */ }
  }, [recentlyMessaged]);

  const toggleCategory = (id: string) =>
    setCollapsedCategories(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const openContextMenu = (event: React.MouseEvent, target: ContextMenuTarget) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      ...target,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 232)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 220)),
    } as ContextMenuState);
  };

  const copyContextValue = async (value: string, label: string) => {
    setContextMenu(null);
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copied`);
    } catch (error) {
      notify(`Could not copy ${label.toLowerCase()}: ${error}`);
    }
  };

  const openContextChannel = (channel: DiscordChannel) => {
    setContextMenu(null);
    if (channel.guild_id) {
      const guild = guilds.find(item => item.id === channel.guild_id);
      setIsDmView(false);
      if (guild && selectedGuildRef.current?.id !== guild.id) {
        void selectGuild(guild, channel.id);
      } else {
        void selectChannel(channel);
      }
      return;
    }
    ++guildLoadRequest.current;
    ++channelLoadRequest.current;
    setIsDmView(true);
    setSelectedGuild(null);
    selectedGuildRef.current = null;
    setActiveDmTab("chat");
    void selectChannel(channel);
  };

  const markChannelRead = (channel: DiscordChannel) => {
    setContextMenu(null);
    setUnreadByChannel(previous => {
      if (!previous[channel.id]) return previous;
      const next = { ...previous };
      delete next[channel.id];
      try {
        localStorage.setItem("voidcord:unread-channels", JSON.stringify(next));
      } catch {
        // Unread state remains updated for this session if storage is unavailable.
      }
      return next;
    });
  };

  const canManageGuildMember = (user: DiscordUser, guildId: string, permissionBit: number) => {
    const guild = guilds.find(item => item.id === guildId);
    if (!guild || user.id === me?.id) return false;
    if (!hasGuildPermission(permissionBit, guildId, currentGuildMemberRolesRef.current, guildRoleDataRef.current, !!guild.owner)) {
      return false;
    }
    if (guild.owner) return true;

    const targetMember = guildMembers.find(member => (member.user?.id || member.id) === user.id);
    if (targetMember?.roles) {
      const highestPosition = (roleIds: string[]) => roleIds.reduce((highest: number, roleId: string) => {
        const role = guildRoleDataRef.current.find(candidate => candidate.id === roleId);
        return Math.max(highest, role?.position ?? 0);
      }, 0);
      if (highestPosition(targetMember.roles) >= highestPosition(currentGuildMemberRolesRef.current)) return false;
    }
    return true;
  };

  const canChangeGuildNickname = (user: DiscordUser, guildId: string) => {
    const guild = guilds.find(item => item.id === guildId);
    if (!guild) return false;
    if (user.id === me?.id) {
      return hasGuildPermission(26, guildId, currentGuildMemberRolesRef.current, guildRoleDataRef.current, !!guild.owner);
    }
    return canManageGuildMember(user, guildId, 27);
  };

  const startEditingMessage = (message: DiscordMessage) => {
    setEditingMessageId(message.id);
    setDraft(message.content);
    setContextMenu(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const deleteMessage = async (message: DiscordMessage, channel: DiscordChannel) => {
    if (!window.confirm(`Delete this message from #${channelDisplayName(channel)}?`)) return;
    setContextBusy(true);
    try {
      await invoke("delete_message", { channelId: channel.id, messageId: message.id });
      notify("Message deleted");
      setContextMenu(null);
    } catch (error) {
      notify(`Could not delete message: ${error}`);
    } finally {
      setContextBusy(false);
    }
  };

  const forwardMessageTo = async (target: DiscordChannel) => {
    if (!forwardTarget || !canForwardMessage(forwardTarget.message)) return;
    setForwardBusy(true);
    let cacheWarning = false;
    try {
      const forwarded = await invoke<DiscordMessage>("forward_message", {
        destinationChannelId: target.id,
        sourceChannelId: forwardTarget.channel.id,
        messageId: forwardTarget.message.id,
      });
      if (!forwarded?.id) throw new Error("Discord did not return the forwarded message");
      const history = target.id === selectedChannel?.id
        ? messageHistoryRef.current[target.id] || messages
        : messageHistoryRef.current[target.id]
          || await readCachedMessages(target.id).catch(error => {
            console.warn("Could not read cached destination messages before adding a forward", error);
            return [];
          });
      const nextHistory = history.some(message => message.id === forwarded.id)
        ? history
        : [...history, forwarded].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
      messageHistoryRef.current[target.id] = nextHistory;
      await writeCachedMessages(target.id, nextHistory).catch(error => {
        console.warn("Forward succeeded, but the local message cache could not be updated", error);
        cacheWarning = true;
      });
      if (selectedChannel?.id === target.id) {
        setMessages(nextHistory);
        scrollToBottom();
      }
      setForwardTarget(null);
      notify(cacheWarning
        ? `Message forwarded to ${channelDisplayName(target)}, but the local cache could not be updated`
        : `Message forwarded to ${channelDisplayName(target)}`);
    } catch (error) {
      notify(`Could not forward message: ${error}`);
    } finally {
      setForwardBusy(false);
    }
  };

  const moderateMember = async (user: DiscordUser, guildId: string, action: "timeout" | "remove_timeout" | "kick" | "ban") => {
    const permissionBit = action === "timeout" || action === "remove_timeout" ? 40 : action === "kick" ? 1 : 2;
    if (!canManageGuildMember(user, guildId, permissionBit)) return;
    let timeoutSeconds: number | undefined;
    if (action === "timeout") {
      const minutes = window.prompt(`Timeout ${displayName(user)} for how many minutes?`, "10");
      if (minutes === null) return;
      const parsedMinutes = Number(minutes);
      if (!Number.isInteger(parsedMinutes) || parsedMinutes < 1 || parsedMinutes > 40_320) {
        notify("Timeout duration must be between 1 minute and 28 days");
        return;
      }
      timeoutSeconds = parsedMinutes * 60;
    } else if (action !== "remove_timeout" && !window.confirm(`${action === "kick" ? "Kick" : "Ban"} ${displayName(user)} from this server?`)) {
      return;
    }

    setContextMenu(null);
    setContextBusy(true);
    try {
      await invoke("moderate_guild_member", {
        guildId,
        userId: user.id,
        action,
        timeoutSeconds: timeoutSeconds ?? null,
      });
      if (action === "kick" || action === "ban") {
        setGuildMembers(previous => previous.filter(member => (member.user?.id || member.id) !== user.id));
      } else if (action === "timeout" || action === "remove_timeout") {
        setGuildMembers(previous => previous.map(member =>
          (member.user?.id || member.id) === user.id
            ? { ...member, communication_disabled_until: action === "timeout"
              ? new Date(Date.now() + (timeoutSeconds || 0) * 1000).toISOString()
              : null }
            : member
        ));
      }
      notify(action === "timeout" ? "Member timed out" : action === "remove_timeout" ? "Member timeout removed" : `Member ${action}ed`);
    } catch (error) {
      notify(`Could not ${action} member: ${error}`);
    } finally {
      setContextBusy(false);
    }
  };

  const changeMemberNickname = async (user: DiscordUser, guildId: string) => {
    if (!canChangeGuildNickname(user, guildId)) return;
    const nickname = window.prompt(`Set a server nickname for ${displayName(user)} (leave blank to clear):`);
    if (nickname === null) return;
    setContextMenu(null);
    setContextBusy(true);
    try {
      const updated = await invoke<any>("set_guild_member_nickname", {
        guildId,
        userId: user.id,
        nickname: nickname.trim() || null,
      });
      setGuildMembers(previous => previous.map(member =>
        (member.user?.id || member.id) === user.id
          ? { ...member, nick: updated?.nick ?? (nickname.trim() || null) }
          : member
      ));
      notify("Server nickname updated");
    } catch (error) {
      notify(`Could not change nickname: ${error}`);
    } finally {
      setContextBusy(false);
    }
  };

  const editChannel = async (channel: DiscordChannel) => {
    const name = window.prompt("Channel name:", channel.name || "");
    if (name === null) return;
    const topic = window.prompt("Channel topic:", channel.topic || "");
    if (topic === null) return;
    setContextMenu(null);
    setContextBusy(true);
    try {
      const updated = await invoke<DiscordChannel>("update_guild_channel", {
        channelId: channel.id,
        name: name.trim(),
        topic,
      });
      const nextChannels = channels.map(item => item.id === channel.id ? { ...item, ...updated } : item);
      setChannels(nextChannels);
      if (selectedChannel?.id === channel.id) {
        setSelectedChannel(previous => previous ? { ...previous, ...updated } : previous);
      }
      if (channel.guild_id) {
        void writeCachedAppData(`guild-data:${channel.guild_id}`, {
          channels: nextChannels,
          roles: guildRoles,
          memberRoles: currentGuildMemberRolesRef.current,
        }).catch(error => notify(`Could not cache channel changes: ${error}`));
      }
      notify("Channel updated");
    } catch (error) {
      notify(`Could not edit channel: ${error}`);
    } finally {
      setContextBusy(false);
    }
  };

  const setChannelLocked = async (channel: DiscordChannel, locked: boolean) => {
    const guildId = channel.guild_id;
    if (!guildId) return;
    const lockPreferenceKey = `voidcord:channel-lock:${channel.id}`;
    const everyoneOverwrite = channel.permission_overwrites?.find(overwrite => overwrite.type === 0 && overwrite.id === guildId);
    let restoreSendPermission = false;
    try {
      if (locked) {
        restoreSendPermission = (BigInt(everyoneOverwrite?.allow || "0") & (1n << 11n)) !== 0n;
        localStorage.setItem(lockPreferenceKey, JSON.stringify({ restoreSendPermission }));
      } else {
        restoreSendPermission = JSON.parse(localStorage.getItem(lockPreferenceKey) || "null")?.restoreSendPermission === true;
      }
    } catch (error) {
      notify(`Could not preserve channel permissions while changing its lock state: ${error}`);
      return;
    }
    setContextMenu(null);
    setContextBusy(true);
    try {
      await invoke("set_guild_channel_locked", { channelId: channel.id, guildId, locked, restoreSendPermission });
      let allow = BigInt(everyoneOverwrite?.allow || "0");
      let deny = BigInt(everyoneOverwrite?.deny || "0");
      const sendMessages = 1n << 11n;
      if (locked) {
        allow &= ~sendMessages;
        deny |= sendMessages;
      } else {
        deny &= ~sendMessages;
        if (restoreSendPermission) allow |= sendMessages;
      }
      const updated = { ...channel, permission_overwrites: [
        ...(channel.permission_overwrites || []).filter(overwrite => !(overwrite.type === 0 && overwrite.id === guildId)),
        {
          id: guildId,
          type: 0,
          allow: allow.toString(),
          deny: deny.toString(),
        },
      ] };
      const nextChannels = channels.map(item => item.id === channel.id ? updated : item);
      setChannels(nextChannels);
      if (!locked) {
        try {
          localStorage.removeItem(lockPreferenceKey);
        } catch (error) {
          notify(`Channel is unlocked, but its saved lock preference could not be cleared: ${error}`);
        }
      }
      if (selectedChannel?.id === channel.id) {
        setSelectedChannel(updated);
        const guild = guilds.find(item => item.id === guildId);
        const permissions = getChannelPermissions(
          updated,
          guildId,
          me?.id || "",
          currentGuildMemberRolesRef.current,
          guildRoleDataRef.current,
          !!guild?.owner,
        );
        setCanSend(permissions?.canSend !== false);
      }
      if (channel.guild_id) {
        void writeCachedAppData(`guild-data:${channel.guild_id}`, {
          channels: nextChannels,
          roles: guildRoles,
          memberRoles: currentGuildMemberRolesRef.current,
        }).catch(error => notify(`Could not cache channel permissions: ${error}`));
      }
      notify(locked ? "Channel locked for @everyone" : "Channel unlocked for @everyone");
    } catch (error) {
      if (locked) {
        try {
          localStorage.removeItem(lockPreferenceKey);
        } catch (storageError) {
          console.warn("Could not clear failed channel lock preference", storageError);
        }
      }
      notify(`Could not update channel lock: ${error}`);
    } finally {
      setContextBusy(false);
    }
  };

  const deleteChannel = async (channel: DiscordChannel) => {
    if (!window.confirm(`Permanently delete #${channelDisplayName(channel)}? This cannot be undone.`)) return;
    setContextMenu(null);
    setContextBusy(true);
    try {
      await invoke("delete_guild_channel", { channelId: channel.id });
      const nextChannels = channels.filter(item => item.id !== channel.id);
      setChannels(nextChannels);
      if (selectedChannel?.id === channel.id) {
        ++channelLoadRequest.current;
        setSelectedChannel(null);
        setMessages([]);
        setEditingMessageId(null);
        setDraft("");
      }
      if (channel.guild_id) {
        void writeCachedAppData(`guild-data:${channel.guild_id}`, {
          channels: nextChannels,
          roles: guildRoles,
          memberRoles: currentGuildMemberRolesRef.current,
        }).catch(error => notify(`Could not cache deleted channel state: ${error}`));
      }
      notify("Channel deleted");
    } catch (error) {
      notify(`Could not delete channel: ${error}`);
    } finally {
      setContextBusy(false);
    }
  };

  const filteredMessages = useMemo(() =>
    messages.filter(message => !query || (message.content || "").toLowerCase().includes(query.toLowerCase())),
    [messages, query]
  );

  const groups = useMemo(() => groupMessages(filteredMessages, ignoredUserIds), [filteredMessages, ignoredUserIds]);
  const ignoredMessageCount = useMemo(() => messages.filter(message => ignoredUserIds.has(message.author?.id || "")).length, [messages, ignoredUserIds]);
  const orderedGuilds = useMemo(() => {
    const order = new Map(preferences.serverOrder.map((id, index) => [id, index]));
    const original = new Map(guilds.map((guild, index) => [guild.id, index]));
    return [...guilds].sort((a, b) => (order.get(a.id) ?? (preferences.serverOrder.length + (original.get(a.id) || 0))) - (order.get(b.id) ?? (preferences.serverOrder.length + (original.get(b.id) || 0))));
  }, [guilds, preferences.serverOrder]);
  const officialDiscordDm = !!selectedChannel && !selectedChannel.guild_id &&
    !!selectedChannel.recipients?.some(user => user?.bot && user.username?.toLowerCase() === "discord");
  const selectedVoiceChannel = selectedChannel && (
    isVoiceChannel(selectedChannel)
    || (isPrivateCallChannel(selectedChannel) && (
      privateVoiceCalls.has(selectedChannel.id)
      || activeVoiceChannel?.id === selectedChannel.id
      || gatewayVoiceStates.some(state => state.guild_id == null && state.channel_id === selectedChannel.id)
    ))
  ) ? selectedChannel : null;

  const beginSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setSidebarResizing(true);
    const move = (pointer: PointerEvent) => setPreferences(current => ({
      ...current,
      channelSidebarWidth: Math.max(180, Math.min(360, pointer.clientX - 58)),
    }));
    const stop = () => {
      setSidebarResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };
  const selectedProfileBio = memberProfileData?.user?.bio || memberProfileData?.user_profile?.bio || "";
  const selectedProfileRoleColor = !isDmView && selectedMemberProfile
    ? getUserRoleColor(selectedMemberProfile.id, guildMembers, guildRoles)
    : undefined;
  const selectedProfileIsFriend = !!selectedMemberProfile
    && friendRelationships.some(relationship => relationship.user.id === selectedMemberProfile.id);
  const selectedProfileIsBlocked = !!selectedMemberProfile
    && relationships.some(relationship => relationship.user?.id === selectedMemberProfile.id && relationship.type === 2);

  if (authLoading) {
    return (
      <div className="splash">
        <div className="splash-logo">V</div>
        <Loader2 size={22} className="spinning" style={{ color: "var(--accent-bright)" }} />
      </div>
    );
  }

  if (!me) {
    return <LoginScreen onLogin={(user, accounts) => {
      setMe(user);
      setSavedAccounts(accounts);
      void writeCachedAppData("current-user", user);
    }} />;
  }

  return (
    <main className={`app dark accent-${preferences.accent} ${settingsTheme === "light" ? "settings-theme-light" : ""} ${preferences.compactMessages ? "compact-messages" : ""} ${preferences.reduceMotion ? "reduce-motion" : ""} ${sidebarResizing ? "sidebar-resizing" : ""}`} style={{ "--chat-font-size": `${14 * preferences.chatFontScale / 100}px` } as React.CSSProperties}>
      {accountSwitcherOpen && <AccountSwitcher activeUser={me} accounts={savedAccounts} onClose={() => setAccountSwitcherOpen(false)} onConnected={handleAccountConnected} />}
      {!online && (
        <div className="top-net-banner">
          <WifiOff size={13} />
          <span>No internet connection</span>
        </div>
      )}
      {online && gatewayStatus !== "connected" && (
        <div className={`gateway-status-banner ${gatewayStatus}`}>
          {gatewayStatus === "offline"
            ? <WifiOff size={13} />
            : <Loader2 size={13} className="spinning" />}
          <span>{gatewayStatus === "reconnecting" ? "Reconnecting to Discord gateway…" : "Connecting to Discord gateway…"}</span>
        </div>
      )}

      {/* Titlebar */}
      <header className="titlebar" data-tauri-drag-region onMouseDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("titlebar-drag-handle")) getCurrentWindow().startDragging(); }}>
        <div className="titlebar-brand" data-tauri-drag-region>
          <div className="titlebar-logo">V</div>
          <span className="titlebar-name">VoidCord</span>
          <span className="build-tag">PREVIEW</span>
          <span className={`gateway-status-indicator ${gatewayStatus}`} title={`Discord gateway ${gatewayStatus}`} role="status">
            <span className="gateway-status-dot" />
            {gatewayStatus === "connected" ? "Connected" : gatewayStatus === "reconnecting" ? "Reconnecting" : gatewayStatus === "offline" ? "Offline" : "Connecting"}
          </span>
        </div>
        <div className="titlebar-drag-handle" data-tauri-drag-region />
        <div className="window-controls">
          <button title="Dev Console" className="dev-console-btn" onClick={() => invoke("toggle_devtools")}><Terminal size={12} /></button>
          <button title="Minimize" onClick={() => getCurrentWindow().minimize()}>─</button>
          <button title="Maximize" onClick={() => getCurrentWindow().toggleMaximize()}>□</button>
          <button className="close-btn-wc" title="Close" onClick={() => getCurrentWindow().close()}><X size={13} /></button>
        </div>
      </header>

      {Object.keys(incomingCallChannels).length > 0 && (() => {
        const incomingId = Object.keys(incomingCallChannels)[0];
        const incomingChannel = dmChannels.find(channel => channel.id === incomingId);
        if (!incomingChannel) return null;
        const caller = incomingChannel.recipients?.find(user => user.id !== me.id);
        return <div className="incoming-call-banner" role="status">
          <div className="incoming-call-copy"><Phone size={17} /><span><strong>Incoming call</strong><small>{caller ? displayName(caller) : channelDisplayName(incomingChannel)}</small></span></div>
          <button type="button" className="incoming-call-accept" onClick={() => {
            setIncomingCallChannels(previous => { const next = { ...previous }; delete next[incomingId]; return next; });
            setIsDmView(true); setActiveDmTab("chat"); void selectChannel(incomingChannel); void joinPrivateCall(incomingChannel);
          }}><Phone size={14} /> Accept</button>
          <button type="button" className="incoming-call-decline" onClick={() => {
            void invoke("decline_private_call", { channelId: incomingId }).then(() => setIncomingCallChannels(previous => { const next = { ...previous }; delete next[incomingId]; return next; })).catch(error => notify("Could not decline call: " + error));
          }}><X size={14} /> Decline</button>
        </div>;
      })()}
      <section className="desktop">
        {/* Server Rail */}
        <nav className="serverrail" aria-label="Servers">
          <div className="server-list-scroll">
            <button
              className={`home-box ${isDmView ? "active" : ""}`}
              title="Direct Messages"
              onClick={() => {
                ++guildLoadRequest.current;
                ++channelLoadRequest.current;
                setIsDmView(true);
                setSelectedGuild(null);
                selectedGuildRef.current = null;
                if (dmChannels.length > 0) {
                  setActiveDmTab("chat");
                  void selectChannel(dmChannels[0]);
                } else {
                  setActiveDmTab("friends");
                  ++channelLoadRequest.current;
                  setSelectedChannel(null);
                  setMessages([]);
                  setMsgLoading(false);
                }
              }}
            >
              <MessageSquare size={20} />
            </button>

            <div className="rail-sep" />

            {orderedGuilds.map((g, i) => {
              const isActive = !isDmView && selectedGuild?.id === g.id;
              const folder = preferences.serverFolders[g.id]?.trim();
              const previous = i > 0 ? preferences.serverFolders[orderedGuilds[i - 1].id]?.trim() : undefined;
              return (
                <React.Fragment key={g.id}>
                  {folder && folder !== previous && <div className="server-folder-label" title={folder}>{folder}</div>}
                  <button
                    className={`server-icon ${isActive ? "active" : ""}`}
                    title={`${folder ? `${folder} · ` : ""}${g.name} (right-click to organize)`}
                    style={{ animationDelay: `${i * 30}ms` } as React.CSSProperties}
                    onContextMenu={event => {
                      event.preventDefault();
                      const nextFolder = window.prompt("Folder name (leave blank for no folder):", preferences.serverFolders[g.id] || "");
                      if (nextFolder !== null) setPreferences(current => ({ ...current, serverFolders: { ...current.serverFolders, [g.id]: nextFolder.trim() } }));
                    }}
                    onClick={() => {
                      setIsDmView(false);
                      void selectGuild(g);
                    }}
                  >
                    <GuildIcon guild={g} />
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          <div className="rail-bottom-tools">
            <button className="settings-btn" title="Add or join a server" onClick={() => {
              setServerDialogMode("join");
              setServerActionError("");
              setServerDialogOpen(true);
            }}>+</button>
            <button className="settings-btn" title="Join a server by invite" onClick={() => {
              setServerDialogMode("join");
              setServerActionError("");
              setServerDialogOpen(true);
            }}><Compass size={16} /></button>
          </div>
        </nav>

        {/* Sidebar */}
        <aside className={`sidebar ${profileCardOpen ? "profile-open" : ""}`} style={{ width: preferences.channelSidebarWidth }}>
          {isDmView ? (
            <>
              <div className="dm-search-header">
                <button className="dm-find-btn" onClick={() => {
                  setActiveDmTab("friends");
                  setFriendView("all");
                  requestAnimationFrame(() => directorySearchRef.current?.focus());
                }}>Find or start a conversation</button>
              </div>

              <div className="sidebar-scroll">
                <div className="dm-nav-section">
                  <button className={`dm-nav-item ${activeDmTab === "friends" ? "active" : ""}`} onClick={() => setActiveDmTab("friends")}><Users size={16} /><span>Friends</span></button>
                  <button className={`dm-nav-item ${activeDmTab === "friend-requests" ? "active" : ""}`} onClick={() => {
                    setActiveDmTab("friend-requests");
                    void refreshRelationships().catch(error => notify(`Could not refresh friend requests: ${error}`));
                  }}><UserPlus size={16} /><span>Friend Requests</span>{incomingRequests.length > 0 && <span className="dm-nav-count">{incomingRequests.length}</span>}</button>
                  <button className={`dm-nav-item ${activeDmTab === "message-requests" ? "active" : ""}`} onClick={() => {
                    setActiveDmTab("message-requests");
                    setMessageRequestsLoading(true);
                    setMessageRequestsError("");
                    void refreshMessageRequests()
                      .catch(error => setMessageRequestsError(String(error)))
                      .finally(() => setMessageRequestsLoading(false));
                  }}><MessageSquare size={16} /><span>Message Requests</span>{messageRequests.length > 0 && <span className="dm-nav-count">{messageRequests.length}</span>}</button>
                  <button className={`dm-nav-item ${activeDmTab === "nitro" ? "active" : ""}`} onClick={() => setActiveDmTab("nitro")}><Flame size={16} /><span>Nitro Home</span></button>
                  <button className={`dm-nav-item ${activeDmTab === "shop" ? "active" : ""}`} onClick={() => setActiveDmTab("shop")}><ShoppingBag size={16} /><span>Shop</span></button>
                  <button className={`dm-nav-item ${activeDmTab === "quests" ? "active" : ""}`} onClick={() => setActiveDmTab("quests")}><Trophy size={16} /><span>Quests</span></button>
                </div>

                <div className="section-caption" style={{ marginTop: 8 }}>DIRECT MESSAGES</div>

                {orderedDmChannels.filter(dm => {
                  if (!directoryQuery.trim()) return true;
                  const user = dm.recipients?.[0];
                  return `${dm.name || ""} ${user ? `${displayName(user)} ${user.username}` : ""}`.toLowerCase().includes(directoryQuery.trim().toLowerCase());
                }).map(dm => {
                  const recipient = dm.recipients?.[0];
                  const name = dm.name || (recipient ? displayName(recipient) : "Direct Message");
                  const isSelected = selectedChannel?.id === dm.id;
                  const recipientStatus = recipient ? (memberPresences[recipient.id] || "offline") : "offline";

                  return (
                    <button key={dm.id} className={`dm-channel-row ${isSelected ? "selected" : ""}`} onContextMenu={event => openContextMenu(event, { kind: "channel", channel: dm })} onClick={() => {
                      setActiveDmTab("chat");
                      void selectChannel(dm);
                    }}>
                      <div className="dm-avatar-wrap">
                        {recipient ? <img src={avatarUrl(recipient, 32)} alt={name} className="dm-avatar" /> : <div className="dm-avatar-fallback">@</div>}
                        {recipient && <AvatarDecorationOverlay user={recipient} />}
                        <span className="dm-status-dot status-online" /> {/* Lưu ý: Chỗ này có thể bản này vẫn giữ hoặc bạn đang muốn check xem nó hoạt động chưa */}
                      </div>
                      <div className="dm-channel-info">
                        <strong className="dm-name">{name}</strong>
                        <span className="dm-activity">
                          {unreadByChannel[dm.id] 
                            ? `${unreadByChannel[dm.id]} unread` 
                            : recipientStatus !== "offline" 
                              ? `Active now (${recipientStatus})` 
                              : "Offline"}
                        </span>
                      </div>
                      {!!unreadByChannel[dm.id] && <span className="channel-unread-count">{unreadByChannel[dm.id] > 99 ? "99+" : unreadByChannel[dm.id]}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <button className="server-heading">
                <span>{selectedGuild?.name ?? "—"}</span>
                <ChevronDown size={14} />
              </button>

              <div className="sidebar-scroll">
                {channelTree.uncategorized.map(c => (
                  <React.Fragment key={c.id}>
                    <ChannelRow channel={c} selected={selectedChannel?.id === c.id} locked={knownLockedChannels.has(c.id)} unread={unreadByChannel[c.id] || 0} onClick={() => selectChannel(c)} onContextMenu={event => openContextMenu(event, { kind: "channel", channel: c })} />
                    {isVoiceChannel(c) && gatewayVoiceStates.filter(state => state.channel_id === c.id).map(state => {
                      const member = guildMembers.find(item => (item?.user?.id || item?.id) === state.user_id);
                      const user = state.member?.user || state.user || member?.user || (state.user_id === me.id ? me : undefined);
                      if (!user) return null;
                      return <button key={`${c.id}:${state.user_id}`} type="button" className="sidebar-voice-member" onClick={() => void handleOpenMemberProfile(user)}>
                        <img src={avatarUrl(user, 24)} alt="" />
                        <span>{state.member?.nick || displayName(user)}</span>
                        {(state.self_mute || state.self_deaf) && <Mic size={12} className="voice-member-muted" />}
                      </button>;
                    })}
                  </React.Fragment>
                ))}

                {channelTree.categories.map(({ category, children }) => {
                  const collapsed = collapsedCategories.has(category.id);
                  return (
                    <div key={category.id}>
                      <button className="section-caption" style={{ width: "100%", display: "flex", alignItems: "center", gap: 4, cursor: "pointer", background: "none", border: "none", color: "inherit" }} onClick={() => toggleCategory(category.id)}>
                        <ChevronRight size={11} style={{ transform: collapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 150ms", color: "var(--text-dim)" }} />
                        {category.name?.toUpperCase()}
                      </button>
                      {!collapsed && children.map(c => (
                        <React.Fragment key={c.id}>
                          <ChannelRow channel={c} selected={selectedChannel?.id === c.id} locked={knownLockedChannels.has(c.id)} unread={unreadByChannel[c.id] || 0} onClick={() => selectChannel(c)} onContextMenu={event => openContextMenu(event, { kind: "channel", channel: c })} />
                          {isVoiceChannel(c) && gatewayVoiceStates.filter(state => state.channel_id === c.id).map(state => {
                            const member = guildMembers.find(item => (item?.user?.id || item?.id) === state.user_id);
                            const user = state.member?.user || state.user || member?.user || (state.user_id === me.id ? me : undefined);
                            if (!user) return null;
                            return <button key={`${c.id}:${state.user_id}`} type="button" className="sidebar-voice-member" onClick={() => void handleOpenMemberProfile(user)}>
                              <img src={avatarUrl(user, 24)} alt="" />
                              <span>{state.member?.nick || displayName(user)}</span>
                              {(state.self_mute || state.self_deaf) && <Mic size={12} className="voice-member-muted" />}
                            </button>;
                          })}
                        </React.Fragment>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* User Profile Bar */}
          <div className="sidebar-user-bar">
            <button className="user-bar-profile-btn" onContextMenu={event => openContextMenu(event, { kind: "user", user: me, source: "profile" })} onClick={() => void toggleOwnProfileCard()} title="User Profile and Status">
              <div className="user-bar-avatar-wrap">
                <img src={avatarUrl(me, 64)} alt={displayName(me)} className="user-bar-avatar" />
                <AvatarDecorationOverlay user={me} />
                <span className={`user-bar-status status-${selfPresence?.status || "offline"}`} />
              </div>
              <div className="user-bar-names">
                <strong className="user-bar-name">{displayName(me)}</strong>
                <span className="user-bar-sub">{selfPresence?.customStatus || "Set a custom status"}</span>
              </div>
            </button>

            <div className="user-bar-controls">
              <button className={`user-bar-btn ${micMuted ? "muted" : ""}`} title={micMuted ? "Unmute" : "Mute"} onClick={() => void updateVoiceControls(!micMuted, deafened)}><Mic size={15} /></button>
              <button className={`user-bar-btn ${deafened ? "deafened" : ""}`} title={deafened ? "Undeafen" : "Deafen"} onClick={() => void updateVoiceControls(micMuted, !deafened)}><Headphones size={15} /></button>
              <button className="user-bar-btn" title="Settings" onClick={() => setProtoSettingsOpen(true)}><Settings size={15} /></button>
            </div>
          </div>
          {profileCardOpen && (
            <div className="profile-popover-card" onContextMenu={event => openContextMenu(event, { kind: "user", user: me, source: "profile" })} onClick={event => event.stopPropagation()}>
              {(() => {
                const profileUser = userProfile?.user || me;
                const profileBanner = bannerUrl(profileUser, 512);
                const profileBio = userProfile?.user_profile?.bio || profileUser.bio || "";
                return (
                  <>
                    <div className="profile-popover-cover" style={{
                      background: profileBanner
                        ? `url(${profileBanner}) center/cover`
                        : profileUser.accent_color
                          ? `linear-gradient(135deg, #${profileUser.accent_color.toString(16).padStart(6, "0")}, #1b1b2b)`
                          : "linear-gradient(135deg, #404b84, #1b1b2b)"
                    }} />
              <div className="profile-popover-content">
                <div className="profile-popover-avatar-wrap">
                  <img src={avatarUrl(profileUser, 96)} alt={displayName(profileUser)} />
                  <AvatarDecorationOverlay user={profileUser} />
                  <span className={`status-dot status-${selfPresence.status === "invisible" ? "offline" : selfPresence.status}`} />
                </div>
                {ownProfileLoading ? (
                  <div className="profile-card-loading"><Loader2 size={14} className="spinning" /> Loading profile…</div>
                ) : (
                  <>
                    <strong>{displayName(profileUser)}</strong>
                    <span className="profile-popover-handle">@{profileUser.username}</span>
                    {userProfile?.badges?.length > 0 && (
                      <div className="profile-popover-badges">
                        {userProfile.badges.map((badge: any) => (
                          <img key={badge.id} src={badge.icon_url || `https://cdn.discordapp.com/badge-icons/${badge.icon}.png`} alt={badge.description} title={badge.description} />
                        ))}
                      </div>
                    )}
                    <div className="profile-status-bubble">
                      <span>{selfPresence.customStatus || "Set a custom status"}</span>
                      <button
                        type="button"
                        aria-label="Edit custom status"
                        title="Edit custom status"
                        onClick={() => {
                          setCustomStatusDraft(selfPresence.customStatus);
                          setCustomStatusEditing(true);
                        }}
                      ><Edit3 size={13} /></button>
                    </div>
                    {profileBio && (
                      <>
                        <p className="profile-popover-bio">{profileBio}</p>
                        <button className="profile-bio-link" onClick={() => {
                          setProfileCardOpen(false);
                          void handleOpenMemberProfile(me, true);
                        }}>View Full Bio</button>
                      </>
                    )}
                    <button
                      type="button"
                      className="profile-bio-link"
                      onClick={() => {
                        setBioDraft(profileBio);
                        setBioEditing(true);
                      }}
                    >Edit bio</button>
                    {bioEditing && (
                      <div className="profile-bio-editor">
                        <textarea
                          aria-label="Profile bio"
                          maxLength={190}
                          rows={4}
                          value={bioDraft}
                          placeholder="Tell people a little about yourself"
                          onChange={event => setBioDraft(event.target.value)}
                        />
                        <div className="profile-bio-editor-footer">
                          <span>{[...bioDraft].length}/190</span>
                          <button type="button" disabled={bioSaving} onClick={() => void saveBio()}>
                            {bioSaving ? "Saving…" : "Save bio"}
                          </button>
                          <button type="button" disabled={bioSaving} onClick={() => {
                            setBioDraft(profileBio);
                            setBioEditing(false);
                          }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
                <label className="profile-status-label" htmlFor="presence-select">Set your status</label>
                <select
                  id="presence-select"
                  className="profile-status-select"
                  value={selfPresence.status}
                  onChange={event => void changePresence(event.target.value)}
                >
                  <option value="online">Online</option>
                  <option value="idle">Idle</option>
                  <option value="dnd">Do Not Disturb</option>
                  <option value="invisible">Invisible</option>
                </select>
                <button className="profile-open-full-btn account-switcher-profile-button" onClick={() => {
                  setProfileCardOpen(false);
                  setAccountSwitcherOpen(true);
                }}><Users size={14} /> Switch accounts</button>
                {customStatusEditing && (
                  <div className="profile-custom-status">
                    <input
                      aria-label="Custom status"
                      maxLength={128}
                      placeholder="Set a custom status"
                      value={customStatusDraft}
                      onChange={event => setCustomStatusDraft(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === "Enter") {
                          void changePresence(selfPresence.status, customStatusDraft).then(saved => {
                            if (saved) setCustomStatusEditing(false);
                          });
                        }
                      }}
                    />
                    <button onClick={() => {
                      void changePresence(selfPresence.status, customStatusDraft).then(saved => {
                        if (saved) setCustomStatusEditing(false);
                      });
                    }}>Save</button>
                    <button className="profile-status-cancel" aria-label="Cancel editing status" onClick={() => {
                      setCustomStatusDraft(selfPresence.customStatus);
                      setCustomStatusEditing(false);
                    }}><X size={14} /></button>
                  </div>
                )}
                <button className="profile-open-full-btn" onClick={() => {
                  setProfileCardOpen(false);
                  void handleOpenMemberProfile(me, true);
                }}>View full profile</button>
              </div>
                  </>
                );
              })()}
            </div>
          )}
          <div className="sidebar-resize-grip" onPointerDown={beginSidebarResize} role="separator" aria-orientation="vertical" aria-label="Resize channel sidebar" />
        </aside>

        {/* Friends and requests */}
        {showingDirectory ? (
          <section className="directory-area">
            <header className="directory-header">
              <div>
                <h2>{activeDmTab === "friend-requests" ? "Friend Requests" : activeDmTab === "message-requests" ? "Message Requests" : "Friends"}</h2>
                <p>{activeDmTab === "friend-requests" ? "Manage incoming and outgoing friend requests." : activeDmTab === "message-requests" ? "Review messages from people who aren't your friends." : `${friendRelationships.length} friends`}</p>
              </div>
              {activeDmTab === "friends" && (
                <button className="directory-add-button" onClick={() => setFriendView(friendView === "add" ? "all" : "add")}>
                  <UserPlus size={15} /> Add Friend
                </button>
              )}
            </header>

            {activeDmTab === "friends" ? (
              <>
                <nav className="friend-filter-tabs" aria-label="Friend filters">
                  <button className={friendView === "online" ? "active" : ""} onClick={() => setFriendView("online")}>Online</button>
                  <button className={friendView === "all" ? "active" : ""} onClick={() => setFriendView("all")}>All</button>
                  <button className={friendView === "add" ? "active" : ""} onClick={() => setFriendView("add")}>Add Friend</button>
                </nav>

                {friendView === "add" ? (
                  <form className="add-friend-form" onSubmit={event => { event.preventDefault(); void sendFriendRequest(); }}>
                    <h3>Add a friend</h3>
                    <p>Enter their exact Discord username to send a friend request.</p>
                    <div className="directory-search">
                      <Search size={16} />
                      <input
                        autoFocus
                        placeholder="Discord username"
                        value={friendUsername}
                        onChange={event => setFriendUsername(event.target.value)}
                      />
                    </div>
                    {friendSearchError && <div className="directory-error">{friendSearchError}</div>}
                    <button type="submit" disabled={relationshipBusy === "new-friend" || !friendUsername.trim()}>
                      {relationshipBusy === "new-friend" ? <Loader2 size={15} className="spinning" /> : <UserPlus size={15} />}
                      Send Friend Request
                    </button>
                  </form>
                ) : (
                  <>
                    <label className="directory-search">
                      <Search size={16} />
                      <input
                        ref={directorySearchRef}
                        placeholder="Search friends and DMs"
                        value={directoryQuery}
                        onChange={event => setDirectoryQuery(event.target.value)}
                      />
                      {directoryQuery && <button type="button" aria-label="Clear search" onClick={() => setDirectoryQuery("")}><X size={14} /></button>}
                    </label>
                    <div className="directory-list-heading">{friendView === "online" ? "ONLINE" : "ALL FRIENDS"} — {visibleFriends.length}</div>
                    <div className="directory-people">
                      {visibleFriends.map(relationship => {
                        const friend = relationship.user;
                        const status = memberPresences[friend.id] || "offline";
                        return (
                          <div className="directory-person" key={friend.id}>
                            <button className="directory-person-main" onContextMenu={event => openContextMenu(event, { kind: "user", user: friend, source: "member" })} onClick={() => void handleOpenMemberProfile(friend)}>
                              <span className="directory-avatar-wrap">
                                <img src={avatarUrl(friend, 48)} alt="" />
                                <AvatarDecorationOverlay user={friend} className="directory-avatar-decoration" />
                                <span className={`status-dot status-${status}`} />
                              </span>
                              <span className="directory-person-name">
                                <strong>{displayName(friend)}</strong>
                                <small>{friend.username}{status !== "offline" ? ` · ${status}` : ""}</small>
                              </span>
                            </button>
                            <div className="directory-person-actions">
                              <button title="Message" onClick={() => void startDirectMessage(friend)}><MessageSquare size={16} /></button>
                              <button title="Remove friend" disabled={relationshipBusy === friend.id} onClick={() => void changeRelationship(friend.id, "remove")}><X size={16} /></button>
                            </div>
                          </div>
                        );
                      })}
                      {visibleFriends.length === 0 && (
                        <div className="directory-empty">{directoryQuery ? "No friends match that search." : "No friends are online right now."}</div>
                      )}
                    </div>
                  </>
                )}
              </>
            ) : activeDmTab === "friend-requests" ? (
              <div className="request-list">
                <nav className="friend-filter-tabs" aria-label="Friend request filters">
                  <button className={friendRequestView === "incoming" ? "active" : ""} onClick={() => setFriendRequestView("incoming")}>Incoming — {incomingRequests.length}</button>
                  <button className={friendRequestView === "outgoing" ? "active" : ""} onClick={() => setFriendRequestView("outgoing")}>Outgoing — {outgoingRequests.length}</button>
                </nav>
                <div className="directory-list-heading">{friendRequestView === "incoming" ? "INCOMING REQUESTS" : "OUTGOING REQUESTS"}</div>
                {friendRequestView === "incoming" && incomingRequests.map(relationship => (
                  <div className="request-person" key={relationship.id}>
                    <span className="request-avatar-wrap">
                      <img src={avatarUrl(relationship.user, 48)} alt="" />
                      <AvatarDecorationOverlay user={relationship.user} />
                    </span>
                    <div className="request-person-info">
                      <strong>{displayName(relationship.user)}</strong>
                      <small>@{relationship.user.username} · Incoming request</small>
                    </div>
                    <div className="request-actions">
                      <button className="request-ignore" disabled={relationshipBusy === relationship.id} onClick={() => void changeRelationship(relationship.id, "ignore")}>Ignore</button>
                      <button className="request-accept" disabled={relationshipBusy === relationship.id} onClick={() => void changeRelationship(relationship.id, "accept")}>
                        {relationshipBusy === relationship.id ? <Loader2 size={14} className="spinning" /> : <Check size={14} />} Accept
                      </button>
                    </div>
                  </div>
                ))}
                {friendRequestView === "outgoing" && outgoingRequests.map(relationship => (
                  <div className="request-person" key={relationship.id}>
                    <span className="request-avatar-wrap">
                      <img src={avatarUrl(relationship.user, 48)} alt="" />
                      <AvatarDecorationOverlay user={relationship.user} />
                    </span>
                    <div className="request-person-info">
                      <strong>{displayName(relationship.user)}</strong>
                      <small>@{relationship.user.username} · Request sent</small>
                    </div>
                    <div className="request-actions">
                      <button className="request-ignore" disabled={relationshipBusy === relationship.id} onClick={() => void changeRelationship(relationship.id, "ignore")}>Cancel</button>
                    </div>
                  </div>
                ))}
                {(friendRequestView === "incoming" ? incomingRequests.length : outgoingRequests.length) === 0 && (
                  <div className="directory-empty">No {friendRequestView} friend requests.</div>
                )}
              </div>
            ) : (
              <div className="message-request-layout">
                <div className="message-request-list">
                  <div className="directory-list-heading">PENDING MESSAGE REQUESTS — {messageRequests.length}</div>
                  {messageRequestsLoading && <div className="directory-empty"><Loader2 size={18} className="spinning" /></div>}
                  {messageRequestsError && <div className="directory-error request-load-error">Could not load message requests: {messageRequestsError}</div>}
                  {!messageRequestsLoading && !messageRequestsError && messageRequests.map(request => {
                    const sender = request.recipients?.[0];
                    const name = sender ? displayName(sender) : request.name || "Unknown user";
                    return (
                      <div key={request.id} className={`message-request-row ${selectedMessageRequest?.id === request.id ? "selected" : ""}`}>
                        <button className="message-request-summary" onClick={() => void loadRequestMessages(request)}>
                          {sender ? (
                            <span className="request-avatar-wrap">
                              <img src={avatarUrl(sender, 48)} alt="" />
                              <AvatarDecorationOverlay user={sender} />
                            </span>
                          ) : <div className="dm-avatar-fallback">@</div>}
                          <span><strong>{name}</strong><small>{sender?.username ? `@${sender.username}` : "Message request"}</small></span>
                        </button>
                        <div className="request-actions">
                          <button className="request-ignore" disabled={requestBusy === request.id} onClick={() => void updateMessageRequest(request, "ignore")}>Ignore</button>
                          <button className="request-accept" disabled={requestBusy === request.id} onClick={() => void updateMessageRequest(request, "accept")}>
                            {requestBusy === request.id ? <Loader2 size={14} className="spinning" /> : <Check size={14} />} Accept
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {!messageRequestsLoading && !messageRequestsError && messageRequests.length === 0 && (
                    <div className="directory-empty">You don't have any pending message requests.</div>
                  )}
                </div>
                <div className="message-request-conversation">
                  {!selectedMessageRequest ? (
                    <div className="directory-empty">Select a request to preview its messages.</div>
                  ) : (
                    <>
                      <header className="request-conversation-header">
                        <strong>{selectedMessageRequest.recipients?.[0]
                          ? displayName(selectedMessageRequest.recipients[0])
                          : selectedMessageRequest.name || "Message Request"}</strong>
                        <div className="request-actions">
                          <button className="request-ignore" disabled={requestBusy === selectedMessageRequest.id} onClick={() => void updateMessageRequest(selectedMessageRequest, "ignore")}>Ignore</button>
                          <button className="request-accept" disabled={requestBusy === selectedMessageRequest.id} onClick={() => void updateMessageRequest(selectedMessageRequest, "accept")}>Accept</button>
                        </div>
                      </header>
                      <div className="request-message-history">
                        {requestMessagesLoading && <div className="directory-empty"><Loader2 size={18} className="spinning" /></div>}
                        {requestMessagesError && <div className="directory-error request-load-error">Could not load request messages: {requestMessagesError}</div>}
                        {!requestMessagesLoading && !requestMessagesError && requestMessages.map(message => (
                          <div className="request-message" key={message.id}>
                            <span className="request-history-avatar-wrap">
                              <img src={avatarUrl(message.author, 40)} alt="" />
                              <AvatarDecorationOverlay user={message.author} />
                            </span>
                            <div className="request-message-body">
                              <div><strong>{displayName(message.author)}</strong><small>{formatTimestamp(message.timestamp)}</small></div>
                              {message.content && <div className="msg-text"><DiscordMarkdown content={message.content} channels={channels} users={mentionUsers} onChannelClick={jumpToChannel} /></div>}
                              {message.embeds?.filter(embed => !!embed && typeof embed === "object").map((embed, index) => <DiscordEmbedView key={`${message.id}-${index}`} embed={embed} attachments={message.attachments} channels={channels} users={mentionUsers} onChannelClick={jumpToChannel} onMediaOpen={showMedia} />)}
                              {message.attachments?.map(attachment => attachment.content_type?.startsWith("image/")
                                ? <img key={attachment.id} src={attachment.url} alt={attachment.filename} className="msg-attachment-img" style={{ maxWidth: 400, maxHeight: 300, borderRadius: 6 }} />
                                : <a key={attachment.id} className="msg-file-link" href={attachment.url}>{attachment.filename}</a>)}
                            </div>
                          </div>
                        ))}
                        {!requestMessagesLoading && !requestMessagesError && requestMessages.length === 0 && (
                          <div className="directory-empty">No messages were returned for this request.</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        ) : (
        /* Chat Area */
        <section className="chat-area">
          <div className="channel-header">
            <div className="header-left">
              {selectedChannel ? (isVoiceChannel(selectedChannel) ? <Volume2 size={18} /> : <Hash size={18} />) : <Hash size={18} />}
              <strong
                className="channel-name"
                onContextMenu={selectedChannel
                  ? event => openContextMenu(event, { kind: "channel", channel: selectedChannel })
                  : undefined}
              >
                {selectedChannel ? channelDisplayName(selectedChannel) : "Select a channel"}
              </strong>
              {selectedChannel?.topic && (
                <>
                  <div className="header-divider" />
                  <span className="desc">
                    <DiscordMarkdown content={selectedChannel.topic} channels={channels} users={mentionUsers} onChannelClick={jumpToChannel} />
                  </span>
                </>
              )}
            </div>
            <div className="header-right">
              {selectedChannel && isPrivateCallChannel(selectedChannel) && (
                <button
                  className={`icon-btn ${privateVoiceCalls.has(selectedChannel.id) ? "active" : ""}`}
                  title={privateVoiceCalls.has(selectedChannel.id) ? "Join voice call" : "Start voice call"}
                  aria-label={privateVoiceCalls.has(selectedChannel.id) ? "Join voice call" : "Start voice call"}
                  disabled={voiceStatus === "connecting" || (
                    voiceStatus === "connected" && activeVoiceChannel?.id === selectedChannel.id
                  )}
                  onClick={() => void joinPrivateCall(selectedChannel)}
                >
                  <Volume2 size={18} />
                </button>
              )}
              <button className="icon-btn" title="Pins"><Pin size={18} /></button>
              <button className={`icon-btn ${memberOpen ? "active" : ""}`} title="Member list" onClick={() => setMemberOpen(v => !v)}><Sparkles size={18} /></button>
              <button className="icon-btn" title="Deleted message log" aria-label="Deleted message log" onClick={() => void openMessageLogger()}><History size={18} /></button>
              <button className="icon-btn" title="Edited message log" aria-label="Edited message log" onClick={() => void openEditedMessageLogger()}><Edit3 size={17} /></button>
              <button className="icon-btn" title="Deleted channel viewer" aria-label="Deleted channel viewer" onClick={() => void openDeletedChannelViewer()}><Archive size={18} /></button>
              <div className="search-box">
                <Search size={13} />
                <input placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} />
              </div>
              <button className="icon-btn" title="More"><MoreHorizontal size={18} /></button>
              <div className="vencord-toolbar"><Wrench size={12} /><span>Vencord</span></div>
            </div>
          </div>

          <div className={`message-scroll ${selectedVoiceChannel ? "voice-channel-scroll" : ""}`} ref={listRef} onScroll={event => {
            if (event.currentTarget.scrollTop <= 72) void loadOlderMessages();
          }}>
            {selectedVoiceChannel && (
              <section className="voice-stage-panel" aria-live="polite">
                <div className="voice-stage-icon"><Volume2 size={30} /></div>
                <h2>{channelDisplayName(selectedVoiceChannel)}</h2>
                {selectedVoiceChannel.status && (
                  <div className="voice-channel-status">{selectedVoiceChannel.status}</div>
                )}
                {selectedVoiceChannel.guild_id && (
                  <button
                    type="button"
                    className="voice-channel-status-edit"
                    onClick={() => void changeVoiceChannelStatus(selectedVoiceChannel)}
                  >
                    <Edit3 size={13} /> {selectedVoiceChannel.status ? "Change channel status" : "Set channel status"}
                  </button>
                )}
                <p className={`voice-stage-status voice-stage-${activeVoiceChannel?.id === selectedVoiceChannel.id ? voiceStatus : "disconnected"}`}>
                  {activeVoiceChannel?.id === selectedVoiceChannel.id
                    ? voiceStatusMessage || "Connecting…"
                    : voiceParticipants.length ? "Call active" : "Not connected"}
                </p>
                <div className="voice-participant-grid">
                  {voiceParticipants.map(({ state, user }) => (
                    <button
                      type="button"
                      className="voice-participant-card"
                      key={`${selectedVoiceChannel.id}:${state.user_id}`}
                      onClick={() => user && void handleOpenMemberProfile(user)}
                    >
                      {user
                        ? <span className="voice-participant-avatar"><img src={avatarUrl(user, 96)} alt="" /><AvatarDecorationOverlay user={user} /></span>
                        : <span className="voice-participant-avatar voice-participant-fallback"><Users size={26} /></span>}
                      <strong>{state.member?.nick || (user ? displayName(user) : "Connecting…")}</strong>
                      <small>{state.self_mute || state.self_deaf ? "Muted" : "In voice"}</small>
                    </button>
                  ))}
                  {voiceParticipants.length === 0 && (
                    <div className="voice-participant-empty">
                      {activeVoiceChannel?.id === selectedVoiceChannel.id && voiceStatus === "connected"
                        ? "You're connected. Waiting for others to join…"
                        : "No one is in this voice channel yet."}
                    </div>
                  )}
                </div>
                <div className="voice-device-selectors">
                  <label>
                    <span>Microphone</span>
                    <select
                      value={selectedInputDeviceId}
                      onChange={event => updateVoiceDeviceSelection("input", event.target.value)}
                    >
                      <option value="">System default</option>
                      {selectedInputDeviceId && !audioDevices.inputs.some(device => device.id === selectedInputDeviceId) && (
                        <option value={selectedInputDeviceId} disabled>Previously selected device unavailable</option>
                      )}
                      {audioDevices.inputs.map(device => (
                        <option key={device.id} value={device.id}>{device.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Speakers</span>
                    <select
                      value={selectedOutputDeviceId}
                      onChange={event => updateVoiceDeviceSelection("output", event.target.value)}
                    >
                      <option value="">System default</option>
                      {selectedOutputDeviceId && !audioDevices.outputs.some(device => device.id === selectedOutputDeviceId) && (
                        <option value={selectedOutputDeviceId} disabled>Previously selected device unavailable</option>
                      )}
                      {audioDevices.outputs.map(device => (
                        <option key={device.id} value={device.id}>{device.name}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="voice-device-refresh"
                    title="Refresh audio devices"
                    aria-label="Refresh audio devices"
                    disabled={audioDevicesLoading}
                    onClick={() => void refreshAudioDevices()}
                  >
                    <RotateCcw size={14} className={audioDevicesLoading ? "spinning" : ""} />
                  </button>
                </div>
                <p className="voice-device-hint">Device changes apply the next time you join voice.</p>
                {voiceStatus === "connected" && activeVoiceChannel?.id === selectedVoiceChannel.id ? (
                  <button type="button" className="voice-stage-leave" onClick={() => void leaveVoiceChannel()}>
                    Disconnect
                  </button>
                ) : (
                  <button
                    type="button"
                    className="voice-stage-join"
                    disabled={voiceStatus === "connecting" && voiceHandshakeRef.current?.channelId === selectedVoiceChannel.id}
                    onClick={() => void (
                      isVoiceChannel(selectedVoiceChannel)
                        ? joinVoiceChannel(selectedVoiceChannel)
                        : joinPrivateCall(selectedVoiceChannel)
                    )}
                  >
                    {voiceStatus === "connecting" && voiceHandshakeRef.current?.channelId === selectedVoiceChannel.id
                      ? <><Loader2 size={15} className="spinning" /> Connecting…</>
                      : isVoiceChannel(selectedVoiceChannel) ? "Join voice" : "Join call"}
                  </button>
                )}
                {voiceStatus === "connected" && activeVoiceChannel?.id === selectedVoiceChannel.id && (
                  <div className="voice-stage-controls">
                    <button type="button" className={micMuted ? "active" : ""} onClick={() => void updateVoiceControls(!micMuted, deafened)}>
                      <Mic size={16} /> {micMuted ? "Unmute" : "Mute"}
                    </button>
                    <button type="button" className={deafened ? "active" : ""} onClick={() => void updateVoiceControls(micMuted, !deafened)}>
                      <Headphones size={16} /> {deafened ? "Undeafen" : "Deafen"}
                    </button>
                  </div>
                )}
              </section>
            )}
            {olderMessagesLoading && (
              <div className="older-messages-indicator" role="status">
                <Loader2 size={15} className="spinning" /> Loading older messages…
              </div>
            )}
            {offlineCache && channelAccess !== "MISSING_ACCESS" && (
              <div className="offline-cache-note"><WifiOff size={14} /> Offline copy · messages saved on this device</div>
            )}
            {ignoredMessageCount > 0 && <div className="ignored-messages-note">{ignoredMessageCount} ignored {ignoredMessageCount === 1 ? "message is" : "messages are"} hidden · Show reveals one message</div>}
            {msgLoading && (
              <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
                <Loader2 size={22} className="spinning" style={{ color: "var(--text-muted)" }} />
              </div>
            )}

            {!msgLoading && channelAccess === "MISSING_ACCESS" && (
              <div className="locked-channel-screen">
                <div className="locked-channel-lock">🔒</div>
                <h2>This is a hidden text channel</h2>
                <p>You do not have permission to view this channel's messages.</p>
                <div className="locked-channel-meta">
                  <span>Last message created: <strong>{snowflakeTime(selectedChannel?.last_message_id) || "Unknown"}</strong></span>
                  <span>Last message pin: <strong>{selectedChannel?.last_pin_timestamp ? new Date(selectedChannel.last_pin_timestamp).toLocaleString() : "No pin timestamp"}</strong></span>
                </div>
                {!!selectedChannel?.permission_overwrites?.length && (
                  <div className="locked-roles">
                    <strong>Allowed users and roles</strong>
                    <div>
                      {selectedChannel.permission_overwrites.filter(o => (BigInt(o.allow || "0") & (1n << 10n)) !== 0n).map(o => {
                        const roleObj = o.type === 0 ? guildRoles.find((r: any) => r.id === o.id) : null;
                        const label = roleObj ? roleObj.name : (o.type === 0 ? `Role · ${o.id}` : `Member · ${o.id}`);
                        const rColor = roleObj ? roleColorToHex(roleObj.color) : undefined;
                        return (
                          <span key={`${o.type}-${o.id}`} style={{ borderColor: rColor, color: rColor || "inherit" }}>
                            {label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="message-bottom-spacer" />
            {!msgLoading && groups.map((group, gi) => {
              const first = group[0];
              const isMe = first.author.id === me.id;
              const imgUrl = avatarUrl(first.author, 64);

              return (
                <div className="msg-group" key={`g-${gi}`}>
                  {group.map((m, mi) => {
                    const isFirst = mi === 0;
                    const authorIsIgnored = ignoredUserIds.has(m.author?.id || "");
                    const ignoredMessageRevealed = revealedIgnoredMessageIds.has(m.id);
                    const mentionsMe = messageMentionsUser(m, me.id)
                      || (!!selectedChannel?.guild_id
                        && messageMentionsRole(m, currentGuildMemberRolesRef.current));
                    const authorColor = selectedChannel?.guild_id
                      ? getUserRoleColor(m.author.id, guildMembers, guildRoles, m.member?.roles)
                      : undefined;

                    if (authorIsIgnored && !ignoredMessageRevealed) {
                      return (
                        <div key={m.id} className="ignored-message-placeholder">
                          <span>Message from an ignored user</span>
                          <button type="button" onClick={() => setRevealedIgnoredMessageIds(current => new Set(current).add(m.id))}>Show</button>
                          <button type="button" className="ignored-hide-action" onClick={() => toggleIgnoredUser(m.author.id)}>Unignore</button>
                        </div>
                      );
                    }

                    return isFirst ? (
                      <div key={m.id} className={`message ${isMe ? "mine" : ""} ${mentionsMe ? "mentioned-you" : ""} ${m.deleted_at ? "deleted-message" : ""} msg-new`} onContextMenu={event => openContextMenu(event, { kind: "message", message: m, channel: selectedChannel! })}>
                        <div
                          className="msg-avatar-wrap profile-trigger"
                          role="button"
                          tabIndex={0}
                          aria-label={`View ${displayName(m.author)}'s profile`}
                          title={`View ${displayName(m.author)}'s profile`}
                          onClick={() => void handleOpenMemberProfile(m.author)}
                          onKeyDown={event => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              void handleOpenMemberProfile(m.author);
                            }
                          }}
                        >
                          <img className="msg-avatar" src={imgUrl} alt="" />
                          <AvatarDecorationOverlay user={m.author} className="message-avatar-decoration" />
                        </div>
                        <div className="msg-body">
                          <div className="msg-header">
                            <button
                              type="button"
                              className={`msg-author ${m.author.collectibles?.nameplate?.palette ? `nameplate-author-${m.author.collectibles.nameplate.palette}` : ""}`}
                              style={{ color: authorColor || undefined }}
                              onClick={() => void handleOpenMemberProfile(m.author)}
                              onContextMenu={event => openContextMenu(event, { kind: "user", user: m.author, source: "member", guildId: selectedChannel?.guild_id })}
                            >
                              {displayName(m.author)}
                            </button>
                            {m.author.bot && <span className="bot-tag">BOT</span>}
                            <span className="msg-time">{formatTimestamp(m.timestamp)}</span>
                            {m.edited_timestamp && <span className="msg-time">(edited)</span>}
                            {m.deleted_at && <span className="deleted-message-label">DELETED</span>}
                          </div>
                          <MessageContent message={m} channels={channels} users={mentionUsers} onChannelClick={jumpToChannel} onMediaOpen={showMedia} onReactionToggle={(message, emoji) => void toggleMessageReaction(selectedChannel!.id, message, emoji)} autoplayVideos={preferences.autoplayVideos} />
                        </div>
                        <MsgActions message={m} onReact={emoji => void toggleMessageReaction(selectedChannel!.id, m, emoji)} />
                      </div>
                    ) : (
                      <div key={m.id} className={`message compact ${isMe ? "mine" : ""} ${mentionsMe ? "mentioned-you" : ""} ${m.deleted_at ? "deleted-message" : ""}`} onContextMenu={event => openContextMenu(event, { kind: "message", message: m, channel: selectedChannel! })}>
                        <span className="compact-ts">{formatTimestamp(m.timestamp)}</span>
                        <div className="msg-body">
                          {m.deleted_at && <span className="deleted-message-label">DELETED</span>}
                          <MessageContent message={m} channels={channels} users={mentionUsers} onChannelClick={jumpToChannel} onMediaOpen={showMedia} onReactionToggle={(message, emoji) => void toggleMessageReaction(selectedChannel!.id, message, emoji)} autoplayVideos={preferences.autoplayVideos} />
                        </div>
                        <MsgActions message={m} onReact={emoji => void toggleMessageReaction(selectedChannel!.id, m, emoji)} />
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {typingUsers.size > 0 && (
              <div className="typing-indicator">
                <span className="typing-dots"><span /><span /><span /></span>
                <span>{typingUsers.size} {typingUsers.size === 1 ? "person is" : "people are"} typing…</span>
              </div>
            )}

            <div style={{ height: 8 }} />
          </div>

          {/* Composer */}
          <div className={`composer-container ${selectedVoiceChannel ? "voice-channel-composer" : ""}`}>
            {!online && (
              <div className="reconnect-pill">
                <span>Disconnected — waiting to reconnect</span>
                <Loader2 size={14} className="spinning" />
              </div>
            )}
            <div className={`composer-box ${editingMessageId ? "editing-message" : ""} ${!canSend || officialDiscordDm || channelAccess === "MISSING_ACCESS" ? "composer-readonly" : ""}`}>
                {officialDiscordDm && <span className="composer-readonly-hint">Official Discord messages are read-only</span>}
                {!officialDiscordDm && !canSend && channelAccess !== "MISSING_ACCESS" && <span className="composer-readonly-hint">You can read here, but sending is disabled</span>}
                {channelAccess === "MISSING_ACCESS" && <span className="composer-readonly-hint">You don’t have access to this channel</span>}
                {replyToMessage && replyToMessage.channel_id === selectedChannel?.id && !editingMessageId && (
                  <div className="reply-composer-preview"><div><strong>Replying to {displayName(replyToMessage.author)}</strong><span>{replyToMessage.content || "Attachment or system message"}</span></div><button type="button" aria-label="Cancel reply" onClick={() => setReplyToMessage(null)}><X size={14} /></button></div>
                )}
                {editingMessageId && (
                  <div className="message-editing-indicator">
                    <span>Editing message</span>
                    <button type="button" onClick={() => { setEditingMessageId(null); setDraft(""); }} aria-label="Cancel editing"><X size={13} /></button>
                  </div>
                )}
                <button className="plus-btn" title={`Attach files — ${uploadLimitLabel} account limit`} onClick={() => void chooseComposerFiles()} disabled={!selectedChannel || officialDiscordDm || !canSend}>+</button>
                {composerFiles.length > 0 && (
                  <div className="composer-attachments" aria-label={`Attachments to send, up to ${uploadLimitLabel}`}>
                    {composerFiles.map((file, index) => (
                      <span className="composer-attachment" key={`${file.uploadId}-${index}`} title={`${file.filename} (${(file.size / 1024 / 1024).toFixed(2)} MiB)`}>
                        <span>{file.filename}</span>
                        <button type="button" aria-label={`Remove ${file.filename}`} onClick={() => setComposerFiles(files => files.filter((_, fileIndex) => fileIndex !== index))}><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  ref={inputRef}
                  placeholder={editingMessageId ? "Edit message…" : selectedChannel ? `Message ${isDmView ? "" : "#"}${channelDisplayName(selectedChannel)}` : "Select a channel…"}
                  value={draft}
                  disabled={!selectedChannel || officialDiscordDm || channelAccess === "MISSING_ACCESS" || (!canSend && !editingMessageId)}
                  autoComplete="off"
                  onChange={e => {
                    const nextValue = e.target.value;
                    setDraft(nextValue);
                    setSelectedSlashCommand(current => current && nextValue.startsWith("/" + current.name) ? current : null);
                    setMentionCaret(e.target.selectionStart || 0);
                    setMentionSelection(0);
                  }}
                  onClick={e => setMentionCaret(e.currentTarget.selectionStart || 0)}
                  onKeyUp={e => setMentionCaret(e.currentTarget.selectionStart || 0)}
                  onKeyDown={handleComposerKeyDown}
                />
                {slashCommands.length > 0 && /^\/[^\s]*$/.test(draft) && (
                  <div className="slash-command-autocomplete" role="listbox" aria-label="Slash commands">
                    {slashCommands.map(command => <button type="button" role="option" key={command.application_id + ":" + command.id} onMouseDown={event => event.preventDefault()} onClick={() => {
                      setSelectedSlashCommand(command); setDraft("/" + command.name + " "); setSlashCommands([]);
                      requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length); });
                    }}><span className="slash-command-icon">/</span><span><strong>/{command.name}</strong><small>{command.description || "Application command"}</small></span></button>)}
                  </div>
                )}
                {mentionQuery && mentionSuggestions.length > 0 && (
                  <div className="mention-autocomplete" role="listbox" aria-label="Mention suggestions">
                    {mentionSuggestions.map((user, index) => (
                      <button
                        type="button"
                        key={user.id}
                        role="option"
                        aria-selected={index === mentionSelection}
                        className={index === mentionSelection ? "selected" : ""}
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => insertUserMention(user)}
                      >
                        <span className="mention-avatar-wrap">
                          <img src={avatarUrl(user, 32)} alt="" />
                          <AvatarDecorationOverlay user={user} />
                        </span>
                        <span><strong>{user.global_name || user.username}</strong><small>@{user.username}</small></span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="composer-right">
                  <button className={`composer-icon ${composerPicker === "gif" ? "active" : ""}`} title="GIF" onClick={() => setComposerPicker(current => current === "gif" ? null : "gif")}><Gift size={17} /></button>
                  <button className="composer-icon" title="Sticker"><Sticker size={17} /></button>
                  <button className={`composer-icon ${composerPicker === "emoji" ? "active" : ""}`} title="Emoji" onClick={() => setComposerPicker(current => current === "emoji" ? null : "emoji")}><SmilePlus size={17} /></button>
                  <button className="send-btn" onClick={sendMessage} disabled={(!draft.trim() && composerFiles.length === 0) || sending || officialDiscordDm || channelAccess === "MISSING_ACCESS" || !canSend} title={officialDiscordDm ? "Official Discord conversations are read-only" : editingMessageId ? "Save edit" : "Send"}>
                    {sending ? <Loader2 size={14} className="spinning" /> : editingMessageId ? <Check size={14} /> : <Send size={14} />}
                  </button>
                </div>
                {composerPicker === "emoji" && (
                  <div className="composer-picker emoji-picker" role="dialog" aria-label="Emoji picker">
                    <input className="picker-search" value={emojiQuery} onChange={event => setEmojiQuery(event.target.value)} placeholder="Search emoji" autoFocus />
                    <div className="emoji-picker-scroll">
                      {EMOJI_PICKER_ITEMS.map(group => {
                        const items = group.items.filter(emoji => !emojiQuery || emoji.includes(emojiQuery) || EMOJI_SEARCH_TERMS[emoji]?.includes(emojiQuery.toLowerCase()));
                        if (!items.length) return null;
                        return <section key={group.category}><h4>{group.category}</h4><div className="emoji-grid">{items.map((emoji, index) => <button key={`${emoji}-${index}`} type="button" title={emoji} onClick={() => insertComposerText(emoji)}>{emoji}</button>)}</div></section>;
                      })}
                      {emojiQuery && !EMOJI_PICKER_ITEMS.some(group => group.items.some(emoji => emoji.includes(emojiQuery) || EMOJI_SEARCH_TERMS[emoji]?.includes(emojiQuery.toLowerCase()))) && <p className="picker-empty">No matching emoji in the built-in set.</p>}
                    </div>
                  </div>
                )}
                {composerPicker === "gif" && (
                  <div className="composer-picker gif-picker" role="dialog" aria-label="GIF picker">
                    <div className="gif-picker-heading"><strong>GIFs</strong><span>Paste a GIF URL or search GIPHY</span></div>
                    <form className="gif-search-row" onSubmit={event => { event.preventDefault(); if (gifQuery.trim()) void openUrl(`https://giphy.com/search/${encodeURIComponent(gifQuery.trim())}`); }}>
                      <input className="picker-search" value={gifQuery} onChange={event => setGifQuery(event.target.value)} placeholder="Search GIFs on GIPHY" />
                      <button type="submit" className="gif-search-button" disabled={!gifQuery.trim()}><Search size={14} /> Search</button>
                    </form>
                    <div className="gif-url-row"><input className="picker-search" value={gifUrl} onChange={event => setGifUrl(event.target.value)} placeholder="Paste a direct GIF URL" /><button type="button" className="gif-search-button" disabled={!/^https?:\/\//i.test(gifUrl.trim())} onClick={() => insertComposerText(`${gifUrl.trim()} `)}>Insert</button></div>
                    {/^https?:\/\//i.test(gifUrl.trim()) && <div className="gif-preview"><img src={gifUrl.trim()} alt="GIF preview" onError={event => { event.currentTarget.style.display = "none"; }} /></div>}
                    <p className="picker-note">GIF URLs are sent as a message link. Search opens GIPHY in your browser; paste a direct media URL here to preview and insert it.</p>
                  </div>
                )}
              </div>
          </div>
        </section>
        )}

        {/* Member Panel */}
        {selectedVoiceChannel ? (
          <aside className="voice-chat-panel">
            <header className="voice-chat-header">
              <MessageSquare size={15} />
              <strong>CHANNEL CHAT</strong>
              <span>{messages.length}</span>
            </header>
            <div className="voice-chat-messages">
              {msgLoading && <div className="voice-chat-empty"><Loader2 size={16} className="spinning" /> Loading messages…</div>}
              {!msgLoading && messages.length === 0 && <div className="voice-chat-empty">No messages yet. Start the conversation.</div>}
              {messages.map(message => (
                <article className="voice-chat-message" key={message.id}>
                  <img src={avatarUrl(message.author, 32)} alt="" />
                  <div>
                    <header><strong>{displayName(message.author)}</strong><time>{formatTimestamp(message.timestamp)}</time></header>
                    <MessageContent message={message} channels={channels} users={mentionUsers} onChannelClick={jumpToChannel} onMediaOpen={showMedia} onReactionToggle={(target, emoji) => void toggleMessageReaction(selectedVoiceChannel.id, target, emoji)} autoplayVideos={preferences.autoplayVideos} />
                  </div>
                </article>
              ))}
            </div>
            <form className="voice-chat-composer" onSubmit={event => { event.preventDefault(); void sendMessage(); }}>
              <input
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={`Message ${channelDisplayName(selectedVoiceChannel)}`}
                aria-label={`Message ${channelDisplayName(selectedVoiceChannel)}`}
                disabled={!canSend || channelAccess === "MISSING_ACCESS"}
              />
              <button type="submit" title="Send message" disabled={!draft.trim() || sending || !canSend || channelAccess === "MISSING_ACCESS"}>
                {sending ? <Loader2 size={15} className="spinning" /> : <Send size={15} />}
              </button>
            </form>
          </aside>
        ) : memberOpen && !showingDirectory && (
          <aside className="member-panel">
            <div className="member-header">
              {isDmView && selectedChannel?.type === CHANNEL_TYPE_DM
                ? "USER PROFILE"
                : isDmView ? "GROUP MEMBERS" : `MEMBERS — ${activeMembers.length}`}
            </div>
            {isDmView && selectedChannel?.type === CHANNEL_TYPE_DM && selectedChannel.recipients?.find(user => user.id !== me.id) ? (() => {
              const dmUser = selectedChannel.recipients!.find(user => user.id !== me.id)!;
              const dmProfileUser = dmProfileData?.user || dmUser;
              const dmBio = dmProfileData?.user_profile?.bio || dmProfileUser.bio || "";
              const dmBanner = bannerUrl(dmProfileUser, 512);
              return (
                <div className="dm-profile-panel" onContextMenu={event => openContextMenu(event, { kind: "user", user: dmUser, source: "profile" })}>
                  <div
                    className="dm-profile-banner"
                    style={{
                      background: dmBanner
                        ? `url(${dmBanner}) center/cover`
                        : dmProfileUser.accent_color
                          ? `linear-gradient(135deg, #${dmProfileUser.accent_color.toString(16).padStart(6, "0")}, #1b1b2b)`
                          : "linear-gradient(135deg, #404b84, #1b1b2b)",
                    }}
                  />
                  <button className="dm-profile-user" onClick={() => void handleOpenMemberProfile(dmUser)}>
                    <span className="dm-profile-avatar-wrap">
                      <img src={avatarUrl(dmProfileUser, 80)} alt="" />
                      <AvatarDecorationOverlay user={dmProfileUser} />
                      <span className={`status-dot status-${memberPresences[dmUser.id] || "offline"}`} />
                    </span>
                    <strong>{displayName(dmProfileUser)}</strong>
                    <small>@{dmProfileUser.username}</small>
                  </button>
                  {memberCustomStatuses[dmUser.id] && (
                    <div className="dm-profile-custom-status">{memberCustomStatuses[dmUser.id]}</div>
                  )}
                  {dmProfileLoading ? (
                    <div className="dm-profile-loading"><Loader2 size={15} className="spinning" /> Loading profile…</div>
                  ) : (
                    <>
                      {dmProfileData?.badges?.length > 0 && (
                        <div className="dm-profile-badges">
                          {dmProfileData.badges.map((badge: any) => (
                            <img key={badge.id} src={badge.icon_url || `https://cdn.discordapp.com/badge-icons/${badge.icon}.png`} alt={badge.description} title={badge.description} />
                          ))}
                        </div>
                      )}
                      <div className="dm-profile-about">
                        <strong>ABOUT ME</strong>
                        <p>{dmBio || "This user hasn't added a bio yet."}</p>
                      </div>
                      {dmProfileData?.user_profile?.pronouns && (
                        <div className="dm-profile-about">
                          <strong>PRONOUNS</strong>
                          <p>{dmProfileData.user_profile.pronouns}</p>
                        </div>
                      )}
                      <button className="dm-profile-open-button" onClick={() => void handleOpenMemberProfile(dmUser)}>View Full Profile</button>
                    </>
                  )}
                </div>
              );
            })() : <div className="member-list">
              {memberRoleGroups.map(group => (
                <div className="member-role-group" key={group.id}>
                  <div className="member-section-label">{group.name} — {group.members.length}</div>
                  {group.members.map((m: any) => {
                    const userObj = m.user || m;
                    const name = m.nick || userObj.global_name || userObj.username;
                    const avatarSrc = avatarUrl(userObj, 32);
                    const userStatus = memberPresences[userObj.id] || "offline";
                    const userRoleColor = !isDmView
                      ? getUserRoleColor(userObj.id, guildMembers, guildRoles)
                      : undefined;

                    return (
                      <div key={userObj.id} className="member-item" onContextMenu={event => openContextMenu(event, { kind: "user", user: userObj, source: "member", guildId: selectedGuild?.id })} onClick={() => handleOpenMemberProfile(userObj)} style={{ cursor: "pointer" }}>
                        <div className="member-avatar-wrap">
                          <img src={avatarSrc} alt={name} className="member-avatar" />
                          <AvatarDecorationOverlay user={userObj} className="member-avatar-decoration" />
                          <span className={`status-dot status-${userStatus}`} />
                        </div>
                        <div className="member-info">
                          <strong style={{ color: userRoleColor || undefined }}>{name}</strong>
                          {userObj.bot && <span className="bot-tag" style={{ fontSize: 9, marginLeft: 4 }}>BOT</span>}
                          <small className="member-subline">{userObj.username}<PlatformIndicators platforms={memberPlatforms[userObj.id] || []} /></small>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>}
          </aside>
        )}
      </section>

      {/* Member Profile Card Modal */}
      {selectedMemberProfile && (
        <div className="modal-backdrop" onClick={() => setSelectedMemberProfile(null)}>
          <div className={`discord-profile-popout member-profile-card-modal ${fullProfileOpen ? "profile-full-mode" : ""}`} onContextMenu={event => openContextMenu(event, { kind: "user", user: selectedMemberProfile, source: "profile", guildId: selectedGuild?.id })} onClick={e => e.stopPropagation()}>
            {ignoredUserIds.has(selectedMemberProfile.id) && !revealedIgnoredProfileIds.has(selectedMemberProfile.id) && (
              <div className="profile-ignored-overlay">
                <UserX size={28} />
                <strong>This user is ignored</strong>
                <span>Their messages and profile are hidden for you.</span>
                <button type="button" onClick={() => setRevealedIgnoredProfileIds(current => new Set(current).add(selectedMemberProfile.id))}>View profile</button>
                <button type="button" className="profile-ignored-unignore" onClick={() => toggleIgnoredUser(selectedMemberProfile.id)}>Unignore user</button>
              </div>
            )}
            <div
              className="profile-banner"
              style={{
                background: bannerUrl(memberProfileData?.user || selectedMemberProfile, 512)
                  ? `url(${bannerUrl(memberProfileData?.user || selectedMemberProfile, 512)}) center/cover no-repeat`
                  : "linear-gradient(135deg, #2b3040 0%, #1a1e2b 100%)"
              }}
            >
              <div className="profile-banner-tag">VoidCord Profile</div>
            </div>

            <div className="profile-popout-header">
              <div className="profile-popout-avatar-wrap">
                <img src={avatarUrl(selectedMemberProfile, 128)} alt={displayName(selectedMemberProfile)} className="profile-popout-avatar" />
                <AvatarDecorationOverlay user={selectedMemberProfile} className="profile-avatar-decoration" />
                <div className="profile-status-badge">
                  <span className={`status-dot status-${memberPresences[selectedMemberProfile.id] || "offline"}`} />
                </div>
              </div>
            </div>

            {fullProfileOpen ? (
              <div className="profile-full-body">
                <button className="profile-back-button" onClick={() => setFullProfileOpen(false)}>← Back to profile card</button>
                <h2 style={{ color: selectedProfileRoleColor }}>{displayName(selectedMemberProfile)}</h2>
                <span className="profile-handle">@{selectedMemberProfile.username}</span>
                {memberProfileData?.user_profile?.pronouns && <span className="profile-pronouns">{memberProfileData.user_profile.pronouns}</span>}
                <h3>About me</h3>
                <p className="profile-full-bio">{selectedProfileBio || "This user hasn't added a bio yet."}</p>
                <div className="profile-full-meta">
                  <span>Member since</span>
                  <strong>{snowflakeTime(selectedMemberProfile.id) || "Unknown"}</strong>
                </div>
                {memberProfileData?.badges?.length > 0 && (
                  <div className="profile-badges-row">
                    {memberProfileData.badges.map((badge: any) => (
                      <img key={badge.id} src={badge.icon_url || `https://cdn.discordapp.com/badge-icons/${badge.icon}.png`} alt={badge.description} title={badge.description} style={{ width: 22, height: 22, objectFit: "contain" }} />
                    ))}
                  </div>
                )}
                <div className="profile-full-actions">
                  <button onClick={() => void startDirectMessage(selectedMemberProfile)}><MessageSquare size={15} /> Message</button>
                  {selectedMemberProfile.id !== me.id && (
                    selectedProfileIsFriend
                      ? <button onClick={() => void changeRelationship(selectedMemberProfile.id, "remove")}><Users size={15} /> Remove Friend</button>
                      : <button onClick={() => void changeRelationship(selectedMemberProfile.id, "add")}><UserPlus size={15} /> Add Friend</button>
                  )}
                  {selectedMemberProfile.id !== me.id && <button onClick={() => void changeRelationship(selectedMemberProfile.id, selectedProfileIsBlocked ? "unblock" : "block")}><Ban size={15} /> {selectedProfileIsBlocked ? "Unblock" : "Block"}</button>}
                  {selectedMemberProfile.id !== me.id && <button onClick={() => toggleIgnoredUser(selectedMemberProfile.id)}><UserX size={15} /> {ignoredUserIds.has(selectedMemberProfile.id) ? "Unignore" : "Ignore"}</button>}
                  {selectedMemberProfile.id !== me.id && <button onClick={() => void openDiscordReportFlow(selectedMemberProfile.id)}><Flag size={15} /> Report user…</button>}
                </div>
              </div>
            ) : <div className="profile-popout-body">
              {memberProfileLoading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
                  <Loader2 size={20} className="spinning" style={{ color: "var(--text-muted)" }} />
                </div>
              ) : (
                <>
                  <div className="profile-identity">
                    <h3 className="profile-display-name" style={{ color: selectedProfileRoleColor }}>{displayName(selectedMemberProfile)}</h3>
                    <div className="profile-handle-row">
                      <span className="profile-handle">{selectedMemberProfile.username}</span>
                      {memberProfileData?.user_profile?.pronouns && (
                        <>
                          <span className="profile-bullet">•</span>
                          <span className="profile-pronouns">{memberProfileData.user_profile.pronouns}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {memberProfileData?.badges && memberProfileData.badges.length > 0 && (
                    <div className="profile-badges-row">
                      {memberProfileData.badges.map((b: any) => (
                        <img
                          key={b.id}
                          src={b.icon_url || `https://cdn.discordapp.com/badge-icons/${b.icon}.png`}
                          alt={b.description}
                          title={b.description}
                          style={{ width: 20, height: 20, objectFit: "contain" }}
                        />
                      ))}
                    </div>
                  )}

                  {selectedProfileBio && (
                    <div className="profile-section-bio">
                      <p className="profile-bio-preview">{selectedProfileBio}</p>
                      <button className="profile-link-btn" onClick={() => setFullProfileOpen(true)}>View Full Bio</button>
                    </div>
                  )}
                  <button className="profile-open-full-btn" onClick={() => setFullProfileOpen(true)}>View Full Profile</button>

                  <div className="profile-menu-section" style={{ marginTop: 12 }}>
                    <button className="profile-menu-item" onClick={() => void startDirectMessage(selectedMemberProfile)}>
                      <MessageSquare size={15} />
                      <span>Message</span>
                    </button>
                    {selectedMemberProfile.id !== me.id && (
                      selectedProfileIsFriend
                        ? <button className="profile-menu-item" onClick={() => void changeRelationship(selectedMemberProfile.id, "remove")}><Users size={15} /><span>Remove Friend</span></button>
                        : <button className="profile-menu-item" onClick={() => void changeRelationship(selectedMemberProfile.id, "add")}><UserPlus size={15} /><span>Add Friend</span></button>
                    )}
                    {selectedMemberProfile.id !== me.id && <button className="profile-menu-item" onClick={() => void changeRelationship(selectedMemberProfile.id, selectedProfileIsBlocked ? "unblock" : "block")}><Ban size={15} /><span>{selectedProfileIsBlocked ? "Unblock" : "Block"}</span></button>}
                    {selectedMemberProfile.id !== me.id && <button className="profile-menu-item" onClick={() => toggleIgnoredUser(selectedMemberProfile.id)}><UserX size={15} /><span>{ignoredUserIds.has(selectedMemberProfile.id) ? "Unignore" : "Ignore"}</span></button>}
                    {selectedMemberProfile.id !== me.id && <button className="profile-menu-item" onClick={() => void openDiscordReportFlow(selectedMemberProfile.id)}><Flag size={15} /><span>Report user…</span></button>}
                    <button className="profile-menu-item" onClick={() => {
                      navigator.clipboard.writeText(selectedMemberProfile.id);
                      notify("Copied User ID to clipboard!");
                    }}>
                      <Copy size={15} />
                      <span>Copy User ID</span>
                    </button>
                  </div>
                </>
              )}
            </div>}
          </div>
        </div>
      )}

      {messageLoggerOpen && (
        <div className="modal-backdrop message-logger-backdrop" onClick={() => setMessageLoggerOpen(false)}>
          <section className="message-logger-modal" role="dialog" aria-modal="true" aria-label={`${messageLoggerMode === "deleted" ? "Deleted" : "Edited"} message log`} onClick={event => event.stopPropagation()}>
            <header className="message-logger-header">
              <div>
                <h2>{messageLoggerMode === "deleted" ? "Deleted Message Log" : "Edited Message History"}</h2>
                <p>{messageLoggerMode === "deleted" ? "Locally cached messages and archived media deleted while VoidCord was running." : "Previous versions captured when VoidCord receives a message edit."}</p>
              </div>
              <button className="icon-btn" aria-label="Close message log" onClick={() => setMessageLoggerOpen(false)}><X size={18} /></button>
            </header>
            <div className="logger-mode-tabs" role="tablist" aria-label="Message history type">
              <button type="button" role="tab" aria-selected={messageLoggerMode === "deleted"} className={messageLoggerMode === "deleted" ? "active" : ""} onClick={() => { if (messageLoggerMode !== "deleted") void openMessageLogger(); }}>Deleted</button>
              <button type="button" role="tab" aria-selected={messageLoggerMode === "edited"} className={messageLoggerMode === "edited" ? "active" : ""} onClick={() => { if (messageLoggerMode !== "edited") void openEditedMessageLogger(); }}>Edited</button>
            </div>
            <div className="message-logger-content">
              <div className="message-logger-list">
                {loggerLoading && <div className="logger-empty"><Loader2 size={18} className="spinning" /> Loading saved messages…</div>}
                {loggerError && <div className="logger-error">{loggerError}</div>}
                {!loggerLoading && !loggerError && (messageLoggerMode === "deleted" ? deletedLogs.length === 0 : editedLogs.length === 0) && (
                  <div className="logger-empty">{messageLoggerMode === "deleted" ? "No deleted messages have been saved on this device yet." : "No message edits have been recorded yet. VoidCord must be running to capture an edit."}</div>
                )}
                {messageLoggerMode === "deleted" && deletedLogs.map(entry => (
                  <div
                    className={`message-logger-entry ${selectedDeletedLog?.id === entry.id ? "selected" : ""}`}
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void selectDeletedLog(entry)}
                    onKeyDown={event => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void selectDeletedLog(entry);
                      }
                    }}
                  >
                    <span className="logger-entry-info">
                      <strong>{displayName(entry.message.author)}</strong>
                      <small>{entry.channelName} · {new Date(entry.deletedAt).toLocaleString()}</small>
                      <span>{entry.message.content || entry.message.attachments?.[0]?.filename || "Media / embed message"}</span>
                    </span>
                    <button
                      type="button"
                      className="logger-delete-button"
                      title="Remove saved log entry"
                      aria-label="Remove saved log entry"
                      onClick={event => { event.stopPropagation(); void removeDeletedLog(entry); }}
                    ><Trash2 size={15} /></button>
                  </div>
                ))}
                {messageLoggerMode === "edited" && editedLogs.map(entry => (
                  <div
                    className={`message-logger-entry ${selectedEditedLog?.id === entry.id ? "selected" : ""}`}
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void selectEditedLog(entry)}
                    onKeyDown={event => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void selectEditedLog(entry);
                      }
                    }}
                  >
                    <span className="logger-entry-info">
                      <strong>{displayName(entry.message.author)}</strong>
                      <small>{entry.channelName} · edited {new Date(entry.editedAt).toLocaleString()}</small>
                      <span>{entry.message.content || entry.message.attachments?.[0]?.filename || "Media / embed message"}</span>
                    </span>
                    <button type="button" className="logger-delete-button" title="Remove saved edit entry" aria-label="Remove saved edit entry" onClick={event => { event.stopPropagation(); void removeEditedLog(entry); }}><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
              <div className="message-logger-preview">
                {messageLoggerMode === "deleted" && selectedDeletedLog && restoredDeletedMessage ? (
                  <>
                    <div className="logger-preview-meta">
                      <strong>{displayName(restoredDeletedMessage.author)}</strong>
                      <span>{selectedDeletedLog.channelName} · sent {formatTimestamp(restoredDeletedMessage.timestamp)}</span>
                      <span>Deleted {new Date(selectedDeletedLog.deletedAt).toLocaleString()}</span>
                    </div>
                    <div className="logger-preview-message">
                      <MessageContent message={restoredDeletedMessage} channels={channels} users={mentionUsers} onChannelClick={jumpToChannel} onMediaOpen={showMedia} autoplayVideos={preferences.autoplayVideos} />
                    </div>
                  </>
                ) : messageLoggerMode === "edited" && selectedEditedLog && restoredEditedMessage ? (
                  <>
                    <div className="logger-preview-meta">
                      <strong>{displayName(restoredEditedMessage.author)}</strong>
                      <span>{selectedEditedLog.channelName} · sent {formatTimestamp(restoredEditedMessage.timestamp)}</span>
                      <span>Edited {new Date(selectedEditedLog.editedAt).toLocaleString()} · previous version</span>
                    </div>
                    <div className="logger-preview-message">
                      <MessageContent message={restoredEditedMessage} channels={channels} users={mentionUsers} onChannelClick={jumpToChannel} onMediaOpen={showMedia} autoplayVideos={preferences.autoplayVideos} />
                    </div>
                  </>
                ) : (
                  <div className="logger-empty">{messageLoggerMode === "deleted" ? "Select a deleted message to inspect its saved content and media." : "Select an edit to inspect the previous message version."}</div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {deletedChannelViewerOpen && (
        <div className="modal-backdrop message-logger-backdrop" onClick={() => setDeletedChannelViewerOpen(false)}>
          <section className="message-logger-modal deleted-channel-modal" role="dialog" aria-modal="true" aria-label="Deleted channel viewer" onClick={event => event.stopPropagation()}>
            <header className="message-logger-header">
              <div>
                <h2>Deleted Channel Viewer</h2>
                <p>Browse channel metadata and message history saved on this device before deletion.</p>
              </div>
              <button className="icon-btn" aria-label="Close deleted channel viewer" onClick={() => setDeletedChannelViewerOpen(false)}><X size={18} /></button>
            </header>
            <div className="message-logger-content">
              <div className="message-logger-list">
                {deletedChannelLogsLoading && <div className="logger-empty"><Loader2 size={18} className="spinning" /> Loading deleted channels…</div>}
                {!deletedChannelLogsLoading && deletedChannelLogs.length === 0 && (
                  <div className="logger-empty">No deleted channels have been recorded yet. VoidCord must be running when a channel is deleted.</div>
                )}
                {deletedChannelLogs.map(entry => (
                  <button
                    className={`message-logger-entry ${selectedDeletedChannel?.id === entry.id ? "selected" : ""}`}
                    key={entry.id}
                    onClick={() => void selectDeletedChannel(entry)}
                  >
                    <span className="logger-entry-info">
                      <strong>#{channelDisplayName(entry.channel)}</strong>
                      <small>{entry.guildName || entry.guildId || "Unknown server"} · deleted {new Date(entry.deletedAt).toLocaleString()}</small>
                      <span>{entry.channel.topic || "No saved channel topic"}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="message-logger-preview deleted-channel-preview">
                {selectedDeletedChannel ? (
                  <>
                    <div className="logger-preview-meta">
                      <strong>#{channelDisplayName(selectedDeletedChannel.channel)}</strong>
                      {selectedDeletedChannel.channel.topic && <span>{selectedDeletedChannel.channel.topic}</span>}
                      <span>{selectedDeletedChannel.guildName || selectedDeletedChannel.guildId || "Unknown server"} · deleted {new Date(selectedDeletedChannel.deletedAt).toLocaleString()}</span>
                    </div>
                    {deletedChannelMessages.length
                      ? deletedChannelMessages.map(message => (
                        <article className={`deleted-channel-message ${message.deleted_at ? "deleted-message" : ""}`} key={message.id}>
                          <header>
                            <strong>{displayName(message.author)}</strong>
                            <span>{formatTimestamp(message.timestamp)}</span>
                            {message.deleted_at && <span className="deleted-message-label">DELETED</span>}
                          </header>
                          <MessageContent message={message} channels={[]} users={mentionUsers} onChannelClick={jumpToChannel} onMediaOpen={showMedia} autoplayVideos={preferences.autoplayVideos} />
                        </article>
                      ))
                      : <div className="logger-empty">No cached messages were found for this channel.</div>}
                  </>
                ) : (
                  <div className="logger-empty">Select a deleted channel to inspect its locally cached history.</div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {serverDialogOpen && (
        <div className="feature-modal-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget && !serverActionBusy) setServerDialogOpen(false);
        }}>
          <form className="feature-modal server-modal" role="dialog" aria-modal="true" aria-labelledby="server-modal-title" onSubmit={event => void submitServerAction(event)}>
            <button type="button" className="feature-modal-close" aria-label="Close" onClick={() => setServerDialogOpen(false)}>×</button>
            <h2 id="server-modal-title">Add a server</h2>
            <p>Join a community with an invite or create a new server.</p>
            <div className="feature-modal-tabs">
              <button type="button" className={serverDialogMode === "join" ? "active" : ""} onClick={() => { setServerDialogMode("join"); setServerActionError(""); }}>Join a server</button>
              <button type="button" className={serverDialogMode === "create" ? "active" : ""} onClick={() => { setServerDialogMode("create"); setServerActionError(""); }}>Create a server</button>
            </div>
            {serverDialogMode === "join" ? (
              <label className="feature-field">
                <span>Invite link or code</span>
                <input autoFocus required value={serverInvite} onChange={event => setServerInvite(event.target.value)} placeholder="https://discord.gg/…" />
              </label>
            ) : (
              <label className="feature-field">
                <span>Server name</span>
                <input autoFocus required maxLength={100} value={newServerName} onChange={event => setNewServerName(event.target.value)} placeholder="My new server" />
              </label>
            )}
            {serverActionError && <div className="feature-modal-error" role="alert">{serverActionError}</div>}
            <div className="feature-modal-actions">
              <button type="button" className="secondary" disabled={serverActionBusy} onClick={() => setServerDialogOpen(false)}>Cancel</button>
              <button type="submit" disabled={serverActionBusy || (serverDialogMode === "join" ? !serverInvite.trim() : !newServerName.trim())}>
                {serverActionBusy ? "Working…" : serverDialogMode === "join" ? "Join server" : "Create server"}
              </button>
            </div>
          </form>
        </div>
      )}

      {settingsOpen && (
        <div className="feature-modal-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget) setSettingsOpen(false);
        }}>
          <section className="feature-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <button type="button" className="feature-modal-close" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>×</button>
            <h2 id="settings-title">Settings</h2>
            <div className="feature-modal-tabs">
              <button type="button" className={settingsTab === "account" ? "active" : ""} onClick={() => setSettingsTab("account")}>Preferences</button>
              <button type="button" className={settingsTab === "themes" ? "active" : ""} onClick={() => setSettingsTab("themes")}>Appearance</button>
              <button type="button" onClick={() => setProtoSettingsOpen(true)}>Settings scopes</button>
            </div>
            {settingsTab === "account" ? (
              <div className="settings-options">
                <label className="settings-option"><span><strong>Compact messages</strong><small>Reduce spacing between messages in chat.</small></span><input type="checkbox" checked={preferences.compactMessages} onChange={event => setPreferences(current => ({ ...current, compactMessages: event.target.checked }))} /></label>
                <label className="settings-option"><span><strong>Reduce motion</strong><small>Disable decorative interface animations.</small></span><input type="checkbox" checked={preferences.reduceMotion} onChange={event => setPreferences(current => ({ ...current, reduceMotion: event.target.checked }))} /></label>
                <label className="settings-option"><span><strong>Autoplay videos</strong><small>Automatically play videos in messages when possible.</small></span><input type="checkbox" checked={preferences.autoplayVideos} onChange={event => setPreferences(current => ({ ...current, autoplayVideos: event.target.checked }))} /></label>
                <label className="feature-field"><span>Chat text size · {preferences.chatFontScale}%</span><input type="range" min="85" max="125" step="5" value={preferences.chatFontScale} onChange={event => setPreferences(current => ({ ...current, chatFontScale: Number(event.target.value) }))} /></label>
                <h3 className="settings-section-title">Ignored users</h3>
                <p className="settings-help">Ignored users are hidden only in this VoidCord installation. This preference does not sync to Discord.</p>
                {ignoredUserIds.size === 0 ? <p className="settings-help">No ignored users.</p> : (
                  <div className="ignored-users-list">
                    {[...ignoredUserIds].map(userId => {
                      const user = [...mentionUsers, ...guildMembers, ...dmChannels.flatMap(channel => channel.recipients || [])].find(item => item?.id === userId);
                      return <div className="ignored-user-row" key={userId}><span>{user ? displayName(user) : `User ${userId}`}</span><button type="button" onClick={() => toggleIgnoredUser(userId)}>Unignore</button></div>;
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="settings-options">
                <label className="feature-field"><span>Accent color</span><select value={preferences.accent} onChange={event => setPreferences(current => ({ ...current, accent: event.target.value as AppPreferences["accent"] }))}>
                  <option value="blurple">Blurple</option><option value="violet">Violet</option><option value="emerald">Emerald</option>
                </select></label>
                <label className="feature-field"><span>Channel sidebar width · {preferences.channelSidebarWidth}px</span><input type="range" min="180" max="360" step="4" value={preferences.channelSidebarWidth} onChange={event => setPreferences(current => ({ ...current, channelSidebarWidth: Number(event.target.value) }))} /></label>
                <h3 className="settings-section-title">Server folders and order</h3>
                <p className="settings-help">Group servers by folder name. Use arrows to change their order in the server rail.</p>
                <div className="server-organize-list">
                  {orderedGuilds.map((guild, index) => (
                    <div className="server-organize-row" key={guild.id}>
                      <span title={guild.name}>{guild.name}</span>
                      <input aria-label={`Folder for ${guild.name}`} placeholder="Folder" value={preferences.serverFolders[guild.id] || ""} onChange={event => setPreferences(current => ({ ...current, serverFolders: { ...current.serverFolders, [guild.id]: event.target.value } }))} />
                      <button type="button" aria-label={`Move ${guild.name} up`} disabled={index === 0} onClick={() => setPreferences(current => {
                        const ids = orderedGuilds.map(item => item.id);
                        [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
                        return { ...current, serverOrder: ids };
                      })}>↑</button>
                      <button type="button" aria-label={`Move ${guild.name} down`} disabled={index === orderedGuilds.length - 1} onClick={() => setPreferences(current => {
                        const ids = orderedGuilds.map(item => item.id);
                        [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]];
                        return { ...current, serverOrder: ids };
                      })}>↓</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="feature-modal-actions"><button type="button" onClick={() => setSettingsOpen(false)}>Done</button></div>
          </section>
        </div>
      )}

      {protoSettingsOpen && <SettingsMenu
        onClose={() => setProtoSettingsOpen(false)}
        onOpenClientSettings={() => { setProtoSettingsOpen(false); setSettingsOpen(true); }}
        onThemeChange={setSettingsTheme}
        ignoredUserIds={ignoredUserIds}
        blockedUserIds={relationships.filter(relationship => relationship.type === 2).map(relationship => relationship.user.id)}
        onToggleIgnore={toggleIgnoredUser}
        onBlockUser={(userId, blocked) => void changeRelationship(userId, blocked ? "block" : "unblock")}
      />}

      {forwardTarget && (
        <div className="feature-modal-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget && !forwardBusy) setForwardTarget(null);
        }}>
          <section className="feature-modal forward-message-modal" role="dialog" aria-modal="true" aria-labelledby="forward-message-title">
            <button type="button" className="feature-modal-close" aria-label="Close forward dialog" disabled={forwardBusy} onClick={() => setForwardTarget(null)}>×</button>
            <h2 id="forward-message-title">Forward message</h2>
            <p>Choose a direct message or a channel where you can send messages.</p>
            <div className="forward-target-list">
              {forwardTargets.map(target => {
                const guildName = target.guild_id
                  ? guilds.find(guild => guild.id === target.guild_id)?.name
                  : undefined;
                return (
                  <button type="button" key={target.id} disabled={forwardBusy} onClick={() => void forwardMessageTo(target)}>
                    <strong>{target.guild_id ? `#${channelDisplayName(target)}` : channelDisplayName(target)}</strong>
                    {guildName && <small>{guildName}</small>}
                  </button>
                );
              })}
              {forwardTargets.length === 0 && <div className="directory-empty">No available destination channels.</div>}
            </div>
            {forwardBusy && <div className="forward-message-busy"><Loader2 size={16} className="spinning" /> Forwarding…</div>}
          </section>
        </div>
      )}

      {mediaViewer && (
        <div className="media-viewer-backdrop" role="dialog" aria-modal="true" aria-label={mediaViewer.name || `${mediaViewer.kind} viewer`} onMouseDown={event => {
          if (event.target === event.currentTarget) setMediaViewer(null);
        }} ref={mediaViewerRef}>
          <div className="media-viewer-toolbar">
            <div className="media-viewer-file" title={mediaViewer.name || mediaViewer.kind}>
              <strong>{mediaViewer.name || (mediaViewer.kind === "image" ? "Image" : "Video")}</strong>
              <span>{mediaViewer.kind === "image" ? `${Math.round(mediaZoom * 100)}%` : "Media viewer"}</span>
            </div>
            <div className="media-viewer-tools">
              {mediaViewer.kind === "image" && (
                <>
                  <button type="button" title="Zoom out" aria-label="Zoom out" disabled={mediaZoom <= 0.5} onClick={() => setMediaZoom(zoom => Math.max(0.5, Number((zoom / 1.12).toFixed(3))))}><ZoomOut size={17} /></button>
                  <button type="button" title="Reset zoom" aria-label="Reset zoom" onClick={() => setMediaZoom(1)}><RotateCcw size={16} /></button>
                  <button type="button" title="Zoom in" aria-label="Zoom in" disabled={mediaZoom >= 4} onClick={() => setMediaZoom(zoom => Math.min(4, Number((zoom * 1.12).toFixed(3))))}><ZoomIn size={17} /></button>
                </>
              )}
              <a href={mediaViewer.url} target="_blank" rel="noopener noreferrer" title="Open media in a new window" aria-label="Open media in a new window"><ExternalLink size={16} /></a>
              <a href={mediaViewer.url} download={mediaViewer.name || true} title="Download media" aria-label="Download media"><Download size={16} /></a>
              <button type="button" title="Toggle full screen" aria-label="Toggle full screen" onClick={() => void toggleMediaFullscreen()}><Maximize2 size={16} /></button>
              <button type="button" className="media-viewer-close" aria-label="Close media viewer" title="Close" onClick={() => setMediaViewer(null)}><X size={19} /></button>
            </div>
          </div>
          <div className={`media-viewer-stage ${mediaViewer.kind === "image" ? "image-stage" : "video-stage"}`} onWheel={handleMediaImageWheel}>
            {mediaViewer.kind === "image"
              ? <>
                  <div
                    className="media-image-zoom"
                    style={{ transform: `scale(${mediaZoom})`, transformOrigin: mediaZoomOrigin }}
                    onMouseDown={event => {
                      if (event.button === 0) {
                        setMediaLensActive(true);
                      }
                    }}
                    onMouseUp={event => {
                      if (event.button === 0) {
                        setMediaLensActive(false);
                        setMediaLens(null);
                      }
                    }}
                    onMouseLeave={() => {
                      setMediaLensActive(false);
                      setMediaLens(null);
                    }}
                  >
                    <img
                      className="media-viewer-image"
                      src={mediaViewer.url}
                      alt={mediaViewer.name || "Image"}
                      onMouseMove={updateMediaLens}
                    />
                  </div>
                  {mediaLens && (
                    <div
                      className="media-magnifier"
                      aria-hidden="true"
                      style={{
                        left: mediaLens.left,
                        top: mediaLens.top,
                        backgroundImage: `url(${JSON.stringify(mediaViewer.url)})`,
                        backgroundSize: mediaLens.backgroundSize,
                        backgroundPosition: mediaLens.backgroundPosition,
                      }}
                    />
                  )}
                </>
              : <MediaVideoPlayer
                  key={mediaViewer.url}
                  src={mediaViewer.url}
                  autoplay={preferences.autoplayVideos}
                  onToggleFullscreen={() => void toggleMediaFullscreen()}
                />}
          </div>
        </div>
      )}

      {captchaPrompt && (
        <CaptchaDialog
          challenge={captchaPrompt.challenge}
          onSolve={captchaPrompt.onSolve}
          onCancel={captchaPrompt.onCancel}
        />
      )}

      {contextMenu && (
        <div
          className="app-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}
        >
          {contextMenu.kind === "channel" && (
            <>
              <div className="app-context-menu-heading">#{channelDisplayName(contextMenu.channel)}</div>
              <button role="menuitem" disabled={!isMessageChannel(contextMenu.channel)} onClick={() => openContextChannel(contextMenu.channel)}>
                Open Channel
              </button>
              {contextMenu.channel.guild_id && getChannelPermissions(
                contextMenu.channel,
                contextMenu.channel.guild_id,
                me.id,
                currentGuildMemberRolesRef.current,
                guildRoleDataRef.current,
                !!guilds.find(guild => guild.id === contextMenu.channel.guild_id)?.owner,
              )?.canManageChannels && (
                <>
                  <div className="app-context-menu-divider" />
                  <button role="menuitem" disabled={contextBusy} onClick={() => void editChannel(contextMenu.channel)}>Edit Channel</button>
                  {isTextChannel(contextMenu.channel) && getChannelPermissions(
                    contextMenu.channel,
                    contextMenu.channel.guild_id,
                    me.id,
                    currentGuildMemberRolesRef.current,
                    guildRoleDataRef.current,
                    !!guilds.find(guild => guild.id === contextMenu.channel.guild_id)?.owner,
                  )?.canManageRoles && (
                    <button
                      role="menuitem"
                      disabled={contextBusy}
                      onClick={() => void setChannelLocked(
                        contextMenu.channel,
                        !(BigInt(contextMenu.channel.permission_overwrites?.find(overwrite =>
                          overwrite.type === 0 && overwrite.id === contextMenu.channel.guild_id
                        )?.deny || "0") & (1n << 11n)),
                      )}
                    >
                      {(BigInt(contextMenu.channel.permission_overwrites?.find(overwrite =>
                        overwrite.type === 0 && overwrite.id === contextMenu.channel.guild_id
                      )?.deny || "0") & (1n << 11n)) !== 0n ? "Unlock Channel" : "Lock Channel"}
                    </button>
                  )}
                  <button className="danger" role="menuitem" disabled={contextBusy} onClick={() => void deleteChannel(contextMenu.channel)}>Delete Channel</button>
                </>
              )}
              <div className="app-context-menu-divider" />
              <button role="menuitem" disabled={!unreadByChannel[contextMenu.channel.id]} onClick={() => markChannelRead(contextMenu.channel)}>
                Mark as Read
              </button>
              <div className="app-context-menu-divider" />
              <button role="menuitem" onClick={() => void copyContextValue(contextMenu.channel.id, "Channel ID")}>
                <Copy size={14} /> Copy Channel ID
              </button>
              <button role="menuitem" onClick={() => void copyContextValue(
                `https://discord.com/channels/${contextMenu.channel.guild_id || "@me"}/${contextMenu.channel.id}`,
                "Channel link",
              )}>
                <Copy size={14} /> Copy Channel Link
              </button>
            </>
          )}
          {contextMenu.kind === "user" && (
            <>
              <div className="app-context-menu-heading">{displayName(contextMenu.user)}</div>
              <button role="menuitem" disabled={contextBusy} onClick={() => {
                const { user, source } = contextMenu;
                setContextMenu(null);
                void handleOpenMemberProfile(user, source === "profile");
              }}>
                View {contextMenu.source === "profile" ? "Full " : ""}Profile
              </button>
              {contextMenu.user.id !== me.id && (
                <button role="menuitem" onClick={() => {
                  const user = contextMenu.user;
                  setContextMenu(null);
                  void startDirectMessage(user);
                }}>
                  <MessageSquare size={14} /> Message
                </button>
              )}
              {contextMenu.user.id !== me.id && (
                <>
                  <button role="menuitem" disabled={relationshipBusy === contextMenu.user.id} onClick={() => {
                    const userId = contextMenu.user.id;
                    setContextMenu(null);
                    void changeRelationship(userId, relationships.some(item => item.user?.id === userId && item.type === 2) ? "unblock" : "block");
                  }}><Ban size={14} /> {relationships.some(item => item.user?.id === contextMenu.user.id && item.type === 2) ? "Unblock" : "Block"}</button>
                  <button role="menuitem" onClick={() => {
                    const userId = contextMenu.user.id;
                    setContextMenu(null);
                    toggleIgnoredUser(userId);
                  }}><UserX size={14} /> {ignoredUserIds.has(contextMenu.user.id) ? "Unignore" : "Ignore"}</button>
                  <button role="menuitem" onClick={() => {
                    const userId = contextMenu.user.id;
                    setContextMenu(null);
                    void openDiscordReportFlow(userId);
                  }}><Flag size={14} /> Report user…</button>
                </>
              )}
              {contextMenu.source === "member" && selectedChannel && contextMenu.user.id !== me.id && (
                <button role="menuitem" onClick={() => {
                  const user = contextMenu.user;
                  setContextMenu(null);
                  setDraft(previous => `${previous}${previous && !previous.endsWith(" ") ? " " : ""}<@${user.id}> `);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}>
                  Mention
                </button>
              )}
              {contextMenu.guildId && contextMenu.user.id !== me.id && (
                <>
                  {canChangeGuildNickname(contextMenu.user, contextMenu.guildId) && (
                    <button role="menuitem" disabled={contextBusy} onClick={() => void changeMemberNickname(contextMenu.user, contextMenu.guildId!)}>
                      Change Server Nickname
                    </button>
                  )}
                  {canManageGuildMember(contextMenu.user, contextMenu.guildId, 40) && (
                    <>
                      <button role="menuitem" disabled={contextBusy} onClick={() => void moderateMember(contextMenu.user, contextMenu.guildId!, "timeout")}>
                        Timeout Member…
                      </button>
                      {guildMembers.some(member =>
                        (member.user?.id || member.id) === contextMenu.user.id
                        && typeof member.communication_disabled_until === "string"
                        && Date.parse(member.communication_disabled_until) > Date.now()
                      ) && (
                        <button role="menuitem" disabled={contextBusy} onClick={() => void moderateMember(contextMenu.user, contextMenu.guildId!, "remove_timeout")}>
                          Remove Timeout
                        </button>
                      )}
                    </>
                  )}
                  {canManageGuildMember(contextMenu.user, contextMenu.guildId, 1) && (
                    <button className="danger" role="menuitem" disabled={contextBusy} onClick={() => void moderateMember(contextMenu.user, contextMenu.guildId!, "kick")}>
                      Kick Member…
                    </button>
                  )}
                  {canManageGuildMember(contextMenu.user, contextMenu.guildId, 2) && (
                    <button className="danger" role="menuitem" disabled={contextBusy} onClick={() => void moderateMember(contextMenu.user, contextMenu.guildId!, "ban")}>
                      Ban Member…
                    </button>
                  )}
                </>
              )}
              <div className="app-context-menu-divider" />
              <button role="menuitem" onClick={() => void copyContextValue(displayName(contextMenu.user), "Display name")}>
                <Copy size={14} /> Copy Display Name
              </button>
              <button role="menuitem" onClick={() => void copyContextValue(`@${contextMenu.user.username}`, "Username")}>
                <Copy size={14} /> Copy Username
              </button>
              <button role="menuitem" onClick={() => void copyContextValue(contextMenu.user.id, "User ID")}>
                <Copy size={14} /> Copy User ID
              </button>
              <button role="menuitem" onClick={() => void copyContextValue(`https://discord.com/users/${contextMenu.user.id}`, "User URL")}>
                <Copy size={14} /> Copy User URL
              </button>
            </>
          )}
          {contextMenu.kind === "message" && (
            <>
              <div className="app-context-menu-heading">Message by {displayName(contextMenu.message.author)}</div>
              <button role="menuitem" disabled={!!contextMenu.message.deleted_at || !isMessageChannel(contextMenu.channel)} onClick={() => {
                setReplyToMessage(contextMenu.message); setContextMenu(null); requestAnimationFrame(() => inputRef.current?.focus());
              }}>Reply</button>
              <button
                role="menuitem"
                disabled={!canForwardMessage(contextMenu.message)}
                title={!canForwardMessage(contextMenu.message) ? "This message type cannot be forwarded" : undefined}
                onClick={() => {
                  setForwardTarget({ message: contextMenu.message, channel: contextMenu.channel });
                  setContextMenu(null);
                }}
              >
                Forward Message…
              </button>
              {contextMenu.message.author.id === me.id && !contextMenu.message.deleted_at && (
                <button role="menuitem" onClick={() => startEditingMessage(contextMenu.message)}>Edit Message</button>
              )}
              {(contextMenu.message.author.id === me.id || (contextMenu.channel.guild_id && getChannelPermissions(
                contextMenu.channel,
                contextMenu.channel.guild_id,
                me.id,
                currentGuildMemberRolesRef.current,
                guildRoleDataRef.current,
                !!guilds.find(guild => guild.id === contextMenu.channel.guild_id)?.owner,
              )?.canManageMessages)) && !contextMenu.message.deleted_at && (
                <button className="danger" role="menuitem" disabled={contextBusy} onClick={() => void deleteMessage(contextMenu.message, contextMenu.channel)}>
                  Delete Message…
                </button>
              )}
              {(contextMenu.message.author.id === me.id || (contextMenu.channel.guild_id && getChannelPermissions(
                contextMenu.channel,
                contextMenu.channel.guild_id,
                me.id,
                currentGuildMemberRolesRef.current,
                guildRoleDataRef.current,
                !!guilds.find(guild => guild.id === contextMenu.channel.guild_id)?.owner,
              )?.canManageMessages)) && !contextMenu.message.deleted_at && (
                <div className="app-context-menu-divider" />
              )}
              <button
                role="menuitem"
                disabled={!contextMenu.message.content}
                onClick={() => void copyContextValue(contextMenu.message.content, "Message text")}
              >
                <Copy size={14} /> Copy Message Text
              </button>
              {contextMenu.message.author.id !== me.id && !contextMenu.message.deleted_at && (
                <button role="menuitem" onClick={() => {
                  const { message, channel } = contextMenu;
                  setContextMenu(null);
                  void openDiscordReportFlow(message.author.id, message, channel);
                }}><Flag size={14} /> Report Message…</button>
              )}
              <button role="menuitem" onClick={() => void copyContextValue(contextMenu.message.id, "Message ID")}>
                <Copy size={14} /> Copy Message ID
              </button>
              <button role="menuitem" onClick={() => void copyContextValue(
                `https://discord.com/channels/${contextMenu.channel.guild_id || "@me"}/${contextMenu.channel.id}/${contextMenu.message.id}`,
                "Message link",
              )}>
                <Copy size={14} /> Copy Message Link
              </button>
              <div className="app-context-menu-divider" />
              <button role="menuitem" onClick={() => {
                const author = contextMenu.message.author;
                setContextMenu(null);
                void handleOpenMemberProfile(author);
              }}>
                View Author Profile
              </button>
            </>
          )}
        </div>
      )}
      {systemNotice && (
        <div key={systemNotice.id} className={`system-notification ${systemNotice.exiting ? "exiting" : ""}`} role="status" aria-live="polite">
          <div className="system-notification-heading"><span>System</span><button type="button" aria-label="Dismiss notification" onClick={() => setSystemNotice(null)}><X size={13} /></button></div>
          <div>{systemNotice.message}</div>
        </div>
      )}
      {toast && <div key={toast.id} className={`toast ${toast.exiting ? "exiting" : ""}`} role="status" aria-live="polite">{toast.message}</div>}
    </main>
  );
}

// Sub-components
function ChannelRow({
  channel, selected, locked = false, unread = 0, onClick, onContextMenu,
}: {
  channel: DiscordChannel;
  selected: boolean;
  locked?: boolean;
  unread?: number;
  onClick: () => void;
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const isVoice = isVoiceChannel(channel);
  return (
    <button
      className={`channel-row ${selected ? "selected" : ""} ${locked ? "permission-locked" : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={locked ? "Permission check: this channel is hidden for the current account" : channel.name}
    >
      {isVoice ? <Volume2 size={16} /> : locked ? <LockKeyhole size={15} /> : <Hash size={16} />}
      <span style={{ flex: 1, textAlign: "left" }}>{channel.name}</span>
      {locked && <span className="channel-lock-label">LOCKED</span>}
      {!!unread && <span className="channel-unread-count">{unread > 99 ? "99+" : unread}</span>}
    </button>
  );
}

function MessageContent({
  message: m,
  channels,
  users,
  onChannelClick,
  onMediaOpen,
  onReactionToggle,
  autoplayVideos = false,
}: {
  message: DiscordMessage;
  channels?: DiscordChannel[];
  users?: DiscordUser[];
  onChannelClick?: (channelId: string) => void;
  onMediaOpen?: (url: string, kind: "image" | "video", name?: string) => void;
  onReactionToggle?: (message: DiscordMessage, emoji: string) => void;
  autoplayVideos?: boolean;
}) {
  return (
    <>
      {m.message_reference && m.message_reference.type !== 1 && (
        <div className="reply-message-reference"><span>↪ {m.referenced_message ? displayName(m.referenced_message.author) : "Reply to message"}</span><div>{m.referenced_message?.content || (m.referenced_message ? "Attachment or system message" : "Original message unavailable")}</div></div>
      )}
      {m.message_reference?.type === 1 && m.message_snapshots?.map((snapshot, index) => (
        <div className="forwarded-message" key={`${m.id}-snapshot-${index}`}>
          <div className="forwarded-message-label">↗ Forwarded message</div>
          {snapshot.content && (
            <div className="msg-text">
              <DiscordMarkdown content={snapshot.content} channels={channels} users={users} onChannelClick={onChannelClick} />
            </div>
          )}
          {snapshot.embeds?.map((embed, embedIndex) => (
            <DiscordEmbedView
              key={`${m.id}-snapshot-${index}-embed-${embedIndex}`}
              embed={embed}
              attachments={snapshot.attachments || []}
              channels={channels}
              users={users}
              onChannelClick={onChannelClick}
              onMediaOpen={onMediaOpen}
            />
          ))}
          {snapshot.attachments?.filter(isImageAttachment).map(attachment => (
            <img
              key={attachment.id}
              src={attachment.url}
              alt={attachment.filename}
              className="msg-attachment-img"
              role="button"
              tabIndex={0}
              onClick={() => onMediaOpen?.(attachment.url, "image", attachment.filename)}
            />
          ))}
          {snapshot.attachments?.filter(isVideoAttachment).map(attachment => (
            <div className="msg-video-attachment" key={attachment.id}>
              <video src={attachment.url} controls preload="metadata" autoPlay={autoplayVideos} muted={autoplayVideos} />
              <button type="button" onClick={() => onMediaOpen?.(attachment.url, "video", attachment.filename)}>Open video</button>
            </div>
          ))}
          {snapshot.attachments?.filter(attachment => !isImageAttachment(attachment) && !isVideoAttachment(attachment)).map(attachment => (
            <a key={attachment.id} href={attachment.url} target="_blank" rel="noopener noreferrer" className="msg-file-link">📎 {attachment.filename}</a>
          ))}
        </div>
      ))}

      {(m.type === 3 || m.call) && (
        <div className="msg-special-card msg-call-card" role="note">
          <Phone size={17} aria-hidden="true" />
          <div>
            <strong>{(m.call as any)?.ended_timestamp ? "Voice call ended" : "Voice call"}</strong>
            <span>{(m.call as any)?.ended_timestamp
              ? `Call ended · ${formatTimestamp((m.call as any).ended_timestamp)}`
              : "Call activity"}</span>
          </div>
        </div>
      )}

      {m.type !== 0 && m.type !== 3 && !m.content && !m.call
        && !(m.attachments?.length) && !(m.embeds?.length) && (
        <div className="msg-special-card msg-system-card" role="note">
          <span>{SYSTEM_MESSAGE_LABELS[m.type] || `Discord system message · type ${m.type}`}</span>
        </div>
      )}

      {m.content && (
        <div className="msg-text">
          <DiscordMarkdown content={m.content} channels={channels} users={users} onChannelClick={onChannelClick} />
        </div>
      )}

      {m.embeds && m.embeds.length > 0 && (
        <div className="msg-embeds-container">
          {m.embeds.filter(embed => !!embed && typeof embed === "object").map((embed, i) => (
            <DiscordEmbedView key={i} embed={embed} attachments={m.attachments} channels={channels} users={users} onChannelClick={onChannelClick} onMediaOpen={onMediaOpen} />
          ))}
        </div>
      )}

      {m.attachments
        ?.filter(isImageAttachment)
        ?.filter(a => !m.embeds?.some(e => [e.image?.url, e.thumbnail?.url, e.type === "image" ? e.url : undefined]
          .some(url => url === a.url || url === a.proxy_url || !!url?.includes(a.filename))))
        ?.map(a => (
          <img
            key={a.id}
            src={a.url}
            alt={a.filename}
            className="msg-attachment-img"
            role="button"
            tabIndex={0}
            aria-label={`Open image ${a.filename}`}
            onClick={() => onMediaOpen?.(a.url, "image", a.filename)}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onMediaOpen?.(a.url, "image", a.filename);
              }
            }}
            style={{ maxWidth: Math.min(a.width ?? 400, 400), maxHeight: 300, borderRadius: 6, marginTop: 4, display: "block" }}
          />
        ))}

      {m.attachments
        ?.filter(isVideoAttachment)
        ?.map(a => (
          <div className="msg-video-attachment" key={a.id}>
            <video src={a.url} controls preload="metadata" autoPlay={autoplayVideos} muted={autoplayVideos} />
            <button type="button" onClick={() => onMediaOpen?.(a.url, "video", a.filename)}>Open video</button>
          </div>
        ))}

      {m.attachments
        ?.filter(a => !isImageAttachment(a) && !isVideoAttachment(a))
        ?.map(a => (
          <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="msg-file-link">📎 {a.filename}</a>
        ))}

      {m.reactions && m.reactions.length > 0 && (
        <div className="reactions">
          {m.reactions.map((r, i) => r && (
            <button
              type="button"
              key={i}
              className={`reaction-pill ${r.me ? "mine-reaction" : ""}`}
              title={r.emoji?.name || "Reaction"}
              aria-label={`${r.emoji?.name || "emoji"} reaction, ${r.count} ${r.count === 1 ? "reaction" : "reactions"}${r.me ? ", remove your reaction" : ", add your reaction"}`}
              disabled={!onReactionToggle}
              onClick={() => {
                if (!onReactionToggle || !r.emoji?.name) return;
                const emoji = r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name;
                onReactionToggle(m, emoji);
              }}
            >
              {r.emoji?.id ? (
                <img
                  className="reaction-emoji"
                  src={`https://cdn.discordapp.com/emojis/${r.emoji.id}.${r.emoji.animated ? "gif" : "webp"}?size=32`}
                  alt={r.emoji.name || "Custom emoji"}
                  title={r.emoji.name || "Custom emoji"}
                />
              ) : (
                r.emoji?.name || "�"
              )}
              <span style={{ fontSize: 11 }}>{r.count}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function MsgActions({
  message,
  onReact,
}: {
  message: DiscordMessage;
  onReact: (emoji: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const emojis = EMOJI_PICKER_ITEMS.flatMap(group => group.items)
    .filter((emoji, index, list) => list.indexOf(emoji) === index);
  const filteredEmojis = query.trim()
    ? emojis.filter(emoji =>
      emoji.includes(query.trim())
      || (EMOJI_SEARCH_TERMS[emoji] || "").includes(query.trim().toLowerCase())
    )
    : emojis;

  return (
    <div className="msg-actions">
      <button
        type="button"
        className="msg-action-btn"
        title="Add reaction"
        aria-label={`Add reaction to message by ${displayName(message.author)}`}
        aria-expanded={pickerOpen}
        onClick={() => setPickerOpen(open => !open)}
      >
        <SmilePlus size={13} />
      </button>
      <button className="msg-action-btn" title="More"><MoreHorizontal size={13} /></button>
      {pickerOpen && (
        <div className="message-reaction-picker" role="dialog" aria-label="Choose a reaction">
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search emoji"
            aria-label="Search emoji"
            autoFocus
          />
          <div className="message-reaction-options">
            {filteredEmojis.slice(0, 96).map((emoji, index) => (
              <button
                key={`${emoji}-${index}`}
                type="button"
                title={EMOJI_SEARCH_TERMS[emoji] || emoji}
                aria-label={emoji}
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                  onReact(emoji);
                  setPickerOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
            {filteredEmojis.length === 0 && <span className="message-reaction-empty">No matching emoji</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function MediaVideoPlayer({
  src,
  autoplay,
  onToggleFullscreen,
}: {
  src: string;
  autoplay: boolean;
  onToggleFullscreen: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(autoplay);
  const [volume, setVolume] = useState(0.8);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [muted, volume]);

  useEffect(() => {
    if (!autoplay) return;
    const video = videoRef.current;
    if (!video) return;
    void video.play().catch(error => console.warn("Video autoplay was blocked", error));
  }, [autoplay, src]);

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
      } catch (error) {
        console.error("Could not play video", error);
      }
    } else {
      video.pause();
    }
  };

  const seek = (value: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(value)) return;
    video.currentTime = value;
    setCurrentTime(value);
  };

  const formatTime = (time: number) => {
    if (!Number.isFinite(time)) return "0:00";
    const seconds = Math.floor(time);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="media-video-player">
      <video
        ref={videoRef}
        className="media-viewer-video"
        src={src}
        autoPlay={autoplay}
        muted={muted}
        playsInline
        onClick={() => void togglePlayback()}
        onLoadedMetadata={event => setDuration(event.currentTarget.duration)}
        onDurationChange={event => setDuration(event.currentTarget.duration)}
        onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <div className="media-video-controls">
        <button type="button" title={playing ? "Pause" : "Play"} aria-label={playing ? "Pause video" : "Play video"} onClick={() => void togglePlayback()}>
          {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
        </button>
        <span className="media-video-time">{formatTime(currentTime)}</span>
        <input
          className="media-video-seek"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          aria-label="Seek video"
          style={{ "--media-progress": `${progress}%` } as React.CSSProperties}
          onChange={event => seek(Number(event.target.value))}
        />
        <span className="media-video-time">{formatTime(duration)}</span>
        <button type="button" title={muted ? "Unmute" : "Mute"} aria-label={muted ? "Unmute video" : "Mute video"} onClick={() => setMuted(value => !value)}>
          {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <input
          className="media-video-volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          aria-label="Video volume"
          style={{ "--media-progress": `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
          onChange={event => {
            const nextVolume = Number(event.target.value);
            setVolume(nextVolume);
            setMuted(nextVolume === 0);
          }}
        />
        <button type="button" title="Toggle full screen" aria-label="Toggle video full screen" onClick={onToggleFullscreen}><Maximize2 size={18} /></button>
      </div>
    </div>
  );
}

function GuildIcon({ guild }: { guild: DiscordGuild }) {
  const [hasError, setHasError] = useState(false);
  const iconUrl = useMemo(() => guildIconUrl(guild, 64), [guild.id, guild.icon]);

  useEffect(() => { setHasError(false); }, [guild.id, guild.icon]);

  if (!iconUrl || hasError) {
    return (
      <div className="guild-icon-fallback" title={guild.name}>
        <span>{getInitials(guild.name)}</span>
      </div>
    );
  }

  return <img src={iconUrl} alt={guild.name} onError={() => setHasError(true)} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} />;
}
