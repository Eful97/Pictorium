# Pictorium — Configuration

[← Back to README](../README.md) · [🇮🇹 Italiano](CONFIGURATION.it.md)

## 🔑 Configuration

All variables use the `PICTORIUM_*` prefix. The legacy `POSTERIUM_*` names are still accepted as a fallback (with a one-time deprecation warning); `PICTORIUM_*` always wins. Values are read at module level, so changing them requires a restart. `?u=`-scoped requests never fall back to instance-wide keys.

### Essential

| Variable | Default | Description |
|---|:---:|---|
| `PICTORIUM_ADMIN_TOKEN` | *(optional)* | Secret for private instances: paste it in Settings → Admin token (session only, dies with the tab) to enable warmup, cache clear and saves from the UI. Without it (and without a PIN session) admin routes return 401. |
| `PICTORIUM_TMDB_KEY` | *(optional)* | Server-side TMDB v3 key for posters and catalogs. Alternatively save instance keys in the app: they live in an encrypted store (AES-256-GCM, `0600`) that anonymous Stremio requests resolve with no env set. |
| `PICTORIUM_REGION` | `IT` | Default country for streaming charts and availability (`IT`, `US`, `GB`, `FR`, `DE`, `ES`, …). |
| `PICTORIUM_DATA_DIR` | `./data` | Directory for settings, saved posters and local caches. In Docker it must point at the persistent volume (`/data`, writable by uid 1000). The data file is created on first save, so "not found" with 0 posters on a fresh install is normal. |
| `PICTORIUM_REDIS_URL` | *(empty)* | Native Redis (TCP) for multi-replica HA without a `/data` volume. Wins over Upstash REST when both are set (no automatic migration). On Kubernetes plain `REDIS_URL` is also read. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | *(empty)* | Canonical Upstash REST credentials for serverless deployments. The legacy Vercel names `KV_REST_API_URL` / `KV_REST_API_TOKEN` carry the same credentials and are accepted with a deprecation warning. |
| `PICTORIUM_KV_CACHE` | *(on with KV)* | With Redis/KV, set `0` to keep the response cache in memory only (state stays in KV). Useful on public instances; not recommended on serverless. |
| `PICTORIUM_IMAGE_FORMAT` | `webp` | Poster format for clients that declare no preference: `webp` (~25–30% lighter at equal quality) or `jpeg` (universal, for dated clients). `?fmt=` overrides per request both ways. Requires restart; switching invalidates the cache once. |
| `PICTORIUM_HOSTED_BY` | *(empty)* | Public hosting sponsor: `elfhosted` shows the ElfHosted banner (auto-detected from an `elfhosted.com` host). Empty = no banner. |
| `PICTORIUM_DUCKDNS_NOTICE` | *(empty)* | `1` shows the dismissible "this instance is closing" notice (the one-off sunset banner for the DuckDNS deployment). Env-only, no hostname sniffing. `NEXT_PUBLIC_DUCKDNS_NOTICE` is accepted as an alias. |
| ~~`PICTORIUM_PUBLIC_INSTANCE`~~ | *(removed)* | Legacy switch, no longer read: if still set it is ignored and opens nothing. Admin routes are always fail-closed without a token or PIN session. |

### API keys & metadata providers

| Variable | Default | Description |
|---|:---:|---|
| `PICTORIUM_TVDB_API_KEY` | *(optional)* | TheTVDB key for alternate season ordering, episode descriptions and TheTVDB custom lists (BYOK: request header, `tvdb_key` query, or user profile key win over this). |
| `PICTORIUM_MDBLIST_KEY` | *(optional)* | MDBList key for custom lists, anime catalogs and aggregated ratings. |
| `PICTORIUM_FANART_KEY` | *(optional)* | Fanart.tv project key for the vertical-posters section in the editor (server-only, never exposed to the browser). Without it the section explains it is not configured. |
| `PICTORIUM_RATING_MIN_VOTES` | `10` | Per-source minimum vote count for MDBList aggregated ratings: sources with a known `votes` count below this are excluded; `0` disables the filter. Missing/malformed counts are always kept, RogerEbert is exempt. |
| `PICTORIUM_TRAKT_CLIENT_ID` | *(optional)* | Trakt API client ID (single Pictorium app registration) for public Trakt lists as custom catalogs, and for per-space OAuth (PKCE, no secret). |
| `PICTORIUM_TRAKT_REDIRECT_URI` | *(optional)* | Exact HTTPS OAuth redirect URI registered in the Trakt dashboard (path is always `/api/trakt/callback`, e.g. `https://your-instance/api/trakt/callback`). Never derived from the request. |
| `PICTORIUM_CUSTOM_RATING_*` | *(unset)* | Custom rating provider (`_ENABLED`, `_ENDPOINT`, `_API_KEY`, `_API_KEY_HEADER`) plus `PICTORIUM_CUSTOM_RATINGS` for the default row. Endpoint and header can also be set from the editor; the key is env-only. See [docs/custom-rating.md](custom-rating.md). |
| `PICTORIUM_EPISODE_RATINGS_PROVIDER` | `showgrid` | Per-episode ★ source for TV episode thumbnails: `showgrid` (IMDb per-episode poll via ShowGrid, then TMDB episode vote), `tmdb`/`off` (TMDB episode vote only), or the opt-in `seriesgraph`/`dataset`. |
| `PICTORIUM_SHOWGRID_URL` | *(unset)* | Optional http(s) origin override for the default ShowGrid API (built-in default `https://api.theshowgrid.com`; the same override serves the deterministic E2E mock). |
| `PICTORIUM_NON_COMMERCIAL_ACK` | *(unset)* | `1` acknowledges the non-commercial permission required by the opt-in `seriesgraph`/`dataset` providers. No effect on the default ShowGrid source. |
| `PICTORIUM_SERIESGRAPH_URL` | *(unset)* | Endpoint for the opt-in SeriesGraph provider. Required with `PICTORIUM_EPISODE_RATINGS_PROVIDER=seriesgraph`; shipped as a fail-closed stub (no fetch) until written consent exists. |
| `PICTORIUM_IMDB_DATASET_URL` | *(unset)* | Absolute http(s) location of a licensed IMDb episode-ratings dataset for the opt-in `dataset` provider; shipped as a fail-closed stub (no import). |

> [!NOTE]
> **Episode ratings.** ShowGrid is enabled by default under an explicit operator decision that accepts the third-party risk: it has no licence and provider permission is still pending (12h cache, fail-open to the TMDB vote). Opt-in providers are fail-closed: without `PICTORIUM_NON_COMMERCIAL_ACK=1` and their URL they log a warning and fall back to ShowGrid. Cinemeta is no longer consulted on the episode path (legacy `cinemeta`/`imdb` values are aliases of ShowGrid); title ratings keep using Cinemeta unchanged.
>
> **MDBList quota.** The daily quota is per account, shared across keys and apps; keyless ratings calls are skipped (Cinemeta/native fallbacks remain).
>
> **Trakt OAuth.** One Trakt app registration per instance (client ID + redirect URI, no client secret: new Trakt apps use PKCE and receive no secret — a leftover `PICTORIUM_TRAKT_CLIENT_SECRET` is ignored, remove it). Users connect their own account from Settings → Space; Pictorium imports only the watchlist and private standard lists, read-only (no writes, no history, Smart Lists unsupported). Tokens are encrypted with `PROFILE_ENCRYPTION_KEY` on persistent storage; without persistence, connections are lost on restart. Disconnect deletes local tokens (verified, fenced) but the upstream revocation call is best-effort, so to fully revoke access also remove the app under https://trakt.tv/settings/apps.

### Shared hosting hardening

| Variable | Default | Description |
|---|:---:|---|
| `PICTORIUM_POSTER_PARAMS` | *(auto)* | `presets` restricts non-preview requests to a finite render set (cache-key allowlist, coarse 5/10/5px steps, palette-only `ac`, no anonymous free-text/keyless overrides); `free` is the historic behavior. Auto-`presets` on shared hosting (`HOSTED_BY=elfhosted` or `MULTI_USER=1`); the WYSIWYG preview stays live for user spaces and unlocked sessions. |
| `PICTORIUM_PREVIEW_AUTH` | *(auto)* | On shared hosting, anonymous previews (`preview=1` without a space or session) are downgraded and cached like normal requests (no bot bypass). User spaces and unlocked sessions stay live. `0` forces OFF, `1` forces ON; no effect on private instances. |
| `PICTORIUM_PROXY_ALLOW_DOMAINS` | *(private: open; shared: deny)* | Comma-separated host allowlist (subdomains included) the addon proxy may fetch. On shared instances an unset list is default-deny: a public instance must not be an open relay. Private self-hosted instances keep the historic open behavior. |
| `PICTORIUM_PROXY_ALLOW_ANY` | `0` | **Dangerous, never on a public instance**: reopens the addon proxy to any host when no allowlist is set (open relay / SSRF-by-proxy for anonymous callers). Prefer `PICTORIUM_PROXY_ALLOW_DOMAINS`. |
| `PICTORIUM_TRUST_PROXY` | `0` | Set `1` **only** behind a reverse proxy/Cloudflare that overwrites client-IP headers: enables `cf-connecting-ip` (preferred) / `x-real-ip` / first-hop `x-forwarded-for` for rate-limit keys. Without a trusted proxy those headers are spoofable, so by default none is read and anonymous callers share one bucket (`local`). |
| `PICTORIUM_CLIENT_IP_HEADER` | *(empty)* | With `TRUST_PROXY=1`, trust exactly one header (e.g. `cf-connecting-ip` behind Cloudflare). It must carry a single proxy-set value: comma-separated or invalid names are refused with a one-time warning. |
| `PICTORIUM_ALLOWED_HOSTS` | *(empty)* | Comma-separated public hostnames trusted as `X-Forwarded-Host` by the same-origin (CSRF) check. Leave empty unless a proxy forwards a host different from the request `Host`. |
| `PICTORIUM_RATELIMIT_POSTER_MAX` | `200` | Burst budget of the poster rate-limit bucket (accepted 10–10000, invalid values fall back to `200`). |
| `PICTORIUM_FRAME_ANCESTORS` | *(HF default)* | Overrides the CSP `frame-ancestors` (default is HF Spaces compatible). E.g. `'self'` for public instances that should never be embedded. |

### Multi-user mode

| Variable | Default | Description |
|---|:---:|---|
| `CONFIG_HMAC_SECRET` | *(empty)* | HMAC key that signs `?config=`/`/c/<config>/` share and install links. Required in production: without it unsigned tokens are rejected (fail-closed). Also accepted as `ENCRYPTION_KEY_SECRET`. |
| `PICTORIUM_MULTI_USER` | `0` | Set `1` to enable isolated user spaces on `/u/<uuid>/configure`. The instance PIN card and instance API-key store are then hidden: each space uses its own session password and keys, while instance-wide settings unlock with `PICTORIUM_ADMIN_TOKEN`. |
| `PROFILE_ENCRYPTION_KEY` | *(empty)* | **Required** with `MULTI_USER=1`. 64-character hex key (AES-256-GCM, generate via `openssl rand -hex 32`). Set once and keep it: rotating it makes stored API keys and Trakt tokens unreadable until re-entered. |
| `PICTORIUM_MAX_MAPPINGS_PER_USER` | `500` | Maximum number of saved posters allowed per user space. |
| `PICTORIUM_MAX_USERS` | *(unlimited)* | Maximum number of user spaces that can be created. The unlimited default is kept for backwards compatibility (existing instances may already exceed any fixed cap); **set an explicit value on public instances** to bound name space creation. |
| `PICTORIUM_PUBLIC_STATS` | `1` | Set `0` to return user counts from `/api/status` only to admins (the home "spaces" strip is then hidden for visitors). |

<details>
<summary><strong>Rendering defaults</strong></summary>

| Variable | Default | Description |
|---|:---:|---|
| `PICTORIUM_BADGE_STYLE` | `shadow` | Genre & rating badge style: `shadow`, `pill`, `bar`, `colored`, `bordo` (Border), `vetro` (Glass), `minimal`, `ink`. |
| `PICTORIUM_RANKING_BADGE_STYLE` | `default` | Ranking badge style (`default`, `bar`, `colored`, `pill`, `netflix`). |
| `PICTORIUM_RIBBON_SIDE` | `left` | Netflix Top 10 ribbon side (`left` / `right`). |
| `PICTORIUM_RIBBON_ENABLED` | `1` | `1` = corner ribbon, `0` = centered rank badge. |
| `PICTORIUM_BLUR_ENABLED` | `1` | Enable or disable cinematic background blur. |
| `PICTORIUM_TINT_STRENGTH` | `20` | Scene tint strength for background blur (0–100). |
| `PICTORIUM_TOP_SHADE` | `50` | Top linear shade strength (0–100, `0` = off). |
| `PICTORIUM_TOP_SHADE_HEIGHT` | `25` | Top linear shade height as % of the poster canvas (0–100, `0` = off). |
| `PICTORIUM_BADGE_QUALITY` | `1` | Show or hide video streaming resolution badges (4K/FHD). |
| `PICTORIUM_AGE_BADGE` | `0` | Show or hide the regional age-certification badge below the quality stack (original country label, no conversion). |
| `PICTORIUM_AGE_COUNTRY` | `IT` | Certification country for the age badge (ISO-2, e.g. `US`, `FR`; `GLOBAL` is rejected). Independent from UI language and streaming region. |
| `PICTORIUM_QUALITY_SOURCE` | `justwatch` | Live streaming quality source: `justwatch` (JustWatch only: tier plus Dolby Vision/Atmos formats from offer `videoTechnology`/`audioTechnology`) or `none` (no live provider; the local DB still applies). The legacy value `torrentio` and unknown values are normalized to `justwatch` and never trigger a live Torrentio call. Torrentio data is used only to expand/update the local `av-specs.json` DB through the offline operator scripts. Poster chain: explicit `quality` param > local DB > live source. |
| `PICTORIUM_NETWORK_LOGO` | `1` | Show or hide production network/studio logos. |
| `PICTORIUM_PRE_RELEASE` | `0` | Dark veil + "Coming Soon" ribbon for movies not yet streaming. |
| `PICTORIUM_GRADIENT_HEIGHT` | `65` | Percentage height of the bottom dark gradient. |

</details>

<details>
<summary><strong>Concurrency & performance</strong></summary>

| Variable | Default | Description |
|---|:---:|---|
| `PICTORIUM_MAX_CONCURRENT_RENDERS` | CPU-scaled `2`–`8` (`4` in docker-compose) | Max concurrent Sharp renders to prevent OOM. Unset = `min(8, max(2, availableParallelism()))`; an explicit value (1–32) always wins, garbage falls back to `4`. |
| `PICTORIUM_MAX_CONCURRENT_FETCHES` | `12` | Max concurrent upstream/image fetches inside the render pipeline (1–32). Waiters hold no image buffers, so this budget is deliberately larger than the render one. |
| `PICTORIUM_RENDER_SLOT_WAIT_MS` | `15000` | Max wait for a render slot before the caller gets a bounded 503 (500–60000 ms). On Vercel without an explicit value it defaults to `7500`. |
| `PICTORIUM_RENDER_QUEUE` | `0` | Bounded render queue (0–128). `0` = waiters queue up to `PICTORIUM_RENDER_SLOT_WAIT_MS`; `N` > 0 = waiters beyond `N` get an immediate 503 (backpressure instead of an unbounded queue). |
| `PICTORIUM_ZOMBIE_GRACE_MS` | `10000` | How long a render abandoned by the deadline watchdog keeps occupying a render slot before it is force-released (1000–120000 ms). The zombie keeps running in the background until it settles. |
| `PICTORIUM_RENDER_TIMEOUT_MS` | `30000` | Max render deadline before the original caller gets a bounded 503 with `Retry-After` (1000–40000 ms). Past the deadline the late job never caches a poster and never double-counts the 503. |
| `PICTORIUM_NEGATIVE_CACHE_TTL_MS` | `5000` | How long a failed render (500/503/404) is remembered so a broken upstream is not hammered (1000–60000 ms). |
| `PICTORIUM_DYNAMIC_POSTER_TTL_MS` | `21600000` (6 h) | Storage TTL for on-demand (unmapped) posters, which also drives their `Cache-Control`/Surrogate headers (clamped 5 min–24 h, ±10% deterministic jitter per cache key). Mapped posters follow the scheduled daily refresh policy. |
| `PICTORIUM_IMG_CACHE_MB` | `32` | RAM budget for the in-process downloaded-image byte cache (0–512 MB, `0` disables it). |
| `PICTORIUM_CACHE_MAX` | `4000` | Max entries in the in-memory metadata cache (must be > 100, otherwise `4000`). A rendered poster takes 2 entries (~60-110KB webp + headers), so 4000 lets the `PICTORIUM_CACHE_MAX_MB` byte cap bind first. This is the entry-cap knob: `PICTORIUM_CACHE_MAX_ENTRIES` is not read. |
| `PICTORIUM_CACHE_MAX_MB` | `150` | Maximum RAM allocated for the in-memory metadata cache (must be > 10 MB, otherwise `150`). |
| `PICTORIUM_POSTER_DISK_CACHE` | on (off on Vercel) | Persist rendered posters to `DATA_DIR/poster-cache` so a restart/deploy serves them from disk (~0.4 ms) instead of re-rendering cold. Same TTL/SWR as memory; wiped on cache clear / global defaults save. `0`/`false`/`off`/`no` disables. |
| `PICTORIUM_POSTER_DISK_CACHE_MB` | `512` | Size cap of the poster disk cache (16–10240 MB); least recently used files are evicted first. |

</details>

<details>
<summary><strong>Operations & diagnostics</strong></summary>

| Variable | Default | Description |
|---|:---:|---|
| `PICTORIUM_SELF_WARMUP` | `1` | Pre-warm core catalogs on server start (Docker entrypoint). |
| `PICTORIUM_WARMUP_TOKEN` | *(unset)* | Optional second factor for `POST /api/warmup`: when set, a matching `x-warmup-token` header is accepted alongside a valid admin token. |
| `PICTORIUM_WARMUP_ORIGIN` | *(derived)* | Origin used by the warmup self-fetch. Default: `VERCEL_URL` when present, else `http://127.0.0.1:<PORT>`. |
| `CRON_SECRET` | *(unset)* | Secret Vercel Cron attaches as `Authorization: Bearer …` when calling `GET /api/warmup`; without it that call is fail-closed. |
| `PICTORIUM_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. Invalid values fall back to `info`. |
| `PICTORIUM_LOG_FORMAT` | `human` | `human` for readable lines, `json` for structured logs. |
| `PICTORIUM_ALLOW_DEV_ADMIN` | `0` | Development only: opens admin routes on non-loopback hosts. Never set it on a deployed instance. |
| `PICTORIUM_ALLOWED_HOSTS` | *(empty)* | See [Shared hosting hardening](#shared-hosting-hardening). |
| `PICTORIUM_BIND_IP` | `0.0.0.0` | Docker Compose only: host interface the published port binds to. |
| `PICTORIUM_HOST_PORT` | `8080` | Docker Compose only: published host port (the container keeps `8080`). |
| `PICTORIUM_NODE_OLD_SPACE` | `384` | Docker Compose only: `--max-old-space-size` for the container (raise it for large shared instances). |
| `SHARP_CONCURRENCY` / `SHARP_CACHE_MEMORY_MB` | `2` / `64` | Set by the Dockerfile and overridable in Compose. |
| `NODE_MAX_OLD_SPACE` | `384` | Docker **build arg** for the image (`docker build --build-arg NODE_MAX_OLD_SPACE=1024 …`). `scripts/tune-env.mjs` can suggest tuned values. |

</details>

---

## ⚠ Known limitations

Deliberate architectural choices, not bugs:

* **In-process poster JPEG cache** (RAM/disk, 32 MB default via `PICTORIUM_IMG_CACHE_MB`): never in Redis/KV, which holds only lightweight metadata and catalogs. Pushing JPEG binaries into KV would bloat RAM and saturate internal bandwidth.
* **Wikidata awards persistence** (7d fresh / 30d stale, disk or KV): successful lookups — including genuine empties, explicitly non-degraded — are additionally stored per title (`DATA_DIR/wikidata`, soft file cap ~2000 enforced by a throttled prune between scans, or KV with 30-day expiry when a backend is configured), so restarts and upstream outages serve recent data instead of refetching. Fresh records (≤7 days) repopulate the shared cache with their remaining lifetime (never extended); records up to 30 days old are served degraded on upstream failure, then ignored. Failures are never persisted; durable reads are bounded (250ms additional budget after a shared miss, upstream refresh capped at min(1500ms, 2250ms total stale deadline from request start) under the 2500ms poster race) and fail open.
* **MDBList raw ratings persistence** (24h default / 7d old movies, disk or KV): successful raw provider responses — keyed by IMDb ID plus API-key hash, never plaintext — are additionally stored (`DATA_DIR/mdblist-raw`, one JSON per identity, ≤2000 entries / ≤16MiB enforced per process by a write-triggered background prune, or the existing shared KV L2 envelope when a Redis/KV backend is configured), so restarts serve recent ratings without refetching. Disk records repopulate the in-memory cache with their remaining lifetime (never extended); misses, errors and aborted requests are never persisted; writes are fire-and-forget off the hot path with bounded concurrency (excess writes drop fail-open), reads are single-file async probes owned by the shared fetch operation (a slow read with no remaining callers never starts an upstream fetch), and all I/O is fail-open. Retention converges per process; concurrent writers can transiently exceed the caps until each process's next prune. Disk persistence requires explicitly configured durable storage (`PICTORIUM_DATA_DIR` set — always true in Docker via the entrypoint default `/data`); with the bare `./data` default or in KV mode the disk is never read, written or scanned.
* **JustWatch pagination**: the upstream GraphQL only pages via `$first` — the server overfetches (max 60) and slices locally. Deep `skip` may cost more than one upstream fetch.
* **Chromium-only visual E2E suite**: deterministic snapshots on a single browser; Firefox/WebKit intentionally out of scope.
* **HSTS at the reverse proxy**: the container does not force `Strict-Transport-Security` with preload (it would break LAN/Docker over HTTP). TLS+HSTS belong to Caddy / Cloudflare / Nginx — see the Caddy deploy above.
* **Limited warmup**: only 8 core catalogs are pre-warmed at boot (`WARMUP_CATALOG_IDS`). Warming everything would trigger TMDB 429s and push boot past liveness probes.
* **Hebrew RTL layout**: `he` is selectable as a UI language, but the layout does not apply right-to-left direction (`dir="ltr"` is fixed in `src/app/layout.tsx`): Hebrew strings are translated, while the page layout stays left-to-right. Label composition accounts for RTL strings (e.g. the season number sits *inside* the translated string, so each language decides where it goes), but the page is not mirrored.
* **App version in container artifacts**: `APP_VERSION` is automatic and counts commits from the `package.json` version, so it requires git history. The repo `Dockerfile` excludes `.git` from the build context: without the `APP_VERSION` build-arg the image reports the base `package.json` version. CI builds from tags pass the build-arg and report the release version.
