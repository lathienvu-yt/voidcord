import React, { useState } from "react";
import { avatarUrl, DiscordChannel, DiscordUser } from "./types";

interface DiscordMarkdownProps {
  content: string;
  channels?: DiscordChannel[];
  users?: DiscordUser[];
  onChannelClick?: (channelId: string) => void;
}

export function DiscordMarkdown({ content, channels, users, onChannelClick }: DiscordMarkdownProps) {
  if (!content) return null;

  // Split content by code blocks first
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <React.Fragment key={`text-${lastIndex}`}>
          {renderBlockLines(content.substring(lastIndex, match.index), channels, users, onChannelClick)}
        </React.Fragment>
      );
    }
    const lang = match[1];
    const code = match[2];
    parts.push(
      <pre key={`code-${match.index}`} className="d-codeblock">
        {lang && <span className="d-code-lang">{lang}</span>}
        <code>{code}</code>
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(
      <React.Fragment key={`text-${lastIndex}`}>
        {renderBlockLines(content.substring(lastIndex), channels, users, onChannelClick)}
      </React.Fragment>
    );
  }

  return <div className="discord-markdown">{parts}</div>;
}

function renderBlockLines(
  text: string,
  channels?: DiscordChannel[],
  users?: DiscordUser[],
  onChannelClick?: (id: string) => void,
) {
  const lines = text.split(/\r?\n/);
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Header 1: # ...
    if (/^#\s+(.+)$/.test(line)) {
      const h1Match = line.match(/^#\s+(.+)$/);
      elements.push(
        <h1 key={`h1-${i}`} className="d-h1">
          {renderInline(h1Match![1], channels, users, onChannelClick)}
        </h1>
      );
      continue;
    }

    // Header 2: ## ...
    if (/^##\s+(.+)$/.test(line)) {
      const h2Match = line.match(/^##\s+(.+)$/);
      elements.push(
        <h2 key={`h2-${i}`} className="d-h2">
          {renderInline(h2Match![1], channels, users, onChannelClick)}
        </h2>
      );
      continue;
    }

    // Header 3: ### ...
    if (/^###\s+(.+)$/.test(line)) {
      const h3Match = line.match(/^###\s+(.+)$/);
      elements.push(
        <h3 key={`h3-${i}`} className="d-h3">
          {renderInline(h3Match![1], channels, users, onChannelClick)}
        </h3>
      );
      continue;
    }

    // Subtext: -# ...
    if (/^-#\s+(.+)$/.test(line)) {
      const subMatch = line.match(/^-#\s+(.+)$/);
      elements.push(
        <div key={`sub-${i}`} className="d-subtext">
          {renderInline(subMatch![1], channels, users, onChannelClick)}
        </div>
      );
      continue;
    }

    // Single blockquote: > ...
    if (/^>\s+(.+)$/.test(line)) {
      const bqMatch = line.match(/^>\s+(.+)$/);
      elements.push(
        <blockquote key={`bq-${i}`} className="d-blockquote">
          {renderInline(bqMatch![1], channels, users, onChannelClick)}
        </blockquote>
      );
      continue;
    }

    // Unordered list item: - ... or * ...
    if (/^[-*]\s+(.+)$/.test(line)) {
      const liMatch = line.match(/^[-*]\s+(.+)$/);
      elements.push(
        <div key={`li-${i}`} className="d-list-item">
          <span className="d-list-bullet">•</span>
          <span>{renderInline(liMatch![1], channels, users, onChannelClick)}</span>
        </div>
      );
      continue;
    }

    // Regular line or empty line
    if (line.trim() === "") {
      elements.push(<div key={`empty-${i}`} className="d-empty-line" />);
    } else {
      elements.push(
        <div key={`p-${i}`} className="d-line">
          {renderInline(line, channels, users, onChannelClick)}
        </div>
      );
    }
  }

  return elements;
}

export function renderInline(
  text: string,
  channels?: DiscordChannel[],
  users?: DiscordUser[],
  onChannelClick?: (id: string) => void,
): React.ReactNode {
  // Regex parsing inline tokens in priority order:
  // 1: Inline code `...`
  // 2: Custom Emoji <:name:id> or <a:name:id>
  // 3: Slash-command mention </command:command_id>
  // 4: Channel mention <#id>
  // 4: User mention <@!?id>
  // 5: Role mention <@&id>
  // 6: Timestamp <t:123456:R>
  // 7: Masked link [text](url)
  // 8: Raw URL https://...
  // 9: Spoiler ||...||
  // 10: Bold ***...*** or **...**
  // 11: Underline __...__
  // 12: Italic *...* or _..._
  // 13: Strikethrough ~~...~~
  const tokenRegex = /(`[^`]+`)|(<a?:[a-zA-Z0-9_]+:\d+>)|(<#\d+>)|(<@!?[0-9]+>)|(<@&[0-9]+>)|(<t:\d+(?::[tTdDfFR])?>)|(\[[^\]]+\]\([^)]+\))|(https?:\/\/[^\s<]+[^<.,:;"')\]\s])|(\|\|[\s\S]+?\|\|)|(\*\*\*[\s\S]+?\*\*\*)|(\*\*[\s\S]+?\*\*)|(__[\s\S]+?__)|(\*[\s\S]+?\*)|(_[\s\S]+?_)|(~~[\s\S]+?~~)/g;

  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.substring(lastIndex, match.index));
    }

    const token = match[0];

    // Inline code `...`
    if (token.startsWith("`") && token.endsWith("`") && token.length >= 2) {
      result.push(<code key={`ic-${match.index}`} className="d-inline-code">{token.slice(1, -1)}</code>);
    }
    // Custom Emoji <:name:id> or <a:name:id>
    else if (token.startsWith("<:") || token.startsWith("<a:")) {
      const emojiMatch = token.match(/^<(a)?:([a-zA-Z0-9_]+):(\d+)>$/);
      if (emojiMatch) {
        const isAnimated = emojiMatch[1] === "a";
        const name = emojiMatch[2];
        const id = emojiMatch[3];
        const ext = isAnimated ? "gif" : "webp";
        const src = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=48&quality=lossless`;
        result.push(
          <img
            key={`emoji-${match.index}`}
            src={src}
            alt={`:${name}:`}
            title={`:${name}:`}
            className="d-custom-emoji"
          />
        );
      } else {
        result.push(token);
      }
    }
    // Slash-command mention </command:command_id>. Discord's Markdown parser
    // doesn't make these clickable; render a command-shaped affordance instead.
    else if (token.startsWith("</") && token.endsWith(">")) {
      const commandMention = token.match(/^<\\/([a-zA-Z0-9_-]+):(\\d+)>$/);
      result.push(
        <span
          key={`cmd-mention-${match.index}`}
          className="d-mention d-command-mention"
          title={commandMention ? `Slash command: /${commandMention[1]} (ID ${commandMention[2]})` : "Slash command"}
          role="text"
        >
          <span aria-hidden="true">⌘</span> /{commandMention?.[1] || token.slice(2, -1).split(":")[0]}
        </span>
      );
    }
    // Channel mention <#id>
    else if (token.startsWith("<#") && token.endsWith(">")) {
      const channelId = token.slice(2, -1);
      const targetChannel = channels?.find(c => c.id === channelId);
      const channelName = targetChannel ? (targetChannel.name || channelId) : channelId;
      result.push(
        <span
          key={`chan-${match.index}`}
          className="d-mention d-channel-mention"
          onClick={() => onChannelClick?.(channelId)}
          role={onChannelClick ? "button" : undefined}
          tabIndex={onChannelClick ? 0 : undefined}
          onKeyDown={event => {
            if (onChannelClick && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              onChannelClick(channelId);
            }
          }}
          title={`Channel ID: ${channelId}`}
        >
          #{channelName}
        </span>
      );
    }
    // User mention <@id> or <@!id>
    else if (token.startsWith("<@") && !token.startsWith("<@&") && token.endsWith(">")) {
      const userId = token.replace(/<@!?/, "").replace(">", "");
      const user = users?.find(candidate => candidate.id === userId);
      result.push(
        user ? (
          <span key={`user-${match.index}`} className="d-mention d-user-mention" title={`@${user.username}`}>
            <img className="d-user-mention-avatar" src={avatarUrl(user, 32)} alt="" />
            <span>@{user.global_name || user.username}</span>
            {user.global_name && user.global_name !== user.username && (
              <span className="d-user-mention-username">(@{user.username})</span>
            )}
          </span>
        ) : (
          <span key={`user-${match.index}`} className="d-mention d-user-mention" title={`User ID: ${userId}`}>
            @{userId}
          </span>
        )
      );
    }
    // Role mention <@&id>
    else if (token.startsWith("<@&") && token.endsWith(">")) {
      const roleId = token.slice(3, -1);
      result.push(
        <span key={`role-${match.index}`} className="d-mention d-role-mention" title={`Role ID: ${roleId}`}>
          @role
        </span>
      );
    }
    // Timestamp <t:123456:R>
    else if (token.startsWith("<t:") && token.endsWith(">")) {
      const tsMatch = token.match(/^<t:(\d+)(?::([tTdDfFR]))?>$/);
      if (tsMatch) {
        const timestamp = parseInt(tsMatch[1], 10) * 1000;
        const date = new Date(timestamp);
        const style = tsMatch[2] || "f";
        const relative = (target: Date) => {
          const delta = Math.round((target.getTime() - Date.now()) / 1000);
          const abs = Math.abs(delta);
          const unit = abs < 60 ? "second" : abs < 3600 ? "minute" : abs < 86400 ? "hour" : abs < 2_592_000 ? "day" : abs < 31_536_000 ? "month" : "year";
          const divisor: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400, month: 2592000, year: 31536000 };
          const amount = Math.max(1, Math.round(abs / divisor[unit]));
          const phrase = `${amount} ${unit}${amount === 1 ? "" : "s"}`;
          return delta < 0 ? `in ${phrase}` : `${phrase} ago`;
        };
        const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const dateShort = date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
        const dateLong = date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
        const dateTime = date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
        const rendered = style === "t" ? time
          : style === "T" ? date.toLocaleTimeString()
          : style === "d" ? date.toLocaleDateString()
          : style === "D" ? dateLong
          : style === "F" ? `${dateLong} ${time}`
          : style === "R" ? relative(date)
          : dateTime;
        result.push(
          <span key={`ts-${match.index}`} className="d-timestamp" title={date.toLocaleString()}>
            {rendered}
          </span>
        );
      } else {
        result.push(token);
      }
    }
    // Masked link [text](url)
    else if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        result.push(
          <a
            key={`link-${match.index}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="d-link"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        result.push(token);
      }
    }
    // Raw URL https://...
    else if (/^https?:\/\//.test(token)) {
      result.push(
        <a
          key={`rawurl-${match.index}`}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          className="d-link"
        >
          {token}
        </a>
      );
    }
    // Spoiler ||...||
    else if (token.startsWith("||") && token.endsWith("||") && token.length >= 4) {
      result.push(<SpoilerText key={`sp-${match.index}`} text={token.slice(2, -2)} />);
    }
    // Bold italic ***...***
    else if (token.startsWith("***") && token.endsWith("***") && token.length >= 6) {
      result.push(
        <strong key={`bi-${match.index}`}>
          <em>{token.slice(3, -3)}</em>
        </strong>
      );
    }
    // Bold **...**
    else if (token.startsWith("**") && token.endsWith("**") && token.length >= 4) {
      result.push(<strong key={`b-${match.index}`}>{token.slice(2, -2)}</strong>);
    }
    // Underline __...__
    else if (token.startsWith("__") && token.endsWith("__") && token.length >= 4) {
      result.push(<u key={`u-${match.index}`}>{token.slice(2, -2)}</u>);
    }
    // Italic *...* or _..._
    else if (
      (token.startsWith("*") && token.endsWith("*") && token.length >= 2) ||
      (token.startsWith("_") && token.endsWith("_") && token.length >= 2)
    ) {
      result.push(<em key={`em-${match.index}`}>{token.slice(1, -1)}</em>);
    }
    // Strikethrough ~~...~~
    else if (token.startsWith("~~") && token.endsWith("~~") && token.length >= 4) {
      result.push(<del key={`del-${match.index}`}>{token.slice(2, -2)}</del>);
    } else {
      result.push(token);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    result.push(text.substring(lastIndex));
  }

  return result;
}

function SpoilerText({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`d-spoiler ${revealed ? "revealed" : ""}`}
      onClick={() => setRevealed(true)}
      title={revealed ? undefined : "Click to reveal spoiler"}
    >
      {text}
    </span>
  );
}
