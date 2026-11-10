import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Save, X } from "lucide-react";
import { DiscordChannel, DiscordGuild, guildBannerUrl } from "./types";

type GuildSettingsData = DiscordGuild & {
  approximate_member_count?: number;
  approximate_presence_count?: number;
  premium_tier?: number;
  premium_subscription_count?: number;
};

type Draft = {
  name: string;
  description: string;
  verification_level: number;
  explicit_content_filter: number;
  default_message_notifications: number;
  afk_channel_id: string;
  afk_timeout: number;
  system_channel_id: string;
  rules_channel_id: string;
  public_updates_channel_id: string;
  safety_alerts_channel_id: string;
  preferred_locale: string;
  premium_progress_bar_enabled: boolean;
};

const makeDraft = (guild: GuildSettingsData): Draft => ({
  name: guild.name || "",
  description: guild.description || "",
  verification_level: guild.verification_level ?? 0,
  explicit_content_filter: guild.explicit_content_filter ?? 0,
  default_message_notifications: guild.default_message_notifications ?? 0,
  afk_channel_id: guild.afk_channel_id || "",
  afk_timeout: guild.afk_timeout ?? 300,
  system_channel_id: guild.system_channel_id || "",
  rules_channel_id: guild.rules_channel_id || "",
  public_updates_channel_id: guild.public_updates_channel_id || "",
  safety_alerts_channel_id: guild.safety_alerts_channel_id || "",
  preferred_locale: guild.preferred_locale || "en-US",
  premium_progress_bar_enabled: guild.premium_progress_bar_enabled ?? false,
});

export default function GuildSettings({
  guild, channels, canManageGuild, invoke, onClose, onLeave,
}: {
  guild: DiscordGuild;
  channels: DiscordChannel[];
  canManageGuild: boolean;
  invoke: <T,>(command: string, args?: Record<string, unknown>) => Promise<T>;
  onClose: () => void;
  onLeave: () => void;
}) {
  const [data, setData] = useState<GuildSettingsData>(guild);
  const [draft, setDraft] = useState<Draft>(() => makeDraft(guild));
  const [tab, setTab] = useState<"overview" | "moderation" | "privacy" | "info">("overview");
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [bannerData, setBannerData] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void invoke<GuildSettingsData>("get_guild_settings", { guildId: guild.id })
      .then(result => {
        if (!active) return;
        const next = { ...guild, ...result };
        setData(next);
        setDraft(makeDraft(next));
        setLoaded(true);
      })
      .catch(reason => { if (active) setError(String(reason).replace(/^Error: /, "")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [guild.id, invoke]);

  const banner = bannerData || guildBannerUrl(data);
  const features = data.features || [];
  const canSetBanner = features.includes("BANNER");
  const canSetAnimatedBanner = features.includes("ANIMATED_BANNER");
  const textChannels = useMemo(() => channels.filter(channel => channel.type === 0 || channel.type === 5), [channels]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const changed = JSON.stringify(draft) !== JSON.stringify(makeDraft(data)) || bannerData !== null;

  const leaveServer = async () => {
    if (leaving) return;
    setLeaving(true);
    setError("");
    try { await invoke("leave_guild", { guildId: guild.id }); onLeave(); }
    catch (reason) { setError(String(reason).replace(/^Error: /, "")); setLeaving(false); setLeaveConfirm(false); }
  };

  const save = async () => {
    if (!canManageGuild || saving) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        verification_level: draft.verification_level,
        explicit_content_filter: draft.explicit_content_filter,
        default_message_notifications: draft.default_message_notifications,
        afk_channel_id: draft.afk_channel_id || null,
        afk_timeout: draft.afk_timeout,
        system_channel_id: draft.system_channel_id || null,
        rules_channel_id: draft.rules_channel_id || null,
        public_updates_channel_id: draft.public_updates_channel_id || null,
        safety_alerts_channel_id: draft.safety_alerts_channel_id || null,
        preferred_locale: draft.preferred_locale.trim() || "en-US",
        premium_progress_bar_enabled: draft.premium_progress_bar_enabled,
        banner: bannerData || undefined,
      };
      await invoke<GuildSettingsData>("update_guild_settings", { guildId: guild.id, settings: payload });
      const refreshed = await invoke<GuildSettingsData>("get_guild_settings", { guildId: guild.id });
      const next = { ...data, ...refreshed };
      setData(next);
      setDraft(makeDraft(next));
      setBannerData(null);
    } catch (reason) {
      setError(String(reason).replace(/^Error: /, ""));
    } finally {
      setSaving(false);
    }
  };

  const channelSelect = (label: string, key: "afk_channel_id" | "system_channel_id" | "rules_channel_id" | "public_updates_channel_id" | "safety_alerts_channel_id") => (
    <label className="guild-settings-field">
      {label}
      <select disabled={!canManageGuild} value={draft[key]} onChange={event => set(key, event.target.value)}>
        <option value="">Not set</option>
        {textChannels.map(channel => <option key={channel.id} value={channel.id}>#{channel.name || channel.id}</option>)}
      </select>
    </label>
  );

  return (
    <div className="feature-modal-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="feature-modal guild-settings-modal" role="dialog" aria-modal="true" aria-labelledby="guild-settings-title">
        <button type="button" className="feature-modal-close" aria-label="Close server settings" onClick={onClose}><X size={18} /></button>
        <h2 id="guild-settings-title">Server Settings</h2>
        <p className="settings-help">{guild.name} · {canManageGuild ? "You can manage this server" : "Read-only · Manage Server permission required to edit"}</p>
        <div className="feature-modal-tabs">
          <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button>
          <button type="button" className={tab === "moderation" ? "active" : ""} onClick={() => setTab("moderation")}>Safety</button>
          <button type="button" className={tab === "privacy" ? "active" : ""} onClick={() => setTab("privacy")}>Privacy</button>
          <button type="button" className={tab === "info" ? "active" : ""} onClick={() => setTab("info")}>Server Info</button>
        </div>
        <div className="guild-settings-body">
          {loading ? <div className="settings-loading"><Loader2 size={18} className="spinning" /> Loading server configuration…</div> : (
            <>
              <div className="guild-settings-banner">
                {banner ? <img src={banner} alt="" /> : <div className="guild-settings-banner-empty">No server banner configured</div>}
                {banner && data.banner?.startsWith("a_") && <span className="guild-settings-banner-tag">ANIMATED GIF</span>}
              </div>
              {canManageGuild && canSetBanner && (
                <label className="guild-settings-upload">
                  <span>{bannerData ? "Banner image selected · save to apply" : "Change server banner"}</span>
                  <input type="file" accept="image/png,image/jpeg,image/gif" onChange={event => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (!file) return;
                    if (!["image/png", "image/jpeg", "image/gif"].includes(file.type)) { setError("Choose a PNG, JPEG, or GIF image."); return; }
                    if (file.size > 10 * 1024 * 1024) { setError("Banner files must be 10 MB or smaller."); return; }
                    if (file.type === "image/gif" && !canSetAnimatedBanner) { setError("This server does not have the ANIMATED_BANNER feature."); return; }
                    const reader = new FileReader();
                    reader.onload = () => { if (typeof reader.result === "string") { setBannerData(reader.result); setError(""); } };
                    reader.onerror = () => setError("The selected banner could not be read.");
                    reader.readAsDataURL(file);
                  }} />
                  <small>{canSetAnimatedBanner ? "PNG, JPEG, or animated GIF supported." : "PNG or JPEG supported. Animated GIF requires ANIMATED_BANNER."}</small>
                </label>
              )}
              <div className="guild-settings-meta">
                {typeof data.approximate_member_count === "number" && <span className="guild-settings-chip">{data.approximate_member_count.toLocaleString()} members</span>}
                {typeof data.approximate_presence_count === "number" && <span className="guild-settings-chip">{data.approximate_presence_count.toLocaleString()} online</span>}
                {typeof data.premium_tier === "number" && <span className="guild-settings-chip">Boost level {data.premium_tier}</span>}
                {features.includes("ANIMATED_BANNER") && <span className="guild-settings-chip">Animated banners enabled</span>}
              </div>
              {tab === "overview" ? (
                <>
                  <h3 className="guild-settings-section-title">Server identity</h3>
                  <div className="guild-settings-grid">
                    <label className="guild-settings-field full">Server name
                      <input disabled={!canManageGuild} maxLength={100} value={draft.name} onChange={event => set("name", event.target.value)} />
                    </label>
                    <label className="guild-settings-field full">Description
                      <textarea disabled={!canManageGuild} maxLength={120} value={draft.description} onChange={event => set("description", event.target.value)} placeholder="Tell people what this server is about" />
                    </label>
                    <label className="guild-settings-field">Preferred locale
                      <input disabled={!canManageGuild} maxLength={16} value={draft.preferred_locale} onChange={event => set("preferred_locale", event.target.value)} />
                    </label>
                    <label className="guild-settings-field">Default notifications
                      <select disabled={!canManageGuild} value={draft.default_message_notifications} onChange={event => set("default_message_notifications", Number(event.target.value))}>
                        <option value={0}>All messages</option><option value={1}>Only @mentions</option>
                      </select>
                    </label>
                  </div>
                  <h3 className="guild-settings-section-title">Server channels</h3>
                  <div className="guild-settings-grid">
                    {channelSelect("AFK channel", "afk_channel_id")}
                    <label className="guild-settings-field">AFK timeout
                      <select disabled={!canManageGuild} value={draft.afk_timeout} onChange={event => set("afk_timeout", Number(event.target.value))}>
                        {[60, 300, 900, 1800, 3600].map(value => <option key={value} value={value}>{value < 3600 ? value / 60 + " minutes" : "60 minutes"}</option>)}
                      </select>
                    </label>
                    {channelSelect("System messages", "system_channel_id")}
                    {channelSelect("Rules channel", "rules_channel_id")}
                    {channelSelect("Community updates", "public_updates_channel_id")}
                    {channelSelect("Safety alerts", "safety_alerts_channel_id")}
                  </div>
                  <p className="guild-settings-note">Personal notification overrides are separate from server-wide defaults and belong in your notification preferences.</p>
                </>
              ) : tab === "moderation" ? (
                <>
                  <h3 className="guild-settings-section-title">Safety & Moderation</h3>
                  <div className="guild-settings-grid">
                    <label className="guild-settings-field">Verification level
                      <select disabled={!canManageGuild} value={draft.verification_level} onChange={event => set("verification_level", Number(event.target.value))}>
                        <option value={0}>None</option><option value={1}>Low</option><option value={2}>Medium</option><option value={3}>High</option><option value={4}>Highest</option>
                      </select>
                    </label>
                    <label className="guild-settings-field">Explicit content filter
                      <select disabled={!canManageGuild} value={draft.explicit_content_filter} onChange={event => set("explicit_content_filter", Number(event.target.value))}>
                        <option value={0}>Disabled</option><option value={1}>Members without roles</option><option value={2}>All members</option>
                      </select>
                    </label>
                    {channelSelect("Safety alerts channel", "safety_alerts_channel_id")}
                  </div>
                  <p className="guild-settings-note">Discord applies the server's verification and content-filter rules. Some community controls may only be available when the server has the corresponding feature enabled.</p>
                </>
              ) : tab === "privacy" ? (
                <>
                  <h3 className="guild-settings-section-title">Privacy settings</h3>
                  <p className="guild-settings-note">These are account-level preferences, not server configuration. Manage who can contact you and how your account activity is shared from User Settings → Privacy & Safety.</p>
                  <div className="guild-settings-info-card"><strong>Direct messages from server members</strong><span>Review whether people in shared servers can send you direct messages.</span></div>
                  <div className="guild-settings-info-card"><strong>Activity and data controls</strong><span>Review activity status, data personalization, and friend request permissions in your account privacy settings.</span></div>
                  <button type="button" className="guild-settings-link" onClick={() => { onClose(); document.querySelector<HTMLButtonElement>(".pfp-button")?.click(); }}>Open User Settings</button>
                </>
              ) : (
                <>
                  <h3 className="guild-settings-section-title">Server information</h3>
                  <div className="guild-settings-info-grid">
                    <div><small>Server name</small><strong>{data.name}</strong></div>
                    <div><small>Server ID</small><strong>{data.id}</strong></div>
                    <div><small>Owner ID</small><strong>{data.owner_id || "Unavailable"}</strong></div>
                    <div><small>Preferred locale</small><strong>{data.preferred_locale || "Not set"}</strong></div>
                    <div><small>Members</small><strong>{data.approximate_member_count?.toLocaleString() ?? "Unavailable"}</strong></div>
                    <div><small>Online</small><strong>{data.approximate_presence_count?.toLocaleString() ?? "Unavailable"}</strong></div>
                    <div><small>Boost level</small><strong>{data.premium_tier ?? 0}</strong></div>
                    <div><small>Boosts</small><strong>{data.premium_subscription_count ?? "Unavailable"}</strong></div>
                    <div className="full"><small>Features</small><strong>{features.length ? features.join(" · ") : "No special features reported"}</strong></div>
                  </div>
                  <button type="button" className="guild-settings-danger" onClick={() => setLeaveConfirm(true)}><AlertTriangle size={15} /> Leave Server</button>
                  {leaveConfirm && <div className="guild-settings-confirm" role="alertdialog" aria-modal="true" aria-label="Confirm leaving server">
                    <strong>Leave {guild.name}?</strong>
                    <p>You will need a new invite to rejoin this server. This does not delete the server.</p>
                    <div><button type="button" disabled={leaving} onClick={() => setLeaveConfirm(false)}>Cancel</button><button type="button" disabled={leaving} onClick={() => void leaveServer()}>{leaving ? "Leaving…" : "Leave Server"}</button></div>
                  </div>}
                </>
              )}
              {error && <div className="guild-settings-error" role="alert">{error}</div>}
              {!loaded && !error && <p className="guild-settings-note">The server settings could not be loaded.</p>}
            </>
          )}
        </div>
        <footer className="guild-settings-footer">
          <span className="guild-settings-note">{tab === "info" ? "Server details are read from Discord." : tab === "privacy" ? "Privacy controls are managed in your account settings." : canManageGuild ? "Changes are saved directly to Discord." : "You can view settings, but cannot modify them."}</span>
          <div className="guild-settings-footer-actions">
            <button type="button" onClick={onClose} disabled={saving}>Close</button>
            {canManageGuild && <button type="button" className="primary" onClick={() => void save()} disabled={loading || saving || !changed || !draft.name.trim()}>
              {saving ? <><Loader2 size={14} className="spinning" /> Saving…</> : <><Save size={14} /> Save changes</>}
            </button>}
          </div>
        </footer>
      </section>
    </div>
  );
}
