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
| Native window and app shell | Prototype + motion | Standalone GPUI window with native entrance and animated loading placeholders |
| Shared Discord networking core | Extracted foundation | Existing `DiscordRouter` is now exposed through `voidcord-core`; both Tauri and GPUI depend on the same implementation |
| Server rail | Live data foundation | Loads the active saved account and renders real guild initials; selecting a server fetches its channels |
| Guild/channel selection | Live data foundation | Fetches guilds and channel lists through the shared DiscordRouter; selection is session-local |
| Channel list | Live data foundation | Fetches real guild channels and handles loading, empty, and error states |
| Message history | Initial REST slice | Loads the latest 50 text-channel messages through the shared DiscordRouter; loading, empty, and error states are rendered. Pagination and gateway updates remain pending |
| Guild member sidebar | Initial REST slice | Loads up to 100 members for the selected guild, displays nicknames/global names, and includes loading, empty, and error states |
| Channel metadata and type cues | Initial UI pass | Shows channel topic in the main header and distinguishes text, voice, category, announcement, and forum-style channels in navigation |
| Message composer | Not started | Add a native GPUI input and route sends through the shared DiscordRouter |
| Gateway events | Not started | Must consume the existing gateway; no second gateway |
| Notifications and unread state | Not started | Preserve existing read-state semantics |
| Settings | Not started | Reuse settings persistence and proto serialization |
| RPC / presence | Not started | Reuse existing RPC and presence services |
| Voice / screenshare | Not started | Keep current implementation until dedicated parity work |
| Mobile / Android | Unchanged | Remains on `feat/mobile-client` |

## Account and navigation slice (implemented foundation)

- Reads `accounts` and `active_account_id` from the existing `voidcord-v1.json` settings store in the Windows app-data directory.
- Retrieves the selected account credential from the same Windows keyring service and key naming convention as Tauri (`voidcord` / `discord_token_<user id>`). Raw credentials are not read from the JSON store.
- Uses the shared `DiscordRouter` to fetch `/users/@me/guilds` and `guilds/{id}/channels`; it does not start a second gateway.
- Displays account/guild loading, channel loading, empty, error, and retry states.
- Adds a native shell entrance fade and animated loading placeholders. This is an initial motion pass, not yet a complete reduced-motion system.
- Loads the latest 50 messages for selected text channels through `DiscordRouter`, renders author/content/timestamp rows, and reports loading, empty, and error states.
- Loads up to 100 guild members for the selected server through `DiscordRouter`; renders member initials and nicknames/global names in the right sidebar with loading, empty, and error states.
- Uses channel type cues in the channel list and displays the selected channel topic in the main header when Discord provides one.

## Next slice: messages and gateway events

1. Finish the native message composer and send flow using the existing REST behavior.
2. Add older-message pagination and consume existing gateway message events without starting another gateway.
3. Add account switching and refresh without duplicating token persistence.

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
