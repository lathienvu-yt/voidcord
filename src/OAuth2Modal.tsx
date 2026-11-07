import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, X, Shield, ExternalLink, Loader2, AlertCircle, Bot } from "lucide-react";
import { DiscordUser, avatarUrl, displayName, formatDiscriminator } from "./types";

export interface OAuth2PromptConfig {
    clientId: string;
    scopes: string[];
    redirectUri: string;
    responseType?: string;
    permissions?: string;
    state?: string;
    clientMod?: string;
    onSuccess?: (result: { location: string; data?: any }) => void;
    onCancel?: () => void;
}

interface OAuth2AppInfo {
    id: string;
    name: string;
    icon?: string | null;
    description?: string | null;
    bot?: any;
    terms_of_service_url?: string | null;
    privacy_policy_url?: string | null;
}

interface OAuth2AuthorizeData {
    application: OAuth2AppInfo;
    user?: any;
    scopes: string[];
    bot?: any;
    approximate_guild_count?: number;
    authorized?: boolean;
}

const SCOPE_DESCRIPTIONS: Record<string, { label: string; details: string }> = {
    identify: {
        label: "Access your basic profile",
        details: "Know your username, display name, avatar, and banner",
    },
    email: {
        label: "Access your email address",
        details: "Know the email address registered with your Discord account",
    },
    guilds: {
        label: "Know what servers you are in",
        details: "Access the list of all servers your account has joined",
    },
    "guilds.join": {
        label: "Add you to servers",
        details: "Join Discord servers on your behalf",
    },
    "gdm.join": {
        label: "Join Group DMs",
        details: "Add your account to group direct messages",
    },
    connections: {
        label: "Access third-party connections",
        details: "View linked accounts like Steam, Spotify, Twitch, and GitHub",
    },
    "role_connections.write": {
        label: "Update role connections",
        details: "Update verification metadata for linked roles in servers",
    },
    "applications.commands": {
        label: "Add slash commands",
        details: "Register application slash commands in servers you choose",
    },
    bot: {
        label: "Add a bot",
        details: "Install and authorize this bot into a server you choose",
    },
};

export function OAuth2Modal({
    config,
    currentUser,
    onClose,
}: {
    config: OAuth2PromptConfig;
    currentUser?: DiscordUser | null;
    onClose: () => void;
}) {
    const [loading, setLoading] = useState(true);
    const [authorizing, setAuthorizing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<OAuth2AuthorizeData | null>(null);

    const queryParams = new URLSearchParams({
        client_id: config.clientId,
        response_type: config.responseType || "code",
        scope: config.scopes.join(" "),
        redirect_uri: config.redirectUri,
    });
    if (config.permissions) queryParams.set("permissions", config.permissions);
    if (config.state) queryParams.set("state", config.state);

    const queryString = queryParams.toString();

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(null);

        invoke<OAuth2AuthorizeData>("get_oauth2_authorize", { query: queryString })
            .then(res => {
                if (active) {
                    setData(res);
                    setLoading(false);
                }
            })
            .catch(err => {
                if (active) {
                    setError(String(err));
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [queryString]);

    const handleAuthorize = async () => {
        if (authorizing) return;
        setAuthorizing(true);
        setError(null);

        try {
            const res = await invoke<{ location: string }>("submit_oauth2_authorize", {
                query: queryString,
                authorize: true,
                permissions: config.permissions || "0",
                guildId: null,
            });

            if (!res?.location) {
                throw new Error("Authorization failed: Discord did not return a redirect location.");
            }

            // Follow redirect and exchange code if clientMod is requested (e.g. ReviewDB)
            let redirectData: any = null;
            if (config.clientMod) {
                redirectData = await invoke<any>("complete_oauth2_redirect", {
                    url: res.location,
                    clientMod: config.clientMod,
                });
            }

            config.onSuccess?.({ location: res.location, data: redirectData });
            onClose();
        } catch (err) {
            setError(String(err));
            setAuthorizing(false);
        }
    };

    const handleCancel = async () => {
        if (authorizing) return;
        try {
            await invoke("submit_oauth2_authorize", {
                query: queryString,
                authorize: false,
                permissions: null,
                guildId: null,
            });
        } catch {}
        config.onCancel?.();
        onClose();
    };

    const app = data?.application;
    const appIcon = app?.icon
        ? `https://cdn.discordapp.com/app-icons/${app.id}/${app.icon}.png?size=128`
        : "https://cdn.discordapp.com/embed/avatars/0.png";

    let redirectHost = "";
    try {
        redirectHost = new URL(config.redirectUri).hostname;
    } catch {
        redirectHost = config.redirectUri;
    }

    return (
        <div className="feature-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !authorizing) onClose(); }}>
            <section className="feature-modal oauth2-modal" role="dialog" aria-modal="true" aria-labelledby="oauth2-title">
                {loading ? (
                    <div className="oauth2-loading">
                        <Loader2 size={32} className="spinning" />
                        <span>Connecting to Discord…</span>
                    </div>
                ) : error && !app ? (
                    <div className="oauth2-error-state">
                        <AlertCircle size={36} className="oauth2-error-icon" />
                        <h3>Could not load authorization prompt</h3>
                        <p>{error}</p>
                        <button type="button" className="oauth2-cancel-btn" onClick={onClose}>Close</button>
                    </div>
                ) : (
                    <>
                        <header className="oauth2-header">
                            <div className="oauth2-app-icon-wrap">
                                <img src={appIcon} alt={app?.name || "App"} className="oauth2-app-icon" />
                            </div>
                            <h2 id="oauth2-title" className="oauth2-app-name">{app?.name || "Application"}</h2>
                            <p className="oauth2-subtitle">wants to access your Discord account</p>

                            {currentUser && (
                                <div className="oauth2-user-badge">
                                    <img
                                        src={avatarUrl(currentUser, 32)}
                                        alt={displayName(currentUser)}
                                        className="oauth2-user-avatar"
                                    />
                                    <span>
                                        Signed in as <strong>{displayName(currentUser)}</strong>
                                        <small>{currentUser.username}{formatDiscriminator(currentUser)}</small>
                                    </span>
                                </div>
                            )}
                        </header>

                        <div className="oauth2-body">
                            {error && (
                                <div className="oauth2-inline-error">
                                    <AlertCircle size={16} />
                                    <span>{error}</span>
                                </div>
                            )}

                            <div className="oauth2-section-title">
                                This will allow the developer of <strong>{app?.name}</strong> to:
                            </div>

                            <ul className="oauth2-scopes-list">
                                {config.scopes.map(scope => {
                                    const desc = SCOPE_DESCRIPTIONS[scope] || {
                                        label: `Scope: ${scope}`,
                                        details: `Access permissions for ${scope}`,
                                    };
                                    return (
                                        <li key={scope} className="oauth2-scope-item">
                                            <div className="oauth2-scope-check">
                                                <Check size={14} />
                                            </div>
                                            <div className="oauth2-scope-text">
                                                <strong>{desc.label}</strong>
                                                <span>{desc.details}</span>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>

                            <div className="oauth2-disclaimer">
                                <Shield size={14} />
                                <span>This will <strong>not</strong> give access to your password or payment info.</span>
                            </div>

                            <div className="oauth2-redirect-note">
                                Authorizing will redirect to: <strong>{redirectHost}</strong>
                            </div>
                        </div>

                        <footer className="oauth2-footer">
                            <button
                                type="button"
                                className="oauth2-cancel-btn"
                                onClick={handleCancel}
                                disabled={authorizing}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="oauth2-authorize-btn"
                                onClick={() => void handleAuthorize()}
                                disabled={authorizing}
                            >
                                {authorizing ? (
                                    <>
                                        <Loader2 size={16} className="spinning" />
                                        <span>Authorizing…</span>
                                    </>
                                ) : (
                                    <span>Authorize</span>
                                )}
                            </button>
                        </footer>
                    </>
                )}
            </section>
        </div>
    );
}
