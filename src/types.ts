import React from 'react';

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

export interface DiscordRoleColors {
  primary_color?: number | null;
  secondary_color?: number | null;
  tertiary_color?: number | null;
}

export interface DiscordRole {
  id: string;
  name: string;
  color: number;
  colors?: DiscordRoleColors | null;
  hoist?: boolean;
  icon?: string | null;
  unicode_emoji?: string | null;
  position: number;
  permissions: string;
  managed?: boolean;
  mentionable?: boolean;
  tags?: {
    bot_id?: string;
    integration_id?: string;
    premium_subscriber?: null;
    subscription_listing_id?: string;
    available_for_purchase?: null;
    guild_connections?: null;
  } | null;
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
  profile_effect?: { id: string; expires_at?: number | null } | null;
  display_name_styles?: {
    colors?: number[] | null;
    effect_id?: number | null;
    font_id?: number | null;
  } | null;
}

export interface DiscordRelationship {
  id: string;
  type: number;
  user: DiscordUser;
  nickname?: string | null;
  user_ignored?: boolean;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  banner?: string | null;
  splash?: string | null;
  description?: string | null;
  owner?: boolean;
  owner_id?: string;
  features?: string[];
  verification_level?: number;
  default_message_notifications?: number;
  explicit_content_filter?: number;
  afk_channel_id?: string | null;
  afk_timeout?: number;
  system_channel_id?: string | null;
  system_channel_flags?: number;
  rules_channel_id?: string | null;
  public_updates_channel_id?: string | null;
  safety_alerts_channel_id?: string | null;
  preferred_locale?: string;
  premium_tier?: number;
  premium_subscription_count?: number;
  premium_progress_bar_enabled?: boolean;
  approximate_member_count?: number;
  approximate_presence_count?: number;
}

export interface DiscordChannel {
  id: string;
  account_id?: string;
  type: number; // 0=text, 1=DM, 2=voice, 3=GroupDM, 4=category, 5=announcement, 10=announcement thread, 11=public thread, 12=private thread, 13=stage, 15=forum
  name?: string;
  topic?: string | null;
  status?: string | null;
  position?: number;
  parent_id?: string | null;
  guild_id?: string;
  last_message_id?: string | null;
  message_count?: number;
  member_count?: number;
  last_pin_timestamp?: string | null;
  is_message_request?: boolean;
  is_message_request_timestamp?: string | null;
  is_spam?: boolean;
  flags?: number;
  message_preview?: DiscordMessage;
  safety_warnings?: Array<{ id: string; type: number; description?: string; dismissed?: boolean }>;
  permission_overwrites?: { id: string; type: number; allow: string; deny: string }[];
  recipients?: DiscordUser[];
  icon?: string | null;
  owner_id?: string;
  applied_tags?: string[];
  available_tags?: Array<{ id: string; name: string; moderated?: boolean; emoji_id?: string | null; emoji_name?: string | null }>;
  default_thread_rate_limit_per_user?: number;
  default_sort_order?: number | null;
  default_forum_layout?: number;
  thread_metadata?: {
    archived: boolean;
    auto_archive_duration: number;
    archive_timestamp: string;
    locked: boolean;
    invitable?: boolean;
    create_timestamp?: string | null;
  };
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
  thread?: DiscordChannel;
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

export function guildBannerUrl(guild: Pick<DiscordGuild, "id" | "banner">, size = 1024): string | null {
  if (!guild.banner || !guild.id) return null;
  const s = normalizeCdnSize(size);
  const ext = guild.banner.startsWith("a_") ? "gif" : "webp";
  return `https://cdn.discordapp.com/banners/${guild.id}/${guild.banner}.${ext}?size=${s}`;
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

// Discord display-name font IDs; deprecated fonts intentionally use the default.
export function displayNameFontClass(fontId?: number | null): string {
  const classes: Record<number, string> = {
    1: "dn-font-1",
    2: "dn-font-2",
    3: "dn-font-3",
    4: "dn-font-4",
    5: "dn-font-5",
    6: "dn-font-6",
    7: "dn-font-7",
    8: "dn-font-8",
    9: "dn-font-9",
    10: "dn-font-10",
    11: "dn-font-11",
    12: "dn-font-12",
    13: "dn-font-13",
    14: "dn-font-14",
    15: "dn-font-15",
    16: "dn-font-16",
  };
  return fontId == null ? "" : classes[fontId] || "";
}

// Role gradient style helper
export function roleColorStyle(
  primaryColor?: number | null,
  secondaryColor?: number | null,
  tertiaryColor?: number | null
): React.CSSProperties {
  const toHex = (n: number) => '#' + n.toString(16).padStart(6, '0');
  if (secondaryColor != null && tertiaryColor != null) {
    return {
      background: `linear-gradient(90deg, ${toHex(primaryColor ?? 0)}, ${toHex(secondaryColor)}, ${toHex(tertiaryColor)})`,
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
    };
  }
  if (secondaryColor != null) {
    return {
      background: `linear-gradient(90deg, ${toHex(primaryColor ?? 0)}, ${toHex(secondaryColor)})`,
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
    };
  }
  if (primaryColor != null && primaryColor !== 0) {
    return { color: toHex(primaryColor) };
  }
  return {};
}

// Profile effect CDN URL
export function profileEffectUrl(effectId: string): string {
  return `https://cdn.discordapp.com/profile-effects/assets/${effectId}/intro.png`;
}

// ─── Channel type guards ─────────────────────────────────────────────────────
// Channel type guards
export const CHANNEL_TYPE_TEXT         = 0;
export const CHANNEL_TYPE_DM           = 1;
export const CHANNEL_TYPE_VOICE        = 2;
export const CHANNEL_TYPE_GROUP_DM     = 3;
export const CHANNEL_TYPE_CATEGORY     = 4;
export const CHANNEL_TYPE_ANNOUNCEMENT = 5;
export const CHANNEL_TYPE_ANNOUNCEMENT_THREAD = 10;
export const CHANNEL_TYPE_PUBLIC_THREAD       = 11;
export const CHANNEL_TYPE_PRIVATE_THREAD      = 12;
export const CHANNEL_TYPE_STAGE               = 13;
export const CHANNEL_TYPE_FORUM                = 15;
