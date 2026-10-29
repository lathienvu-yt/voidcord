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
  const customFields = Array.isArray(embed.fields) ? embed.fields.filter(field => !!field) : [];
  const customFieldMap = new Map(customFields.map(field => [String(field.name || "").toLowerCase(), field.value]));
  const officialHeader = customFieldMap.get("header");
  const officialBody = customFieldMap.get("body");
  const officialLearnMore = customFieldMap.get("learn_more_link");
  const officialCtas = customFieldMap.get("ctas");
  const officialDetails = customFields.filter(field => !["header", "body", "learn_more_link", "ctas", "timestamp", "theme", "icon_type", "content_type", "classification_id"].includes(String(field.name || "").toLowerCase()));

  // GIF providers frequently return a gifv embed whose actual animation is MP4.
  // Render the video directly instead of a generic embed card.
  if (embed.type === "gifv" && embed.video?.url) {
    const videoUrl = resolveUrl(embed.video.url);
    const poster = thumbnailUrl || undefined;
    return (
      <div className="embed-gifv" style={{ width: "min(100%, 448px)" }}>
        <video
          src={videoUrl}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          controls
          preload="metadata"
          style={{ display: "block", width: "100%", maxHeight: 480, objectFit: "contain", borderRadius: 8, background: "#000" }}
          onError={event => {
            const video = event.currentTarget;
            video.style.display = "none";
            const fallback = video.nextElementSibling as HTMLElement | null;
            if (fallback) fallback.style.display = "block";
          }}
        />
        {poster && <a href={poster} target="_blank" rel="noopener noreferrer" style={{ display: "none" }}>
          <img src={poster} alt={embed.title || "Animated GIF preview"} style={{ display: "block", maxWidth: "100%", borderRadius: 8 }} />
        </a>}
        <div className="embed-gifv-title" style={{ marginTop: 5, fontWeight: 600 }}>
          GIF - {embed.title || embed.provider?.name || "Animated image"}
        </div>
      </div>
    );
  }

  // Use official provider iframe endpoints for supported YouTube and TikTok URLs.
  const providerUrl = embed.url || embed.author?.url || "";
  let providerFrame: { src: string; ratio: string; title: string } | null = null;
  try {
    const parsed = new URL(providerUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\\./, "");
    if (host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      const id = host === "youtu.be" ? parsed.pathname.split("/").filter(Boolean)[0]
        : parsed.pathname.match(/^\\/(?:embed|shorts|live)\\/([A-Za-z0-9_-]{11})/)?.[1] || parsed.searchParams.get("v");
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
        providerFrame = { src: `https://www.youtube.com/embed/${id}`, ratio: "16 / 9", title: embed.title || "YouTube video" };
      }
    } else if (host === "tiktok.com" || host === "m.tiktok.com") {
      const id = parsed.pathname.match(/\\/video\\/(\\d+)/)?.[1] || parsed.pathname.match(/\\/player\\/v1\\/(\\d+)/)?.[1];
      if (id) {
        providerFrame = { src: `https://www.tiktok.com/player/v1/${id}?utm_source=discord.gg`, ratio: "9 / 16", title: embed.title || "TikTok video" };
      }
    }
  } catch { /* malformed or non-URL embed: use the normal embed renderer */ }

  if (providerFrame) {
    return (
      <div className="discord-provider-video" style={{ width: "min(100%, 560px)" }}>
        <iframe
          src={providerFrame.src}
          title={providerFrame.title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          allowFullScreen
          style={{ display: "block", width: "100%", aspectRatio: providerFrame.ratio, border: 0, borderRadius: 8, background: "#000" }}
        />
        {embed.title && <div style={{ marginTop: 5, fontWeight: 600 }}>{embed.title}</div>}
        <a href={providerUrl} target="_blank" rel="noopener noreferrer">Open on {providerUrl.toLowerCase().includes("tiktok.com") ? "TikTok" : "YouTube"}</a>
      </div>
    );
  }
  if (officialBody && (officialHeader || /discord/i.test(embed.title || ""))) {
    return (
      <div className="discord-official-embed" role="note">
        {embed.title && <h3>{embed.title}</h3>}
        {officialHeader && <strong>{officialHeader}</strong>}
        <div className="discord-official-embed-body"><DiscordMarkdown content={officialBody} channels={channels} users={users} onChannelClick={onChannelClick} /></div>
        {officialDetails.length > 0 && <dl>{officialDetails.map((field, index) => <div key={`${field.name}-${index}`}><dt>{field.name}</dt><dd>{field.value}</dd></div>)}</dl>}
        {(officialLearnMore || officialCtas) && <a href={officialLearnMore || officialCtas} target="_blank" rel="noopener noreferrer">Learn More</a>}
      </div>
    );
  }
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
          {Array.isArray(embed.fields) && embed.fields.some(field => !!field) && (
            <div className="embed-fields-grid">
              {customFields.map((field, idx) => (
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
