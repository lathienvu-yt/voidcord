# Connected Accounts

VoidCord supports viewing and managing third-party accounts linked to the current Discord account.

## Commands

- `get_user_connections`: `GET /users/@me/connections`
- `update_user_connection`: `PATCH /users/@me/connections/{type}/{id}` for supported profile visibility, metadata visibility, activity, and friend-sync settings.
- `refresh_user_connection`: `POST /users/@me/connections/{type}/{id}/refresh`
- `delete_user_connection`: `DELETE /users/@me/connections/{type}/{id}`

All connection path segments are validated before constructing the route. Visibility values are limited to Discord's documented values: 0 (private) and 1 (everyone).

## UI

The **Connections** DM sidebar panel lists linked providers, verification/revocation state, visibility settings, activity and friend-sync toggles, refresh, and unlink actions. Unlinking requires confirmation because Discord may remove memberships associated with the connection's guild integrations.

Creating a new provider link is intentionally not included yet. Discord requires a provider-specific authorization URL and a callback exchange; the panel does not collect provider passwords or access tokens. Contact syncing is also not exposed.
