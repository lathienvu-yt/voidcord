# Quests and Store browser

VoidCord exposes read-only views for Discord's current user quests and published application store listings.

## Quests

The Quests view reads:

- `GET /quests/@me` for current quests and enrollment eligibility metadata.
- `GET /quests/@me/claimed` for the account's claimed quest history.

Quest progress and task metadata are displayed as returned by Discord. VoidCord does not simulate activity, submit heartbeats, force completion, or automatically claim rewards.

## Store

The Store view accepts a Discord application ID and reads:

- `GET /store/published-listings/skus?application_id={id}&country_code=VN&localize=true`

Only published listing metadata is displayed. The panel does not create purchase previews, submit purchases, or handle payment sources.

## Implementation

- Frontend: `src/QuestsStorePanel.tsx`
- Tauri commands: `get_my_quests`, `get_published_store_listings`
- Both commands use the existing `DiscordRouter` and read-only account identity.
- Navigation is available under the DM sidebar's Quests and Shop entries.

The endpoint shapes are based on the community-maintained, unofficial Discord Userdoccers reference. These are undocumented client-facing APIs and may change without notice:
- https://docs.discord.food/resources/quests
- https://docs.discord.food/resources/store
