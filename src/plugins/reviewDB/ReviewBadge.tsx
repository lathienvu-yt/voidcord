import React from "react";
import { Badge } from "./entities";

export function ReviewBadge({ badge }: { badge: Badge }) {
    const content = (
        <img
            src={badge.icon}
            alt={badge.description || badge.name}
            title={`${badge.name}: ${badge.description}`}
            className="rdb-badge-img"
        />
    );

    if (badge.redirectURL) {
        return (
            <a
                href={badge.redirectURL}
                target="_blank"
                rel="noreferrer noopener"
                className="rdb-badge-link"
                title={`${badge.name} (Click to open)`}
            >
                {content}
            </a>
        );
    }

    return <span className="rdb-badge-wrap">{content}</span>;
}

export function ReviewBadgesList({ badges }: { badges?: Badge[] }) {
    if (!badges || badges.length === 0) return null;
    return (
        <span className="rdb-badges-list">
            {badges.map((b, i) => (
                <ReviewBadge key={i} badge={b} />
            ))}
        </span>
    );
}
