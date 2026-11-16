# GPUI migration tracker

The desktop migration is incremental. Tauri remains the stable default; GPUI is opt-in with `--gpui-experimental` (or `npm run gpui:experimental` during development). Android remains on the existing mobile branch.

## Porting rules

- Port one user-visible subsystem at a time.
- Reuse the existing Rust implementation; do not fork gateway, REST, cache, or persistence logic.
- Extract UI-independent services before connecting them to GPUI.
- Keep the Tauri implementation working until its GPUI replacement reaches parity.
- A feature is not "ported" until its loading, empty, error, reconnect, and persistence states are covered.

## Feature status

| Feature | GPUI status | Notes |
| --- | --- | --- |
| Native window and app shell | Prototype | Standalone GPUI window launches independently of Tauri |
| Shared Discord networking core | Extracted foundation | Existing `DiscordRouter` is now exposed through `voidcord-core`; both Tauri and GPUI depend on the same implementation |
| Server rail | Interactive prototype | Server selection updates active styling and resets the selected channel; entries are still placeholders |
| Guild/channel selection | Interactive prototype | Channel selection and collapsible text/voice categories work locally; no Discord data or persistence yet |
| Channel list | Interactive prototype | Selectable rows and collapsible categories; currently demo entries |
| Message history | Not started | Reuse existing message/cache services |
| Message composer | Not started | Include uploads, replies, edits, and interaction responses |
| Gateway events | Not started | Must consume the existing gateway; no second gateway |
| Notifications and unread state | Not started | Preserve existing read-state semantics |
| Settings | Not started | Reuse settings persistence and proto serialization |
| RPC / presence | Not started | Reuse existing RPC and presence services |
| Voice / screenshare | Not started | Keep current implementation until dedicated parity work |
| Mobile / Android | Unchanged | Remains on `feat/mobile-client` |

## Next slice: connect the authenticated account

1. Reuse the existing secure-token storage and account-selection settings.
2. Initialize the shared `DiscordRouter` in the GPUI app without starting a second gateway.
3. Fetch and normalize the authenticated user's guild list into a UI-neutral navigation snapshot.
4. Render real guild names/icons and handle loading, empty, auth-error, network-error, and retry states.
5. Keep Tauri's current account and navigation behavior untouched until parity.

## Experimental launch

From the repository root:

```powershell
npm run gpui:experimental
```

Stable mode remains the default:

```powershell
npm run tauri dev
```

The same Rust executable selects GPUI only when `--gpui-experimental` is present. No production default or mobile target is switched.
