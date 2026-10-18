import React from "react";
import { DiscordEmbed, DiscordAttachment, DiscordChannel, DiscordUser } from "./types";
import { DiscordMarkdown } from "./DiscordMarkdown";

interface DiscordEmbedViewProps {
  embed: DiscordEmbed;
  attachments?: DiscordAttachment[];
  channels?: DiscordChannel[];
  users?: DiscordUser[];
  onChannelClick?: (channelId: string) => void;
  onMediaOpen?: (url: string, kind: "image" | "video", name?: string) => void;
}

export function DiscordEmbedView({
  embed,
  attachments = [],
  channels,
  users,
  onChannelClick,
  onMediaOpen,
}: DiscordEmbedViewProps) {
  // Resolve attachment:// URL if needed
  const resolveUrl = (url?: string) => {
    if (!url) return undefined;
    if (url.startsWith("attachment://")) {
      const filename = url.replace("attachment://", "");
      const matched = attachments.find(a => a.filename === filename);
      return matched ? matched.url : url;
    }
    return url;
  };

  const imageUrl = resolveUrl(embed.image?.url);
  const thumbnailUrl = resolveUrl(embed.thumbnail?.url);
  const imageOnly = !embed.title
    && !embed.description
    && !embed.author?.name
    && !embed.provider?.name
    && !embed.fields?.length
    && !embed.footer?.text
    && !embed.timestamp
    && (imageUrl || thumbnailUrl);
  const standaloneImageUrl = imageUrl || thumbnailUrl;

  if (imageOnly && standaloneImageUrl) {
    const href = embed.url && !embed.url.startsWith("attachment://") ? embed.url : standaloneImageUrl;
    return (
      <a className="embed-standalone-image" href={href} target="_blank" rel="noopener noreferrer" onClick={event => {
        if (!onMediaOpen) return;
        event.preventDefault();
        onMediaOpen(standaloneImageUrl, "image", embed.title);
      }}>
        <img src={standaloneImageUrl} alt="" loading="lazy" />
      </a>
    );
  }

  // Border color calculation (Discord embeds default to dark grey if no color specified)
  const borderColor =
    embed.color != null
      ? `#${embed.color.toString(16).padStart(6, "0")}`
      : "var(--border-strong, #2b2d31)";

  return (
    <div
      className="discord-embed-card"
      style={{ borderLeftColor: borderColor }}
    >
      <div className="embed-grid">
        {/* Main Content Area */}
        <div className="embed-content-col">
          {/* Provider */}
          {embed.provider?.name && (
            <div className="embed-provider">
              {embed.provider.url ? (
                <a href={embed.provider.url} target="_blank" rel="noopener noreferrer">
                  {embed.provider.name}
                </a>
              ) : (
                embed.provider.name
              )}
            </div>
          )}

          {/* Author */}
          {embed.author?.name && (
            <div className="embed-author">
              {embed.author.icon_url && (
                <img
                  src={embed.author.icon_url}
                  alt=""
                  className="embed-author-icon"
                />
              )}
              {embed.author.url ? (
                <a
                  href={embed.author.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="embed-author-name"
                >
                  {embed.author.name}
                </a>
              ) : (
                <span className="embed-author-name">{embed.author.name}</span>
              )}
            </div>
          )}

          {/* Title */}
          {embed.title && (
            <div className="embed-title">
              {embed.url ? (
                <a href={embed.url} target="_blank" rel="noopener noreferrer">
                  {embed.title}
                </a>
              ) : (
                embed.title
              )}
            </div>
          )}

          {/* Description */}
          {embed.description && (
            <div className="embed-description">
              <DiscordMarkdown
                content={embed.description}
                channels={channels}
                users={users}
                onChannelClick={onChannelClick}
              />
            </div>
          )}

          {/* Fields */}
          {embed.fields && embed.fields.length > 0 && (
            <div className="embed-fields-grid">
              {embed.fields.map((field, idx) => (
                <div
                  key={idx}
                  className={`embed-field ${field.inline ? "inline" : "full"}`}
                >
                  <div className="embed-field-name">{field.name}</div>
                  <div className="embed-field-value">
                    <DiscordMarkdown
                      content={field.value}
                      channels={channels}
                      users={users}
                      onChannelClick={onChannelClick}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Thumbnail (floated top right) */}
        {thumbnailUrl && (
          <div className="embed-thumbnail-wrap">
            <img
              src={thumbnailUrl}
              alt=""
              className="embed-thumbnail-img"
              loading="lazy"
              role="button"
              tabIndex={onMediaOpen ? 0 : undefined}
              aria-label={embed.title ? `Open image for ${embed.title}` : "Open embedded image"}
              onClick={() => onMediaOpen?.(thumbnailUrl, "image", embed.title)}
              onKeyDown={event => {
                if (onMediaOpen && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  onMediaOpen(thumbnailUrl, "image", embed.title);
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Main Image */}
      {imageUrl && (
        <div className="embed-image-wrap">
          <img
            src={imageUrl}
            alt=""
            className="embed-main-img"
            loading="lazy"
            role="button"
            tabIndex={onMediaOpen ? 0 : undefined}
            aria-label={embed.title ? `Open image for ${embed.title}` : "Open embedded image"}
            onClick={() => onMediaOpen?.(imageUrl, "image", embed.title)}
            onKeyDown={event => {
              if (onMediaOpen && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onMediaOpen(imageUrl, "image", embed.title);
              }
            }}
          />
        </div>
      )}

      {embed.video?.url && (
        <button className="embed-video-open" onClick={() => onMediaOpen?.(embed.video!.url!, "video", embed.title)}>
          Open embedded video
        </button>
      )}

      {/* Footer */}
      {(embed.footer?.text || embed.timestamp) && (
        <div className="embed-footer">
          {embed.footer?.icon_url && (
            <img
              src={embed.footer.icon_url}
              alt=""
              className="embed-footer-icon"
            />
          )}
          <span>{embed.footer?.text}</span>
          {embed.footer?.text && embed.timestamp && (
            <span className="embed-bullet">•</span>
          )}
          {embed.timestamp && (
            <span className="embed-timestamp">
              {new Date(embed.timestamp).toLocaleDateString([], {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
