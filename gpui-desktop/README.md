# VoidCord GPUI Desktop

This directory contains an isolated native desktop-shell prototype. It is intentionally separate from the existing Tauri application and from the Android/mobile branch.

## Run (Windows)

Requirements:
- Windows 10/11
- Rust stable toolchain
- The native build tools required by the GPUI 0.2.2 dependency
- A working GPU driver

From the repository root:

```powershell
cargo run --manifest-path gpui-desktop/Cargo.toml
```

The first build compiles GPUI and its native dependencies and can take a while.

## Current status

**Milestone 1: native shell scaffold.** The prototype opens a native GPUI window with a server rail, channel sidebar, conversation area, and context panel. Server-rail selection is interactive.

This is not feature parity and is not yet connected to Discord. The visible content is placeholder UI. No account, message, gateway, cache, upload, notification, RPC, or voice action is wired up.

## Architecture boundary

The existing Tauri application remains the production desktop client. The Android/mobile branch remains unchanged.

The current backend is not yet a standalone crate:
- `discord_router.rs` is the strongest existing extraction candidate; it owns REST routing and credential-scoped request logic without importing Tauri.
- `settings_proto.rs` is also independent of Tauri.
- `commands.rs`, `cache.rs`, `gateway_ipc.rs`, `rpc.rs`, and `voice_gateway.rs` currently contain Tauri types, commands, event emission, or runtime integration and need adapters or refactoring before GPUI can call them directly.
- `main.rs` currently owns application state construction and Tauri startup.

Do not duplicate or rewrite the Discord gateway. The next milestone should extract UI-independent state and services into a shared Rust library, then provide separate Tauri and GPUI adapters. Keep Tauri as the stable desktop entry point until the GPUI app has feature parity and passes regression testing.

## Planned milestones

1. **Native shell** — this prototype.
2. **Shared core extraction** — isolate router, cache, settings, gateway lifecycle, and service state from Tauri-specific handles.
3. **GPUI service adapter** — connect the native UI to the shared core with typed events and commands.
4. **Feature migration** — accounts, guild/channel navigation, messages, uploads, notifications, settings, RPC, then voice and screenshare.
5. **Parity and cutover** — test persistence, reconnects, performance, and platform behavior before changing the default desktop launcher.

GPUI is still evolving and its APIs may change between releases. Keep the version pinned until the migration is stable.
