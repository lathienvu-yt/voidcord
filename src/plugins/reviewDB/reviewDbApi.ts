import { Review, ReviewDBCurrentUser, ReviewDBUser, ReviewType, ReviewVote, UserReviewsData } from "./entities";

const API_URL = "https://manti.vendicated.dev/api/reviewdb";
export const REVIEWS_PER_PAGE = 50;

export function getStoredReviewDbToken(): string | null {
    try {
        return localStorage.getItem("voidcord:reviewdb-token") || null;
    } catch {
        return null;
    }
}

export function setStoredReviewDbToken(token: string | null) {
    try {
        if (token) {
            localStorage.setItem("voidcord:reviewdb-token", token);
        } else {
            localStorage.removeItem("voidcord:reviewdb-token");
        }
    } catch {}
}

async function rdbRequest<T = unknown>(path: string, options: RequestInit = {}): Promise<{ data: T | null; error?: string }> {
    const token = getStoredReviewDbToken();
    const headers: Record<string, string> = {
        Accept: "application/json",
        ...(token ? { Authorization: token } : {}),
        ...(options.headers as Record<string, string> || {}),
    };

    if (options.body) {
        headers["Content-Type"] = "application/json";
    }

    try {
        const res = await fetch(API_URL + path, {
            ...options,
            headers,
        });

        const json = await res.json().catch(() => null);

        if (!res.ok) {
            const errorMsg = json?.message || `ReviewDB: Request failed with status ${res.status}`;
            return { data: null, error: errorMsg };
        }

        return { data: json as T };
    } catch (err) {
        return { data: null, error: `Network error connecting to ReviewDB: ${String(err)}` };
    }
}

export async function getReviews(
    id: string,
    { limit = REVIEWS_PER_PAGE, offset = 0, fetchVotes = false }: { limit?: number; offset?: number; fetchVotes?: boolean } = {}
): Promise<UserReviewsData> {
    const params = new URLSearchParams();
    if (offset) params.append("offset", String(offset));
    if (limit) params.append("limit", String(limit));

    const votesPromise = fetchVotes ? getReviewVotes(id).catch(() => []) : Promise.resolve([]);

    try {
        const req = await fetch(`${API_URL}/users/${id}/reviews?${params}`);
        if (!req.ok) {
            const data = await req.json().catch(() => null);
            return {
                message: data?.message || (req.status === 429 ? "Rate limited by ReviewDB" : "Error fetching reviews"),
                reviews: [],
                updated: false,
                hasNextPage: false,
                reviewCount: 0,
                hasOptedOut: false,
            };
        }

        const res = (await req.json()) as UserReviewsData;

        if (fetchVotes && res.reviews?.length > 0) {
            const votes = await votesPromise;
            if (votes.length > 0) {
                const map = new Map<number, boolean>();
                for (const v of votes) map.set(v.reviewID, v.isUpvote);
                res.reviews = res.reviews.map(r => ({
                    ...r,
                    userVote: map.get(r.id) ?? null,
                }));
            }
        }

        return res;
    } catch (err) {
        return {
            message: `Failed to load reviews: ${String(err)}`,
            reviews: [],
            updated: false,
            hasNextPage: false,
            reviewCount: 0,
            hasOptedOut: false,
        };
    }
}

export async function getReviewVotes(id: string): Promise<ReviewVote[]> {
    const token = getStoredReviewDbToken();
    if (!token) return [];
    const { data } = await rdbRequest<{ votes: ReviewVote[] }>(`/users/${id}/reviews/votes`);
    return data?.votes || [];
}

export async function addReview(userId: string, comment: string): Promise<{ success: boolean; message?: string }> {
    const token = getStoredReviewDbToken();
    if (!token) return { success: false, message: "Please log in to ReviewDB first." };

    const { data, error } = await rdbRequest<UserReviewsData>(`/users/${userId}/reviews`, {
        method: "PUT",
        body: JSON.stringify({ userid: userId, comment }),
    });

    if (error) return { success: false, message: error };
    return { success: true, message: data?.message };
}

export async function deleteReview(id: number): Promise<{ success: boolean; message?: string }> {
    const { data, error } = await rdbRequest<UserReviewsData>(`/users/${id}/reviews`, {
        method: "DELETE",
        body: JSON.stringify({ reviewid: id }),
    });
    if (error) return { success: false, message: error };
    return { success: true, message: data?.message };
}

export async function reportReview(id: number): Promise<{ success: boolean; message?: string }> {
    const { data, error } = await rdbRequest<UserReviewsData>("/reports", {
        method: "PUT",
        body: JSON.stringify({ reviewid: id }),
    });
    if (error) return { success: false, message: error };
    return { success: true, message: data?.message };
}

export async function voteReview(id: number, isUpvote: boolean): Promise<boolean> {
    const { data } = await rdbRequest<{ message?: string }>(`/reviews/${id}/vote`, {
        method: "POST",
        body: JSON.stringify({ isUpvote }),
    });
    return !!data;
}

export async function deleteReviewVote(id: number): Promise<boolean> {
    const { data } = await rdbRequest<{ message?: string }>(`/reviews/${id}/vote`, {
        method: "DELETE",
    });
    return !!data;
}

export async function getCurrentReviewDbUser(): Promise<ReviewDBCurrentUser | null> {
    const token = getStoredReviewDbToken();
    if (!token) return null;
    const { data } = await rdbRequest<ReviewDBCurrentUser>("/users", {
        method: "POST",
    });
    return data;
}

export async function fetchReviewDbBlocks(): Promise<ReviewDBUser[]> {
    const { data } = await rdbRequest<ReviewDBUser[]>("/blocks");
    return data || [];
}

export async function patchReviewDbBlock(action: "block" | "unblock", discordId: string): Promise<boolean> {
    const { data } = await rdbRequest("/blocks", {
        method: "PATCH",
        body: JSON.stringify({ action, discordId }),
    });
    return !!data;
}
