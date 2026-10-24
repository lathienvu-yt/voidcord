import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Clipboard, Loader2, RefreshCw, Terminal } from "lucide-react";

type Mode = "global" | "guild" | "permissions";

export default function ApplicationCommandsPanel() {
  const [mode, setMode] = useState<Mode>("global");
  const [applicationId, setApplicationId] = useState("");
  const [guildId, setGuildId] = useState("");
  const [withLocalizations, setWithLocalizations] = useState(true);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function fetchData() {
    setError("");
    setResult(null);
    setCopied(false);
    const appId = applicationId.trim();
    const serverId = guildId.trim();
    if (!/^\d{15,22}$/.test(appId)) {
      setError("Enter a valid numeric Discord application ID.");
      return;
    }
    if (mode !== "global" && !/^\d{15,22}$/.test(serverId)) {
      setError("Enter a valid numeric Discord guild ID.");
      return;
    }

    setLoading(true);
    try {
      let data: unknown;
      if (mode === "global") {
        data = await invoke("get_global_application_commands", {
          applicationId: appId,
          withLocalizations,
        });
      } else if (mode === "guild") {
        data = await invoke("get_guild_application_commands", {
          applicationId: appId,
          guildId: serverId,
          withLocalizations,
        });
      } else {
        data = await invoke("get_guild_application_command_permissions", {
          applicationId: appId,
          guildId: serverId,
        });
      }
      setResult(data);
      if (mode !== "permissions") {
        try {
          const saved = JSON.parse(localStorage.getItem("voidcord:application-command-app-ids") || "[]");
          const ids = Array.isArray(saved) ? saved.filter((id: unknown): id is string => typeof id === "string") : [];
          localStorage.setItem("voidcord:application-command-app-ids", JSON.stringify([...new Set([...ids, appId])].slice(-20)));
        } catch {
          localStorage.setItem("voidcord:application-command-app-ids", JSON.stringify([appId]));
        }
      }
    } catch (cause) {
      setError(typeof cause === "string" ? cause : cause instanceof Error ? cause.message : JSON.stringify(cause));
    } finally {
      setLoading(false);
    }
  }

  async function copyResult() {
    if (result === null) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Clipboard access was denied. Select and copy the JSON manually.");
    }
  }

  const commandCount = Array.isArray(result) ? result.length : null;
  const modeDescription = mode === "global"
    ? "Commands registered globally to an application."
    : mode === "guild"
      ? "Commands registered specifically to one server."
      : "Configured command permission entries for an application in a server.";

  return <div className="appcmd-panel">
    <div className="appcmd-intro">
      <div className="appcmd-icon"><Terminal size={20} /></div>
      <div><h2>Application commands</h2><p className="proto-settings-help">Inspect registered commands and guild permission configuration through VoidCord's REST layer.</p></div>
    </div>

    <div className="appcmd-mode-tabs" role="tablist" aria-label="Application command query">
      <button type="button" role="tab" aria-selected={mode === "global"} className={mode === "global" ? "active" : ""} onClick={() => { setMode("global"); setResult(null); setError(""); }}>Global commands</button>
      <button type="button" role="tab" aria-selected={mode === "guild"} className={mode === "guild" ? "active" : ""} onClick={() => { setMode("guild"); setResult(null); setError(""); }}>Guild commands</button>
      <button type="button" role="tab" aria-selected={mode === "permissions"} className={mode === "permissions" ? "active" : ""} onClick={() => { setMode("permissions"); setResult(null); setError(""); }}>Permissions</button>
    </div>
    <p className="appcmd-mode-description">{modeDescription}</p>

    <form className="appcmd-form" onSubmit={event => { event.preventDefault(); void fetchData(); }}>
      <label className="appcmd-field">
        <span>Application ID</span>
        <input inputMode="numeric" autoComplete="off" spellCheck={false} value={applicationId} onChange={event => setApplicationId(event.target.value)} placeholder="e.g. 123456789012345678" />
      </label>
      {mode !== "global" && <label className="appcmd-field">
        <span>Guild ID</span>
        <input inputMode="numeric" autoComplete="off" spellCheck={false} value={guildId} onChange={event => setGuildId(event.target.value)} placeholder="Server ID" />
      </label>}
      {mode !== "permissions" && <label className="appcmd-localizations">
        <input type="checkbox" checked={withLocalizations} onChange={event => setWithLocalizations(event.target.checked)} />
        <span><strong>Include localizations</strong><small>Return localized command names and descriptions when available.</small></span>
      </label>}
      <button className="appcmd-fetch-button" type="submit" disabled={loading}>
        {loading ? <Loader2 size={16} className="appcmd-spin" /> : <RefreshCw size={16} />}
        {loading ? "Fetching…" : "Fetch data"}
      </button>
    </form>

    {error && <div className="appcmd-error" role="alert">{error}</div>}
    {result !== null && <section className="appcmd-result" aria-label="Fetch result">
      <div className="appcmd-result-header">
        <div><strong>Response</strong><small>{commandCount === null ? "JSON object" : `${commandCount} command${commandCount === 1 ? "" : "s"} returned`}</small></div>
        <button type="button" onClick={() => void copyResult()}><Clipboard size={14} />{copied ? "Copied" : "Copy JSON"}</button>
      </div>
      {mode !== "permissions" && Array.isArray(result) && result.length > 0 && <div className="appcmd-command-list">
        {result.map((entry: any, index) => <div className="appcmd-command-row" key={entry?.id ?? `${entry?.name ?? "command"}-${index}`}>
          <div className="appcmd-command-type">{entry?.type === 2 ? "USER" : entry?.type === 3 ? "MESSAGE" : "SLASH"}</div>
          <div className="appcmd-command-info"><strong>/{typeof entry?.name === "string" ? entry.name : "Unnamed command"}</strong><small>{typeof entry?.description === "string" && entry.description ? entry.description : "No description"}</small></div>
          <code>{typeof entry?.id === "string" ? entry.id : "no ID"}</code>
        </div>)}
      </div>}
      {Array.isArray(result) && result.length === 0 && <p className="appcmd-empty">No entries were returned for this request.</p>}
      <details className="appcmd-json-details" open={!Array.isArray(result) || result.length === 0}>
        <summary>Raw JSON</summary>
        <pre>{JSON.stringify(result, null, 2)}</pre>
      </details>
    </section>}
  </div>;
}
