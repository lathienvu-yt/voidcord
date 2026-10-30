import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { load } from "@tauri-apps/plugin-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle, Archive, Ban, Bell, BellOff, Check, ChevronDown, ChevronRight, Compass, Copy, Download, Edit3, ExternalLink, Flame, Flag, Gamepad2, Gift, Hash, History,
  Headphones, Loader2, LockKeyhole, MessageSquare, Mic, MoreHorizontal, Pause, Phone, Pin, Play, Search, Send, Settings, ShoppingBag,
  Maximize2, RotateCcw, ShieldCheck, SmilePlus, Sparkles, Sticker, Terminal, Trash2, Trophy, UserPlus, UserX, Users, Volume2, VolumeX, WifiOff, Wrench, X,
  ZoomIn, ZoomOut
} from "lucide-react";

import {
  avatarDecorationUrl, avatarUrl, bannerUrl, displayName, formatDiscriminator, isVerifiedBot, formatTimestamp, guildIconUrl, primaryGuildBadgeUrl,
  DiscordChannel, DiscordGuild, DiscordMessage, DiscordReaction, DiscordRelationship, DiscordUser,
  CHANNEL_TYPE_CATEGORY, CHANNEL_TYPE_DM, CHANNEL_TYPE_GROUP_DM, CHANNEL_TYPE_TEXT, CHANNEL_TYPE_VOICE,
  CHANNEL_TYPE_ANNOUNCEMENT, CHANNEL_TYPE_STAGE,
} from "./types";
import { DiscordMarkdown } from "./DiscordMarkdown";
import { DiscordEmbedView } from "./DiscordEmbedView";
import { DiscordComponents } from "./DiscordComponents";
import InteractionModal from "./InteractionModal";
import SettingsMenu from "./SettingsMenu";
import {
  deleteDeletedMessage, deleteEditedMessage, markCachedMessageDeleted, readArchivedMedia, readCachedAppData, readCachedDraft,
  readCachedMessages, readDeletedChannels, readDeletedMessages, readEditedMessages, writeArchivedMedia, writeCachedAppData,
  writeCachedDraft, writeCachedMessages, writeDeletedChannel, writeDeletedMessage, DeletedChannelLog,
  DeletedMessageLog, EditedMessageLog, writeEditedMessage, readCachedCommands, writeCachedCommands,
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

type ContentInventoryEntry = {
  rank?: number;
  content?: {
    id?: string;
    author_id?: string;
    content_type?: number;
    started_at?: string;
    expires_at?: string;
    extra?: Record<string, any>;
    traits?: Array<{ type?: number; value?: unknown }>;
  };
};
type ContentInventoryResponse = {
  entries?: ContentInventoryEntry[];
  unranked_game_entries?: ContentInventoryEntry[];
  users?: DiscordUser[];
  refresh_token?: string;
};

function contentInventoryTitle(entry: ContentInventoryEntry): string {
  const extra = entry.content?.extra;
  if (!extra || typeof extra !== "object") return "Discord activity";
  switch (extra.type) {
    case "played_game_extra":
      return typeof extra.game_name === "string" ? extra.game_name : "Played a game";
    case "launched_activity_extra":
      return typeof extra.activity_name === "string" ? extra.activity_name : "Launched an activity";
    case "top_artist_extra":
      return typeof extra.artist?.name === "string" ? extra.artist.name : "Music activity";
    default:
      return "Discord activity";
  }
}

function contentInventorySubtitle(entry: ContentInventoryEntry): string {
  const extra = entry.content?.extra;
  if (!extra || typeof extra !== "object") return "Activity details unavailable";
  switch (extra.type) {
    case "played_game_extra":
      return typeof extra.platform === "string" ? `Played on ${extra.platform}` : "Game activity";
    case "launched_activity_extra":
      return "Launched activity";
    case "top_artist_extra": {
      const media = extra.media;
      if (typeof media?.title === "string" && media.title) return media.title;
      if (typeof media?.parent_title === "string" && media.parent_title) return media.parent_title;
      return "Music activity";
    }
    default:
      return "Activity details unavailable";
  }
}

function contentInventoryTimestamp(entry: ContentInventoryEntry): string | null {
  const value = entry.content?.started_at;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}
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
  const tokens = [...rawArguments.matchAll(/"([^"\\]*(?:\\\\.[^"\\]*)*)"|'([^']*)'|(\\S+)/g)]
    .map(match => (match[1] ?? match[2] ?? match[3] ?? "").replace(/\\\\(["\\\\])/g, "$1"));

  const rootOptions: any[] = Array.isArray(command?.options) ? command.options : [];
  let options = rootOptions;
  let selectedSubcommand: any | null = null;
  let selectedGroup: any | null = null;

  if (rootOptions.some((option: any) => option.type === 1 || option.type === 2)) {
    // Discord subcommand names are single identifiers. Accept the documented quoted
    // form (/command "subcommand") as well as the unquoted shorthand.
    const selectedName = tokens.shift()?.replace(/^\[|\]$/g, "");
    const selected = rootOptions.find((option: any) => option.name === selectedName && (option.type === 1 || option.type === 2));
    if (!selected) {
      throw new Error('Choose a subcommand using /' + command.name + ' "[sub command]". Available: ' + rootOptions.filter((option: any) => option.type === 1 || option.type === 2).map((option: any) => option.name).join(", "));
    }

    if (selected.type === 2) {
      selectedGroup = selected;
      const subcommandName = tokens.shift()?.replace(/^\[|\]$/g, "");
      selectedSubcommand = (selected.options || []).find((option: any) => option.name === subcommandName && option.type === 1);
      if (!selectedSubcommand) {
        throw new Error('Choose a subcommand from "' + selected.name + '": ' + (selected.options || []).filter((option: any) => option.type === 1).map((option: any) => option.name).join(", "));
      }
      options = Array.isArray(selectedSubcommand.options) ? selectedSubcommand.options : [];
    } else {
      selectedSubcommand = selected;
      options = Array.isArray(selected.options) ? selected.options : [];
    }
  }

  // Accept both positional values and explicit --option value pairs.
  const namedValues = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const option = options.find((candidate: any) => candidate.name === name);
      if (!option) throw new Error("Unknown option --" + name + ".");
      const value = tokens[++i];
      if (value === undefined || value.startsWith("--")) throw new Error("Missing value for --" + name + ".");
      namedValues.set(name, value);
    } else {
      positional.push(token);
    }
  }

  const result: any[] = [];
  let positionalIndex = 0;
  for (const option of options) {
    if (option.type === 1 || option.type === 2) continue;
    const token = namedValues.has(option.name) ? namedValues.get(option.name) : positional[positionalIndex++];
    if (token === undefined) {
      if (option.required) throw new Error("Missing required option: " + option.name + ". Use --" + option.name + " <value>.");
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
      const match = token.match(/\\d{15,22}/);
      if (!match) throw new Error(option.name + " needs a Discord mention or ID.");
      value = match[0];
    } else if (option.type === 11) {
      throw new Error("Attachment options aren't supported yet. Choose a command that doesn't require an uploaded file.");
    }

    if (Array.isArray(option.choices) && option.choices.length > 0) {
      const choice = option.choices.find((candidate: any) => String(candidate.value) === String(value));
      if (!choice) throw new Error(option.name + " must be one of: " + option.choices.map((candidate: any) => candidate.name).join(", "));
      value = choice.value;
    }
    result.push({ name: option.name, type: option.type, value });
  }
  if (positionalIndex < positional.length) {
    throw new Error("Too many positional arguments for /" + command.name + ". Use --option value for named parameters.");
  }

  // Discord expects a subcommand selection as a nested option object, even when it has no arguments.
  // Sending its children as top-level options causes HTTP 400 Invalid Form Body (50035).
  if (selectedSubcommand) {
    const nestedSubcommand = { name: selectedSubcommand.name, type: 1, options: result };
    if (selectedGroup) {
      return [{ name: selectedGroup.name, type: 2, options: [nestedSubcommand] }];
    }
    return [nestedSubcommand];
  }
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
  showSystemNotifications: boolean;
  systemNotificationDuration: number;
  channelSidebarWidth: number;
  chatFontScale: number;
  serverOrder: string[];
  serverFolders: Record<string, string>;
  cachedServerOrder: string[];
  cachedDiscordFolders: DiscordGuildFolder[];
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
  const defaults: AppPreferences = { accent: "blurple", compactMessages: false, reduceMotion: false, autoplayVideos: false, showSystemNotifications: true, systemNotificationDuration: 4200, channelSidebarWidth: 228, chatFontScale: 100, serverOrder: [], serverFolders: {}, cachedServerOrder: [], cachedDiscordFolders: [] };
  try {
    const saved = JSON.parse(localStorage.getItem("voidcord:preferences") || "{}");
    return {
      accent: ["blurple", "violet", "emerald"].includes(saved.accent) ? saved.accent : defaults.accent,
      compactMessages: typeof saved.compactMessages === "boolean" ? saved.compactMessages : defaults.compactMessages,
      reduceMotion: typeof saved.reduceMotion === "boolean" ? saved.reduceMotion : defaults.reduceMotion,
      autoplayVideos: typeof saved.autoplayVideos === "boolean" ? saved.autoplayVideos : defaults.autoplayVideos,
      showSystemNotifications: typeof saved.showSystemNotifications === "boolean" ? saved.showSystemNotifications : defaults.showSystemNotifications,
      systemNotificationDuration: Number.isFinite(saved.systemNotificationDuration) ? Math.max(2000, Math.min(10000, saved.systemNotificationDuration)) : defaults.systemNotificationDuration,
      channelSidebarWidth: Number.isFinite(saved.channelSidebarWidth) ? Math.max(180, Math.min(360, saved.channelSidebarWidth)) : defaults.channelSidebarWidth,
      chatFontScale: Number.isFinite(saved.chatFontScale) ? Math.max(85, Math.min(125, saved.chatFontScale)) : defaults.chatFontScale,
      serverOrder: Array.isArray(saved.serverOrder) ? saved.serverOrder.filter((id: unknown): id is string => typeof id === "string") : [],
      serverFolders: saved.serverFolders && typeof saved.serverFolders === "object" && !Array.isArray(saved.serverFolders) ? saved.serverFolders : {},
      cachedServerOrder: Array.isArray(saved.cachedServerOrder) ? saved.cachedServerOrder.filter((id: unknown): id is string => typeof id === "string") : [],
      cachedDiscordFolders: Array.isArray(saved.cachedDiscordFolders) ? saved.cachedDiscordFolders.filter((folder: unknown) => !!folder && typeof folder === "object") as DiscordGuildFolder[] : [],
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

type DiscordGuildFolder = { id: string | null; name: string; color: number | null; guildIds: string[] };
type DiscordGuildFolderSettings = { folders: DiscordGuildFolder[]; positions: string[] };
function decodeGuildFolderSettings(encoded: string): DiscordGuildFolderSettings {
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const readVarint = (data: Uint8Array, cursor: { value: number }): bigint => { let value = 0n, shift = 0n; while (cursor.value < data.length && shift < 70n) { const b = data[cursor.value++]; value |= BigInt(b & 127) << shift; if (!(b & 128)) return value; shift += 7n; } throw new Error("Invalid protobuf varint"); };
  const fields = (data: Uint8Array) => { const out: Array<{n:number;w:number;v:Uint8Array|bigint}> = [], c={value:0}; while(c.value<data.length){const k=Number(readVarint(data,c)),n=k>>>3,w=k&7;if(!n)throw new Error("Invalid protobuf field");if(w===0)out.push({n,w,v:readVarint(data,c)});else if(w===1||w===5){const size=w===1?8:4;if(c.value+size>data.length)throw new Error("Truncated fixed field");out.push({n,w,v:data.slice(c.value,c.value+size)});c.value+=size;}else if(w===2){const size=Number(readVarint(data,c));if(!Number.isSafeInteger(size)||size<0||c.value+size>data.length)throw new Error("Invalid protobuf length");out.push({n,w,v:data.slice(c.value,c.value+size)});c.value+=size;}else throw new Error("Unsupported protobuf wire type");}return out;};
  const b=(f:{v:Uint8Array|bigint})=>{if(!(f.v instanceof Uint8Array))throw new Error("Expected bytes");return f.v;};
  const id=(f:{w:number;v:Uint8Array|bigint})=>{if(f.w===0)return String(f.v);if(f.w===1&&f.v instanceof Uint8Array){let n=0n;for(let i=7;i>=0;i--)n=(n<<8n)|BigInt(f.v[i]);return n.toString();}throw new Error("Unexpected ID encoding");};
  const root=fields(bytes), parent=root.find(f=>f.n===14&&f.w===2);if(!parent)return {folders:[],positions:[]};const body=fields(b(parent));
  const folders=body.filter(f=>f.n===1&&f.w===2).map(f=>{const fs=fields(b(f));const guildIds=fs.filter(x=>x.n===1).flatMap(x=>x.w===1?[id(x)]:x.w===2?(()=>{const packed=b(x),ids:string[]=[];for(let o=0;o+8<=packed.length;o+=8)ids.push(id({w:1,v:packed.slice(o,o+8)}));return ids;})():[]);const wrapper=(n:number)=>{const f=fs.find(x=>x.n===n&&x.w===2);return f?fields(b(f)).find(x=>x.n===1):undefined;};const fi=wrapper(2),fn=wrapper(3),fc=wrapper(4);return {id:fi?String(fi.v):null,name:fn&&fn.v instanceof Uint8Array?new TextDecoder().decode(fn.v):"",color:fc?Number(fc.v):null,guildIds};}).filter(f=>f.guildIds.length>0);
  const p=body.find(f=>f.n===2);let positions:string[]=[];if(p?.w===1)positions=[id(p)];else if(p?.w===2){const packed=b(p);if(packed.length%8===0)for(let o=0;o<packed.length;o+=8)positions.push(id({w:1,v:packed.slice(o,o+8)}));}return {folders,positions};
}

function encodeGuildFolderSettings(settings: DiscordGuildFolderSettings): string {
  const join = (...chunks: Uint8Array[]) => { const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let offset = 0; for (const c of chunks) { out.set(c, offset); offset += c.length; } return out; };
  const vi = (input: bigint) => { const out: number[] = []; let n = input; while (n > 127n) { out.push(Number(n & 127n) | 128); n >>= 7n; } out.push(Number(n)); return Uint8Array.from(out); };
  const key = (field: number, wire: number) => vi(BigInt(field * 8 + wire));
  const blob = (field: number, value: Uint8Array) => join(key(field, 2), vi(BigInt(value.length)), value);
  const fixed = (field: number, value: string) => { let n = BigInt(value); const b = new Uint8Array(8); for (let i = 0; i < 8; i++) { b[i] = Number(n & 255n); n >>= 8n; } return join(key(field, 1), b); };
  const wrapper = (field: number, value: Uint8Array) => blob(field, blob(1, value));
  const folders = settings.folders.map(folder => {
    const parts = folder.guildIds.map(id => fixed(1, id));
    if (folder.id) parts.push(wrapper(2, vi(BigInt(folder.id))));
    if (folder.name) parts.push(wrapper(3, new TextEncoder().encode(folder.name)));
    if (folder.color !== null) parts.push(wrapper(4, vi(BigInt(folder.color))));
    return blob(1, join(...parts));
  });
  const positions = settings.positions.map(id => fixed(2, id));
  const encoded = blob(14, join(...folders, ...positions));
  let binary = ""; for (const byte of encoded) binary += String.fromCharCode(byte);
  return btoa(binary);
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
                <div className="account-switcher-name"><strong>{displayName(account.user)}</strong><small>@{account.user.username}{formatDiscriminator(account.user)}{current ? " · Current" : ""}</small></div>
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
  const [rawMessage, setRawMessage] = useState<DiscordMessage | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [guilds, setGuilds] = useState<DiscordGuild[]>([]);
  const [discordGuildFolders, setDiscordGuildFolders] = useState<DiscordGuildFolderSettings | null>(null);
  const [collapsedServerFolders, setCollapsedServerFolders] = useState<Set<string>>(() => new Set());
  const [selectedGuild, setSelectedGuild] = useState<DiscordGuild | null>(null);
  const [dmChannels, setDmChannels] = useState<DiscordChannel[]>([]);
  const [recentlyMessaged, setRecentlyMessaged] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("voidcord:recently-messaged") || "[]");
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
    } catch { return []; }
  });
  const [isDmView, setIsDmView] = useState(true);
  const [activeDmTab, setActiveDmTab] = useState<"friends" | "friend-requests" | "message-requests" | "notifications" | "nitro" | "shop" | "quests" | "chat">("friends");
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
  const [messageRequestTab, setMessageRequestTab] = useState<"all" | "spam">("all");
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
  const [activityEntries, setActivityEntries] = useState<ContentInventoryEntry[]>([]);
  const [activityUsers, setActivityUsers] = useState<Record<string, DiscordUser>>({});
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const activityRefreshTokenRef = useRef<string | undefined>(undefined);

  const loadActivityFeed = useCallback(async () => {
    setActivityLoading(true);
    setActivityError("");
    try {
      const response = await tauriInvoke<ContentInventoryResponse>("get_content_inventory", {
        refreshToken: activityRefreshTokenRef.current ?? null,
      });
      if (typeof response?.refresh_token === "string" && response.refresh_token.length > 0) {
        activityRefreshTokenRef.current = response.refresh_token;
      }
      if (Array.isArray(response?.users)) {
        setActivityUsers(prev => {
          const next = { ...prev };
          for (const u of response.users!) {
            if (u && u.id) next[u.id] = u;
          }
          return next;
        });
      }
      const combined = [
        ...(Array.isArray(response?.entries) ? response.entries : []),
        ...(Array.isArray(response?.unranked_game_entries) ? response.unranked_game_entries : []),
      ];
      const seen = new Set<string>();
      setActivityEntries(combined.filter(entry => {
        const id = entry.content?.id;
        if (typeof id !== "string" || !id) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      }));
    } catch (error) {
      setActivityError(String(error).replace(/^Error: /, ""));
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (me && isDmView && activeDmTab === "friends" && friendView !== "add") {
      void loadActivityFeed();
    }
  }, [me?.id, isDmView, activeDmTab, friendView, loadActivityFeed]);

  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>(() => {
    // Only ping/reply counts are shown as red numbers, not ordinary unread messages.
    try { const saved = JSON.parse(localStorage.getItem("voidcord:ping-counts") || "{}"); return saved && typeof saved === "object" ? saved : {}; }
    catch { return {}; }
  });
  type NotificationCenterItem = { id: string; type: string; body?: string; acked: boolean; icon_url?: string | null; other_user?: DiscordUser | null; message?: DiscordMessage | null; message_id?: string | null; message_channel_id?: string | null; message_content?: string | null; deeplink?: string; };
  const [notificationItems, setNotificationItems] = useState<NotificationCenterItem[]>([]);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");
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
  const [settingsTab, setSettingsTab] = useState<"account" | "themes" | "notifications">("account");
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
  const [slashCommandAppFilter, setSlashCommandAppFilter] = useState("all");
  const slashCommandApps = useMemo(() => {
    const appIds = [...new Set(slashCommands.map(command => String(command.application_id || "unknown")))];
    return appIds.map(applicationId => {
      const command = slashCommands.find(item => String(item.application_id || "unknown") === applicationId);
      const botFromDm = dmChannels.flatMap(channel => channel.recipients || []).find(user => user.bot && user.id === applicationId);
      const botFromGuild = guildMembers.map(member => member?.user || member).find(user => user?.bot && String(user.id) === applicationId);
      const bot = botFromDm || botFromGuild;
      const label = command?.application?.name || command?.application_name || bot?.global_name || bot?.username || (applicationId === "unknown" ? "Unknown app" : `App …${applicationId.slice(-4)}`);
      return { id: applicationId, label, count: slashCommands.filter(item => String(item.application_id || "unknown") === applicationId).length };
    }).sort((left, right) => left.label.localeCompare(right.label));
  }, [slashCommands, dmChannels, guildMembers]);
  const visibleSlashCommands = useMemo(() => slashCommandAppFilter === "all"
    ? slashCommands
    : slashCommands.filter(command => String(command.application_id || "unknown") === slashCommandAppFilter), [slashCommands, slashCommandAppFilter]);
  const [slashCommandSearchStatus, setSlashCommandSearchStatus] = useState("");
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<any | null>(null);
  const [gatewaySessionId, setGatewaySessionId] = useState("");
  const [interactionModal, setInteractionModal] = useState<any | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [forwardTarget, setForwardTarget] = useState<{ message: DiscordMessage; channel: DiscordChannel } | null>(null);
  const [forwardBusy, setForwardBusy] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
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
  const cachedCommandsRef = useRef<any[]>([]);
  

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

  const notifySystem = useCallback((msg: string, ms = preferences.systemNotificationDuration) => {
    if (!preferences.showSystemNotifications) return;
    setSystemNotice({ id: ++notificationSequence.current, message: msg, duration: ms, exiting: false });
  }, [preferences.showSystemNotifications, preferences.systemNotificationDuration]);

  const loadNotificationCenter = useCallback(async () => {
    setNotificationLoading(true); setNotificationError("");
    try { const response = await invoke<{ items?: NotificationCenterItem[] }>("get_notification_center_items"); setNotificationItems(Array.isArray(response?.items) ? response.items : []); }
    catch (error) { setNotificationError(String(error)); }
    finally { setNotificationLoading(false); }
  }, [invoke]);

  const acknowledgeNotification = useCallback(async (item: NotificationCenterItem) => {
    try { await invoke("ack_notification_center_item", { itemId: item.id }); setNotificationItems(previous => previous.map(current => current.id === item.id ? { ...current, acked: true } : current)); }
    catch (error) { notify("Could not acknowledge notification: " + error); }
  }, [invoke, notify]);

  useEffect(() => { if (me && isDmView && activeDmTab === "notifications") void loadNotificationCenter(); }, [me?.id, isDmView, activeDmTab, loadNotificationCenter]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen("discord:notification_center_update", () => {
      if (me && isDmView && activeDmTab === "notifications") void loadNotificationCenter();
    }).then(stop => { unlisten = stop; }).catch(error => console.warn("Could not subscribe to notification center updates", error));
    return () => { unlisten?.(); };
  }, [me?.id, isDmView, activeDmTab, loadNotificationCenter]);

  // Load cached commands immediately so autocomplete remains useful during startup/offline.
  useEffect(() => {
    let cancelled = false;
    readCachedCommands().then(commands => {
      if (!cancelled && Array.isArray(commands)) cachedCommandsRef.current = commands;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // When opening a bot DM, its bot user ID is also its application ID.
  useEffect(() => {
    if (!selectedChannel || selectedChannel.type !== CHANNEL_TYPE_DM) return;
    const botRecipient = selectedChannel.recipients?.find(user => user.bot && user.id !== me?.id);
    if (!botRecipient) return;
    const botId = botRecipient.id;
    let cancelled = false;
    invoke<any>("get_global_application_commands", { applicationId: botId, withLocalizations: true })
      .then(response => {
        if (cancelled) return;
        const payload = response?.data ?? response;
        const entries: any[] = Array.isArray(payload) ? payload
          : Array.isArray(payload?.application_commands) ? payload.application_commands
          : Array.isArray(payload?.commands) ? payload.commands : [];
        const normalized = entries
          .filter((entry: any) => entry && typeof entry === "object" && entry.id && typeof entry.name === "string")
          .filter((entry: any) => entry.type === undefined || entry.type === 1)
          .map((entry: any) => ({ ...entry, id: String(entry.id), application_id: botId }));
        if (!normalized.length) return;
        const merged = new Map<string, any>();
        for (const command of cachedCommandsRef.current) {
          if (command?.id && command?.application_id) merged.set(command.application_id + ":" + command.id, command);
        }
        for (const command of normalized) merged.set(command.application_id + ":" + command.id, command);
        cachedCommandsRef.current = [...merged.values()].slice(-500);
        void writeCachedCommands(cachedCommandsRef.current);
        try {
          const saved: string[] = JSON.parse(localStorage.getItem("voidcord:application-command-app-ids") || "[]");
          if (!saved.includes(botId)) localStorage.setItem("voidcord:application-command-app-ids", JSON.stringify([botId, ...saved].slice(0, 50)));
        } catch {}
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedChannel?.id, selectedChannel?.type, me?.id, invoke]);

  useEffect(() => {
    const match = draft.match(/^\/([^\s]*)$/);
    if (!match || !selectedChannel || selectedSlashCommand) {
      setSlashCommands([]);
      setSlashCommandSearchStatus("");
      return;
    }

    let cancelled = false;
    const query = match[1].toLowerCase();
    const cachedHits = cachedCommandsRef.current.filter(command =>
      command && typeof command.name === "string"
      && command.name.toLowerCase().startsWith(query)
      && (command.type === undefined || command.type === 1)
      && command.id && command.application_id
    );
    if (cachedHits.length) {
      setSlashCommands(cachedHits.slice(0, 50));
      setSlashCommandSearchStatus("⚡ Cached commands — refreshing…");
    } else {
      setSlashCommands([]);
      setSlashCommandSearchStatus("Loading registered slash commands…");
    }

    const applicationIds = new Set<string>();
    // The bot's user ID is its application ID. Discover likely candidates from known bot users.
    if (selectedChannel.type === CHANNEL_TYPE_DM) {
      const bot = selectedChannel.recipients?.find(user => user.bot && user.id !== me?.id);
      if (bot) applicationIds.add(bot.id);
    }
    for (const dm of dmChannels) {
      if (dm.type === CHANNEL_TYPE_DM) {
        const bot = dm.recipients?.find(user => user.bot);
        if (bot?.id) applicationIds.add(bot.id);
      }
    }
    for (const member of guildMembers) {
      const user = (member as any).user || member;
      if (user?.bot && user?.id) applicationIds.add(String(user.id));
    }
    try {
      const saved = JSON.parse(localStorage.getItem("voidcord:application-command-app-ids") || "[]");
      if (Array.isArray(saved)) saved.forEach((id: unknown) => {
        if (typeof id === "string" && /^\d{15,22}$/.test(id)) applicationIds.add(id);
      });
    } catch {}
    const ids = [...applicationIds].slice(0, 30);

    const timer = window.setTimeout(async () => {
      try {
        const results = await Promise.all(ids.map(async applicationId => {
          const requests: Promise<any>[] = [
            invoke<any>("get_global_application_commands", { applicationId, withLocalizations: true })
              .then(value => ({ value })).catch(() => null),
          ];
          if (selectedChannel.guild_id) {
            requests.push(invoke<any>("get_guild_application_commands", {
              applicationId, guildId: selectedChannel.guild_id, withLocalizations: true,
            }).then(value => ({ value })).catch(() => null));
          }
          return Promise.all(requests);
        }));
        if (cancelled) return;
        const fetched: any[] = [];
        for (let index = 0; index < results.length; index++) {
          for (const result of results[index]) {
            if (!result) continue;
            const payload = result.value?.data ?? result.value;
            const entries = Array.isArray(payload) ? payload
              : Array.isArray(payload?.application_commands) ? payload.application_commands
              : Array.isArray(payload?.commands) ? payload.commands : [];
            fetched.push(...entries
              .filter((entry: any) => entry && typeof entry === "object" && entry.id && typeof entry.name === "string")
              .filter((entry: any) => entry.type === undefined || entry.type === 1)
              .map((entry: any) => ({ ...entry, id: String(entry.id), application_id: String(entry.application_id || ids[index]) })));
          }
        }
        const merged = new Map<string, any>();
        for (const command of cachedCommandsRef.current) {
          if (command?.id && command?.application_id) merged.set(command.application_id + ":" + command.id, command);
        }
        for (const command of fetched) merged.set(command.application_id + ":" + command.id, command);
        cachedCommandsRef.current = [...merged.values()].slice(-500);
        if (fetched.length) void writeCachedCommands(cachedCommandsRef.current);
        const matching = fetched.filter(command => command.name.toLowerCase().startsWith(query)).slice(0, 50);
        if (matching.length) {
          setSlashCommands(matching);
          setSlashCommandSearchStatus("");
        } else {
          setSlashCommands(cachedHits.slice(0, 50));
          setSlashCommandSearchStatus(cachedHits.length
            ? "⚡ Showing cached commands"
            : ids.length ? "No matching registered slash commands found." : "No bot application IDs discovered yet. Open a bot DM or use Developer Tools → Application Commands.");
        }
      } catch (error) {
        if (!cancelled) {
          setSlashCommands(cachedHits.slice(0, 50));
          setSlashCommandSearchStatus(cachedHits.length ? "⚡ Offline — showing cached commands" : "Could not load commands: " + String(error));
        }
      }
    }, cachedHits.length ? 250 : 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [draft, selectedChannel?.id, selectedChannel?.guild_id, selectedChannel?.type, selectedSlashCommand, invoke, dmChannels, guildMembers, me?.id]);

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

  const zoomMediaAtPointer = (event: WheelEvent) => {
    event.preventDefault();
    const zoomTarget = mediaViewerRef.current?.querySelector(".media-image-zoom");
    const stage = mediaViewerRef.current?.querySelector(".media-viewer-stage");
    const bounds = zoomTarget?.getBoundingClientRect() || stage?.getBoundingClientRect();
    if (!bounds || !bounds.width || !bounds.height) return;
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

  useEffect(() => {
    if (mediaViewer?.kind !== "image") return;
    const stage = mediaViewerRef.current?.querySelector(".media-viewer-stage");
    if (!stage) return;

    // React/browser wheel listeners may be passive, so register explicitly as non-passive
    // when we need to cancel the browser zoom/scroll gesture for image zooming.
    const onWheel = ((event: WheelEvent) => zoomMediaAtPointer(event)) as EventListener;
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [mediaViewer?.kind]);

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

  // Pre-fetch data worker: loads up to 20 channels (top DMs + guild text channels), presences, and application commands
  const prefetchRunningRef = useRef(false);
  useEffect(() => {
    if (!me?.id || prefetchRunningRef.current || !navigator.onLine) return;
    if (dmChannels.length === 0 && guilds.length === 0) return;

    prefetchRunningRef.current = true;

    const runPrefetch = async () => {
      // 1. Gather up to 20 channels (top DMs + first text channel of top guilds)
      const targetChannels: DiscordChannel[] = [];
      targetChannels.push(...dmChannels.slice(0, 10));

      for (const g of guilds.slice(0, 10)) {
        try {
          const cached = await readCachedAppData<{ channels: DiscordChannel[] }>(`guild-data:${g.id}`);
          if (cached?.channels) {
            const first = cached.channels.find(c => isTextChannel(c));
            if (first && !targetChannels.some(tc => tc.id === first.id)) targetChannels.push(first);
          }
        } catch {}
      }

      // Pre-fetch messages for gathered channels in the background
      for (const ch of targetChannels.slice(0, 20)) {
        try {
          const msgs = await invoke<DiscordMessage[]>("get_messages", { channelId: ch.id });
          if (Array.isArray(msgs) && msgs.length > 0) {
            void writeCachedMessages(ch.id, msgs);
          }
        } catch {}
        await new Promise(r => setTimeout(r, 60));
      }

      // 2. Discover bot IDs across DMs and relationships for slash commands pre-fetch
      const botIds = new Set<string>();
      dmChannels.forEach(dm => dm.recipients?.forEach(u => { if (u.bot) botIds.add(u.id); }));
      relationships.forEach(rel => { if (rel.user?.bot) botIds.add(rel.user.id); });

      // Add common/popular bots (Pancake, Midjourney, Carl, Dyno, Tupperbox)
      ["239631525350604801", "936929561302675456", "235148963517071360", "155149108183695360", "431544605203955712"].forEach(id => botIds.add(id));

      try {
        const saved = JSON.parse(localStorage.getItem("voidcord:application-command-app-ids") || "[]");
        if (Array.isArray(saved)) saved.forEach(id => { if (typeof id === "string") botIds.add(id); });
      } catch {}

      const allBotIds = [...botIds].slice(0, 15);
      try {
        localStorage.setItem("voidcord:application-command-app-ids", JSON.stringify(allBotIds));
      } catch {}

      // Pre-fetch global application commands for discovered bots
      await Promise.allSettled(allBotIds.map(appId =>
        invoke<any>("get_global_application_commands", { applicationId: appId, withLocalizations: true })
      ));
    };

    const timer = setTimeout(() => {
      void runPrefetch();
    }, 1800);

    return () => clearTimeout(timer);
  }, [me?.id, dmChannels.length, guilds.length]);

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

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<string>("native-menu-action", event => {
      switch (event.payload) {
        case "reload": window.location.reload(); break;
        case "close": void getCurrentWindow().close(); break;
        case "devtools": void tauriInvoke("toggle_devtools").catch(error => console.error("Could not toggle WebView DevTools", error)); break;
        case "deleted-log": void openMessageLogger(); break;
      }
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
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
    setTimeout(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, 50);
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [messages.length, scrollToBottom]);

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
        try {
          const proto = await invoke<{ settings?: string }>("get_guild_folder_settings");
          if (proto.settings) {
            const decoded = decodeGuildFolderSettings(proto.settings);
            setDiscordGuildFolders(decoded);
            const remoteOrder = [...new Set([...decoded.folders.flatMap(folder => folder.guildIds), ...decoded.positions])];
            setPreferences(current => ({ ...current, cachedServerOrder: remoteOrder, cachedDiscordFolders: decoded.folders }));
          }
        } catch (settingsError) {
          console.warn("Could not load Discord guild folder settings; keeping local sidebar layout", settingsError);
        }
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
          const incomingMessage = payload.message as DiscordMessage & { mentions?: DiscordUser[] };
          const isDirectPing = Array.isArray(incomingMessage.mentions) && incomingMessage.mentions.some(user => user.id === me?.id);
          const isReplyToMe = incomingMessage.referenced_message?.author?.id === me?.id;
          if (isDirectPing || isReplyToMe) {
            setUnreadByChannel(previous => {
              const next = { ...previous, [payload.channel_id]: (previous[payload.channel_id] || 0) + 1 };
              try { localStorage.setItem("voidcord:ping-counts", JSON.stringify(next)); } catch { /* optional cache */ }
              return next;
            });
          }
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

    listen<any>("discord:interaction_modal_create", ({ payload }) => {
      if (payload && typeof payload === "object") setInteractionModal(payload);
    }).then(unsub => unsubs.push(unsub));
    listen<any>("discord:interaction_iframe_modal_create", () => {
      notify("This interaction uses an embedded iframe modal, which VoidCord does not support yet.");
    }).then(unsub => unsubs.push(unsub));

    listen<any>("discord:gateway_ready", ({ payload }) => {
      if (typeof payload?.session_id === "string") setGatewaySessionId(payload.session_id);
      if (Array.isArray(payload?.presences)) {
        applyPresenceUpdates(payload.presences);
      }
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
    // Do not wipe memberPresences so DM & friends status dots persist!
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
    if (channel.last_message_id) {
      void invoke("acknowledge_message", { channelId: channel.id, messageId: channel.last_message_id })
        .catch(error => console.warn("Could not acknowledge channel read state", error));
    }
    setEditingMessageId(null);
    setMessages([]);
    setUnreadByChannel(previous => {
      if (!previous[channel.id]) return previous;
      const next = { ...previous };
      delete next[channel.id];
      try { localStorage.setItem("voidcord:ping-counts", JSON.stringify(next)); } catch { /* optional cache */ }
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
      setKnownLockedChannels(previous => new Set(previous).add(channel.id));
      const cachedMessages = await readCachedMessages(channel.id).catch(() => undefined);
      if (requestId !== channelLoadRequest.current) return;
      if (cachedMessages && cachedMessages.length > 0) {
        messageHistoryRef.current[channel.id] = cachedMessages;
        setMessages(cachedMessages);
        setOfflineCache(true);
        setMsgLoading(false);
        requestAnimationFrame(() => scrollToBottom());
        return;
      }
      setMessages([]);
      setMsgLoading(false);
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
        const acceptedChannel: DiscordChannel = {
          ...channel,
          is_message_request: false,
          is_message_request_timestamp: null,
          is_spam: false,
        };
        setDmChannels(previous => [acceptedChannel, ...previous.filter(item => item.id !== channel.id)]);
        setActiveDmTab("chat");
        await selectChannel(acceptedChannel);
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

  const blockAndIgnoreMessageRequest = async (channel: DiscordChannel) => {
    const sender = channel.recipients?.[0];
    if (!sender) return;
    setRequestBusy(channel.id);
    try {
      await invoke("update_relationship", { userId: sender.id, action: "block" });
      try {
        await invoke("update_message_request", { channelId: channel.id, action: "ignore" });
      } catch {}
      setMessageRequests(previous => previous.filter(request => request.id !== channel.id));
      if (selectedMessageRequest?.id === channel.id) {
        setSelectedMessageRequest(null);
        setRequestMessages([]);
        setRequestMessagesError("");
      }
      notify(`Blocked @${sender.username} and ignored message request`);
      await refreshRelationships();
    } catch (e) {
      notify(`Could not block user: ${e}`);
    } finally {
      setRequestBusy(null);
    }
  };

  const batchRejectRequests = async (channelIds: string[]) => {
    if (channelIds.length === 0) return;
    try {
      await invoke("batch_reject_message_requests", { channelIds });
      setMessageRequests(previous => previous.filter(request => !channelIds.includes(request.id)));
      if (selectedMessageRequest && channelIds.includes(selectedMessageRequest.id)) {
        setSelectedMessageRequest(null);
        setRequestMessages([]);
        setRequestMessagesError("");
      }
      notify(`Cleared ${channelIds.length} message request${channelIds.length > 1 ? "s" : ""}`);
    } catch (e) {
      notify(`Could not clear message requests: ${e}`);
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
    if (slashCommands.length > 0 && /^\/[^\s]*$/.test(draft)) {
      if (event.key === " " || event.key === "Tab" || (event.key === "Enter" && !selectedSlashCommand)) {
        const query = draft.slice(1).toLowerCase();
        const cmd = slashCommands.find(c => c.name.toLowerCase() === query)
          || slashCommands.find(c => c.name.toLowerCase().startsWith(query))
          || slashCommands[0];
        if (cmd) {
          event.preventDefault();
          setSelectedSlashCommand(cmd);
          const nextDraft = "/" + cmd.name + " ";
          setDraft(nextDraft);
          setSlashCommands([]);
          setSlashCommandSearchStatus("");
          requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(nextDraft.length, nextDraft.length);
          });
          return;
        }
      }
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
    && (activeDmTab === "friends" || activeDmTab === "friend-requests" || activeDmTab === "message-requests" || activeDmTab === "notifications");

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
        localStorage.setItem("voidcord:ping-counts", JSON.stringify(next));
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
    const localOrder = new Map(preferences.serverOrder.map((id, index) => [id, index]));
    const remoteOrder = new Map<string, number>(); let next = 0;
    for (const folder of (discordGuildFolders?.folders || preferences.cachedDiscordFolders)) for (const id of folder.guildIds) if (!remoteOrder.has(id)) remoteOrder.set(id, next++);
    for (const id of (discordGuildFolders?.positions || preferences.cachedServerOrder)) if (!remoteOrder.has(id)) remoteOrder.set(id, next++);
    const original = new Map(guilds.map((guild, index) => [guild.id, index]));
    return [...guilds].sort((a,b) => { const la=localOrder.get(a.id),lb=localOrder.get(b.id); if(la!==undefined||lb!==undefined){if(la===undefined)return 1;if(lb===undefined)return -1;if(la!==lb)return la-lb;}return (remoteOrder.get(a.id)??(next+(original.get(a.id)||0)))-(remoteOrder.get(b.id)??(next+(original.get(b.id)||0))); });
  }, [guilds, preferences.serverOrder, preferences.cachedServerOrder, preferences.cachedDiscordFolders, discordGuildFolders]);
  const remoteFolderByGuild = useMemo(() => { const map=new Map<string,DiscordGuildFolder>(); for(const folder of (discordGuildFolders?.folders || preferences.cachedDiscordFolders))for(const id of folder.guildIds)map.set(id,folder);return map; },[discordGuildFolders, preferences.cachedDiscordFolders]);
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
              const remoteFolder = remoteFolderByGuild.get(g.id);
              const folder = remoteFolder?.name || preferences.serverFolders[g.id]?.trim();
              const previousGuild = i > 0 ? orderedGuilds[i - 1] : undefined;
              const previous = (previousGuild && remoteFolderByGuild.get(previousGuild.id)?.name) || (previousGuild ? preferences.serverFolders[previousGuild.id]?.trim() : undefined);
              const folderColor = remoteFolder?.color ? `#${remoteFolder.color.toString(16).padStart(6, "0").slice(-6)}` : undefined;
              return (
                <React.Fragment key={g.id}>
                  {folder && folder !== previous && <button type="button" className="server-folder-label" title={`${folder} · click to ${collapsedServerFolders.has(folder) ? "expand" : "collapse"}`} style={folderColor ? { borderLeft: `3px solid ${folderColor}` } : undefined} onClick={() => setCollapsedServerFolders(current => { const next = new Set(current); if (next.has(folder)) next.delete(folder); else next.add(folder); return next; })}><span>{collapsedServerFolders.has(folder) ? "▸" : "▾"} {folder}</span></button>}
                  {folder && collapsedServerFolders.has(folder) ? null : <button
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
                  </button>}
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
                  <button className={"dm-nav-item " + (activeDmTab === "notifications" ? "active" : "")} onClick={() => setActiveDmTab("notifications")}><Bell size={16} /><span>Notifications</span>{notificationItems.filter(item => !item.acked && (item.type === "recent_mention" || item.type === "reply_mention")).length > 0 && <span className="dm-nav-count">{notificationItems.filter(item => !item.acked && (item.type === "recent_mention" || item.type === "reply_mention")).length}</span>}</button>
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
                        <span className={`dm-status-dot status-${recipientStatus}`} />
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
              <button className="user-bar-btn" title="Open Rust Console" aria-label="Open Rust Console" onClick={() => void tauriInvoke("open_rust_console").catch(error => console.error("Could not open Rust console", error))}><Terminal size={15} /></button>
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
                    <strong>{displayName(profileUser)} <PlatformIndicators platforms={memberPlatforms[profileUser.id] || []} /></strong>
                    <span className="profile-popover-handle">@{profileUser.username}{formatDiscriminator(profileUser)}</span>
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
                        <div className="profile-popover-bio"><DiscordMarkdown content={profileBio} /></div>
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
                        <div className="profile-bio-markdown-preview">
                          <div className="profile-bio-markdown-preview-label">Markdown preview</div>
                          {bioDraft.trim()
                            ? <DiscordMarkdown content={bioDraft} channels={channels} users={mentionUsers} onChannelClick={jumpToChannel} />
                            : <span className="profile-bio-markdown-empty">Bold, italic, links, inline code, and line breaks preview here.</span>}
                        </div>
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

            {activeDmTab === "notifications" ? (
              <section className="notification-center-view">
                <header className="directory-header"><div><h2>Notifications</h2><p>Mentions, replies, friend activity, and other Discord notifications.</p></div><button className="directory-add-button" onClick={() => void loadNotificationCenter()} disabled={notificationLoading}><RotateCcw size={14} /> Refresh</button></header>
                {notificationLoading && <div className="directory-empty"><Loader2 size={18} className="spinning" /> Loading notifications…</div>}
                {notificationError && <div className="directory-error">{notificationError}</div>}
                {!notificationLoading && !notificationError && notificationItems.length === 0 && <div className="directory-empty">No notifications to show.</div>}
                <div className="notification-center-list">{notificationItems.map(item => <article className={"notification-center-item " + (item.acked ? "acked" : "unacked")} key={item.id}>
                  {item.icon_url ? <img className="notification-center-icon" src={item.icon_url} alt="" /> : <span className="notification-center-icon-fallback"><Bell size={16} /></span>}
                  <div className="notification-center-copy"><strong>{item.type === "reply_mention" ? "Reply to you" : item.type === "recent_mention" ? "Mention" : item.type.replaceAll("_", " ")}</strong><p>{item.message_content || item.body || item.message?.content || "Discord notification"}</p>{item.other_user && <small>{displayName(item.other_user)}</small>}</div>
                  {!item.acked && <button className="notification-ack-button" onClick={() => void acknowledgeNotification(item)} title="Mark as read" aria-label="Mark notification as read"><Check size={15} /></button>}
                </article>)}</div>
              </section>
            ) : activeDmTab === "friends" ? (
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
                  <div className="friends-content-layout">
                    <section className="friends-directory-main">
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
                                  <strong>{displayName(friend)} <PlatformIndicators platforms={memberPlatforms[friend.id] || []} /></strong>
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
                          <div className="directory-empty">{directoryQuery ? "No friends match that search." : friendView === "online" ? "No friends are online right now." : "No friends to show yet."}</div>
                        )}
                      </div>
                    </section>
                    <aside className="activity-feed-panel" aria-label="Friends activity feed">
                      <div className="activity-feed-header">
                        <div>
                          <h3>Activity</h3>
                          <p>Recent games, activities and music</p>
                        </div>
                        <button type="button" title="Refresh activity" aria-label="Refresh activity" disabled={activityLoading} onClick={() => void loadActivityFeed()}>
                          <RotateCcw size={14} className={activityLoading ? "spinning" : ""} />
                        </button>
                      </div>
                      {activityError && (
                        <div className="activity-feed-message activity-feed-error">
                          <span>Couldn’t load activity.</span>
                          <small>{activityError}</small>
                          <button type="button" onClick={() => void loadActivityFeed()}>Try again</button>
                        </div>
                      )}
                      {!activityError && activityLoading && activityEntries.length === 0 && (
                        <div className="activity-feed-message"><Loader2 size={16} className="spinning" /> Loading activity…</div>
                      )}
                      {!activityError && !activityLoading && activityEntries.length === 0 && (
                        <div className="activity-feed-message">No activity entries were returned.</div>
                      )}
                      <div className="activity-feed-list">
                        {activityEntries.map((entry, index) => {
                          const content = entry.content;
                          const authorId = content?.author_id;
                          const author: DiscordUser | undefined = authorId === me?.id
                            ? me
                            : friendRelationships.find(relationship => relationship.user.id === authorId)?.user
                              || (authorId ? activityUsers[authorId] : undefined)
                              || dmChannels.flatMap(c => c.recipients || []).find(u => u.id === authorId);

                          const authorName = author ? displayName(author) : (authorId ? `User (${authorId.slice(-4)})` : "Discord friend");
                          const authorStatus = author ? (memberPresences[author.id] || "offline") : "offline";
                          const title = contentInventoryTitle(entry);
                          const subtitle = contentInventorySubtitle(entry);
                          const timestamp = contentInventoryTimestamp(entry);
                          const kind = content?.extra?.type === "played_game_extra" ? "game"
                            : content?.extra?.type === "launched_activity_extra" ? "launched"
                            : content?.extra?.type === "top_artist_extra" ? "music" : "other";

                          return (
                            <article className="activity-feed-card" key={content?.id || `activity-${index}`}>
                              <div className="activity-user-header">
                                <div className="activity-user-avatar">
                                  {author ? (
                                    <>
                                      <img src={avatarUrl(author, 28)} alt="" />
                                      <AvatarDecorationOverlay user={author} />
                                      <span className={`status-dot status-${authorStatus}`} />
                                    </>
                                  ) : (
                                    <div className="dm-avatar-fallback">@</div>
                                  )}
                                </div>
                                <div className="activity-user-info">
                                  <span className="activity-user-name">{authorName}</span>
                                  {author?.username && <span className="activity-user-username">@{author.username}</span>}
                                </div>
                                {timestamp && <small className="activity-time">{timestamp}</small>}
                              </div>

                              <div className="activity-content-row">
                                <span className={`activity-feed-icon activity-feed-icon-${kind}`}>
                                  {kind === "game" ? <Gamepad2 size={16} /> : kind === "music" ? <Headphones size={16} /> : <Sparkles size={16} />}
                                </span>
                                <div className="activity-feed-copy">
                                  <strong title={title}>{title}</strong>
                                  <span>{subtitle}</span>
                                </div>
                              </div>

                              {author && author.id !== me?.id && (
                                <div className="activity-feed-actions">
                                  <button
                                    type="button"
                                    className="activity-action-btn"
                                    onClick={() => void startDirectMessage(author)}
                                    title={`Message ${authorName}`}
                                  >
                                    <MessageSquare size={12} /> Message
                                  </button>
                                  <button
                                    type="button"
                                    className="activity-action-btn"
                                    onClick={() => void handleOpenMemberProfile(author)}
                                    title="View profile"
                                  >
                                    Profile
                                  </button>
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    </aside>
                  </div>
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
                      <strong>{displayName(relationship.user)} <PlatformIndicators platforms={memberPlatforms[relationship.user.id] || []} /></strong>
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
                      <strong>{displayName(relationship.user)} <PlatformIndicators platforms={memberPlatforms[relationship.user.id] || []} /></strong>
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
            ) : (() => {
              const spamRequests = messageRequests.filter(r => r.is_spam || ((r.flags || 0) & (1 << 6)) !== 0);
              const regularRequests = messageRequests.filter(r => !r.is_spam && !((r.flags || 0) & (1 << 6)));
              const displayedRequests = messageRequestTab === "spam" ? spamRequests : regularRequests;
              const reqSender = selectedMessageRequest?.recipients?.[0];

              return (
                <div className="message-request-layout">
                  <div className="message-request-list">
                    <div className="message-request-subtabs">
                      <button
                        className={`request-subtab-btn ${messageRequestTab === "all" ? "active" : ""}`}
                        onClick={() => setMessageRequestTab("all")}
                      >
                        You May Know ({regularRequests.length})
                      </button>
                      <button
                        className={`request-subtab-btn ${messageRequestTab === "spam" ? "active" : ""}`}
                        onClick={() => setMessageRequestTab("spam")}
                      >
                        Spam ({spamRequests.length})
                      </button>
                      {displayedRequests.length > 0 && (
                        <button
                          className="request-clear-all"
                          onClick={() => void batchRejectRequests(displayedRequests.map(r => r.id))}
                          title="Reject all requests in this tab"
                        >
                          Clear All
                        </button>
                      )}
                    </div>
                    {messageRequestsLoading && <div className="directory-empty"><Loader2 size={18} className="spinning" /></div>}
                    {messageRequestsError && <div className="directory-error request-load-error">Could not load message requests: {messageRequestsError}</div>}
                    {!messageRequestsLoading && !messageRequestsError && displayedRequests.map(request => {
                      const sender = request.recipients?.[0];
                      const name = sender ? displayName(sender) : request.name || "Unknown user";
                      const isSpam = request.is_spam || ((request.flags || 0) & (1 << 6)) !== 0;
                      return (
                        <div key={request.id} className={`message-request-row ${selectedMessageRequest?.id === request.id ? "selected" : ""}`}>
                          <button className="message-request-summary" onClick={() => void loadRequestMessages(request)}>
                            {sender ? (
                              <span className="request-avatar-wrap">
                                <img src={avatarUrl(sender, 48)} alt="" />
                                <AvatarDecorationOverlay user={sender} />
                              </span>
                            ) : <div className="dm-avatar-fallback">@</div>}
                            <span>
                              <span className="request-name-row">
                                <strong>{name}</strong>
                                {sender && <BotTag user={sender} />}
                                {sender && <span className="author-discriminator">{formatDiscriminator(sender)}</span>}
                                {isSpam && <span className="spam-badge">SPAM</span>}
                              </span>
                              <small>{sender?.username ? `@${sender.username}` : "Message request"}</small>
                            </span>
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
                    {!messageRequestsLoading && !messageRequestsError && displayedRequests.length === 0 && (
                      <div className="directory-empty">
                        {messageRequestTab === "spam" ? "No spam message requests." : "You don't have any pending message requests."}
                      </div>
                    )}
                  </div>
                  <div className="message-request-conversation">
                    {!selectedMessageRequest ? (
                      <div className="directory-empty">Select a request to preview its messages.</div>
                    ) : (
                      <>
                        <header className="request-conversation-header">
                          <div className="request-header-user">
                            <strong>{reqSender ? displayName(reqSender) : selectedMessageRequest.name || "Message Request"}</strong>
                            {reqSender && <BotTag user={reqSender} />}
                            {reqSender && <span className="author-discriminator">{formatDiscriminator(reqSender)}</span>}
                            {reqSender?.username && <small className="request-header-username">@{reqSender.username}</small>}
                          </div>
                          <div className="request-actions">
                            {reqSender && (
                              <button
                                className="request-block"
                                disabled={requestBusy === selectedMessageRequest.id}
                                onClick={() => void blockAndIgnoreMessageRequest(selectedMessageRequest)}
                                title="Block user and delete request"
                              >
                                Block
                              </button>
                            )}
                            <button className="request-ignore" disabled={requestBusy === selectedMessageRequest.id} onClick={() => void updateMessageRequest(selectedMessageRequest, "ignore")}>Ignore</button>
                            <button className="request-accept" disabled={requestBusy === selectedMessageRequest.id} onClick={() => void updateMessageRequest(selectedMessageRequest, "accept")}>Accept</button>
                          </div>
                        </header>
                        <div className="message-request-safety-banner">
                          <AlertTriangle size={16} className="safety-icon" />
                          <div className="safety-content">
                            <strong>Do you know this user?</strong>
                            <span>We don't recognize mutual friends or servers. Be careful before sharing personal info, opening links, or accepting files.</span>
                          </div>
                        </div>
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
                                <div className="request-message-header">
                                  <strong>{displayName(message.author)} <PlatformIndicators platforms={memberPlatforms[message.author.id] || []} /></strong>
                                  <BotTag user={message.author} />
                                  <span className="author-discriminator">{formatDiscriminator(message.author)}</span>
                                  <small>{formatTimestamp(message.timestamp)}</small>
                                </div>
                                {message.content && <div className="msg-text"><DiscordMarkdown content={message.content} channels={channels} users={mentionUsers} onChannelClick={jumpToChannel} /></div>}
                                {message.embeds?.filter(embed => !!embed && typeof embed === "object").map((embed, index) => <DiscordEmbedView key={`${message.id}-${index}`} embed={embed} attachments={message.attachments} channels={channels} users={mentionUsers} onChannelClick={jumpToChannel} onMediaOpen={showMedia} />)}
                                {message.components && message.components.length > 0 && (
                                  <DiscordComponents components={message.components} message={message} channelId={selectedMessageRequest.id} />
                                )}
                                {message.attachments?.map(attachment => attachment.content_type?.startsWith("image/")
                                  ? <RefreshableAttachmentImage key={attachment.id} channelId={selectedMessageRequest.id} messageId={message.id} attachment={attachment} alt={attachment.filename} className="msg-attachment-img" style={{ maxWidth: 400, maxHeight: 300, borderRadius: 6 }} />
                                  : <a key={attachment.id} className="msg-file-link" href={attachment.url}>{attachment.filename}</a>)}
                              </div>
                            </div>
                          ))}
                          {!requestMessagesLoading && !requestMessagesError && requestMessages.length === 0 && (
                            <div className="directory-empty">No messages were returned for this request.</div>
                          )}
                        </div>
                        <div className="message-request-bottom-bar">
                          <span>You must accept this message request before you can reply.</span>
                          <div className="request-actions">
                            {reqSender && (
                              <button
                                className="request-block"
                                disabled={requestBusy === selectedMessageRequest.id}
                                onClick={() => void blockAndIgnoreMessageRequest(selectedMessageRequest)}
                              >
                                Block
                              </button>
                            )}
                            <button className="request-ignore" disabled={requestBusy === selectedMessageRequest.id} onClick={() => void updateMessageRequest(selectedMessageRequest, "ignore")}>Ignore</button>
                            <button className="request-accept" disabled={requestBusy === selectedMessageRequest.id} onClick={() => void updateMessageRequest(selectedMessageRequest, "accept")}>Accept</button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}
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
            const el = event.currentTarget;
            if (el.scrollTop <= 72) void loadOlderMessages();
            const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
            isNearBottomRef.current = dist <= 250;
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

            {!msgLoading && channelAccess === "MISSING_ACCESS" && messages.length === 0 && (
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

            {!msgLoading && channelAccess === "MISSING_ACCESS" && messages.length > 0 && (
              <div className="locked-channel-cache-banner">
                <LockKeyhole size={18} />
                <div>
                  <strong>Locked Channel — Cached Archive</strong>
                  <div>Live messages are hidden due to missing channel permissions, but <strong>{messages.length}</strong> cached message{messages.length === 1 ? "" : "s"} were loaded from offline storage.</div>
                </div>
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
                            <BotTag user={m.author} />
                            <span className="msg-time">{formatTimestamp(m.timestamp)}</span>
                            {m.edited_timestamp && <span className="msg-time">(edited)</span>}
                            {m.deleted_at && <span className="deleted-message-label">DELETED</span>}
                          </div>
                          <MessageContent message={m} channels={channels} users={mentionUsers} onChannelClick={jumpToChannel} onMediaOpen={showMedia} onReactionToggle={(message, emoji) => void toggleMessageReaction(selectedChannel!.id, message, emoji)} autoplayVideos={preferences.autoplayVideos} sessionId={gatewaySessionId} channelId={selectedChannel?.id} guildId={selectedChannel?.guild_id} onNotify={notify} />
                        </div>
                        <MsgActions message={m} onReact={emoji => void toggleMessageReaction(selectedChannel!.id, m, emoji)} />
                      </div>
                    ) : (
                      <div key={m.id} className={`message compact ${isMe ? "mine" : ""} ${mentionsMe ? "mentioned-you" : ""} ${m.deleted_at ? "deleted-message" : ""}`} onContextMenu={event => openContextMenu(event, { kind: "message", message: m, channel: selectedChannel! })}>
                        <span className="compact-ts">{formatTimestamp(m.timestamp)}</span>
                        <div className="msg-body">
                          {m.deleted_at && <span className="deleted-message-label">DELETED</span>}
                          <MessageContent message={m} channels={channels} users={mentionUsers} onChannelClick={jumpToChannel} onMediaOpen={showMedia} onReactionToggle={(message, emoji) => void toggleMessageReaction(selectedChannel!.id, message, emoji)} autoplayVideos={preferences.autoplayVideos} sessionId={gatewaySessionId} channelId={selectedChannel?.id} guildId={selectedChannel?.guild_id} onNotify={notify} />
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
                {replyToMessage && replyToMessage.channel_id === selectedChannel?.id && !editingMessageId && (
                  <div className="reply-composer-preview"><div><strong>Replying to {displayName(replyToMessage.author)}</strong><span>{replyToMessage.content || "Attachment or system message"}</span></div><button type="button" aria-label="Cancel reply" onClick={() => setReplyToMessage(null)}><X size={14} /></button></div>
                )}
            {!online && (
              <div className="reconnect-pill">
                <span>Disconnected — waiting to reconnect</span>
                <Loader2 size={14} className="spinning" />
              </div>
            )}
            <div className={`composer-box ${editingMessageId ? "editing-message" : ""} ${!canSend || officialDiscordDm || channelAccess === "MISSING_ACCESS" ? "composer-readonly" : ""}`}>
                {officialDiscordDm && <span className="composer-readonly-hint">Official Discord messages are read-only</span>}
                {!officialDiscordDm && !canSend && channelAccess !== "MISSING_ACCESS" && <span className="composer-readonly-hint">You can read here, but sending is disabled</span>}
                {channelAccess === "MISSING_ACCESS" && <span className="composer-readonly-hint">{messages.length > 0 ? "Locked channel · Viewing offline cached messages (read-only)" : "You don’t have access to this channel"}</span>}
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
                    setSlashCommandAppFilter("all");
                    setSelectedSlashCommand((current: any | null) => current && nextValue.startsWith("/" + current.name) ? current : null);
                    setMentionCaret(e.target.selectionStart || 0);
                    setMentionSelection(0);
                  }}
                  onClick={e => setMentionCaret(e.currentTarget.selectionStart || 0)}
                  onKeyUp={e => setMentionCaret(e.currentTarget.selectionStart || 0)}
                  onKeyDown={handleComposerKeyDown}
                />
                {(slashCommands.length > 0 || slashCommandSearchStatus) && /^\/[^\s]*$/.test(draft) && (
                  <div className="slash-command-autocomplete" role="listbox" aria-label="Slash commands">
                    {slashCommandSearchStatus && <div className="slash-command-search-status" role="status">{slashCommandSearchStatus}</div>}
                    {slashCommandApps.length > 1 && <div className="slash-command-app-tabs" role="tablist" aria-label="Filter commands by app">
                      <button type="button" role="tab" aria-selected={slashCommandAppFilter === "all"} className={slashCommandAppFilter === "all" ? "active" : ""} onMouseDown={event => event.preventDefault()} onClick={() => setSlashCommandAppFilter("all")}>All apps <span>{slashCommands.length}</span></button>
                      {slashCommandApps.map(appOption => <button type="button" role="tab" aria-selected={slashCommandAppFilter === appOption.id} className={slashCommandAppFilter === appOption.id ? "active" : ""} key={appOption.id} title={appOption.label} onMouseDown={event => event.preventDefault()} onClick={() => setSlashCommandAppFilter(appOption.id)}>{appOption.label} <span>{appOption.count}</span></button>)}
                    </div>}
                    {visibleSlashCommands.map(command => <button type="button" role="option" key={command.application_id + ":" + command.id} onMouseDown={event => event.preventDefault()} onClick={() => {
                      setSelectedSlashCommand(command); setDraft("/" + command.name + " "); setSlashCommands([]); setSlashCommandSearchStatus("");
                      requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length); });
                    }}><span className="slash-command-icon">/</span><span><strong>/{command.name}</strong><small>{command.description || "Application command"}</small></span></button>)}
                  </div>
                )}
                {selectedSlashCommand && draft.startsWith("/" + selectedSlashCommand.name + " ") && Array.isArray(selectedSlashCommand.options) && selectedSlashCommand.options.length > 0 && (
                  <div className="slash-command-parameters" role="note">
                    <div className="slash-command-parameters-header">
                      <div className="slash-command-parameters-title">
                        <span className="slash-command-icon">/</span>
                        <div>
                          <strong>/{selectedSlashCommand.name}</strong>
                          <small>{selectedSlashCommand.description || "Application command"}</small>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="slash-command-parameters-close"
                        onClick={() => setSelectedSlashCommand(null)}
                        title="Dismiss suggestions"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="slash-command-parameters-guide">
                      <div className="guide-title">
                        <Sparkles size={13} />
                        <span>How to use parameters in VoidCord</span>
                      </div>
                      <p>
                        Use <code>--parameter &quot;value with spaces&quot;</code>. Subcommands use quotes too: <code>&quot;subcommand&quot;</code>.
                        Click a parameter chip to insert <code>--parameter &quot;&quot;</code>, or a subcommand chip to insert <code>&quot;subcommand&quot;</code>.
                      </p>
                    </div>

                    <div className="slash-command-parameters-section-title">AVAILABLE PARAMETERS</div>
                    <div className="slash-command-parameter-list">
                      {selectedSlashCommand.options.flatMap((option: any) => option.type === 2
                        ? (option.options || []).filter((child: any) => child.type === 1).map((child: any) => ({ ...child, _insert: '"' + option.name + '" "' + child.name + '" ' }))
                        : [{ ...option, _insert: [1, 2].includes(option.type) ? '"' + option.name + '" ' : '--' + option.name + ' "" ' }]
                      ).map((option: any) => {
                        const typeName = option.type === 3 ? "String"
                          : option.type === 4 ? "Integer"
                          : option.type === 5 ? "Boolean"
                          : option.type === 6 ? "User"
                          : option.type === 7 ? "Channel"
                          : option.type === 8 ? "Role"
                          : option.type === 10 ? "Number"
                          : [1, 2].includes(option.type) ? "Subcommand" : "Value";

                        return (
                          <div key={option.name + ":" + option._insert} className="slash-command-parameter-card">
                            <button
                              type="button"
                              className="parameter-insert-btn"
                              title={option.description || option.name}
                              onMouseDown={event => event.preventDefault()}
                              onClick={() => {
                                const insertion = option._insert;
                                const nextDraft = draft.endsWith(" ") ? draft + insertion : draft + " " + insertion;
                                setDraft(nextDraft);
                                requestAnimationFrame(() => {
                                  const input = inputRef.current;
                                  input?.focus();
                                  // Put the caret inside the empty quoted value so typing can start immediately.
                                  const emptyValue = nextDraft.lastIndexOf('""');
                                  const caret = emptyValue >= 0 && insertion.includes('""') ? emptyValue + 1 : nextDraft.length;
                                  input?.setSelectionRange(caret, caret);
                                });
                              }}
                            >
                              <code>{option._insert.trim()}</code>
                              <span className="param-type-badge">{typeName}</span>
                              {option.required ? (
                                <span className="param-badge-required">REQUIRED</span>
                              ) : (
                                <span className="param-badge-optional">{[1, 2].includes(option.type) ? "SUBCOMMAND" : "OPTIONAL"}</span>
                              )}
                            </button>
                            {option.description && <span className="parameter-desc">{option.description}</span>}
                            {Array.isArray(option.choices) && option.choices.length > 0 && (
                              <div className="parameter-choices">
                                <span className="choices-label">Choices:</span>
                                {option.choices.map((choice: any) => (
                                  <button
                                    type="button"
                                    key={String(choice.value)}
                                    className="choice-chip"
                                    onClick={() => {
                                      const choiceInsert = `--${option.name} "${choice.value}" `;
                                      const nextDraft = draft.endsWith(" ") ? draft + choiceInsert : draft + " " + choiceInsert;
                                      setDraft(nextDraft);
                                      requestAnimationFrame(() => {
                                        inputRef.current?.focus();
                                        inputRef.current?.setSelectionRange(nextDraft.length, nextDraft.length);
                                      });
                                    }}
                                  >
                                    {choice.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="slash-command-parameters-example">
                      <span>Syntax preview:</span>
                      <code>
                        /{selectedSlashCommand.name} {selectedSlashCommand.options.map((opt: any) =>
                          opt.required ? `--${opt.name} <${opt.name}>` : `[--${opt.name}]`
                        ).join(" ")}
                      </code>
                    </div>
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
                    <header><strong>{displayName(message.author)} <PlatformIndicators platforms={memberPlatforms[message.author.id] || []} /></strong><time>{formatTimestamp(message.timestamp)}</time></header>
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
                    <strong>{displayName(dmProfileUser)} <PlatformIndicators platforms={memberPlatforms[dmProfileUser.id] || []} /></strong>
                    <small>@{dmProfileUser.username}{formatDiscriminator(dmProfileUser)}</small>
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
                        {dmBio ? <DiscordMarkdown content={dmBio} /> : <p>This user hasn't added a bio yet.</p>}
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
                          {formatDiscriminator(userObj) && <span className="author-discriminator" style={{ marginLeft: 3 }}>{formatDiscriminator(userObj)}</span>}
                          <BotTag user={userObj} style={{ fontSize: 9, marginLeft: 4 }} />
                          <small className="member-subline">{userObj.username}{formatDiscriminator(userObj)}<PlatformIndicators platforms={memberPlatforms[userObj.id] || []} /></small>
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
                <h2 style={{ color: selectedProfileRoleColor }}>{displayName(selectedMemberProfile)}<BotTag user={selectedMemberProfile} /></h2>
                <span className="profile-handle">@{selectedMemberProfile.username}{formatDiscriminator(selectedMemberProfile)}</span>
                {memberProfileData?.user_profile?.pronouns && <span className="profile-pronouns">{memberProfileData.user_profile.pronouns}</span>}
                <h3>About me</h3>
                <div className="profile-full-bio">{selectedProfileBio ? <DiscordMarkdown content={selectedProfileBio} /> : "This user hasn't added a bio yet."}</div>
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
                    <h3 className="profile-display-name" style={{ color: selectedProfileRoleColor }}>{displayName(selectedMemberProfile)}<BotTag user={selectedMemberProfile} /></h3>
                    <div className="profile-handle-row">
                      <span className="profile-handle">{selectedMemberProfile.username}{formatDiscriminator(selectedMemberProfile)}</span>
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
                      <div className="profile-bio-preview"><DiscordMarkdown content={selectedProfileBio} /></div>
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
                            <strong>{displayName(message.author)} <PlatformIndicators platforms={memberPlatforms[message.author.id] || []} /></strong>
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
              <button type="button" className={settingsTab === "notifications" ? "active" : ""} onClick={() => setSettingsTab("notifications")}>Notifications</button>
              <button type="button" onClick={() => setProtoSettingsOpen(true)}>Discord settings</button>
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
            ) : settingsTab === "themes" ? (
              <div className="settings-options">
                <label className="feature-field"><span>Accent color</span><select value={preferences.accent} onChange={event => setPreferences(current => ({ ...current, accent: event.target.value as AppPreferences["accent"] }))}>
                  <option value="blurple">Blurple</option><option value="violet">Violet</option><option value="emerald">Emerald</option>
                </select></label>
                <label className="feature-field"><span>Channel sidebar width · {preferences.channelSidebarWidth}px</span><input type="range" min="180" max="360" step="4" value={preferences.channelSidebarWidth} onChange={event => setPreferences(current => ({ ...current, channelSidebarWidth: Number(event.target.value) }))} /></label>
                <h3 className="settings-section-title">Server folders and order</h3>
                <p className="settings-help">Group servers by folder name. Use arrows to change their order in the server rail.</p>
                <div className="server-folder-order-list">
                  {[...new Set(orderedGuilds.map(guild => remoteFolderByGuild.get(guild.id)?.name || preferences.serverFolders[guild.id]?.trim()).filter((name): name is string => !!name))].map((folderName, folderIndex, folderNames) => (
                    <div className="server-organize-row server-folder-order-row" key={folderName}>
                      <strong>📁 {folderName}</strong>
                      <button type="button" aria-label={"Move folder " + folderName + " up"} disabled={folderIndex === 0} onClick={() => setPreferences(current => {
                        const groups = new Map<string, string[]>();
                        for (const guild of orderedGuilds) { const key = remoteFolderByGuild.get(guild.id)?.name || current.serverFolders[guild.id]?.trim() || ""; if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(guild.id); }
                        const order = [...folderNames]; [order[folderIndex - 1], order[folderIndex]] = [order[folderIndex], order[folderIndex - 1]];
                        const ids = [...(groups.get("") || [])]; for (const key of order) ids.push(...(groups.get(key) || []));
                        for (const [key, value] of groups) if (key && !order.includes(key)) ids.push(...value);
                        return { ...current, serverOrder: ids };
                      })}>↑</button>
                      <button type="button" aria-label={"Move folder " + folderName + " down"} disabled={folderIndex === folderNames.length - 1} onClick={() => setPreferences(current => {
                        const groups = new Map<string, string[]>();
                        for (const guild of orderedGuilds) { const key = remoteFolderByGuild.get(guild.id)?.name || current.serverFolders[guild.id]?.trim() || ""; if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(guild.id); }
                        const order = [...folderNames]; [order[folderIndex + 1], order[folderIndex]] = [order[folderIndex], order[folderIndex + 1]];
                        const ids = [...(groups.get("") || [])]; for (const key of order) ids.push(...(groups.get(key) || []));
                        for (const [key, value] of groups) if (key && !order.includes(key)) ids.push(...value);
                        return { ...current, serverOrder: ids };
                      })}>↓</button>
                    </div>
                  ))}
                </div>
                <button type="button" className="settings-action-button" onClick={async () => {
                  const sourceFolders = discordGuildFolders?.folders || preferences.cachedDiscordFolders;
                  const groups = new Map<string, string[]>();
                  for (const guild of orderedGuilds) {
                    const name = remoteFolderByGuild.get(guild.id)?.name || preferences.serverFolders[guild.id]?.trim() || "";
                    if (!groups.has(name)) groups.set(name, []);
                    groups.get(name)!.push(guild.id);
                  }
                  const names = [...groups.keys()].filter(Boolean);
                  const folders = names.map(name => {
                    const old = sourceFolders.find(folder => folder.name === name);
                    return { id: old?.id || null, name, color: old?.color ?? null, guildIds: groups.get(name) || [] };
                  });
                  const positions = [...(groups.get("") || []), ...names.flatMap(name => groups.get(name) || [])];
                  try {
                    await invoke("sync_settings_proto_v1", { settingsPayload: encodeGuildFolderSettings({ folders, positions }) });
                    setDiscordGuildFolders({ folders, positions });
                    setPreferences(current => ({ ...current, cachedServerOrder: positions, cachedDiscordFolders: folders }));
                    window.alert("Guild folder layout synced to Discord.");
                  } catch (error) { window.alert("Couldn't sync guild folders to Discord: " + String(error)); }
                }}>Sync layout to Discord</button>
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
            ) : (
              <div className="settings-options">
                <h3 className="settings-section-title">In-app notifications</h3>
                <p className="settings-help">Control VoidCord's connection and status banners. This is a local client preference and does not change Discord push notifications.</p>
                <label className="settings-option"><span><strong>Show status notifications</strong><small>Show banners for connection changes and other client status events.</small></span><input type="checkbox" checked={preferences.showSystemNotifications} onChange={event => setPreferences(current => ({ ...current, showSystemNotifications: event.target.checked }))} /></label>
                <label className="feature-field"><span>Banner duration · {(preferences.systemNotificationDuration / 1000).toFixed(1)} seconds</span><input type="range" min="2000" max="10000" step="500" value={preferences.systemNotificationDuration} onChange={event => setPreferences(current => ({ ...current, systemNotificationDuration: Number(event.target.value) }))} /></label>
                <p className="settings-help">Changes are saved locally and apply immediately.</p>
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
          <div className={`media-viewer-stage ${mediaViewer.kind === "image" ? "image-stage" : "video-stage"}`}>
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
                onClick={() => {
                  setRawMessage(contextMenu.message);
                  setContextMenu(null);
                }}
              >
                <Terminal size={14} /> View Raw JSON
              </button>
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
      {rawMessage && (
        <div
          className="raw-message-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setRawMessage(null);
          }}
        >
          <section className="raw-message-dialog" role="dialog" aria-modal="true" aria-labelledby="raw-message-title">
            <header className="raw-message-header">
              <div>
                <h2 id="raw-message-title">Raw Message JSON</h2>
                <p>In-memory message object · {rawMessage.id}</p>
              </div>
              <div className="raw-message-actions">
                <button type="button" onClick={() => void copyContextValue(JSON.stringify(rawMessage, null, 2), "Raw message JSON")}>
                  <Copy size={14} /> Copy JSON
                </button>
                <button type="button" className="raw-message-close" aria-label="Close raw message viewer" onClick={() => setRawMessage(null)}>
                  <X size={16} />
                </button>
              </div>
            </header>
            <pre className="raw-message-pre"><code>{JSON.stringify(rawMessage, null, 2)}</code></pre>
          </section>
        </div>
      )}
      {systemNotice && (
        <div key={systemNotice.id} className={`system-notification ${systemNotice.exiting ? "exiting" : ""}`} role="status" aria-live="polite">
          <div className="system-notification-heading"><span>System</span><button type="button" aria-label="Dismiss notification" onClick={() => setSystemNotice(null)}><X size={13} /></button></div>
          <div>{systemNotice.message}</div>
        </div>
      )}
      {toast && <div key={toast.id} className={`toast ${toast.exiting ? "exiting" : ""}`} role="status" aria-live="polite">{toast.message}</div>}
      {interactionModal && (
        <InteractionModal
          modal={interactionModal}
          onClose={() => setInteractionModal(null)}
          onSubmit={async components => {
            if (!gatewaySessionId) throw new Error("Discord gateway session is not ready");
            const nonce = String((BigInt(Date.now()) << 12n) + BigInt(Math.floor(Math.random() * 4096)));
            await invoke("submit_interaction_modal", { modal: interactionModal, sessionId: gatewaySessionId, components, nonce });
            setInteractionModal(null);
          }}
        />
      )}
    </main>
  );
}

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

function BotTag({
  user,
  className,
  style,
}: {
  user?: { bot?: boolean; flags?: number; public_flags?: number } | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (!user?.bot) return null;
  const verified = isVerifiedBot(user);

  return (
    <span
      className={`bot-tag ${verified ? "verified" : ""} ${className || ""}`}
      style={style}
      title={verified ? "Verified Bot" : "Bot"}
    >
      {verified && (
        <svg
          className="bot-verified-check"
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Verified Bot"
        >
          <path
            d="M13.5 4.5L6.5 11.5L3 8"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span className="bot-tag-text">BOT</span>
    </span>
  );
}

type RefreshableAttachmentImageProps = {
  channelId: string;
  messageId: string;
  attachment: { id: string; url: string; proxy_url?: string; filename: string; width?: number; height?: number };
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  role?: React.AriaRole;
  tabIndex?: number;
  ariaLabel?: string;
  onClick?: (url: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLImageElement>) => void;
};

function RefreshableAttachmentImage({
  channelId,
  messageId,
  attachment,
  alt,
  className,
  style,
  role,
  tabIndex,
  ariaLabel,
  onClick,
  onKeyDown,
}: RefreshableAttachmentImageProps) {
  const [src, setSrc] = useState(attachment.url);
  const [failed, setFailed] = useState(false);
  const refreshInFlight = useRef(false);
  const lastFailedUrl = useRef<string | null>(null);

  useEffect(() => {
    setSrc(attachment.url);
    setFailed(false);
    lastFailedUrl.current = null;
  }, [attachment.url, attachment.id]);

  const refreshAttachment = useCallback(async () => {
    if (refreshInFlight.current || !navigator.onLine) return;
    refreshInFlight.current = true;
    try {
      const freshMessage = await tauriInvoke<DiscordMessage>("get_message", {
        channelId,
        messageId,
      });
      const freshAttachment = freshMessage.attachments?.find(item => item.id === attachment.id);
      // Merge the freshly fetched message into the persistent cache even if this
      // particular attachment was removed; the server response is authoritative.
      await writeCachedMessages(channelId, [freshMessage]);
      if (freshAttachment?.url && freshAttachment.url !== src) {
        lastFailedUrl.current = null;
        setSrc(freshAttachment.url);
        setFailed(false);
      }
    } catch (error) {
      console.warn("Could not refresh expired Discord attachment URL", {
        channelId,
        messageId,
        attachmentId: attachment.id,
        error,
      });
    } finally {
      refreshInFlight.current = false;
    }
  }, [channelId, messageId, attachment.id, src]);

  const handleImageError = () => {
    if (lastFailedUrl.current === src) return;
    lastFailedUrl.current = src;
    setFailed(true);
    void refreshAttachment();
  };

  useEffect(() => {
    if (!failed) return;
    const retryWhenOnline = () => void refreshAttachment();
    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, [failed, refreshAttachment]);

  return (
    <img
      src={src}
      alt={alt ?? attachment.filename}
      className={className}
      style={style}
      role={role}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      onClick={() => onClick?.(src)}
      onKeyDown={onKeyDown}
      onError={handleImageError}
    />
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
  sessionId,
  channelId,
  guildId,
  onNotify,
}: {
  message: DiscordMessage;
  channels?: DiscordChannel[];
  users?: DiscordUser[];
  onChannelClick?: (channelId: string) => void;
  onMediaOpen?: (url: string, kind: "image" | "video", name?: string) => void;
  onReactionToggle?: (message: DiscordMessage, emoji: string) => void;
  autoplayVideos?: boolean;
  sessionId?: string;
  channelId?: string;
  guildId?: string;
  onNotify?: (msg: string) => void;
}) {
  const isEphemeral = ((m.flags ?? 0) & 64) === 64;
  const hideGifSourceLink = !!m.content?.trim()
    && m.embeds?.some(embed => embed.type === "gifv" && !!embed.url && m.content.trim() === embed.url.trim());

  return (
    <>
      {isEphemeral && (
        <div className="ephemeral-message-label" title="This response is ephemeral and may only be visible to its recipient">
          <span aria-hidden="true">◈</span> Ephemeral response
        </div>
      )}
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
            <RefreshableAttachmentImage
              key={attachment.id}
              channelId={m.channel_id || channelId || ""}
              messageId={m.id}
              attachment={attachment}
              alt={attachment.filename}
              className="msg-attachment-img"
              role="button"
              tabIndex={0}
              onClick={url => onMediaOpen?.(url, "image", attachment.filename)}
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

      {m.type === 20 && (
        <div className="msg-special-card msg-system-card msg-command-card" role="note">
          <span>Slash command: <strong>/{m.interaction_metadata?.name || m.interaction?.name || (m.content.match(/^\/([^\s]+)/)?.[1]) || "command"}</strong></span>
        </div>
      )}

      {m.type !== 0 && m.type !== 3 && m.type !== 19 && m.type !== 20 && !m.content && !m.call
        && !(m.attachments?.length) && !(m.embeds?.length) && !(m.components?.length) && (
        <div className="msg-special-card msg-system-card" role="note">
          <span>{SYSTEM_MESSAGE_LABELS[m.type] || `Discord system message · type ${m.type}`}</span>
        </div>
      )}

      {m.content && !hideGifSourceLink && (
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
          <RefreshableAttachmentImage
            key={a.id}
            channelId={m.channel_id || channelId || ""}
            messageId={m.id}
            attachment={a}
            alt={a.filename}
            className="msg-attachment-img"
            role="button"
            tabIndex={0}
            ariaLabel={`Open image ${a.filename}`}
            onClick={url => onMediaOpen?.(url, "image", a.filename)}
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
            <button
              type="button"
              className="msg-video-open-btn"
              onClick={() => onMediaOpen?.(a.url, "video", a.filename)}
              title="Open video in media viewer"
            >
              <Maximize2 size={13} />
              <span>Open video</span>
            </button>
          </div>
        ))}

      {m.attachments
        ?.filter(a => !isImageAttachment(a) && !isVideoAttachment(a))
        ?.map(a => (
          <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="msg-file-link">📎 {a.filename}</a>
        ))}

      {m.components && m.components.length > 0 && (
        <DiscordComponents
          components={m.components}
          message={m}
          channelId={channelId || m.channel_id}
          guildId={guildId}
          sessionId={sessionId}
          channels={channels}
          users={users}
          onChannelClick={onChannelClick}
          onMediaOpen={onMediaOpen}
          onNotify={onNotify}
        />
      )}

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
