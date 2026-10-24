// Discord API types matching v10 payloads

export interface DiscordAvatarDecoration {
  asset: string;
  sku_id?: string;
}

export interface DiscordCollectibles {
  nameplate?: {
    asset: string;
    sku_id?: string;
    palette?: string;
    label?: string;
  };
}

export interface DiscordPrimaryGuild {
  identity_guild_id?: string;
  identity_enabled?: boolean;
  tag?: string;
  badge?: string;
}

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name: string | null;
  avatar: string | null;
  banner?: string | null;
  accent_color?: number | null;
  bio?: string;
  pronouns?: string;
  bot?: boolean;
  flags?: number;
  public_flags?: number;
  premium_type?: number;
  avatar_decoration_data?: DiscordAvatarDecoration | null;
  collectibles?: DiscordCollectibles | null;
  primary_guild?: DiscordPrimaryGuild | null;
  profile_effect_id?: string | null;
}

export interface DiscordRelationship {
  id: string;
  type: number;
  user: DiscordUser;
  nickname?: string | null;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner?: boolean;
}

export interface DiscordChannel {
  id: string;
  type: number; // 0=text, 1=DM, 2=voice, 3=GroupDM, 4=category, 5=announcement, 13=stage
  name?: string;
  topic?: string | null;
  status?: string | null;
  position?: number;
  parent_id?: string | null;
  guild_id?: string;
  last_message_id?: string | null;
  last_pin_timestamp?: string | null;
  is_message_request?: boolean;
  is_message_request_timestamp?: string | null;
  is_spam?: boolean;
  flags?: number;
  safety_warnings?: Array<{ id: string; type: number; description?: string; dismissed?: boolean }>;
  permission_overwrites?: { id: string; type: number; allow: string; deny: string }[];
  recipients?: DiscordUser[];
  icon?: string | null;
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  url: string;
  proxy_url: string;
  size: number;
  content_type?: string;
  width?: number;
  height?: number;
}

export interface DiscordEmbedFooter {
  text: string;
  icon_url?: string;
  proxy_icon_url?: string;
}

export interface DiscordEmbedImage {
  url: string;
  proxy_url?: string;
  height?: number;
  width?: number;
}

export interface DiscordEmbedThumbnail {
  url: string;
  proxy_url?: string;
  height?: number;
  width?: number;
}

export interface DiscordEmbedVideo {
  url?: string;
  proxy_url?: string;
  height?: number;
  width?: number;
}

export interface DiscordEmbedProvider {
  name?: string;
  url?: string;
}

export interface DiscordEmbedAuthor {
  name: string;
  url?: string;
  icon_url?: string;
  proxy_icon_url?: string;
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  type?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: DiscordEmbedFooter;
  image?: DiscordEmbedImage;
  thumbnail?: DiscordEmbedThumbnail;
  video?: DiscordEmbedVideo;
  provider?: DiscordEmbedProvider;
  author?: DiscordEmbedAuthor;
  fields?: DiscordEmbedField[];
}

export interface DiscordReaction {
  count: number;
  me: boolean;
  emoji: { id: string | null; name: string | null; animated?: boolean } | null;
}

export interface DiscordMessageSnapshot {
  content?: string;
  timestamp?: string;
  attachments?: DiscordAttachment[];
  embeds?: DiscordEmbed[];
  stickers?: unknown[];
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  member?: { roles?: string[] } | null;
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  attachments: DiscordAttachment[];
  embeds: DiscordEmbed[];
  reactions?: DiscordReaction[];
  referenced_message?: DiscordMessage | null;
  message_reference?: { type?: number; message_id?: string; channel_id?: string; guild_id?: string } | null;
  message_snapshots?: DiscordMessageSnapshot[];
  type: number;
  interaction_metadata?: { name?: string; type?: number; id?: string; user?: DiscordUser } | null;
  interaction?: { name?: string; type?: number; id?: string; user?: DiscordUser } | null;
  poll?: unknown;
  call?: unknown;
  activity?: unknown;
  flags?: number;
  application_id?: string;
  components?: DiscordComponent[];
  deleted_at?: number;
  mentions?: DiscordUser[];
  mention_roles?: string[];
}

// ── Message Components (buttons, selects) ──────────────────────────────────

export type DiscordButtonStyle = 1 | 2 | 3 | 4 | 5 | 6; // primary, secondary, success, danger, link

export interface DiscordPartialEmoji {
  id?: string | null;
  name?: string | null;
  animated?: boolean;
}

export interface DiscordButton {
  type: 2;
  style: DiscordButtonStyle;
  label?: string;
  emoji?: DiscordPartialEmoji;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
}

export interface DiscordSelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: DiscordPartialEmoji;
  default?: boolean;
}

export interface DiscordSelectMenu {
  type: 3 | 5 | 6 | 7 | 8; // string, user, role, mentionable, channel select
  custom_id: string;
  options?: DiscordSelectOption[];
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  disabled?: boolean;
}

export interface DiscordTextDisplay {
  type: 10;
  content: string;
}

export interface DiscordThumbnail {
  type: 11;
  media?: { url: string; proxy_url?: string };
  thumbnail?: { url: string };
  description?: string;
}

export interface DiscordMediaGalleryItem {
  media: { url: string; proxy_url?: string };
  description?: string;
  spoiler?: boolean;
}

export interface DiscordMediaGallery {
  type: 12;
  items: DiscordMediaGalleryItem[];
}

export interface DiscordFileComponent {
  type: 13;
  file?: { url: string; filename?: string; size?: number };
  filename?: string;
  url?: string;
}

export interface DiscordSeparator {
  type: 14;
  divider?: boolean;
  spacing?: number;
}

export interface DiscordSection {
  type: 9;
  components: DiscordComponent[];
  accessory?: DiscordButton | DiscordThumbnail | any;
}

export interface DiscordContainer {
  type: 17;
  accent_color?: number;
  spoiler?: boolean;
  components: DiscordComponent[];
}

export interface DiscordActionRow {
  type: 1;
  components: DiscordComponent[];
}

export type DiscordComponent =
  | DiscordActionRow
  | DiscordButton
  | DiscordSelectMenu
  | DiscordSection
  | DiscordTextDisplay
  | DiscordThumbnail
  | DiscordMediaGallery
  | DiscordFileComponent
  | DiscordSeparator
  | DiscordContainer
  | any;

// Discord only accepts powers of two: 16, 32, 64, 128, 256, 512, 1024, 2048, 4096
const VALID_CDN_SIZES = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
function normalizeCdnSize(size: number): number {
  if (VALID_CDN_SIZES.includes(size)) return size;
  // Pick closest valid power of two
  return VALID_CDN_SIZES.reduce((prev, curr) =>
    Math.abs(curr - size) < Math.abs(prev - size) ? curr : prev
  );
}

// Local UI helpers
export function avatarUrl(user: DiscordUser, size = 64): string {
  const s = normalizeCdnSize(size);
  if (user.avatar) {
    const ext = user.avatar.startsWith("a_") ? "gif" : "webp";
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=${s}`;
  }
  // Default Discord avatar
  const idx = Number(user.discriminator === "0"
    ? (BigInt(user.id) >> 22n) % 6n
    : parseInt(user.discriminator) % 5);
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

export function guildIconUrl(guild: DiscordGuild, size = 64): string | null {
  if (!guild.icon || !guild.id) return null;
  const s = normalizeCdnSize(size);
  const ext = guild.icon.startsWith("a_") ? "gif" : "webp";
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${ext}?size=${s}`;
}

export function bannerUrl(user: DiscordUser, size = 512): string | null {
  if (!user.banner) return null;
  const s = normalizeCdnSize(size);
  const ext = user.banner.startsWith("a_") ? "gif" : "webp";
  return `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.${ext}?size=${s}`;
}

export function displayName(user: DiscordUser): string {
  return user.global_name || user.username;
}

export function formatDiscriminator(user?: { discriminator?: string | null; bot?: boolean } | null): string | null {
  if (!user || user.discriminator == null) return null;
  const tag = String(user.discriminator).trim();
  if (!user.bot && (tag === "0" || tag === "0000" || tag === "")) {
    return null;
  }
  if (tag === "0" || tag === "0000") {
    return user.bot ? "#0000" : null;
  }
  return `#${tag}`;
}


export function isVerifiedBot(user?: { bot?: boolean; flags?: number; public_flags?: number } | null): boolean {
  if (!user || !user.bot) return false;
  const flags = (user.public_flags ?? user.flags ?? 0);
  return (flags & (1 << 16)) !== 0;
}

export function formatUserTag(user: DiscordUser): string {
  const disc = formatDiscriminator(user);
  return disc ? `${user.username}${disc}` : `@${user.username}`;
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function avatarDecorationUrl(decoration: DiscordAvatarDecoration | null | undefined): string | null {
  if (!decoration?.asset) return null;
  return `https://cdn.discordapp.com/avatar-decoration-presets/${decoration.asset}.png?size=96&passthrough=false`;
}

export function primaryGuildBadgeUrl(guildId: string | undefined, badgeHash: string | undefined): string | null {
  if (!guildId || !badgeHash) return null;
  return `https://cdn.discordapp.com/guild-tag-badges/${guildId}/${badgeHash}.png`;
}

// Channel type guards
export const CHANNEL_TYPE_TEXT         = 0;
export const CHANNEL_TYPE_DM           = 1;
export const CHANNEL_TYPE_VOICE        = 2;
export const CHANNEL_TYPE_GROUP_DM     = 3;
export const CHANNEL_TYPE_CATEGORY     = 4;
export const CHANNEL_TYPE_ANNOUNCEMENT = 5;
export const CHANNEL_TYPE_STAGE        = 13;
