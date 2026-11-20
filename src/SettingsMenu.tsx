import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { Bell, Code2, Download, FolderUp, HardDrive, Loader2, Moon, Palette, Search, Shield, Sparkles, Upload, Video, Volume2, X } from "lucide-react";
import ApplicationCommandsPanel from "./ApplicationCommandsPanel";
import { exportCacheToVcc, downloadVccFile, importCacheFromVcc, getCacheStats, getVccExportCatalog, previewVccExport, buildReplayTimeline, type VoidCordCacheBundle, type VccExportCatalog } from "./offlineCache";

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
  embedded?: boolean;
  initialTab?: Tab;
  onClose: () => void;
  onThemeChange: (theme: Theme) => void;
  ignoredUserIds: Set<string>;
  blockedUserIds: string[];
  onToggleIgnore: (userId: string) => void;
  onBlockUser: (userId: string, blocked: boolean) => void;
  onOpenClientSettings: () => void;
};

export default function SettingsMenu({
  embedded = false,
  initialTab = "appearance",
  onClose,
  onThemeChange,
  ignoredUserIds,
  blockedUserIds,
  onToggleIgnore,
  onBlockUser,
  onOpenClientSettings,
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => { setTab(initialTab); }, [initialTab]);
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
      className={embedded ? "proto-settings-embedded" : "proto-settings-backdrop"}
      onMouseDown={embedded ? undefined : e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`proto-settings-window${embedded ? " proto-settings-window-embedded" : ""}`}
        role="dialog"
        aria-modal={embedded ? undefined : true}
        aria-label="Discord settings"
      >
        {!embedded && (
          <header className="proto-settings-topbar">
            <div>
              <strong>{tabTitles[tab]}</strong>
            </div>
            <button className="proto-settings-close" onClick={onClose} aria-label="Close settings">
              <X size={18} />
            </button>
          </header>
        )}
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
              Client settings
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
  const [catalog, setCatalog] = useState<VccExportCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [preset, setPreset] = useState<"all" | "today" | "7d" | "30d" | "90d" | "custom">("all");
  const [fromValue, setFromValue] = useState("");
  const [toValue, setToValue] = useState("");
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ channelsCount: number; messagesCount: number } | null>(null);
  const [replayBundle, setReplayBundle] = useState<VoidCordCacheBundle | null>(null);
  const [replayChannelId, setReplayChannelId] = useState("all");
  const [replaySearch, setReplaySearch] = useState("");
  const [replayLimit, setReplayLimit] = useState(100);
  const [replayCursor, setReplayCursor] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshStats = () => {
    void getCacheStats().then(setStats).catch(() => {});
    void getVccExportCatalog().then(setCatalog).catch(error => setStatusMsg(`Could not inspect cache: ${error}`));
  };

  useEffect(() => { refreshStats(); }, []);

  useEffect(() => {
    let cancelled = false;
    previewVccExport({
      from: fromValue || null,
      to: toValue || null,
      serverIds: selectedServerIds,
      channelIds: selectedChannelIds,
    }).then(result => { if (!cancelled) setPreview(result); })
      .catch(error => { if (!cancelled) { setPreview(null); setStatusMsg(String(error)); } });
    return () => { cancelled = true; };
  }, [fromValue, toValue, selectedServerIds, selectedChannelIds]);

  const exportFilters = () => ({
    from: fromValue || null,
    to: toValue || null,
    serverIds: selectedServerIds,
    channelIds: selectedChannelIds,
  });

  const localDateTime = (date: Date) => {
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return adjusted.toISOString().slice(0, 16);
  };

  const applyPreset = (next: typeof preset) => {
    setPreset(next);
    if (next === "all" || next === "custom") {
      if (next === "all") { setFromValue(""); setToValue(""); }
      return;
    }
    const now = new Date();
    const from = new Date(now);
    if (next === "today") from.setHours(0, 0, 0, 0);
    if (next === "7d") from.setDate(from.getDate() - 7);
    if (next === "30d") from.setDate(from.getDate() - 30);
    if (next === "90d") from.setDate(from.getDate() - 90);
    setFromValue(localDateTime(from));
    setToValue(localDateTime(now));
  };

  const toggleServer = (id: string) => {
    setSelectedServerIds(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  };

  const toggleChannel = (id: string) => {
    setSelectedChannelIds(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  };

  const saveExport = async (quick: boolean) => {
    setLoading(true);
    setStatusMsg("");
    try {
      const vccJson = await exportCacheToVcc(exportFilters());
      if (quick) {
        downloadVccFile(vccJson);
        setStatusMsg("✓ Exported filtered .vcc to Downloads.");
      } else {
        try {
          const savedPath = await invoke<string>("export_vcc_file", { content: vccJson });
          setStatusMsg(`✓ Exported filtered .vcc to ${savedPath}`);
        } catch (err) {
          const errStr = String(err).toLowerCase();
          if (errStr.includes("cancelled")) setStatusMsg("Export cancelled.");
          else {
            downloadVccFile(vccJson);
            setStatusMsg("✓ Exported filtered .vcc to Downloads.");
          }
        }
      }
    } catch (error) {
      setStatusMsg(`Export failed: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const acceptImportedBundle = (bundle: VoidCordCacheBundle, messagesCount: number, channelsCount: number, sourceName?: string) => {
    setReplayBundle(bundle);
    setReplayChannelId("all");
    setReplaySearch("");
    setReplayLimit(100);
    setReplayPlaying(false);
    setStatusMsg(`✓ Imported ${messagesCount} messages across ${channelsCount} channels${sourceName ? ` from ${sourceName}` : ""}. ReplayCore is ready.`);
    refreshStats();
  };

  const handlePickImport = async () => {
    setLoading(true);
    setStatusMsg("Opening .vcc file picker…");
    try {
      let content = "";
      try {
        content = await invoke<string>("pick_vcc_file");
      } catch (error) {
        const message = String(error).toLowerCase();
        if (message.includes("cancelled")) {
          setStatusMsg("Import cancelled.");
          return;
        }
        fileInputRef.current?.click();
        return;
      }
      const result = await importCacheFromVcc(content);
      acceptImportedBundle(result.bundle, result.messagesCount, result.channelsCount);
    } catch (error) {
      setStatusMsg(`Import failed: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleWebFileChange = async (event: any) => {
    const file = event.target.files?.[0] as File | undefined;
    if (!file) return;
    setLoading(true);
    setStatusMsg("Importing .vcc archive…");
    try {
      const result = await importCacheFromVcc(await file.text());
      acceptImportedBundle(result.bundle, result.messagesCount, result.channelsCount, file.name);
    } catch (error) {
      setStatusMsg(`Import failed: ${error}`);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const replayEvents = useMemo(() => replayBundle ? buildReplayTimeline(replayBundle) : [], [replayBundle]);
  const replayChannels = useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of replayEvents) byId.set(item.channelId, item.channelName || item.channelId);
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [replayEvents]);
  const visibleReplayEvents = useMemo(() => replayEvents.filter(item =>
    (replayChannelId === "all" || item.channelId === replayChannelId)
    && (!replaySearch.trim() || item.message.content?.toLowerCase().includes(replaySearch.trim().toLowerCase())
      || item.message.author?.username?.toLowerCase().includes(replaySearch.trim().toLowerCase()))
  ), [replayEvents, replayChannelId, replaySearch]);
  useEffect(() => {
    setReplayPlaying(false);
    setReplayCursor(Math.max(0, visibleReplayEvents.length - 1));
  }, [replayBundle, replayChannelId, replaySearch]);

  useEffect(() => {
    if (!replayPlaying || visibleReplayEvents.length === 0) return;
    const timer = window.setInterval(() => {
      setReplayCursor(current => Math.min(current + 1, visibleReplayEvents.length - 1));
    }, 750);
    return () => window.clearInterval(timer);
  }, [replayPlaying, visibleReplayEvents.length]);

  useEffect(() => {
    if (replayPlaying && replayCursor >= visibleReplayEvents.length - 1) setReplayPlaying(false);
  }, [replayCursor, replayPlaying, visibleReplayEvents.length]);

  const displayedReplayEvents = visibleReplayEvents.slice(Math.max(0, replayCursor - replayLimit + 1), replayCursor + 1);

  const visibleChannels = (catalog?.channels || []).filter(channel =>
    selectedServerIds.length === 0 || (!!channel.serverId && selectedServerIds.includes(channel.serverId))
  );

  return (
    <>
      <h2>Cache & Storage (.vcc)</h2>
      <div className="proto-cache-description">
        <p>VoidCord stores offline messages, channels, and message-history logs in RocksDB. Export filters create a separate partial archive; they never delete or modify the original local cache.</p>
      </div>

      <div className="proto-cache-stats-grid">
        <div className="proto-cache-stat-card"><strong>{stats ? stats.channelsCount : "—"}</strong><span>Cached Channels</span></div>
        <div className="proto-cache-stat-card"><strong>{stats ? stats.messagesCount : "—"}</strong><span>Cached Messages</span></div>
        <div className="proto-cache-stat-card"><strong>{stats ? stats.deletedMessagesCount : "—"}</strong><span>Deleted Logs</span></div>
        <div className="proto-cache-stat-card"><strong>{stats ? stats.editedMessagesCount : "—"}</strong><span>Edited Logs</span></div>
      </div>

      <section className="proto-cache-actions">
        <div className="proto-cache-action-row">
          <div><strong>Export .vcc Cache</strong><small>Choose a time range, servers, and channels before packaging the cache.</small></div>
        </div>

        <div className="proto-cache-export-filters" style={{ display: "grid", gap: 14, padding: 14, border: "1px solid var(--border-color, rgba(255,255,255,.12))", borderRadius: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <strong>When</strong>
            <select value={preset} onChange={event => applyPreset(event.target.value as typeof preset)}>
              <option value="all">All time</option><option value="today">Today</option><option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="custom">Custom range</option>
            </select>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
            <label style={{ display: "grid", gap: 5 }}>From <input type="datetime-local" value={fromValue} onChange={event => { setPreset("custom"); setFromValue(event.target.value); }} /></label>
            <label style={{ display: "grid", gap: 5 }}>To <input type="datetime-local" value={toValue} onChange={event => { setPreset("custom"); setToValue(event.target.value); }} /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
            <div style={{ display: "grid", gap: 7, maxHeight: 190, overflow: "auto" }}>
              <strong>Servers</strong>
              <small>No server selected means all servers.</small>
              {catalog?.servers.map(server => (
                <label key={server.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={selectedServerIds.includes(server.id)} onChange={() => toggleServer(server.id)} />
                  <span>{server.name}</span>
                </label>
              ))}
              {catalog?.servers.length === 0 && <small>No cached server metadata found.</small>}
            </div>
            <div style={{ display: "grid", gap: 7, maxHeight: 190, overflow: "auto" }}>
              <strong>Channels</strong>
              <small>No channel selected means all channels in the chosen servers.</small>
              {visibleChannels.map(channel => (
                <label key={channel.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={selectedChannelIds.includes(channel.id)} onChange={() => toggleChannel(channel.id)} />
                  <span>{channel.serverName ? `${channel.serverName} / ${channel.name}` : channel.name}</span>
                </label>
              ))}
              {visibleChannels.length === 0 && <small>No cached channels match the selected servers.</small>}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <strong>{preview ? `${preview.messagesCount.toLocaleString()} matching messages · ${preview.channelsCount.toLocaleString()} channels` : "Calculating matching cache…"}</strong>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="proto-cache-btn" onClick={() => void saveExport(false)} disabled={loading || !preview || preview.messagesCount === 0}>
                {loading ? <Loader2 size={14} className="spinning" /> : <FolderUp size={14} />} Export to…
              </button>
              <button type="button" className="proto-cache-btn" onClick={() => void saveExport(true)} disabled={loading || !preview || preview.messagesCount === 0}>
                <Download size={14} /> Quick Save
              </button>
            </div>
          </div>
        </div>

        <div className="proto-cache-action-row">
          <div><strong>Import .vcc Cache</strong><small>Merge the archive into local cache and open it in ReplayCore.</small></div>
          <input type="file" ref={fileInputRef} accept=".vcc,application/json" style={{ display: "none" }} onChange={handleWebFileChange} />
          <button type="button" className="proto-cache-btn" onClick={() => void handlePickImport()} disabled={loading}>
            {loading ? <Loader2 size={14} className="spinning" /> : <Upload size={14} />} Import .vcc…
          </button>
        </div>

        {statusMsg && <div className={`proto-cache-status ${statusMsg.startsWith("✓") ? "success" : "error"}`}>{statusMsg}</div>}
      </section>

      {replayBundle && (
        <section style={{ marginTop: 22, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div><h2 style={{ marginBottom: 4 }}>ReplayCore</h2><small>{replayBundle.exportScope?.partial ? "Partial archive" : "Archive"} · VCC v{replayBundle.version} · Exported {new Date(replayBundle.exportedAt).toLocaleString()}</small></div>
            <button type="button" className="proto-cache-btn" onClick={() => setReplayBundle(null)}>Close replay</button>
          </div>
          {replayBundle.exportScope?.partial && (
            <div className="proto-cache-description"><strong>Partial cache archive.</strong> This replay only contains the records included by the export filters. Missing messages cannot be reconstructed from this file.</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            <div className="proto-cache-stat-card"><strong>{replayEvents.length.toLocaleString()}</strong><span>Replay events</span></div>
            <div className="proto-cache-stat-card"><strong>{replayChannels.length.toLocaleString()}</strong><span>Channels</span></div>
            <div className="proto-cache-stat-card"><strong>{replayBundle.exportScope?.exportedMessagesCount ?? replayBundle.messages.reduce((sum, item) => sum + item.messages.length, 0)}</strong><span>Archived messages</span></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) minmax(180px, 2fr)", gap: 8 }}>
            <select value={replayChannelId} onChange={event => { setReplayChannelId(event.target.value); setReplayLimit(100); }}>
              <option value="all">All channels</option>
              {replayChannels.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <input value={replaySearch} onChange={event => { setReplaySearch(event.target.value); setReplayLimit(100); }} placeholder="Search replay messages…" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto auto minmax(140px, 1fr) auto", alignItems: "center", gap: 8 }}>
            <button type="button" className="proto-cache-btn" disabled={visibleReplayEvents.length === 0} onClick={() => {
              if (replayCursor >= visibleReplayEvents.length - 1) setReplayCursor(0);
              setReplayPlaying(value => !value);
            }}>{replayPlaying ? "Pause" : "Play"}</button>
            <button type="button" className="proto-cache-btn" disabled={visibleReplayEvents.length === 0} onClick={() => { setReplayPlaying(false); setReplayCursor(0); }}>Restart</button>
            <input aria-label="Replay timeline" type="range" min={0} max={Math.max(0, visibleReplayEvents.length - 1)} value={Math.min(replayCursor, Math.max(0, visibleReplayEvents.length - 1))} disabled={visibleReplayEvents.length === 0} onChange={event => { setReplayPlaying(false); setReplayCursor(Number(event.target.value)); }} />
            <small>{visibleReplayEvents.length ? `${replayCursor + 1} / ${visibleReplayEvents.length}` : "0 / 0"}</small>
          </div>
          <div style={{ display: "grid", gap: 8, maxHeight: 520, overflow: "auto", padding: 10, border: "1px solid var(--border-color, rgba(255,255,255,.12))", borderRadius: 10 }}>
            {displayedReplayEvents.map(item => (
              <article key={item.id} style={{ padding: "9px 10px", borderBottom: "1px solid var(--border-color, rgba(255,255,255,.08))" }}>
                <header style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                  <strong>{item.message.author?.global_name || item.message.author?.username || "Unknown user"}</strong>
                  <small>{new Date(item.timestamp).toLocaleString()}</small>
                  <small>#{item.channelName || item.channelId}</small>
                  {item.kind !== "message" && <small>{item.kind.toUpperCase()}</small>}
                </header>
                <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "6px 0" }}>{item.message.content || (item.message.attachments?.length ? "Attachment" : "No text content")}</p>
                {item.message.attachments?.map(attachment => (
                  <div key={attachment.id}><a href={attachment.url} target="_blank" rel="noreferrer">{attachment.filename || "Open attachment"}</a></div>
                ))}
              </article>
            ))}
            {displayedReplayEvents.length === 0 && <small>No replay events match this view.</small>}
            {visibleReplayEvents.length > displayedReplayEvents.length && (
              <button type="button" className="proto-cache-btn" onClick={() => setReplayLimit(value => value + 100)}>Load 100 earlier events</button>
            )}
          </div>
        </section>
      )}
    </>
  );
}
