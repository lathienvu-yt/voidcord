# Discord Content Inventory: Reverse-Engineering Notes

> **Status:** preliminary, observation-based notes. This is an undocumented client endpoint, not an official Discord API specification. Examples were captured by a VoidCord contributor in Discord DevTools. Field meanings are labelled as observed or tentative below.

## Scope and safety

Observed request path:

`GET /api/v9/content-inventory/users/@me`

The captured request also included query parameters such as `for_game_profile=false` and `feature=inbox`; a `refresh_token` query parameter was present in one request. Treat the full URL as sensitive and **never commit or log refresh-token values, authorization headers, cookies, or raw user-specific response dumps**.

This endpoint is undocumented and can change without notice. Use only with an account and data you are authorized to access. Do not use it to collect or redistribute other users' activity without an appropriate basis. This document intentionally contains no captured user IDs, content IDs, signatures, tokens, or personal activity samples.

## Confidence labels

- **Observed:** directly present in the supplied DevTools response samples.
- **Tentative:** plausible interpretation based on names or shape, but not verified against Discord client code or controlled tests.
- **Unknown:** semantics have not been established.

## Response envelope

The reported response shape includes these fields. The first group was present in the supplied endpoint summary; exact optionality and behavior still need fresh captures.

| Field | Type seen/reported | Confidence and notes |
|---|---|---|
| `request_id` | string | Observed in the reported envelope; likely request tracing, but purpose is not confirmed. |
| `entries` | array of ranked entries | Observed. Each supplied item has `content` and `rank`. |
| `unranked_game_entries` | array | Reported in the supplied summary; not independently characterized here. |
| `entries_hash` | integer | Observed in the reported envelope. Cache/change-detection use is tentative. |
| `expired_at` | timestamp string | Reported at envelope level. Do not confuse with entry-level `expires_at`. |
| `refresh_stale_inbox_after_ms` | integer | Reported. Exact refresh semantics are unknown. |
| `refresh_token` | string | Reported. Purpose is unknown; do not assume pagination. Treat as sensitive. |
| `wait_ms_until_next_fetch` | integer | Reported. Likely relevant to fetch scheduling, but exact policy is unknown. |

Do not assume every field is always present, that the reported types are exhaustive, or that timestamps and refresh values have identical semantics across content types.

## Entry envelope

Each supplied ranked entry had this shape:

- `rank`: integer (observed; ranking scope and ordering algorithm unknown).
- `content`: object containing the fields below.

| Field | Observed shape | Notes |
|---|---|---|
| `id` | string | Entry/content identifier. Uniqueness scope is unknown. |
| `author_id` | string | User identifier; sensitive personal identifier in logs/dumps. |
| `author_type` | integer | Numeric enum; meaning not verified. |
| `content_type` | integer | Numeric enum. Values `1` and `8` were observed in game and launched-activity examples respectively; meanings are not established. |
| `traits` | array of objects | Heterogeneous records with numeric `type` and type-specific fields. |
| `extra` | object | Discriminated by a string `type` in observed examples. |
| `participants` | array of strings | Contains user IDs in supplied examples; exact inclusion rules are unknown. |
| `started_at` | timestamp string | Present in a game example. Optionality and exact meaning are unknown. |
| `ended_at` | timestamp string | Reported by the supplied summary, but not present in every sample. |
| `expires_at` | timestamp string | Present in supplied entry examples; distinct spelling from envelope `expired_at`. |
| `original_id` | string | Present in the music example; relationship to `id` is unknown. |
| `signature` | object | Contains `signature`, `kid`, and `version` in examples. Verification algorithm, signed payload, and trust model are unknown. |

Treat timestamps as optional strings until the schema has been validated against more samples. Preserve unrecognized fields.

## Observed `extra.type` variants

### `played_game_extra`

Observed fields:

- `game_name`: string (example title was a game).
- `application_id`: string.
- `platform`: integer (one sample used `0`; its meaning is unknown).

### `launched_activity_extra`

Observed fields:

- `activity_name`: string (example was Wordle).
- `application_id`: string.

One example had outer `content_type: 8`. Do not generalize that value to all launched activities without more samples.

### `top_artist_extra`

Observed fields:

- `artist`: object with `external_id`, `name`, and `image_hash` (which was `null` in the sample).
- `media`: nested object whose `type` was `listened_media_extra`.

The nested `media` example contained:

- `provider`: integer (meaning of numeric value unknown).
- `media_type`: integer (meaning unknown).
- `parent_title`: string.
- `title`: string.
- `image_url`: URL string.
- `artists`: array.
- `external_id`: string.
- `external_parent_id`: string.
- `duration_ms`: nullable value.

The example used Spotify-hosted image and external IDs, but provider and media-type enums should remain numeric until verified. Do not assume this variant always refers to Spotify.

## Observed trait variants

Traits are heterogeneous objects keyed by numeric `type`. These mappings describe fields actually seen in supplied samples, not a complete enum specification.

| `type` | Field observed | Confidence |
|---:|---|---|
| `2` | `duration_seconds` (number) | Observed in game and launched-activity samples. Whether it means total duration, current session duration, or a display metric is unknown. |
| `3` | `is_live` (boolean) | Observed in one game sample. “Live” semantics are unknown; do not equate it with livestreaming without evidence. |
| `6` | `marathon` (boolean) | Observed in one game sample; qualification rules unknown. |
| `8` | `streak_count_days` (number) | Observed in game and launched-activity samples; streak calculation rules unknown. |
| `9` | `trending` (number) | Observed in one game sample. The value is not proven to be a rank or boolean. |

Other trait numbers and fields mentioned in third-party summaries (including `1`, `4`, `5`, `10`, `11`, and `12`) are **not verified by the samples documented here**. Do not hardcode their proposed meanings.

## Safe implementation guidance for VoidCord

1. Model the response as unknown JSON at the network boundary, then validate only the fields needed by the UI.
2. Use string discriminants for `extra.type`; add handlers for known variants and a generic fallback for unknown variants.
3. Keep numeric enums (`author_type`, `content_type`, trait `type`, `platform`, `provider`, `media_type`) as raw numbers until confirmed by evidence.
4. Preserve unrecognized keys and trait records. Avoid destructive normalization of fields the UI does not understand.
5. Render missing or malformed optional fields gracefully; never require a field merely because one sample contains it.
6. Treat `refresh_token`, authentication headers, cookies, and raw request URLs as secrets. Redact them in diagnostics, issue reports, fixtures, and logs.
7. Avoid committing unredacted response fixtures: user IDs, content IDs, signatures, media history, timestamps, and participant lists can be identifying or sensitive. Prefer synthetic fixtures with obviously fake values.
8. Do not implement aggressive polling based on guessed meanings. Observe client behavior and respect server-provided delays and rate limits.
9. Because this endpoint is undocumented, keep it isolated behind an adapter and make the feature optional; do not present it as a stable/public Discord API.

## Questions to resolve with further evidence

- Which fields are always present, and which vary by `feature` or request parameters?
- What exactly does `refresh_token` do, and how does it relate to `wait_ms_until_next_fetch` and `refresh_stale_inbox_after_ms`?
- What does `entries_hash` hash, and what are its comparison rules?
- What do `author_type`, `content_type`, `platform`, `provider`, and `media_type` enum values mean?
- What are the complete trait variants, and how are traits selected?
- How is `rank` computed and scoped? What is the role of `unranked_game_entries`?
- What bytes are signed, and how does the official client validate `signature`?

Until confirmed through controlled observations or the client code, these remain open questions—not API guarantees.
