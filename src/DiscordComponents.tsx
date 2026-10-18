import React from "react";
import { DiscordActionRow, DiscordButton, DiscordButtonStyle } from "./types";

interface DiscordComponentsProps {
  rows: DiscordActionRow[];
  onNotify?: (msg: string) => void;
}

const BUTTON_STYLE_CLASS: Record<DiscordButtonStyle, string> = {
  1: "btn-primary",    // blurple
  2: "btn-secondary",  // grey
  3: "btn-success",    // green
  4: "btn-danger",     // red
  5: "btn-link",       // URL
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

export function DiscordComponents({ rows, onNotify }: DiscordComponentsProps) {
  if (!rows || rows.length === 0) return null;

  return (
    <div className="discord-components">
      {rows.map((row, ri) => (
        <div key={ri} className="component-action-row">
          {row.components.map((comp, ci) => {
            // Button
            if (comp.type === 2) {
              const btn = comp as DiscordButton;
              const styleClass = BUTTON_STYLE_CLASS[btn.style] ?? "btn-secondary";
              const isLink = btn.style === 5 && btn.url;
              const isDisabled = btn.disabled ?? false;

              if (isLink) {
                return (
                  <a
                    key={ci}
                    href={btn.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`discord-btn ${styleClass} ${isDisabled ? "disabled" : ""}`}
                  >
                    {renderEmoji(btn.emoji)}
                    {btn.label && <span>{btn.label}</span>}
                    <span className="btn-link-icon">↗</span>
                  </a>
                );
              }

              return (
                <button
                  key={ci}
                  className={`discord-btn ${styleClass} ${isDisabled ? "disabled" : ""}`}
                  disabled={isDisabled}
                  title={isDisabled ? "This button is disabled" : `Component: ${btn.custom_id ?? btn.label}`}
                  onClick={() =>
                    onNotify?.(`Bot button "${btn.label ?? btn.custom_id}" clicked — interactions require bot permissions`)
                  }
                >
                  {renderEmoji(btn.emoji)}
                  {btn.label && <span>{btn.label}</span>}
                </button>
              );
            }

            // Select menu (type 3–8)
            if (comp.type >= 3 && comp.type <= 8) {
              const sel = comp as any;
              return (
                <div
                  key={ci}
                  className={`discord-select ${sel.disabled ? "disabled" : ""}`}
                  title="Select menus require bot interactions"
                  onClick={() => onNotify?.("Select menus require bot interaction permissions")}
                >
                  <span className="select-placeholder">
                    {sel.placeholder ?? "Make a selection…"}
                  </span>
                  <span className="select-chevron">▾</span>
                </div>
              );
            }

            return null;
          })}
        </div>
      ))}
    </div>
  );
}
