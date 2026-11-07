import React, { useState } from "react";
import { Review, ReviewType } from "./entities";
import { deleteReview, deleteReviewVote, reportReview, voteReview } from "./reviewDbApi";
import { ReviewBadgesList } from "./ReviewBadge";
import { ThumbsUp, ThumbsDown, Trash2, Flag, Star } from "lucide-react";

interface Props {
    review: Review;
    currentDiscordId?: string;
    onDeleted?: () => void;
    onReported?: () => void;
    onUserClick?: (discordId: string) => void;
}

export function ReviewComponent({ review, currentDiscordId, onDeleted, onReported, onUserClick }: Props) {
    const [vote, setVote] = useState<boolean | null>(review.userVote ?? null);
    const [score, setScore] = useState<number>(review.score ?? 0);
    const [busy, setBusy] = useState(false);

    const isOwn = currentDiscordId && review.sender.discordID === currentDiscordId;
    const isSystem = review.type === ReviewType.System;

    const handleVote = async (up: boolean) => {
        if (busy || isSystem) return;
        setBusy(true);
        try {
            if (vote === up) {
                // Cancel vote
                const ok = await deleteReviewVote(review.id);
                if (ok) {
                    setScore(prev => prev - (up ? 1 : -1));
                    setVote(null);
                }
            } else {
                const ok = await voteReview(review.id, up);
                if (ok) {
                    const diff = vote === null ? (up ? 1 : -1) : (up ? 2 : -2);
                    setScore(prev => prev + diff);
                    setVote(up);
                }
            }
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async () => {
        if (!window.confirm("Are you sure you want to delete this review?")) return;
        setBusy(true);
        try {
            const res = await deleteReview(review.id);
            if (res.success) onDeleted?.();
        } finally {
            setBusy(false);
        }
    };

    const handleReport = async () => {
        if (!window.confirm("Report this review to ReviewDB moderators?")) return;
        setBusy(true);
        try {
            const res = await reportReview(review.id);
            if (res.success) {
                alert("Review reported successfully.");
                onReported?.();
            }
        } finally {
            setBusy(false);
        }
    };

    const formattedTime = review.timestamp
        ? new Date(review.timestamp * 1000).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
          })
        : "";

    return (
        <article className={`rdb-review-card ${isSystem ? "rdb-review-system" : ""}`}>
            <header className="rdb-review-header">
                <button
                    type="button"
                    className="rdb-author-btn"
                    onClick={() => onUserClick?.(review.sender.discordID)}
                >
                    <img
                        src={review.sender.profilePhoto || "https://cdn.discordapp.com/embed/avatars/0.png"}
                        alt={review.sender.username}
                        className="rdb-author-avatar"
                    />
                    <strong className="rdb-author-name">{review.sender.username}</strong>
                </button>
                <ReviewBadgesList badges={review.sender.badges} />

                {review.star > 0 && (
                    <div className="rdb-stars" title={`${review.star} star${review.star > 1 ? "s" : ""}`}>
                        {Array.from({ length: 5 }, (_, i) => (
                            <Star
                                key={i}
                                size={13}
                                className={i < review.star ? "rdb-star-filled" : "rdb-star-empty"}
                            />
                        ))}
                    </div>
                )}

                <span className="rdb-timestamp">{formattedTime}</span>

                <div className="rdb-review-actions">
                    {!isSystem && (
                        <div className="rdb-vote-group">
                            <button
                                type="button"
                                className={`rdb-vote-btn ${vote === true ? "active-up" : ""}`}
                                onClick={() => void handleVote(true)}
                                disabled={busy}
                                title="Upvote"
                            >
                                <ThumbsUp size={13} />
                            </button>
                            <span className="rdb-vote-score">{score}</span>
                            <button
                                type="button"
                                className={`rdb-vote-btn ${vote === false ? "active-down" : ""}`}
                                onClick={() => void handleVote(false)}
                                disabled={busy}
                                title="Downvote"
                            >
                                <ThumbsDown size={13} />
                            </button>
                        </div>
                    )}

                    {isOwn && (
                        <button
                            type="button"
                            className="rdb-action-btn delete-btn"
                            onClick={() => void handleDelete()}
                            disabled={busy}
                            title="Delete your review"
                        >
                            <Trash2 size={13} />
                        </button>
                    )}

                    {!isOwn && !isSystem && (
                        <button
                            type="button"
                            className="rdb-action-btn report-btn"
                            onClick={() => void handleReport()}
                            disabled={busy}
                            title="Report review"
                        >
                            <Flag size={13} />
                        </button>
                    )}
                </div>
            </header>

            <div className="rdb-review-comment">{review.comment}</div>
        </article>
    );
}
