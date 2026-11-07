> [!WARNING]
> This is an experimental project of next-gen native Discord client. Expect bugs and crashes
# VoidCord

An offline-friendly, zero-bloat Discord client shell built with **Tauri 2**, **Rust**, and **React/TypeScript**. Engineered for bare-metal performance, offline-first message archiving, multi-account routing, and real-time media transport.

---

## Quick Start

### Prerequisites
- Node.js (v18+)
- Rust & Cargo (Latest Stable)
- Operating system build tools required by [Tauri 2](https://v2.tauri.app/start/prerequisites/)

### Development

```sh
npm install
npm run tauri dev
```

### Production Build

To build the optimized desktop application binary:

```sh
npm run tauri build
```

---

## Key Features & Technical Highlights

* **Rust Account Request Router (`src-tauri/src/discord_router.rs`)**
  * Account-aware REST and Gateway routing layer with isolation between primary identities (write/reactions) and read-only identity scopes.
  * Combines DM lists and profile reads across saved accounts; merged DM channels retain their account owner for message history reads.
  * Coordinates Discord REST route/global rate limits from response headers and retries temporary 429 responses.
  * In-memory credential protection with automated debug log redaction and safe local account-preference mapping.

* **Local Cache (`src-tauri/src/cache.rs`)**
  * Stores offline messages, drafts, application data, logs, and archived attachment media in RocksDB; cached attachments can fall back to local copies when offline.
  * Copies existing IndexedDB cache data into RocksDB once on first launch; the legacy browser database is retained as a recovery copy.

* **Safety Hub & Reporting**
  * Displays account standing and Trust & Safety classifications from Discord Safety Hub, with a dismissible startup warning for account warnings or restrictions.
  * Supports in-client user and message reports using Discord’s available report reasons; Safety Hub data is fetched from Discord’s user endpoint.

* **Friends & Message Requests**
  * Ignore and unignore users through Discord relationships, with ignored state synchronized to the account.
  * Message requests include Discord’s supplemental trigger-message preview and support accepting, rejecting, and batch rejection.

* **Profiles**
  * Caches fetched profile responses in `voidcord-v1.json` for offline viewing and fallback when profile requests fail; keeps the 100 most recently cached profiles.
  * Full profiles use a responsive page layout with a self-profile appearance summary and a right-side Board/Activity/Wishlist game panel.
  * Resolves profile game names and artwork through Discord's public RPC application endpoint; unresolved games are labeled "Unknown game" rather than showing raw IDs.
  * Renders supported Discord display-name fonts, colors, and effects from the display-name style object.

* **Automatic Game Activity**
  * Optional Windows Discord RPC IPC listener accepts game SDK `SET_ACTIVITY` updates, including Rich Presence assets, timestamps, party data, and buttons, and forwards them through the Gateway.
  * SDK activity is detected when an integrated game connects; VoidCord cannot enumerate games or SDKs that are not running. The listener currently implements the activity-focused RPC handshake and commands, not Discord's full voice, channel, and account RPC surface.
  * Game SDK RPC is opt-in. VoidCord does not expose account, chat, or voice-control commands over IPC.
  * Optional process-name allowlist remains available as a fallback for games without Discord SDK integration. Its configuration stays local; the full process inventory is never transmitted.
  * If Discord Desktop is running, it may own an earlier IPC pipe and receive a game's connection first. VoidCord warns about this client-selection conflict.
  * A local custom Rich Presence editor supports application IDs, activity type, details/state, developer-portal asset keys, timestamps, party size, and up to two HTTPS buttons.

* **Protobuf & Settings Synchronization**
  * Built-in `user-settings-proto/1` parsing for exact guild folder layouts, themes, position indexes, and account preferences.

* **Low-Latency Voice Engine**
  * Native voice gateway integration supporting Guild, DM, and Group-DM voice calls.
  * Features **DAVE media encryption**, **Opus encoding/decoding**, custom sample resampling to/from Discord’s native 48 kHz standard, and configurable audio input/output device routing.

* **Offline First & `.vcc` Local Archives**
  * Offline composer message drafting and local channel state retention.
  * Export and import local message archives via `.vcc` file format with zero-alloc async IPC dialog locks.

* **Sovereign Desktop Interface**
  * Custom Windows native titlebar, paint-style menu toolbar, light/dark themes, and native transparent background modes.
  * Import local Discord mod `.css` themes, with common Discord color variables mapped to VoidCord's interface tokens; selectors tied to Discord's private DOM may require adaptation.
  * Interactive Application Command Browser UI with slash-command payload parsing and autocomplete support.

---

## Voice Subsystem Licensing

The voice implementation depends on [`cacophony`](https://crates.io/crates/cacophony) and its [`dave`](https://crates.io/crates/dave) dependency, both licensed under `AGPL-3.0-only`. Please review and comply with these license terms before distributing modified versions of VoidCord or hosting network services utilizing these components.

---

## Security & Privacy

* Credentials and auth tokens are held strictly inside Rust process memory and are never exposed to local frontend persistent storage or client log outputs.
* Rate limits, channel permissions, and age gates strictly adhere to the authenticated user identity without silent failover between sessions.
* Local channel archives only capture messages visible during an active session.
