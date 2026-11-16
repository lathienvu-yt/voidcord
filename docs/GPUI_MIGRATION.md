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
| Native window and app shell | In progress | Standalone GPUI shell is available; not yet wired to app state |
| Server rail | Prototype | Current entries are placeholders; next real-data slice |
| Guild/channel selection | Not started | Needs shared navigation state and event model |
| Channel list | Prototype | Static rows only |
| Message history | Not started | Reuse existing message/cache services |
| Message composer | Not started | Include uploads, replies, edits, and interaction responses |
| Gateway events | Not started | Must consume the existing gateway; no second gateway |
| Notifications and unread state | Not started | Preserve existing read-state semantics |
| Settings | Not started | Reuse settings persistence and proto serialization |
| RPC / presence | Not started | Reuse existing RPC and presence services |
| Voice / screenshare | Not started | Keep current implementation until dedicated parity work |
| Mobile / Android | Unchanged | Remains on `feat/mobile-client` |

## Next slice: real server rail

1. Define a UI-neutral guild/navigation snapshot and event contract.
2. Extract the existing guild list and selected-guild state from Tauri command/event glue.
3. Feed the same snapshot into GPUI.
4. Port selection and active-state rendering.
5. Verify loading, no-guild, network-error, and reconnect behavior.
6. Keep the Tauri rail untouched until the GPUI rail reaches parity.

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
