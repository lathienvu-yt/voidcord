import type { DiscordChannel } from "./types";

export const CHANNEL_FLAG_OBFUSCATED = 1 << 17;
export const OBFUSCATED_CHANNEL_SENTINEL = "___hidden___";

export function isObfuscatedChannel(channel?: Partial<DiscordChannel> | null): boolean {
  if (!channel) return false;
  return ((channel.flags ?? 0) & CHANNEL_FLAG_OBFUSCATED) !== 0
    || channel.name === OBFUSCATED_CHANNEL_SENTINEL
    || channel.topic === OBFUSCATED_CHANNEL_SENTINEL;
}

/** Preserve locally known channel metadata when Discord redacts a channel. */
export function mergeDiscordChannel(previous: DiscordChannel | undefined, incoming: DiscordChannel): DiscordChannel {
  if (!previous) {
    return {
      ...incoming,
      name: incoming.name === OBFUSCATED_CHANNEL_SENTINEL ? "Hidden channel" : incoming.name,
      topic: incoming.topic === OBFUSCATED_CHANNEL_SENTINEL ? null : incoming.topic,
    };
  }

  const merged: DiscordChannel = { ...previous, ...incoming };
  if (isObfuscatedChannel(incoming)) {
    if (incoming.name === OBFUSCATED_CHANNEL_SENTINEL) merged.name = previous.name || "Hidden channel";
    if (incoming.topic === OBFUSCATED_CHANNEL_SENTINEL) merged.topic = previous.topic ?? null;
    for (const [key, value] of Object.entries(incoming)) {
      if (key === "flags" || key === "id" || value !== null) continue;
      const oldValue = (previous as unknown as Record<string, unknown>)[key];
      if (oldValue !== undefined && oldValue !== null) {
        (merged as unknown as Record<string, unknown>)[key] = oldValue;
      }
    }
  }
  return merged;
}

/** Omitted obfuscated channels remain cached until an explicit CHANNEL_DELETE. */
export function mergeDiscordChannelList(previous: DiscordChannel[], incoming: DiscordChannel[], guildId?: string): DiscordChannel[] {
  const merged = new Map<string, DiscordChannel>();
  for (const channel of previous || []) if (channel?.id) merged.set(channel.id, channel);
  const received = new Set<string>();
  for (const channel of incoming || []) {
    if (!channel?.id) continue;
    received.add(channel.id);
    merged.set(channel.id, mergeDiscordChannel(merged.get(channel.id), channel));
  }
  for (const channel of previous || []) {
    if (!channel?.id || received.has(channel.id) || !isObfuscatedChannel(channel)) continue;
    if (!guildId || channel.guild_id === guildId) merged.set(channel.id, channel);
  }
  return [...merged.values()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}
