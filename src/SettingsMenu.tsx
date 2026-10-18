import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { Moon, Palette, Search, Shield, Sparkles, Video, X } from "lucide-react";

type Tab = "appearance" | "privacy" | "clips" | "text";
type Theme = "dark" | "light";
type SettingsState = {
  theme: Theme;
  requiredDataVersion: number;
  developerMode: boolean;
  darkSidebar: boolean;
  contactSyncEnabled: boolean;
  hideLegacyUsername: boolean;
  inlineAttachmentMedia: boolean;
  inlineEmbedMedia: boolean;
  gifAutoPlay: boolean;
  renderEmbeds: boolean;
  convertEmoticons: boolean;
  allowVoiceRecording: boolean;
};

const defaults: SettingsState = {
  theme: "dark", requiredDataVersion: 0, developerMode: false, darkSidebar: false,
  contactSyncEnabled: false, hideLegacyUsername: false,
  inlineAttachmentMedia: true, inlineEmbedMedia: true, gifAutoPlay: true,
  renderEmbeds: true, convertEmoticons: true, allowVoiceRecording: true,
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

export default function SettingsMenu({ onClose, onThemeChange, ignoredUserIds, blockedUserIds, onToggleIgnore, onBlockUser, onOpenClientSettings }: Props) {
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
      } catch { /* Settings remain usable in browser preview mode. */ }
    })();
    return () => { active = false; };
  }, [onThemeChange]);

  async function persist(next: SettingsState) {
    setSettings(next);
    try {
      const store = await load("voidcord-v1.json", { autoSave: true, defaults: {} });
      await store.set("clientSettings", next);
    } catch { /* Browser preview has no Tauri store. */ }
  }

  async function updateProto(scope: "appearance" | "privacy" | "textAndImages" | "clips", field: string, value: boolean) {
    const changes: Record<string, unknown> = { requiredDataVersion: settings.requiredDataVersion, [scope]: { [field]: value } };
    try {
      const envelope = await invoke<{ settings: string; required_data_version: number }>("save_client_settings", { changes });
      setNotice(`Synced with Discord · ${envelope.settings.length} Base64 characters`);
      window.setTimeout(() => setNotice(""), 2200);
    } catch (error) {
      setNotice(`Could not sync setting: ${String(error)}`);
    }
  }

  async function toggle<K extends keyof SettingsState>(key: K, value: SettingsState[K], scope?: "appearance" | "privacy" | "textAndImages" | "clips", field?: string) {
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
    { id: "privacy", label: "Privacy", icon: <Shield size={16} /> },
    { id: "clips", label: "Clips", icon: <Video size={16} /> },
    { id: "text", label: "Text & Images", icon: <Sparkles size={16} /> },
  ];
  const visibleTabs = tabs.filter(item => item.label.toLowerCase().includes(search.trim().toLowerCase()));

  return <div className="proto-settings-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="proto-settings-window" role="dialog" aria-modal="true" aria-label="Settings">
      <header className="proto-settings-topbar"><div><strong>{tab === "privacy" ? "Privacy" : tab === "appearance" ? "Appearance" : tab === "clips" ? "Clips" : "Text & Images"}</strong></div><button className="proto-settings-close" onClick={onClose} aria-label="Close settings"><X size={18} /></button></header>
      <div className="proto-settings-layout">
        <nav className="proto-settings-nav" aria-label="Settings sections">
          <div className="proto-settings-sidebar-brand"><span className="proto-settings-brand-mark">V</span><div><strong>VoidCord</strong><small>Settings</small></div></div>
          <label className="proto-settings-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search settings" aria-label="Search settings" /></label>
          <div className="proto-settings-nav-group"><small>ACCOUNT</small>
            {visibleTabs.filter(item => item.id === "privacy").map(item => <NavButton key={item.id} item={item} selected={tab === item.id} onClick={() => setTab(item.id)} />)}
          </div>
          <div className="proto-settings-nav-group"><small>APP EXPERIENCE</small>
            {visibleTabs.filter(item => item.id !== "privacy").map(item => <NavButton key={item.id} item={item} selected={tab === item.id} onClick={() => setTab(item.id)} />)}
          </div>
          {visibleTabs.length === 0 && <p className="proto-settings-no-results">No settings found</p>}
          <div className="proto-settings-nav-spacer" />
          <button className="proto-settings-client-link" onClick={onOpenClientSettings}>Client preferences</button>
        </nav>
        <div className="proto-settings-content">
          {tab === "appearance" && <>
            <h2>Appearance</h2><p className="proto-settings-help">Customize VoidCord's look and client behavior.</p>
            <div className="proto-setting-row"><div><strong>Theme</strong><small>Choose the local application theme.</small></div><select value={settings.theme} onChange={e => void toggle("theme", e.target.value as Theme)}><option value="dark">Dark</option><option value="light">Light</option></select></div>
            <label className="proto-setting-row"><div><strong>Required data version</strong><small>Use the version from the settings bootstrap. Zero is only a placeholder.</small></div><input type="number" min="0" value={settings.requiredDataVersion} onChange={e => void toggle("requiredDataVersion", Math.max(0, Number(e.target.value) || 0))} /></label>
            <Toggle title="Developer mode" detail="Show extra client diagnostics and identifiers." value={settings.developerMode} onChange={v => void toggle("developerMode", v, "appearance", "developerMode")} />
            <Toggle title="Dark sidebar" detail="Keep the navigation rail dark in light theme." value={settings.darkSidebar} onChange={v => void toggle("darkSidebar", v, "appearance", "darkSidebar")} />
          </>}
          {tab === "privacy" && <>
            <h2>Privacy</h2><p className="proto-settings-help">Account preference toggles use the inspected PrivacySettings fields. Ignore is local; block actions use the existing relationship API.</p>
            <Toggle title="Contact sync" detail="Remember the contact synchronization preference locally." value={settings.contactSyncEnabled} onChange={v => void toggle("contactSyncEnabled", v, "privacy", "contactSyncEnabled")} />
            <Toggle title="Hide legacy username" detail="Use the account's newer username presentation." value={settings.hideLegacyUsername} onChange={v => void toggle("hideLegacyUsername", v, "privacy", "hideLegacyUsername")} />
            <div className="proto-settings-subheading">Block / ignore</div>
            <p className="proto-settings-help">Block and unblock use VoidCord's existing account relationship action. Ignore is stored locally and hides that user's messages in this client.</p>
            <div className="proto-relationship-entry"><input value={userId} onChange={e => setUserId(e.target.value)} placeholder="Discord user ID" /><button onClick={() => addRelationship("block")}>Block</button><button onClick={() => addRelationship("ignore")}>Ignore locally</button></div>
            <RelationshipList title="Blocked accounts" values={blockedUserIds} onRemove={id => onBlockUser(id, false)} />
            <RelationshipList title="Ignored on this device" values={[...ignoredUserIds]} onRemove={onToggleIgnore} />
          </>}
          {tab === "clips" && <>
            <h2>Clips</h2><p className="proto-settings-help">The descriptor confirms the wrapper and nested field numbers for this preference.</p>
            <Toggle title="Allow voice recording" detail="Allow clips to include voice recording." value={settings.allowVoiceRecording} onChange={v => void toggle("allowVoiceRecording", v, "clips", "allowVoiceRecording")} />
          </>}
          {tab === "text" && <>
            <h2>Text & Images</h2><p className="proto-settings-help">These toggles update locally and encode the verified boolean leaf fields.</p>
            <Toggle title="Inline attachment media" detail="Display image and video attachments inside messages." value={settings.inlineAttachmentMedia} onChange={v => void toggle("inlineAttachmentMedia", v, "textAndImages", "inlineAttachmentMedia")} />
            <Toggle title="Inline embed media" detail="Show supported media embeds in the message list." value={settings.inlineEmbedMedia} onChange={v => void toggle("inlineEmbedMedia", v, "textAndImages", "inlineEmbedMedia")} />
            <Toggle title="GIF autoplay" detail="Allow animated GIF previews to play automatically." value={settings.gifAutoPlay} onChange={v => void toggle("gifAutoPlay", v, "textAndImages", "gifAutoPlay")} />
            <Toggle title="Render embeds" detail="Show link preview embeds in conversations." value={settings.renderEmbeds} onChange={v => void toggle("renderEmbeds", v, "textAndImages", "renderEmbeds")} />
            <Toggle title="Convert emoticons" detail="Convert common text emoticons to emoji." value={settings.convertEmoticons} onChange={v => void toggle("convertEmoticons", v, "textAndImages", "convertEmoticons")} />
          </>}
        </div>
      </div>
      <footer className="proto-settings-footer"><span>{notice || "Synced preference changes use the configured primary account."}</span><span><Moon size={13} /> Local theme</span></footer>
    </section>
  </div>;
}

function Toggle({ title, detail, value, onChange }: { title: string; detail: string; value: boolean; onChange: (value: boolean) => void }) {
  return <div className="proto-setting-row"><div><strong>{title}</strong><small>{detail}</small></div><button className={`proto-setting-switch ${value ? "on" : ""}`} role="switch" aria-checked={value} aria-label={title} onClick={() => onChange(!value)}><span /></button></div>;
}

function NavButton({ item, selected, onClick }: { item: { id: Tab; label: string; icon: ReactNode }; selected: boolean; onClick: () => void }) {
  return <button type="button" className={`proto-settings-nav-button ${selected ? "selected" : ""}`} onClick={onClick}>{item.icon}<span>{item.label}</span></button>;
}

function RelationshipList({ title, values, onRemove }: { title: string; values: string[]; onRemove: (id: string) => void }) {
  return <div className="proto-relationship-list"><strong>{title}</strong>{values.length ? values.map(id => <div key={id}><span>{id}</span><button onClick={() => onRemove(id)}>Remove</button></div>) : <small>Empty</small>}</div>;
}
