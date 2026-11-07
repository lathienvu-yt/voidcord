import React, { useEffect, useState, useCallback } from "react";
import { Review, ReviewType, UserReviewsData } from "./entities";
import { addReview, getReviews, getStoredReviewDbToken, setStoredReviewDbToken, REVIEWS_PER_PAGE } from "./reviewDbApi";
import { ReviewComponent } from "./ReviewComponent";
import { X, Send, Key, ChevronLeft, ChevronRight, MessageSquare, AlertCircle, Loader2 } from "lucide-react";
import { OAuth2Modal } from "../../OAuth2Modal";

interface Props {
    targetId: string;
    targetName: string;
    type?: ReviewType;
    currentDiscordId?: string;
    onClose: () => void;
    onUserClick?: (discordId: string) => void;
}

export function ReviewModal({ targetId, targetName, type = ReviewType.User, currentDiscordId, onClose, onUserClick }: Props) {
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [reviewsData, setReviewsData] = useState<UserReviewsData | null>(null);
    const [newComment, setNewComment] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [authOpen, setAuthOpen] = useState(false);
    const [oauthOpen, setOauthOpen] = useState(false);
    const [authError, setAuthError] = useState("");
    const [tokenInput, setTokenInput] = useState("");
    const [tokenSaved, setTokenSaved] = useState(!!getStoredReviewDbToken());

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getReviews(targetId, {
                offset: (page - 1) * REVIEWS_PER_PAGE,
                limit: REVIEWS_PER_PAGE,
                fetchVotes: true,
            });
            setReviewsData(data);
        } finally {
            setLoading(false);
        }
    }, [targetId, page]);

    useEffect(() => {
        void load();
    }, [load]);

    const handleAddReview = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = newComment.trim();
        if (!text || submitting) return;

        if (!getStoredReviewDbToken()) {
            setAuthOpen(true);
            return;
        }

        setSubmitting(true);
        try {
            const res = await addReview(targetId, text);
            if (res.success) {
                setNewComment("");
                void load();
            } else {
                alert(res.message || "Failed to submit review.");
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleSaveToken = () => {
        const t = tokenInput.trim();
        if (!t) {
            setStoredReviewDbToken(null);
            setTokenSaved(false);
            setAuthOpen(false);
            return;
        }
        setStoredReviewDbToken(t);
        setTokenSaved(true);
        setAuthOpen(false);
        alert("ReviewDB token saved successfully!");
    };

    const reviews = reviewsData?.reviews || [];
    const count = reviewsData?.reviewCount ?? reviews.length;
    const totalPages = Math.max(1, Math.ceil(count / REVIEWS_PER_PAGE));

    return (
        <div className="feature-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <>
            <section className="feature-modal rdb-modal" role="dialog" aria-modal="true" aria-labelledby="rdb-modal-title">
                <header className="feature-modal-header">
                    <div>
                        <h2 id="rdb-modal-title" className="rdb-title">
                            <MessageSquare size={18} />
                            <span>{targetName}'s Reviews</span>
                            {count > 0 && <span className="rdb-count-badge">({count})</span>}
                        </h2>
                        <p className="rdb-subtitle">ReviewDB community ratings and comments</p>
                    </div>

                    <div className="rdb-header-actions">
                        <button
                            type="button"
                            className={`rdb-token-btn ${tokenSaved ? "connected" : ""}`}
                            onClick={() => {
                                setTokenInput(getStoredReviewDbToken() || "");
                                setAuthError("");
                                setAuthOpen(prev => !prev);
                            }}
                            title="Connect ReviewDB"
                        >
                            <Key size={14} />
                            <span>{tokenSaved ? "Connected" : "Connect"}</span>
                        </button>

                        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                            <X size={17} />
                        </button>
                    </div>
                </header>

                {authOpen && (
                    <div className="rdb-auth-box">
                        <div className="rdb-auth-desc">
                            <AlertCircle size={15} />
                            <span>
                                Authorize ReviewDB with Discord to post reviews and vote.
                            </span>
                        </div>
                        {authError && <div className="rdb-auth-error">{authError}</div>}
                        <button
                            type="button"
                            onClick={() => {
                                setAuthError("");
                                setOauthOpen(true);
                            }}
                            className="rdb-primary-btn"
                        >
                            Authorize with Discord
                        </button>
                        <details className="rdb-manual-auth">
                            <summary>Or enter a ReviewDB token manually</summary>
                        <div className="rdb-auth-row">
                            <input
                                type="password"
                                placeholder="Paste your ReviewDB token"
                                value={tokenInput}
                                onChange={e => setTokenInput(e.target.value)}
                                className="rdb-token-input"
                            />
                            <button type="button" onClick={handleSaveToken} className="rdb-primary-btn">Save</button>
                            {tokenSaved && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setStoredReviewDbToken(null);
                                        setTokenSaved(false);
                                        setTokenInput("");
                                    }}
                                    className="rdb-secondary-btn"
                                >
                                    Log out
                                </button>
                            )}
                        </div>
                        </details>
                    </div>
                )}

                <div className="rdb-modal-content">
                    {loading ? (
                        <div className="rdb-loading">
                            <Loader2 size={24} className="spinning" />
                            <span>Loading reviews…</span>
                        </div>
                    ) : reviews.length === 0 ? (
                        <div className="rdb-empty">
                            <p>No reviews yet for {targetName}.</p>
                            <small>Be the first to leave a review below!</small>
                        </div>
                    ) : (
                        <div className="rdb-reviews-list">
                            {reviews.map(r => (
                                <ReviewComponent
                                    key={r.id}
                                    review={r}
                                    currentDiscordId={currentDiscordId}
                                    onDeleted={() => void load()}
                                    onReported={() => void load()}
                                    onUserClick={onUserClick}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {totalPages > 1 && (
                    <footer className="rdb-pagination">
                        <button
                            type="button"
                            disabled={page <= 1}
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            className="icon-btn"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <span>Page {page} of {totalPages}</span>
                        <button
                            type="button"
                            disabled={page >= totalPages}
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            className="icon-btn"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </footer>
                )}

                <form className="rdb-input-form" onSubmit={handleAddReview}>
                    <textarea
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        placeholder={`Write a review for ${targetName}…`}
                        rows={2}
                        maxLength={500}
                        className="rdb-textarea"
                    />
                    <div className="rdb-form-footer">
                        <span className="rdb-char-count">{500 - newComment.length} left</span>
                        <button
                            type="submit"
                            disabled={!newComment.trim() || submitting}
                            className="rdb-submit-btn"
                        >
                            <Send size={14} />
                            <span>{submitting ? "Sending…" : "Post Review"}</span>
                        </button>
                    </div>
                </form>
            </section>
            {oauthOpen && (
                <OAuth2Modal
                    config={{
                        clientId: "915703782174752809",
                        scopes: ["identify"],
                        redirectUri: "https://manti.vendicated.dev/api/reviewdb/auth",
                        responseType: "code",
                        onSuccess: ({ data }) => {
                            const token = data?.token;
                            if (typeof token !== "string" || !token.trim()) {
                                setAuthError("ReviewDB authorization completed, but no token was returned.");
                                setAuthOpen(true);
                                return;
                            }
                            setStoredReviewDbToken(token);
                            setTokenSaved(true);
                            setTokenInput("");
                            setAuthOpen(false);
                            setOauthOpen(false);
                        },
                        onCancel: () => setOauthOpen(false),
                    }}
                    onClose={() => setOauthOpen(false)}
                />
            )}
            </>
        </div>
    );
}
