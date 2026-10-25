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
  * In-memory credential protection with automated debug log redaction and safe local account-preference mapping.

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
  * Interactive Application Command Browser UI with slash-command payload parsing and autocomplete support.

---

## Voice Subsystem Licensing

The voice implementation depends on [`cacophony`](https://crates.io/crates/cacophony) and its [`dave`](https://crates.io/crates/dave) dependency, both licensed under `AGPL-3.0-only`. Please review and comply with these license terms before distributing modified versions of VoidCord or hosting network services utilizing these components.

---

## Security & Privacy

* Credentials and auth tokens are held strictly inside Rust process memory and are never exposed to local frontend persistent storage or client log outputs.
* Rate limits, channel permissions, and age gates strictly adhere to the authenticated user identity without silent failover between sessions.
* Local channel archives only capture messages visible during an active session.
