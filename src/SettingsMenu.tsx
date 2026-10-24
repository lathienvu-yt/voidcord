import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { Bell, Code2, Download, FolderUp, HardDrive, Loader2, Moon, Palette, Search, Shield, Sparkles, Upload, Video, Volume2, X } from "lucide-react";
import ApplicationCommandsPanel from "./ApplicationCommandsPanel";
import { exportCacheToVcc, downloadVccFile, importCacheFromVcc, getCacheStats } from "./offlineCache";

type Tab = "appearance" | "privacy" | "text" | "notifications" | "clips" | "voice" | "applicationCommands" | "cache";
type Theme = "dark" | "light";

type SettingsState = {
  theme: Theme;
  requiredDataVersion: number;
  developerMode: boolean;
  darkSidebar: boolean;
  messageDisplayCompact: boolean;

  contactSyncEnabled: boolean;
  hideLegacyUsername: boolean;
  allowAccessibilityDetection: boolean;
  dropsOptedOut: boolean;
  defaultGuildsRestricted: boolean;

  inlineAttachmentMedia: boolean;
  inlineEmbedMedia: boolean;
  gifAutoPlay: boolean;
  renderEmbeds: boolean;
  renderReactions: boolean;
  animateEmoji: boolean;
  convertEmoticons: boolean;
  useRichChatInput: boolean;
  useThreadSidebar: boolean;

  allowVoiceRecording: boolean;
  clipsEnabled: boolean;

  showInAppNotifications: boolean;
  notifyFriendsOnGoLive: boolean;

  autoPlayVideos: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
};

const defaults: SettingsState = {
  theme: "dark",
  requiredDataVersion: 0,
  developerMode: false,
  darkSidebar: false,
  messageDisplayCompact: false,

  contactSyncEnabled: false,
  hideLegacyUsername: false,
  allowAccessibilityDetection: false,
  dropsOptedOut: false,
  defaultGuildsRestricted: false,

  inlineAttachmentMedia: true,
  inlineEmbedMedia: true,
  gifAutoPlay: true,
  renderEmbeds: true,
  renderReactions: true,
  animateEmoji: true,
  convertEmoticons: true,
  useRichChatInput: true,
  useThreadSidebar: true,

  allowVoiceRecording: true,
  clipsEnabled: true,

  showInAppNotifications: true,
  notifyFriendsOnGoLive: true,

  autoPlayVideos: true,
  noiseSuppression: true,
  echoCancellation: true,
};

type Props = {
  onClose: () => void;
  onThemeChange: (theme: Theme) => void;
  ignoredUserIds: Set<string>;
  blockedUserIds: string[];
  onToggleIgnore: (userId: string) => void;
  onBlockUser: (userId: string, blocked: boolean) => void;
  onOpenClientSettings: () => void;
};

export default function SettingsMenu({
  onClose,
  onThemeChange,
  ignoredUserIds,
  blockedUserIds,
  onToggleIgnore,
  onBlockUser,
  onOpenClientSettings,
}: Props) {
  const [tab, setTab] = useState<Tab>("appearance");
  const [settings, setSettings] = useState<SettingsState>(defaults);
  const [userId, setUserId] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const store = await load("voidcord-v1.json", { autoSave: true, defaults: {} });
        const saved = await store.get<Partial<SettingsState>>("clientSettings");
        if (active && saved) {
          setSettings({ ...defaults, ...saved });
          onThemeChange(saved.theme ?? defaults.theme);
        }
      } catch {
        /* Settings remain usable in browser preview mode. */
      }
    })();
    return () => {
      active = false;
    };
  }, [onThemeChange]);

  async function persist(next: SettingsState) {
    setSettings(next);
    try {
      const store = await load("voidcord-v1.json", { autoSave: true, defaults: {} });
      await store.set("clientSettings", next);
    } catch {
      /* Browser preview has no Tauri store. */
    }
  }

  async function updateProto(
    scope: "appearance" | "privacy" | "textAndImages" | "clips" | "notifications",
    field: string,
    value: boolean
  ) {
    const changes: Record<string, unknown> = {
      requiredDataVersion: settings.requiredDataVersion,
      [scope]: { [field]: value },
    };
    try {
      const envelope = await invoke<{ settings: string; required_data_version: number }>(
        "save_client_settings",
        { changes }
      );
      setNotice(`Synced with Discord · ${envelope.settings.length} Base64 characters`);
      window.setTimeout(() => setNotice(""), 2200);
    } catch (error) {
      setNotice(`Could not sync setting: ${String(error)}`);
    }
  }

  async function toggle<K extends keyof SettingsState>(
    key: K,
    value: SettingsState[K],
    scope?: "appearance" | "privacy" | "textAndImages" | "clips" | "notifications",
    field?: string
  ) {
    const next = { ...settings, [key]: value };
    await persist(next);
    if (key === "theme") onThemeChange(value as Theme);
    if (scope && field && typeof value === "boolean") await updateProto(scope, field, value);
  }

  function addRelationship(action: "block" | "ignore") {
    const id = userId.trim();
    if (!id) return;
    if (action === "ignore") {
      if (!ignoredUserIds.has(id)) onToggleIgnore(id);
      setNotice("User ignored locally");
    } else {
      if (!blockedUserIds.includes(id)) onBlockUser(id, true);
      setNotice("Block request sent");
    }
    setUserId("");
    window.setTimeout(() => setNotice(""), 2200);
  }

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: "appearance", label: "Appearance", icon: <Palette size={16} /> },
    { id: "text", label: "Text & Images", icon: <Sparkles size={16} /> },
    { id: "privacy", label: "Privacy & Safety", icon: <Shield size={16} /> },
    { id: "notifications", label: "Notifications", icon: <Bell size={16} /> },
    { id: "clips", label: "Clips", icon: <Video size={16} /> },
    { id: "voice", label: "Voice & Video", icon: <Volume2 size={16} /> },
    { id: "applicationCommands", label: "Application Commands", icon: <Code2 size={16} /> },
    { id: "cache", label: "Cache & Storage (.vcc)", icon: <HardDrive size={16} /> },
  ];
  const visibleTabs = tabs.filter(item => item.label.toLowerCase().includes(search.trim().toLowerCase()));

  const tabTitles: Record<Tab, string> = {
    appearance: "Appearance",
    text: "Text & Images",
    privacy: "Privacy & Safety",
    notifications: "Notifications",
    clips: "Clips",
    voice: "Voice & Video",
    applicationCommands: "Application Commands",
    cache: "Cache & Storage (.vcc)",
  };

  return (
    <div
      className="proto-settings-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="proto-settings-window" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="proto-settings-topbar">
          <div>
            <strong>{tabTitles[tab]}</strong>
          </div>
          <button className="proto-settings-close" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </header>
        <div className="proto-settings-layout">
          <nav className="proto-settings-nav" aria-label="Settings sections">
            <div className="proto-settings-sidebar-brand">
              <span className="proto-settings-brand-mark">V</span>
              <div>
                <strong>VoidCord</strong>
                <small>Settings</small>
              </div>
            </div>
            <label className="proto-settings-search">
              <Search size={15} />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search settings"
                aria-label="Search settings"
              />
            </label>
            <div className="proto-settings-nav-group">
              <small>ACCOUNT & PRIVACY</small>
              {visibleTabs
                .filter(item => item.id === "privacy")
                .map(item => (
                  <NavButton key={item.id} item={item} selected={tab === item.id} onClick={() => setTab(item.id)} />
                ))}
            </div>
            <div className="proto-settings-nav-group">
              <small>APP EXPERIENCE</small>
              {visibleTabs
                .filter(item => item.id !== "privacy" && item.id !== "applicationCommands")
                .map(item => (
                  <NavButton key={item.id} item={item} selected={tab === item.id} onClick={() => setTab(item.id)} />
                ))}
            </div>
            <div className="proto-settings-nav-group">
              <small>DEVELOPER TOOLS</small>
              {visibleTabs
                .filter(item => item.id === "applicationCommands")
                .map(item => (
                  <NavButton key={item.id} item={item} selected={tab === item.id} onClick={() => setTab(item.id)} />
                ))}
            </div>
            {visibleTabs.length === 0 && <p className="proto-settings-no-results">No settings found</p>}
            <div className="proto-settings-nav-spacer" />
            <button className="proto-settings-client-link" onClick={onOpenClientSettings}>
              Client preferences
            </button>
          </nav>
          <div className="proto-settings-content">
            {tab === "appearance" && (
              <>
                <h2>Appearance</h2>
                <p className="proto-settings-help">Customize VoidCord's interface theme and display density.</p>
                <div className="proto-setting-row">
                  <div>
                    <strong>Theme</strong>
                    <small>Choose the local application color theme.</small>
                  </div>
                  <select value={settings.theme} onChange={e => void toggle("theme", e.target.value as Theme)}>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>
                <Toggle
                  title="Compact message display"
                  detail="Fit more messages on screen by aligning avatars and timestamps inline."
                  value={settings.messageDisplayCompact}
                  onChange={v => void toggle("messageDisplayCompact", v, "appearance", "messageDisplayCompact")}
                />
                <Toggle
                  title="Dark sidebar"
                  detail="Keep the navigation rail dark even when using the light theme."
                  value={settings.darkSidebar}
                  onChange={v => void toggle("darkSidebar", v, "appearance", "darkSidebar")}
                />
                <Toggle
                  title="Developer mode"
                  detail="Expose Discord snowflake IDs in context menus and slash toolings."
                  value={settings.developerMode}
                  onChange={v => void toggle("developerMode", v, "appearance", "developerMode")}
                />
                <label className="proto-setting-row">
                  <div>
                    <strong>Required data version</strong>
                    <small>Protobuf synchronization version offset. Zero uses the latest snapshot version.</small>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={settings.requiredDataVersion}
                    onChange={e => void toggle("requiredDataVersion", Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
              </>
            )}

            {tab === "text" && (
              <>
                <h2>Text & Images</h2>
                <p className="proto-settings-help">Configure message formatting, media auto-display, and chat previews.</p>
                <Toggle
                  title="Inline attachment media"
                  detail="Display image and video attachments directly within messages."
                  value={settings.inlineAttachmentMedia}
                  onChange={v => void toggle("inlineAttachmentMedia", v, "textAndImages", "inlineAttachmentMedia")}
                />
                <Toggle
                  title="Inline embed media"
                  detail="Show rich media embeds from supported external links."
                  value={settings.inlineEmbedMedia}
                  onChange={v => void toggle("inlineEmbedMedia", v, "textAndImages", "inlineEmbedMedia")}
                />
                <Toggle
                  title="Render embeds"
                  detail="Show link preview embeds in conversations."
                  value={settings.renderEmbeds}
                  onChange={v => void toggle("renderEmbeds", v, "textAndImages", "renderEmbeds")}
                />
                <Toggle
                  title="GIF autoplay"
                  detail="Automatically animate GIF files and GIF stickers in chat."
                  value={settings.gifAutoPlay}
                  onChange={v => void toggle("gifAutoPlay", v, "textAndImages", "gifAutoPlay")}
                />
                <Toggle
                  title="Animate emoji"
                  detail="Play animations for custom animated server and nitro emojis."
                  value={settings.animateEmoji}
                  onChange={v => void toggle("animateEmoji", v, "textAndImages", "animateEmoji")}
                />
                <Toggle
                  title="Show emoji reactions"
                  detail="Display reaction counts and pills underneath messages."
                  value={settings.renderReactions}
                  onChange={v => void toggle("renderReactions", v, "textAndImages", "renderReactions")}
                />
                <Toggle
                  title="Convert emoticons to emoji"
                  detail="Automatically convert emoticons like :-) to their matching emoji."
                  value={settings.convertEmoticons}
                  onChange={v => void toggle("convertEmoticons", v, "textAndImages", "convertEmoticons")}
                />
                <Toggle
                  title="Rich chat input"
                  detail="Enable formatted rich text display inside the composer box."
                  value={settings.useRichChatInput}
                  onChange={v => void toggle("useRichChatInput", v, "textAndImages", "useRichChatInput")}
                />
                <Toggle
                  title="Thread sidebar view"
                  detail="Open active channel threads in the side drawer split view."
                  value={settings.useThreadSidebar}
                  onChange={v => void toggle("useThreadSidebar", v, "textAndImages", "useThreadSidebar")}
                />
              </>
            )}

            {tab === "privacy" && (
              <>
                <h2>Privacy & Safety</h2>
                <p className="proto-settings-help">Manage account safety, direct messaging permissions, and local blocklists.</p>
                <Toggle
                  title="Direct messages from server members"
                  detail="Allow direct messages from members of mutual Discord servers by default."
                  value={!settings.defaultGuildsRestricted}
                  onChange={v => void toggle("defaultGuildsRestricted", !v, "privacy", "defaultGuildsRestricted")}
                />
                <Toggle
                  title="Contact sync"
                  detail="Synchronize mobile phone contacts to discover friends on Discord."
                  value={settings.contactSyncEnabled}
                  onChange={v => void toggle("contactSyncEnabled", v, "privacy", "contactSyncEnabled")}
                />
                <Toggle
                  title="Hide legacy username"
                  detail="Prioritize global display names over legacy #0001 discriminators."
                  value={settings.hideLegacyUsername}
                  onChange={v => void toggle("hideLegacyUsername", v, "privacy", "hideLegacyUsername")}
                />
                <Toggle
                  title="Screen reader & accessibility telemetry"
                  detail="Allow Discord to detect assistive technology usage to adapt interface accessibility."
                  value={settings.allowAccessibilityDetection}
                  onChange={v => void toggle("allowAccessibilityDetection", v, "privacy", "allowAccessibilityDetection")}
                />
                <Toggle
                  title="Opt out of Discord Drops"
                  detail="Do not participate in sponsored quest rewards and promotional inventory drops."
                  value={settings.dropsOptedOut}
                  onChange={v => void toggle("dropsOptedOut", v, "privacy", "dropsOptedOut")}
                />
                <div className="proto-settings-subheading">Block / ignore</div>
                <p className="proto-settings-help">Block and unblock use Discord account relationships. Local ignore hides messages exclusively in this client.</p>
                <div className="proto-relationship-entry">
                  <input
                    value={userId}
                    onChange={e => setUserId(e.target.value)}
                    placeholder="Discord user ID"
                  />
                  <button onClick={() => addRelationship("block")}>Block</button>
                  <button onClick={() => addRelationship("ignore")}>Ignore locally</button>
                </div>
                <RelationshipList title="Blocked accounts" values={blockedUserIds} onRemove={id => onBlockUser(id, false)} />
                <RelationshipList title="Ignored on this device" values={[...ignoredUserIds]} onRemove={onToggleIgnore} />
              </>
            )}

            {tab === "notifications" && (
              <>
                <h2>Notifications</h2>
                <p className="proto-settings-help">Configure alert badges, in-app banners, and stream alerts.</p>
                <Toggle
                  title="In-app notifications"
                  detail="Show notification toast popups when new messages arrive while the app is focused."
                  value={settings.showInAppNotifications}
                  onChange={v => void toggle("showInAppNotifications", v, "notifications", "showInAppNotifications")}
                />
                <Toggle
                  title="Notify friends when going live"
                  detail="Send an alert to friends when you begin streaming in a server voice channel."
                  value={settings.notifyFriendsOnGoLive}
                  onChange={v => void toggle("notifyFriendsOnGoLive", v, "notifications", "notifyFriendsOnGoLive")}
                />
              </>
            )}

            {tab === "clips" && (
              <>
                <h2>Clips</h2>
                <p className="proto-settings-help">Configure background recording and voice capture for clips.</p>
                <Toggle
                  title="Enable Clips"
                  detail="Allow capturing gameplay and stream replay clips."
                  value={settings.clipsEnabled}
                  onChange={v => void toggle("clipsEnabled", v, "clips", "clipsEnabled")}
                />
                <Toggle
                  title="Allow voice recording in clips"
                  detail="Include your microphone and channel voice audio in saved clips."
                  value={settings.allowVoiceRecording}
                  onChange={v => void toggle("allowVoiceRecording", v, "clips", "allowVoiceRecording")}
                />
              </>
            )}

            {tab === "voice" && (
              <>
                <h2>Voice & Video</h2>
                <p className="proto-settings-help">Media playback and local voice processing preferences.</p>
                <Toggle
                  title="Autoplay videos in chat"
                  detail="Automatically play video attachment previews when messages are scrolled into view."
                  value={settings.autoPlayVideos}
                  onChange={v => void toggle("autoPlayVideos", v)}
                />
                <Toggle
                  title="Noise suppression"
                  detail="Filter background room noise and keyboard clicks during voice calls."
                  value={settings.noiseSuppression}
                  onChange={v => void toggle("noiseSuppression", v)}
                />
                <Toggle
                  title="Echo cancellation"
                  detail="Prevent speaker audio from feeding back into your microphone."
                  value={settings.echoCancellation}
                  onChange={v => void toggle("echoCancellation", v)}
                />
              </>
            )}

            {tab === "applicationCommands" && <ApplicationCommandsPanel />}
            {tab === "cache" && <CachePanel />}
          </div>
        </div>
        <footer className="proto-settings-footer">
          <span>{notice || "Synced preference changes use the configured primary account."}</span>
          <span>
            <Moon size={13} /> Local theme
          </span>
        </footer>
      </section>
    </div>
  );
}

function Toggle({
  title,
  detail,
  value,
  onChange,
}: {
  title: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="proto-setting-row">
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      <button
        className={`proto-setting-switch ${value ? "on" : ""}`}
        role="switch"
        aria-checked={value}
        aria-label={title}
        onClick={() => onChange(!value)}
      >
        <span />
      </button>
    </div>
  );
}

function NavButton({
  item,
  selected,
  onClick,
}: {
  item: { id: Tab; label: string; icon: ReactNode };
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`proto-settings-nav-button ${selected ? "selected" : ""}`} onClick={onClick}>
      {item.icon}
      <span>{item.label}</span>
    </button>
  );
}

function RelationshipList({
  title,
  values,
  onRemove,
}: {
  title: string;
  values: string[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="proto-relationship-list">
      <strong>{title}</strong>
      {values.length ? (
        values.map(id => (
          <div key={id}>
            <span>{id}</span>
            <button onClick={() => onRemove(id)}>Remove</button>
          </div>
        ))
      ) : (
        <small>Empty</small>
      )}
    </div>
  );
}


function CachePanel() {
  const [stats, setStats] = useState<{ channelsCount: number; messagesCount: number; deletedMessagesCount: number; editedMessagesCount: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshStats = () => {
    void getCacheStats().then(setStats).catch(() => {});
  };

  useEffect(() => {
    refreshStats();
  }, []);

  const handleExportTo = async () => {
    setLoading(true);
    setStatusMsg("");
    try {
      const vccJson = await exportCacheToVcc();
      try {
        const savedPath = await invoke<string>("export_vcc_file", { content: vccJson });
        setStatusMsg(`✓ Exported to ${savedPath}`);
      } catch (err) {
        const errStr = String(err);
        if (errStr.includes("cancelled")) {
          setStatusMsg("Export cancelled.");
        } else {
          downloadVccFile(vccJson);
          setStatusMsg("✓ Exported to Downloads folder");
        }
      }
    } catch (e) {
      setStatusMsg(`Export failed: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickExport = async () => {
    setLoading(true);
    setStatusMsg("");
    try {
      const vccJson = await exportCacheToVcc();
      downloadVccFile(vccJson);
      setStatusMsg("✓ Exported to Downloads folder");
    } catch (e) {
      setStatusMsg(`Export failed: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePickImport = async () => {
    setLoading(true);
    setStatusMsg("Opening file picker…");
    try {
      let content = "";
      try {
        content = await invoke<string>("pick_vcc_file");
      } catch (err) {
        const errStr = String(err);
        if (errStr.includes("cancelled")) {
          setStatusMsg("Import cancelled.");
          setLoading(false);
          return;
        }
        // Fallback to web input if native picker unsupported
        fileInputRef.current?.click();
        setLoading(false);
        return;
      }
      const res = await importCacheFromVcc(content);
      setStatusMsg(`✓ Imported ${res.messagesCount} messages across ${res.channelsCount} channels!`);
      refreshStats();
    } catch (e) {
      setStatusMsg(`Import failed: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleWebFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setStatusMsg("Importing .vcc file…");
    try {
      const text = await file.text();
      const res = await importCacheFromVcc(text);
      setStatusMsg(`✓ Imported ${res.messagesCount} messages across ${res.channelsCount} channels from ${file.name}!`);
      refreshStats();
    } catch (e) {
      setStatusMsg(`Import failed: ${e}`);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <h2>Cache & Storage (.vcc)</h2>
      <div className="proto-cache-description">
        <p>VoidCord saves channels, messages, commands, and deleted/edited logs locally in IndexedDB so you can read them offline. You can export this cache as a <code>.vcc</code> (VoidCord Cache) file to share with others or backup your history.</p>
      </div>

      <div className="proto-cache-stats-grid">
        <div className="proto-cache-stat-card">
          <strong>{stats ? stats.channelsCount : "—"}</strong>
          <span>Cached Channels</span>
        </div>
        <div className="proto-cache-stat-card">
          <strong>{stats ? stats.messagesCount : "—"}</strong>
          <span>Cached Messages</span>
        </div>
        <div className="proto-cache-stat-card">
          <strong>{stats ? stats.deletedMessagesCount : "—"}</strong>
          <span>Deleted Logs</span>
        </div>
        <div className="proto-cache-stat-card">
          <strong>{stats ? stats.editedMessagesCount : "—"}</strong>
          <span>Edited Logs</span>
        </div>
      </div>

      <div className="proto-cache-actions">
        <div className="proto-cache-action-row">
          <div>
            <strong>Export .vcc Cache</strong>
            <small>Export your offline messages, channels, and logs to a .vcc file.</small>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" className="proto-cache-btn" onClick={handleExportTo} disabled={loading} title="Choose destination folder and export">
              {loading ? <Loader2 size={14} className="spinning" /> : <FolderUp size={14} />} Export to…
            </button>
            <button type="button" className="proto-cache-btn" style={{ background: "rgba(255,255,255,0.08)" }} onClick={handleQuickExport} disabled={loading} title="Quick save to Downloads">
              <Download size={14} /> Quick Save
            </button>
          </div>
        </div>

        <div className="proto-cache-action-row">
          <div>
            <strong>Import .vcc Cache</strong>
            <small>Merge messages and channels from a .vcc cache file into your local offline database.</small>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            accept=".vcc,application/json"
            style={{ display: "none" }}
            onChange={handleWebFileChange}
          />
          <button type="button" className="proto-cache-btn" onClick={handlePickImport} disabled={loading}>
            {loading ? <Loader2 size={14} className="spinning" /> : <Upload size={14} />} Import .vcc…
          </button>
        </div>

        {statusMsg && (
          <div className={`proto-cache-status ${statusMsg.startsWith("✓") ? "success" : "error"}`}>
            {statusMsg}
          </div>
        )}
      </div>
    </>
  );
}
