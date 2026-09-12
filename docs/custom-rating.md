# Custom Rating Provider

Optional backend enrichment from any external rating service, using IMDb IDs.
The existing TMDb/MDBList `voteAverage` badge remains unchanged. Custom ratings
appear in a separate horizontal pill row above the existing bottom badge.
When disabled, no multi-rating row is rendered. When enabled, available internal
IMDb data is combined with the provider items for non-mapped, saved and query posters.

## Configuration

Configuration is currently server-side via environment variables.
The canonical prefix is `PICTORIUM_`; `POSTERIUM_` is supported as a legacy
fallback through `envWithFallback()`. Canonical values take precedence.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PICTORIUM_CUSTOM_RATING_ENABLED` | `false` | Enable with `true` or `1` |
| `PICTORIUM_CUSTOM_RATING_ENDPOINT` | empty | HTTP(S) URL containing `{imdbId}` |
| `PICTORIUM_CUSTOM_RATING_API_KEY` | unset | Optional secret sent only in a header |
| `PICTORIUM_CUSTOM_RATING_API_KEY_HEADER` | `X-API-Key` | Header for the secret |

Example endpoint: `https://example.com/ratings/{imdbId}`.
For IMDb ID `tt1375666`, Pictorium sends:

```http
GET /ratings/tt1375666 HTTP/1.1
Host: example.com
Accept: application/json
X-API-Key: <configured secret, if any>
```

Required response contract:

```json
{
  "ratings": [
    { "id": "source1", "name": "Source 1", "value": 8.8, "format": "decimal" },
    { "id": "source2", "name": "Source 2", "value": 87, "format": "percent" }
  ]
}
```

`fetchCustomRatings(imdbId, config, signal?)` returns `RatingItem[]`. There is no
fixed item count, subject to the response size limit below. Every item is validated
independently: `id` and `name` must be non-empty strings after trimming, `value`
must be a finite number, and `format` must be `decimal` or `percent`. Invalid items
are ignored; an empty or entirely invalid array returns `[]`. Extra fields are
ignored. Percent renders `87` as `87%`; decimal renders `8.8` as `8.8`, without
scale conversion. Names and formats come from the API.

IDs are case-sensitive and trimmed. For duplicate IDs, the last valid API item
wins while retaining the first occurrence's position. Provider items override
internal items with the same ID. The internal IMDb slot stays first when present;
remaining provider items follow API order. Invalid duplicates never erase a valid item.

Errors, invalid JSON, non-2xx responses and timeouts return `[]` and must never
prevent poster rendering. The
request has a 1.5-second timeout combined with the main render AbortSignal,
and a 16 KiB response limit. Only public HTTP(S) destinations are supported:
private/loopback/link-local addresses are blocked at connection time, URL
credentials and redirects are rejected. Configure secrets through the header,
never in the endpoint URL. Provider errors are not logged.

Poster cache hits return before custom fetching. On a miss, fetching runs with
luminance and optional metadata work after IMDb ID resolution. A SHA-256 digest
of enabled configuration participates in poster cache identity, including key
changes without storing plaintext secrets in cache keys. There is no additional
rating cache; freshness follows the existing poster TTL. Restart after env changes.

`GenerationInput.ratings?: RatingItem[]` supports any number of ratings in a
horizontal row that scales to the available width. Omission preserves the old
renderer. Each item has `id`, `name`, `value`, `format`, and optional `logo`.
Logo is reserved for later trusted assets; this phase renders the name as text.
The renderer already supports multiple rating pills. Web/editor configuration
is not part of this backend change. Future editor integration can expose the
endpoint, API key/header and related settings through
`resolveCustomRatingConfig(overrides)`. Asset uploads are also left for a separate
change; no public endpoint or token schema changes here.
