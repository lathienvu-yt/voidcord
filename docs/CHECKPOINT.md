# Discord Checkpoint

VoidCord exposes Discord's yearly activity recap from the account's own Checkpoint endpoint.

## API

- `GET /checkpoint` — retrieved by the `get_checkpoint` Tauri command using the read-only account identity.
- `POST /checkpoint/loot` — invoked only when the user presses **Claim decoration**; this is the explicit claim for the free avatar decoration.

## UI

- `src/CheckpointPanel.tsx` renders the returned message, emoji, voice, server, game, quest, power-level, sidekick, and reward fields.
- The panel displays Discord's returned values rather than deriving or estimating statistics locally.
- Missing fields remain unavailable instead of being treated as zero.
- The decoration claim is not automatic. A successful claim is reflected in the current panel session; refresh reloads the server response.

The endpoint is account- and year-dependent. Discord may return missing or null sections when a checkpoint is unavailable.
