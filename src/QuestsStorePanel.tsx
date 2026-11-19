import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, RefreshCw, Trophy, ShoppingBag, Search, ExternalLink } from "lucide-react";

type Quest = {
  id?: string;
  config?: {
    messages?: { quest_name?: string; game_title?: string; game_publisher?: string };
    starts_at?: string;
    expires_at?: string;
    rewards_config?: { rewards?: Array<{ messages?: { name?: string }; type?: number }> };
    task_config_v2?: { tasks?: Record<string, { target?: number; messages?: { task_title?: string; task_description?: string } }> };
  };
  user_status?: { completed_at?: string | null; claimed_at?: string | null; progress?: Record<string, number> };
};
type Listing = {
  id?: string;
  sku?: { id?: string; name?: string | Record<string,string>; summary?: string | Record<string,string>; description?: string | Record<string,string>; price?: unknown; external_purchase_url?: string };
  name?: string | Record<string,string>;
  summary?: string | Record<string,string>;
  description?: string | Record<string,string>;
  thumbnail?: string;
  image?: string;
};
type QuestResponse = { quests?: Quest[]; excluded_quests?: unknown[]; quest_enrollment_blocked_until?: string | null };
type StoreResponse = Listing[] | { listings?: Listing[]; skus?: Listing[] };

function localized(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferred = record["en-US"] ?? record["en-us"] ?? Object.values(record)[0];
    return typeof preferred === "string" ? preferred : "";
  }
  return "";
}
function rowsFrom(value: StoreResponse): Listing[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.listings)) return value.listings;
  if (Array.isArray(value?.skus)) return value.skus;
  return [];
}

export default function QuestsStorePanel({ mode }: { mode: "quests" | "shop" }) {
  const [quests, setQuests] = useState<Quest[]>([]);
  const [claimed, setClaimed] = useState(false);
  const [questBusy, setQuestBusy] = useState(false);
  const [questError, setQuestError] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [storeBusy, setStoreBusy] = useState(false);
  const [storeError, setStoreError] = useState("");
  const [searched, setSearched] = useState(false);

  const loadQuests = useCallback(async (showClaimed: boolean) => {
    setQuestBusy(true);
    setQuestError("");
    try {
      const result = await invoke<QuestResponse>("get_my_quests", { claimed: showClaimed });
      setQuests(Array.isArray(result?.quests) ? result.quests : []);
    } catch (error) {
      setQuestError(String(error).replace(/^Error: /, ""));
    } finally {
      setQuestBusy(false);
    }
  }, []);

  const loadStore = useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!/^\d{5,24}$/.test(applicationId.trim())) {
      setStoreError("Enter a valid application ID (digits only).");
      return;
    }
    setStoreBusy(true);
    setStoreError("");
    setSearched(true);
    try {
      const result = await invoke<StoreResponse>("get_published_store_listings", { applicationId: applicationId.trim() });
      setListings(rowsFrom(result));
    } catch (error) {
      setStoreError(String(error).replace(/^Error: /, ""));
      setListings([]);
    } finally {
      setStoreBusy(false);
    }
  }, [applicationId]);

  useEffect(() => {
    if (mode === "quests") void loadQuests(false);
  }, [mode, loadQuests]);

  if (mode === "quests") {
    return <section className="directory-area quest-store-area">
      <header className="directory-header">
        <div><h2><Trophy size={20} /> Quests</h2><p>View current and previously claimed Discord quests. Progress is reported by Discord.</p></div>
        <button className="directory-add-button" onClick={() => void loadQuests(claimed)} disabled={questBusy}><RefreshCw size={14} /> Refresh</button>
      </header>
      <nav className="friend-filter-tabs" aria-label="Quest filters">
        <button className={!claimed ? "active" : ""} onClick={() => { setClaimed(false); void loadQuests(false); }}>Available</button>
        <button className={claimed ? "active" : ""} onClick={() => { setClaimed(true); void loadQuests(true); }}>Claimed history</button>
      </nav>
      {questBusy && <div className="directory-empty"><Loader2 size={18} className="spinning" /> Loading quests…</div>}
      {questError && <div className="directory-error">{questError}</div>}
      {!questBusy && !questError && quests.length === 0 && <div className="directory-empty">No {claimed ? "claimed quests" : "available quests"} were returned for this account.</div>}
      <div className="quest-store-grid">{quests.map((quest, index) => {
        const config = quest.config;
        const title = config?.messages?.quest_name || config?.messages?.game_title || "Discord quest";
        const task = Object.values(config?.task_config_v2?.tasks || {})[0];
        const reward = config?.rewards_config?.rewards?.[0]?.messages?.name;
        const expiry = config?.expires_at ? new Date(config.expires_at).toLocaleString() : "";
        return <article className="quest-store-card" key={quest.id || index}>
          <div className="quest-store-card-icon"><Trophy size={20} /></div>
          <div className="quest-store-card-body">
            <strong>{title}</strong>
            {config?.messages?.game_title && <span>{config.messages.game_title}{config.messages.game_publisher ? ` · ${config.messages.game_publisher}` : ""}</span>}
            {task?.messages?.task_description && <p>{task.messages.task_description}</p>}
            {task?.messages?.task_title && !task.messages.task_description && <p>{task.messages.task_title}</p>}
            {reward && <small>Reward: {reward}</small>}
            {expiry && <small>Ends {expiry}</small>}
            {claimed && <small>Claimed quest</small>}
          </div>
        </article>;
      })}</div>
    </section>;
  }

  return <section className="directory-area quest-store-area">
    <header className="directory-header"><div><h2><ShoppingBag size={20} /> Store</h2><p>Browse published listings by Discord application ID. Purchases are not available in this panel.</p></div></header>
    <form className="quest-store-search" onSubmit={loadStore}>
      <label><Search size={16} /><input value={applicationId} onChange={event => setApplicationId(event.target.value)} inputMode="numeric" placeholder="Application ID" aria-label="Discord application ID" /></label>
      <button className="directory-add-button" type="submit" disabled={storeBusy || !applicationId.trim()}>{storeBusy ? <Loader2 size={14} className="spinning" /> : <Search size={14} />} Browse</button>
    </form>
    {storeError && <div className="directory-error">{storeError}</div>}
    {storeBusy && <div className="directory-empty"><Loader2 size={18} className="spinning" /> Loading published listings…</div>}
    {!storeBusy && searched && !storeError && listings.length === 0 && <div className="directory-empty">No published listings were returned for that application.</div>}
    <div className="quest-store-grid">{listings.map((listing, index) => {
      const sku = listing.sku || listing;
      const title = localized(sku.name) || "Store listing";
      const summary = localized(sku.summary) || localized(sku.description);
      const externalUrl = typeof sku.external_purchase_url === "string" ? sku.external_purchase_url : "";
      return <article className="quest-store-card" key={sku.id || listing.id || index}>
        <div className="quest-store-card-icon"><ShoppingBag size={20} /></div>
        <div className="quest-store-card-body">
          <strong>{title}</strong>
          {summary && <p>{summary}</p>}
          {sku.id && <small>SKU {sku.id}</small>}
          {externalUrl && /^https:\/\//i.test(externalUrl) && <a href={externalUrl} target="_blank" rel="noreferrer">External listing <ExternalLink size={12} /></a>}
        </div>
      </article>;
    })}</div>
  </section>;
}
