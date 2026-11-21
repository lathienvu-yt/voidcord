import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, Eye, EyeOff, ExternalLink, Link2, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

type Connection = {
  id: string;
  type: string;
  name: string;
  verified?: boolean;
  revoked?: boolean;
  visibility?: number;
  metadata_visibility?: number;
  show_activity?: boolean;
  friend_sync?: boolean;
  two_way_link?: boolean;
  metadata?: Record<string, unknown>;
};

const labels: Record<string, string> = {
  "amazon-music":"Amazon Music", battlenet:"Battle.net", bluesky:"Bluesky", bungie:"Bungie.net",
  crunchyroll:"Crunchyroll", domain:"Domain", ebay:"eBay", epicgames:"Epic Games", facebook:"Facebook",
  github:"GitHub", instagram:"Instagram", leagueoflegends:"League of Legends", mastodon:"Mastodon",
  paypal:"PayPal", playstation:"PlayStation Network", reddit:"Reddit", roblox:"Roblox",
  riotgames:"Riot Games", soundcloud:"SoundCloud", spotify:"Spotify", steam:"Steam", tiktok:"TikTok",
  twitch:"Twitch", twitter:"X / Twitter", xbox:"Xbox", youtube:"YouTube"
};
const displayType = (type: string) => labels[type] || type.replace(/-/g," ").replace(/\b\w/g, c => c.toUpperCase());

export default function ConnectionsPanel() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const result = await invoke<Connection[]>("get_user_connections");
      setConnections(Array.isArray(result) ? result : []);
    } catch (reason) {
      setError(String(reason).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = async (item: Connection, patch: Partial<Pick<Connection, "visibility" | "metadata_visibility" | "show_activity" | "friend_sync">>) => {
    const key = item.type + ":" + item.id;
    setWorking(key); setError("");
    try {
      const result = await invoke<Connection>("update_user_connection", {
        connectionType: item.type, connectionId: item.id,
        name: null, showActivity: patch.show_activity ?? null, friendSync: patch.friend_sync ?? null,
        metadataVisibility: patch.metadata_visibility ?? null, visibility: patch.visibility ?? null
      });
      setConnections(current => current.map(entry => entry.type === item.type && entry.id === item.id ? { ...entry, ...patch, ...(result || {}) } : entry));
    } catch (reason) { setError(String(reason).replace(/^Error: /, "")); }
    finally { setWorking(null); }
  };

  const refresh = async (item: Connection) => {
    const key = item.type + ":" + item.id;
    setWorking(key); setError("");
    try {
      await invoke("refresh_user_connection", { connectionType: item.type, connectionId: item.id });
      await load();
    } catch (reason) { setError(String(reason).replace(/^Error: /, "")); }
    finally { setWorking(null); }
  };

  const remove = async (item: Connection) => {
    if (!window.confirm("Unlink " + displayType(item.type) + " account “" + item.name + "”? Discord may also remove server memberships associated with this connection.")) return;
    const key = item.type + ":" + item.id;
    setWorking(key); setError("");
    try {
      await invoke("delete_user_connection", { connectionType: item.type, connectionId: item.id });
      setConnections(current => current.filter(entry => !(entry.type === item.type && entry.id === item.id)));
    } catch (reason) { setError(String(reason).replace(/^Error: /, "")); }
    finally { setWorking(null); }
  };

  return <section className="directory-area quest-store-area connections-area">
    <header className="directory-header">
      <div><h2><Link2 size={20} /> Connected Accounts</h2><p>Manage third-party accounts linked to your Discord profile.</p></div>
      <button className="directory-add-button" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Refresh</button>
    </header>
    <div className="connections-privacy-note"><ShieldCheck size={16} /><span>These settings control what Discord shares on your profile. Private visibility is 0; everyone visibility is 1.</span></div>
    {error && <div className="directory-error" role="alert">{error}</div>}
    {busy ? <div className="directory-empty"><Loader2 size={18} className="spinning" /> Loading connected accounts…</div>
      : connections.length === 0 ? <div className="directory-empty"><Link2 size={24} /><strong>No connected accounts</strong><span>Accounts you have linked to Discord will appear here.</span></div>
      : <div className="connections-list">{connections.map(item => {
        const key = item.type + ":" + item.id;
        const isBusy = working === key;
        return <article className="connections-card" key={key}>
          <div className="connections-card-top">
            <div className="connections-provider-icon"><Link2 size={19} /></div>
            <div className="connections-identity"><strong>{displayType(item.type)}</strong><span>{item.name || item.id}</span></div>
            {item.verified && <span className="connections-verified"><CheckCircle2 size={13} /> Verified</span>}
            {item.revoked && <span className="connections-revoked">Revoked</span>}
          </div>
          <div className="connections-controls">
            <label><span>Profile visibility</span><select value={item.visibility ?? 0} disabled={isBusy} onChange={event => void update(item,{visibility:Number(event.target.value)})}><option value={0}>Only me</option><option value={1}>Everyone</option></select></label>
            <label><span>Metadata visibility</span><select value={item.metadata_visibility ?? 0} disabled={isBusy} onChange={event => void update(item,{metadata_visibility:Number(event.target.value)})}><option value={0}>Only me</option><option value={1}>Everyone</option></select></label>
            <label className="connections-toggle"><span>Show activity</span><input type="checkbox" checked={!!item.show_activity} disabled={isBusy} onChange={event => void update(item,{show_activity:event.target.checked})} /></label>
            <label className="connections-toggle"><span>Friend sync</span><input type="checkbox" checked={!!item.friend_sync} disabled={isBusy} onChange={event => void update(item,{friend_sync:event.target.checked})} /></label>
          </div>
          <div className="connections-actions">
            <button onClick={() => void refresh(item)} disabled={isBusy}><RefreshCw size={13} /> Refresh link</button>
            <button className="connections-unlink" onClick={() => void remove(item)} disabled={isBusy}><Trash2 size={13} /> Unlink</button>
            {isBusy && <Loader2 size={14} className="spinning" />}
          </div>
        </article>;
      })}</div>}
    <p className="connections-footnote"><Eye size={13} /> VoidCord currently manages existing links. New provider linking requires a separate authorization and callback flow; this panel does not collect provider passwords or tokens.</p>
  </section>;
}
