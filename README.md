# Fluentcord

An offline-friendly Discord client shell made with Tauri 2, React and TypeScript. The preview UI runs on local sample data. The Rust backend now includes an account-aware Discord REST/gateway routing module; OAuth credential provisioning and frontend commands still need to be connected.

## Start

```sh
npm install
npm run tauri dev
```

To build the desktop app, install the prerequisites for Tauri 2 and run `npm run tauri build`.

## Included in the preview

- Custom desktop title bar, Discord-inspired server/channel layout, message list, member list, profile menu, composer, and dark/light themes.
- Offline/online status and a local Tauri Store cache for messages, profile selection, and preferences. Messages you type offline stay in the composer as drafts.
- A local archived-channel preview: “save last message offline” stores a channel's last message. Archived entries are rendered as muted, clickable, read-only channels and show their locally saved message.
- Multiple local profile slots and profile selection. These are presentation profiles, not Discord credentials or an authentication implementation.
- Windows transparent window setup for native material experimentation. Mica needs a Windows-specific native window effect integration; transparent mode alone does not activate Mica.
- Guild, direct-message, and group-DM voice calls using Discord's voice gateway, DAVE media encryption, Opus encode/decode, selectable microphone and speaker devices, and streaming resampling to/from Discord's 48 kHz audio format. Voice participants and call chat are shown in the voice view; guild voice channels also support editable status.
- Vencord loader preference placeholder only. Loading Vencord requires an explicit, compatible integration and a plugin security boundary.
- Rust account request router in `src-tauri/src/discord_router.rs`: primary identity for message/reaction writes, read-only identity for browsing and gateway events, explicit secondary identity availability, and safe local community-to-account preferences.

## Voice dependency licensing

The voice implementation depends on [`cacophony`](https://crates.io/crates/cacophony) and its [`dave`](https://crates.io/crates/dave) dependency, both licensed `AGPL-3.0-only`. Review and comply with those license terms before distributing VoidCord or offering a modified version over a network.

## Privacy and access

Use Discord's supported OAuth flow to authenticate accounts. Never store Discord passwords or user tokens in the frontend or local cache. The router holds credentials only in Rust memory and redacts their debug output. HTTP 401/403 and channel-access errors are surfaced to the selected identity's caller; they are not silently retried under another account. Age gates and channel access restrictions must be respected for the signed-in account. Archived messages are only messages captured locally while the user could already see them.
