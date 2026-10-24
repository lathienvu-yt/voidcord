import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DiscordActionRow,
  DiscordButton,
  DiscordButtonStyle,
  DiscordChannel,
  DiscordComponent,
  DiscordContainer,
  DiscordFileComponent,
  DiscordMediaGallery,
  DiscordMessage,
  DiscordSection,
  DiscordSelectMenu,
  DiscordSeparator,
  DiscordTextDisplay,
  DiscordThumbnail,
  DiscordUser,
} from "./types";
import { DiscordMarkdown } from "./DiscordMarkdown";
import { ExternalLink, FileText, Loader2 } from "lucide-react";

interface DiscordComponentsProps {
  components?: DiscordComponent[] | DiscordActionRow[];
  rows?: DiscordActionRow[]; // Backward compatibility
  message?: DiscordMessage;
  channelId?: string;
  guildId?: string;
  sessionId?: string;
  channels?: DiscordChannel[];
  users?: DiscordUser[];
  onChannelClick?: (channelId: string) => void;
  onMediaOpen?: (url: string, kind: "image" | "video", name?: string) => void;
  onNotify?: (msg: string) => void;
}

const BUTTON_STYLE_CLASS: Record<DiscordButtonStyle, string> = {
  1: "btn-primary",    // blurple
  2: "btn-secondary",  // grey
  3: "btn-success",    // green
  4: "btn-danger",     // red
  5: "btn-link",       // URL
  6: "btn-premium",    // nitro
};

function renderEmoji(emoji?: { id?: string | null; name?: string | null; animated?: boolean }) {
  if (!emoji) return null;
  if (emoji.id) {
    const ext = emoji.animated ? "gif" : "webp";
    return (
      <img
        src={`https://cdn.discordapp.com/emojis/${emoji.id}.${ext}?size=20`}
        alt={emoji.name ?? ""}
        className="component-emoji"
      />
    );
  }
  if (emoji.name) return <span className="component-emoji-unicode">{emoji.name}</span>;
  return null;
}

export function DiscordComponents({
  components,
  rows,
  message,
  channelId,
  guildId,
  sessionId,
  channels,
  users,
  onChannelClick,
  onMediaOpen,
  onNotify,
}: DiscordComponentsProps) {
  const items = components ?? rows ?? [];
  const [busyComponentId, setBusyComponentId] = useState<string | null>(null);

  if (!items || items.length === 0) return null;

  const handleInteraction = async (compType: number, customId?: string, values?: string[]) => {
    if (!customId) return;
    if (!channelId || !message) {
      onNotify?.("Cannot send component interaction: missing channel or message context.");
      return;
    }
    if (!sessionId) {
      onNotify?.("Gateway session not ready yet. Please reconnect to interact with buttons.");
      return;
    }

    setBusyComponentId(customId);
    try {
      await invoke("execute_component_interaction", {
        channelId,
        guildId: guildId || null,
        sessionId,
        messageId: message.id,
        applicationId: (message as any).application_id || message.author.id,
        messageFlags: (message as any).flags ?? null,
        componentType: compType,
        customId,
        values: values || null,
        nonce: String(Date.now()),
      });
    } catch (error) {
      console.warn("Component interaction failed:", error);
      onNotify?.(`Component interaction failed: ${String(error)}`);
    } finally {
      setBusyComponentId(null);
    }
  };

  const renderButton = (btn: DiscordButton, key: React.Key) => {
    const styleClass = BUTTON_STYLE_CLASS[btn.style] ?? "btn-secondary";
    const isLink = btn.style === 5 && !!btn.url;
    const isDisabled = btn.disabled ?? false;
    const isBusy = busyComponentId === btn.custom_id;

    if (isLink) {
      return (
        <a
          key={key}
          href={btn.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`discord-btn ${styleClass} ${isDisabled ? "disabled" : ""}`}
        >
          {renderEmoji(btn.emoji)}
          {btn.label && <span>{btn.label}</span>}
          <ExternalLink size={14} className="btn-link-icon" />
        </a>
      );
    }

    return (
      <button
        key={key}
        type="button"
        className={`discord-btn ${styleClass} ${isDisabled || isBusy ? "disabled" : ""}`}
        disabled={isDisabled || isBusy}
        title={isDisabled ? "This button is disabled" : btn.label || btn.custom_id}
        onClick={() => void handleInteraction(2, btn.custom_id)}
      >
        {isBusy ? <Loader2 size={14} className="spinning" /> : renderEmoji(btn.emoji)}
        {btn.label && <span>{btn.label}</span>}
      </button>
    );
  };

  const renderSelect = (sel: DiscordSelectMenu, key: React.Key) => {
    const isDisabled = sel.disabled ?? false;
    const isBusy = busyComponentId === sel.custom_id;

    return (
      <div key={key} className={`discord-select-wrapper ${isDisabled ? "disabled" : ""}`}>
        <select
          className="discord-select"
          disabled={isDisabled || isBusy}
          value=""
          onChange={e => {
            const val = e.target.value;
            if (val) void handleInteraction(sel.type ?? 3, sel.custom_id, [val]);
          }}
        >
          <option value="" disabled>
            {isBusy ? "Interacting…" : sel.placeholder ?? "Make a selection…"}
          </option>
          {sel.options?.map((opt, i) => (
            <option key={i} value={opt.value}>
              {opt.label}
              {opt.description ? ` — ${opt.description}` : ""}
            </option>
          ))}
        </select>
        <span className="select-chevron">▾</span>
      </div>
    );
  };

  const renderComponent = (comp: any, key: React.Key): React.ReactNode => {
    if (!comp || typeof comp !== "object") return null;

    // Type 1: Action Row
    if (comp.type === 1) {
      const row = comp as DiscordActionRow;
      return (
        <div key={key} className="component-action-row">
          {row.components?.map((child, ci) => renderComponent(child, `${key}-${ci}`))}
        </div>
      );
    }

    // Type 2: Button
    if (comp.type === 2) {
      return renderButton(comp as DiscordButton, key);
    }

    // Type 3..8: Select Menu
    if (comp.type >= 3 && comp.type <= 8) {
      return renderSelect(comp as DiscordSelectMenu, key);
    }

    // Type 9: Section (Components V2)
    if (comp.type === 9) {
      const section = comp as DiscordSection;
      return (
        <div key={key} className="discord-section">
          <div className="discord-section-content">
            {section.components?.map((child: any, ci: number) => renderComponent(child, `${key}-sec-${ci}`))}
          </div>
          {section.accessory && (
            <div className="discord-section-accessory">
              {renderComponent(section.accessory, `${key}-acc`)}
            </div>
          )}
        </div>
      );
    }

    // Type 10: Text Display (Components V2)
    if (comp.type === 10) {
      const td = comp as DiscordTextDisplay;
      return (
        <div key={key} className="discord-text-display">
          <DiscordMarkdown
            content={td.content || ""}
            channels={channels}
            users={users}
            onChannelClick={onChannelClick}
          />
        </div>
      );
    }

    // Type 11: Thumbnail (Components V2)
    if (comp.type === 11) {
      const thumb = comp as DiscordThumbnail;
      const url = thumb.media?.url || thumb.thumbnail?.url;
      if (!url) return null;
      return (
        <img
          key={key}
          src={url}
          alt={thumb.description || "Thumbnail"}
          className="discord-component-thumbnail"
          onClick={() => onMediaOpen?.(url, "image")}
        />
      );
    }

    // Type 12: Media Gallery (Components V2)
    if (comp.type === 12) {
      const gallery = comp as DiscordMediaGallery;
      if (!gallery.items?.length) return null;
      return (
        <div key={key} className="discord-media-gallery">
          {gallery.items.map((item: any, gi: number) => {
            const url = item.media?.url || (item as any).url;
            if (!url) return null;
            return (
              <div key={gi} className="discord-media-gallery-item">
                <img
                  src={url}
                  alt={item.description || `Media ${gi + 1}`}
                  className="discord-media-gallery-img"
                  onClick={() => onMediaOpen?.(url, "image", item.description)}
                />
              </div>
            );
          })}
        </div>
      );
    }

    // Type 13: File Component (Components V2)
    if (comp.type === 13) {
      const fc = comp as DiscordFileComponent;
      const fileUrl = fc.url || fc.file?.url;
      const filename = fc.filename || fc.file?.filename || "Download file";
      return (
        <div key={key} className="discord-component-file">
          <FileText size={20} />
          <div className="discord-file-info">
            <span className="discord-file-name">{filename}</span>
            {fc.file?.size && <small className="discord-file-size">{(fc.file.size / 1024).toFixed(1)} KB</small>}
          </div>
          {fileUrl && (
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="discord-file-download">
              Download
            </a>
          )}
        </div>
      );
    }

    // Type 14: Separator (Components V2)
    if (comp.type === 14) {
      const sep = comp as DiscordSeparator;
      return (
        <div
          key={key}
          className={`discord-component-separator ${sep.divider ? "with-divider" : ""}`}
          style={{ margin: sep.spacing ? `${sep.spacing * 4}px 0` : undefined }}
        />
      );
    }

    // Type 17: Container (Components V2)
    if (comp.type === 17) {
      const cont = comp as DiscordContainer;
      const accentHex = cont.accent_color
        ? `#${cont.accent_color.toString(16).padStart(6, "0")}`
        : undefined;

      return (
        <div
          key={key}
          className="discord-container"
          style={{ borderLeftColor: accentHex || "var(--accent)" }}
        >
          {cont.components?.map((child: any, ci: number) => renderComponent(child, `${key}-cont-${ci}`))}
        </div>
      );
    }

    // Fallback: If it has components array (generic container / unrecognized type)
    if (Array.isArray(comp.components)) {
      return (
        <div key={key} className="component-action-row">
          {comp.components.map((child: any, ci: number) => renderComponent(child, `${key}-gen-${ci}`))}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="discord-components">
      {items.map((comp, idx) => renderComponent(comp, idx))}
    </div>
  );
}
