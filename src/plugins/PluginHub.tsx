import React, { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Puzzle } from "lucide-react";

const PORT_APPLICATION_URL =
    "https://github.com/lathienvu-yt/voidcord/issues/new?template=plugin-port-application.yml";

export function PluginHub() {
    const [error, setError] = useState("");

    const openPortApplication = async () => {
        setError("");
        try {
            await openUrl(PORT_APPLICATION_URL);
        } catch (openError) {
            setError(`Could not open the port application in your browser: ${String(openError)}`);
        }
    };

    return (
        <div className="settings-options plugin-hub">
            <header className="plugin-hub-header">
                <div>
                    <h3 className="settings-section-title">VoidCord Plugins</h3>
                    <p className="settings-help">
                        Browse plugins officially supported by VoidCord and apply to contribute a port.
                        Vencord plugins are adapted for VoidCord rather than installed or executed directly.
                    </p>
                </div>
                <Puzzle size={24} aria-hidden="true" />
            </header>

            <section className="plugin-hub-section" aria-labelledby="plugin-catalog-title">
                <h4 id="plugin-catalog-title">Supported plugins</h4>
                <article className="plugin-hub-card">
                    <div className="plugin-hub-card-icon"><Puzzle size={18} /></div>
                    <div className="plugin-hub-card-content">
                        <div className="plugin-hub-card-title">
                            <strong>ReviewDB</strong>
                            <span className="plugin-hub-status">Supported</span>
                        </div>
                        <p>View community reviews on profiles and connect your ReviewDB account to post and vote.</p>
                        <small>Available from profile review panels.</small>
                    </div>
                </article>
            </section>

            <section className="plugin-hub-section" aria-labelledby="porting-program-title">
                <h4 id="porting-program-title">VoidCord porting program</h4>
                <p className="settings-help">
                    Original developers and authorized contributors can propose ports of existing Vencord plugins.
                    Submissions are reviewed for compatibility, security, privacy, and maintainability. Third-party
                    ports must be identified as unofficial until accepted.
                </p>
                <p className="settings-help">
                    The application asks for the plugin source, porting plan, permissions and data use, and testing
                    details. Submitting an application does not guarantee acceptance.
                </p>
                {error && <p className="plugin-port-message error" role="alert">{error}</p>}
                <button
                    className="settings-action-button plugin-port-submit"
                    type="button"
                    onClick={() => void openPortApplication()}
                >
                    Apply to port
                    <ExternalLink size={14} />
                </button>
            </section>
        </div>
    );
}
