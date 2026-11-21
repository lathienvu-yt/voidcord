import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, CalendarDays, Clock3, Gamepad2, Loader2, MessageSquare, RefreshCw, Sparkles, Trophy, Users } from "lucide-react";

type Checkpoint = {
  card_id?: number;
  avatar_decoration?: {
    label?: string;
    assets?: { static_image_url?: string; animated_image_url?: string };
  };
  power_level?: number;
  power_level_percentile?: number;
  messages?: {
    num_messages_sent?: number;
    num_messages_sent_percentile?: number | null;
    top_month?: { month?: number; num_messages_sent?: number };
  };
  emojis?: { num_emojis_sent?: number; emojis?: Array<{ id?: string; name?: string }> };
  voice?: {
    total_voice_minutes?: number;
    total_voice_minutes_percentile?: number | null;
    top_month?: { month?: number; num_minutes_in_voice?: number };
  };
  guilds?: {
    num_guilds_joined?: number;
    guilds?: Array<{ num_messages_sent?: number; num_voice_minutes?: number; guild?: { id?: string; name?: string; icon?: string } }>;
  };
  sidekick?: { user?: { id?: string; username?: string; global_name?: string }; num_messages_sent?: number; num_voice_minutes?: number };
  users?: Array<{ user?: { id?: string; username?: string; global_name?: string } }>;
  applications?: { total_games_played?: number; applications?: Array<{ num_sessions?: number; game?: { id?: string; name?: string } }> };
  quests?: { num_completed?: number; num_orbs?: number };
};

const monthName = (month?: number) => month && month >= 1 && month <= 12
  ? new Date(2024, month - 1, 1).toLocaleString(undefined, { month: "long" })
  : "—";
const number = (value?: number | null) => typeof value === "number" && Number.isFinite(value)
  ? new Intl.NumberFormat().format(value)
  : "—";
const percentile = (value?: number | null) => typeof value === "number" && Number.isFinite(value)
  ? `${value.toFixed(1)}%`
  : "—";

export default function CheckpointPanel() {
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const result = await invoke<Checkpoint>("get_checkpoint");
      setCheckpoint(result || {});
      setClaimed(false);
    } catch (reason) {
      setError(String(reason).replace(/^Error: /, ""));
      setCheckpoint(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const claim = async () => {
    if (claimBusy || claimed) return;
    setClaimBusy(true);
    setError("");
    try {
      await invoke("claim_checkpoint_loot");
      setClaimed(true);
    } catch (reason) {
      setError(String(reason).replace(/^Error: /, ""));
    } finally {
      setClaimBusy(false);
    }
  };

  useEffect(() => { void load(); }, [load]);

  const stats = checkpoint;
  const topGuilds = stats?.guilds?.guilds || [];
  const games = stats?.applications?.applications || [];
  const sidekick = stats?.sidekick?.user;

  return <section className="directory-area quest-store-area checkpoint-area">
    <header className="directory-header">
      <div><h2><Sparkles size={20} /> Your Discord Checkpoint</h2><p>Your official yearly activity recap, fetched directly from Discord.</p></div>
      <button className="directory-add-button" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Refresh</button>
    </header>
    {busy && <div className="directory-empty"><Loader2 size={18} className="spinning" /> Loading your checkpoint…</div>}
    {error && <div className="directory-error" role="alert">{error}</div>}
    {!busy && !error && !stats && <div className="directory-empty">No checkpoint data is available for this account.</div>}
    {stats && <>
      <div className="checkpoint-hero">
        <div><span className="checkpoint-eyebrow">YOUR YEAR IN DISCORD</span><strong>{number(stats.power_level)} <small>Power level</small></strong><span>Activity percentile: {percentile(stats.power_level_percentile)}</span></div>
        {stats.avatar_decoration?.assets?.static_image_url && <img src={stats.avatar_decoration.assets.static_image_url} alt={stats.avatar_decoration.label || "Checkpoint avatar decoration"} />}
      </div>
      <div className="quest-store-grid checkpoint-stats">
        <article className="quest-store-card"><div className="quest-store-card-icon"><MessageSquare size={20} /></div><div className="quest-store-card-body"><strong>{number(stats.messages?.num_messages_sent)}</strong><span>Messages sent</span><small>Top month: {monthName(stats.messages?.top_month?.month)} · {number(stats.messages?.top_month?.num_messages_sent)}</small><small>Percentile: {percentile(stats.messages?.num_messages_sent_percentile)}</small></div></article>
        <article className="quest-store-card"><div className="quest-store-card-icon"><Activity size={20} /></div><div className="quest-store-card-body"><strong>{number(stats.emojis?.num_emojis_sent)}</strong><span>Emoji uses</span><small>{(stats.emojis?.emojis || []).map(item => item.name).filter(Boolean).join(" ") || "No emoji breakdown"}</small></div></article>
        <article className="quest-store-card"><div className="quest-store-card-icon"><Clock3 size={20} /></div><div className="quest-store-card-body"><strong>{number(stats.voice?.total_voice_minutes)} sec</strong><span>Voice activity</span><small>Top month: {monthName(stats.voice?.top_month?.month)} · {number(stats.voice?.top_month?.num_minutes_in_voice)} min</small><small>Percentile: {percentile(stats.voice?.total_voice_minutes_percentile)}</small></div></article>
        <article className="quest-store-card"><div className="quest-store-card-icon"><Users size={20} /></div><div className="quest-store-card-body"><strong>{number(stats.guilds?.num_guilds_joined)}</strong><span>Servers joined</span><small>Top participating servers listed below</small></div></article>
        <article className="quest-store-card"><div className="quest-store-card-icon"><Gamepad2 size={20} /></div><div className="quest-store-card-body"><strong>{number(stats.applications?.total_games_played)}</strong><span>Games played</span><small>{games.map(game => game.game?.name).filter(Boolean).join(", ") || "No game breakdown"}</small></div></article>
        <article className="quest-store-card"><div className="quest-store-card-icon"><Trophy size={20} /></div><div className="quest-store-card-body"><strong>{number(stats.quests?.num_completed)}</strong><span>Quests completed</span><small>{number(stats.quests?.num_orbs)} Orbs collected</small></div></article>
      </div>
      {topGuilds.length > 0 && <section className="checkpoint-section"><h3><Users size={16} /> Your top servers</h3><div className="quest-store-grid">{topGuilds.map((entry, index) => <article className="quest-store-card" key={entry.guild?.id || index}><div className="quest-store-card-body"><strong>{entry.guild?.name || "Server"}</strong><small>{number(entry.num_messages_sent)} messages · {number(entry.num_voice_minutes)} voice minutes</small></div></article>)}</div></section>}
      {sidekick && <section className="checkpoint-section"><h3><Users size={16} /> Your sidekick</h3><article className="quest-store-card"><div className="quest-store-card-body"><strong>{sidekick.global_name || sidekick.username || "Discord user"}</strong><small>{number(stats.sidekick?.num_messages_sent)} DM messages · {number(stats.sidekick?.num_voice_minutes)} voice minutes</small></div></article></section>}
      {stats.avatar_decoration && <section className="checkpoint-reward"><div><strong>{stats.avatar_decoration.label || "Checkpoint avatar decoration"}</strong><p>Discord offers this free decoration as a checkpoint reward.</p></div><button className="directory-add-button" onClick={() => void claim()} disabled={claimBusy || claimed}>{claimBusy ? <Loader2 size={14} className="spinning" /> : <Sparkles size={14} />}{claimed ? "Claimed" : "Claim decoration"}</button></section>}
      <p className="checkpoint-footnote"><CalendarDays size={13} /> Values are returned by Discord. Missing fields are shown as unavailable.</p>
    </>}
  </section>;
}
