# Pictorium posters in AIOMetadata — setup guide

## 1. What this guide does (Pictorium art inside AIOMetadata)

This guide feeds your Pictorium space's posters into your **existing
AIOMetadata setup**: same catalogs, sources and order — only the artwork URLs
change. No server setup needed: you use a hosted Pictorium site, copy one
template link, paste it into AIOMetadata's Art Providers, then pick portrait
or landscape per catalog.

Version honesty first: these steps were verified against AIOMetadata's
current **dev-branch source** (checked Oct 2026). Your hosted AIO (e.g.
v3.2.3) may label, move, or lack a control — that is version drift, not user
error. Adapt to what you see; nothing here claims a control is guaranteed on
every live build.

## 2. Pick a host and create your personal space

Open one verified public Pictorium instance (also listed in the README):

- https://pictorium.duckdns.org (community VPS)
- https://pictorium.elfhosted.com/ (ElfHosted)

Create your **own personal space**: pick a password, receive a **recovery
key**, and save that key somewhere safe — it is shown only once. Bookmark
your space URL (placeholder, yours will differ):

```
https://<host>/u/<your-space-uuid>/configure
```

Always return through that bookmark so you edit *your* settings. Anyone with
your editor link plus password can open your editor, so never post the link,
passwords, or recovery keys publicly or in screenshots.

## 3. Add your TMDB key (free, 2 minutes)

Pictorium reads movie/series info from TMDB, so it needs your TMDB key. Sign
up free at `themoviedb.org`, open **Settings → API** there, and copy the
**API Key (v3 auth)**.

Back in your Pictorium space, open **Settings**, find **Your API keys**,
paste the key into **Personal TMDB Key**, save, and wait for the **Keys
saved.** confirmation (use **Verify key** where offered). If search later
says **Enter a TMDB key in Settings to search**, you are likely in the wrong
space or the key never saved — re-paste, save, re-test one poster. That key
powers your space only: never paste Pictorium's TMDB key into artwork URL
fields. If your AIO setup itself asks for its own metadata provider keys,
configure those independently inside AIO.

## 4. Set your style, then save one poster as a test

Style in two passes. First, global defaults: in your space open **Settings**,
pick the closest base (**Quick setups** / presets), tune badges, ratings,
ranking, logo, gradient and blur, then **Save as defaults** and wait for the
saved confirmation.

Optional but useful test: save one real title. Search it from your space
home, check the live WYSIWYG preview (what you see is what clients receive),
set its own **Poster shape** if needed, and press **Save Poster**. Confirm it
under **My Posters**. Your global defaults already render unsaved titles too,
so this save is a verification step, not a prerequisite — do it to prove the
pipeline works before touching AIO.

## 5. Copy your AIOMetadata link (Install Hub, Follow mode)

In your space press **Install Hub** (dialog titled **Connect Pictorium**).
Switch to the **AIOMetadata** tab — its hint reads like *"Paste this link in
AIOMetadata under Art Providers → Poster URL Pattern."* Copy the **Link for
AIO & Custom URL** field.

Check two things before leaving: the mode line says **Follow my space**
(*"Use saved changes without copying the link again"*), and the advanced
**Fixed settings in the link** box stays **off**. Keep the **ID** dropdown on
**Auto (recommended)** unless you know you need TMDB- or IMDb-only
placeholders. Your link is a placeholder template (yours will differ):

```
https://<host>/api/poster/{type}/{tmdb_id|imdb_id}?u=<your-space-uuid>&live=1
```

Keep whatever placeholder your copied link uses **exactly as-is** — Auto
copies carry `{tmdb_id|imdb_id}` (AIO fills the first non-empty id), while
TMDB-/IMDb-only copies carry `{tmdb_id}` / `{imdb_id}`. It normally carries
**no `shape`** — the server follows your space. Never share a link containing
a raw `api_key` value.

## 6. Open your EXISTING AIOMetadata config (do not start fresh)

Open your AIOMetadata **configure page for the setup you already use** —
the same config whose manifest your clients consume. Do not create a new
empty config: a fresh one has none of your catalogs, keys, or integrations,
and you would silently fork your setup.

In the configure sidebar open the **Art Providers** section (artwork sources
for posters, backgrounds, logos). Leave the **Art Sources** matrix alone for
now — provider switches there are optional taste, not required for this
guide. Scroll to **Art URL Overrides**: that card outranks the matrix, and
it is where your Pictorium link goes (see Section 7).

## 7. Paste into Poster URL Pattern (Custom Art URLs)

Inside **Art URL Overrides**, find the **Rating Poster Provider** selector.
If your build shows it, set it to **Custom Art URLs** so the manual pattern
fields stay editable. If your build has no such selector, skip that sentence
— go straight to the **URL Patterns** card.

Click into **Poster URL Pattern** and paste the full template you copied in
Section 5, placeholders intact (`{type}`, `{tmdb_id|imdb_id}` exactly as
copied, `u`, `live=1`). Do not "fix" the braces, do not swap in a real title
ID,
and do not append anything yet — landscape gets its own field (see Section 8).
Upstream rule worth knowing: overrides beat the Art Sources matrix, but they
apply to catalogs and detail pages, **not** to search results.

## 8. Robust portrait + landscape: two explicit overrides

For artwork you can trust in both orientations, use the **same** copied link
twice, adding one explicit shape each. If a `shape=...` already sits in the
link, **replace** it; keep everything else byte-identical (`u`, `live=1`,
all placeholders — including the `{tmdb_id|imdb_id}` alternation exactly as
copied):

- **Poster URL Pattern** → ends with `&shape=poster`
- **Landscape URL Pattern** → the same link ending with `&shape=landscape`

```
.../api/poster/{type}/{tmdb_id|imdb_id}?u=<your-space-uuid>&live=1&shape=poster
.../api/poster/{type}/{tmdb_id|imdb_id}?u=<your-space-uuid>&live=1&shape=landscape
```

Pictorium's endpoint supports both (`poster` = vertical canvas,
`landscape` = 16:9). Without an explicit Landscape pattern, a poster pattern
carrying `{shape}` also fills landscape — the fixed pair above avoids that
ambiguity entirely. Note: `shape` picks the **artwork** rendered, not the
client's card layout — some clients keep their own card shapes regardless.

## 9. Per-catalog shape: the gear dialog (Poster Shape)

Global patterns decide *which art exists*; each catalog decides *which shape
it asks for*. For one catalog:

1. On the AIO **Catalogs** page, open that catalog's **gear / settings
dialog**.
2. Find the **Poster Shape** dropdown and choose **Poster** or **Landscape**
(landscape falls back to that title's background when it has no landscape
art).
3. If the dialog also shows **Enable Rating Posters**, leave it on wherever
you want custom/rating art.
4. Press the dialog's **Save**, then repeat for each catalog (e.g. spotlight
rows landscape, library grids poster).

Dialog Save alone is **not** the finish: AIO still needs the final Save
Configuration (see Section 11).

## 10. Bulk shape: flip many catalogs at once

Tick the checkboxes of several catalogs on the Catalogs page and a bulk
action bar appears. To flip everything at once, first clear any search or
filter hiding catalogs, then use the select-all checkbox to tick all
catalogs. On desktop use **Landscape Shape** (and **Poster Shape** to
revert); on mobile the same actions are the short **Landscape** / **Poster**
buttons. One tap marks every selected catalog — far faster than opening each
gear dialog.

Two catches: bulk buttons only appear when relevant (e.g. **Landscape Shape**
shows while a selected catalog is still portrait), and like dialog Saves,
bulk edits are staged, not live. Nothing reaches clients until you do the
final **Save Configuration** (see Section 11) — do that once after all edits.

## 11. Save Configuration, then install the manifest

This is the step everyone skips. AIO's own dialogs warn that changes take
effect after saving in the **Configuration Manager** — so:

1. Open the **Configuration Manager**, press **Save Configuration** once,
after all pattern + shape edits, and wait for its confirmation.
2. Press **Install**, then **Open in Stremio** (Desktop or Web) or copy the
manifest URL into a supported client and confirm the install.
3. Re-open the affected views and check one catalog you set to Poster and
one you set to Landscape.

No automatic-update promise: clients pick up the saved config through this
install/update, so repeat it wherever you watch. Shape logic: each AIO
catalog selects which art it requests, and an explicit `&shape=` in the
pattern URL takes precedence over your Pictorium default — your global
**Format to edit** switch is only the editing target in your space, so no
per-title/global matching is required.

## 12. Checks, caching, and privacy

Checks: a known saved title shows your Pictorium art; portrait art renders
vertical, landscape art renders wide — then check the artwork inside your
client, since each client's own card layout decides the final row look.
Give it a minute and re-request the view before re-saving anything.

Caching caveat: edits apply to future requests, but AIO/proxy/client caches
mean changes are **not instant**. Follow links (`live=1`) revalidate per
request, yet copies already cached elsewhere refresh on that client's
schedule — patience, not repeated saves.

Privacy: `u=` is your space's public image namespace, not an auth
credential — `u` alone is no password or key. Even so, your full
personal-config link is sensitive: never post it, keys, or passwords
publicly.

## 12.1 Saved covers not appearing on AIOMetadata (cache identity)

Symptom: you save a poster mapping in Pictorium, but AIOMetadata (and the
Stremio client behind it) keeps showing the old art.

Why (verified): AIOMetadata resolves your pasted **Poster URL Pattern** by
substituting only its own placeholders — `{type}`, `{tmdb_id}`, `{imdb_id}`,
`{shape}`, `{season}`, `{episode}`, `{blur}`, `{thumbnail}`. There is no
placeholder for a per-title mapping version, so the resolved URL is
**byte-identical before and after a Pictorium save**. Pictorium's own
catalog/meta URLs bust caches via the `mv` (mapping.updatedAt) parameter,
but a static AIO pattern cannot carry `mv`, so both AIOMetadata's meta
cache and the downstream Stremio client cache serve the stale bytes until
their TTL expires or the URL changes. This is a limitation of AIO's static
pattern model, not a Pictorium bug: no random nonce is added (URL stability
for unchanged titles is preserved by design).

Verified steps to make a saved cover appear on AIOMetadata:

1. In Pictorium, press **Save Poster** on the title (this bumps
   `mapping.updatedAt`, which drives `mv` on the Stremio/catalog path and
   invalidates Pictorium's own cache).
2. In AIOMetadata, open **Configuration Manager** and press
   **Save Configuration** once (Section 11) so the meta cache is rebuilt.
3. Reinstall the manifest / reopen the affected views in your client
   (Section 11, step 2).
4. If the old art still shows, clear the Stremio client image cache or wait
   for its TTL: mapped posters are cached up to 24 h server-side and client
   caches follow their own schedule. Follow links (`live=1`) revalidate per
   request, but already-cached copies refresh on the client's schedule.
5. To **verify immediately** that the saved cover renders, use Pictorium's
   **Testa URL Stremio** (or open the poster URL from **My Posters**): that
   path embeds `mv` and shows the saved cover at once, proving the save
   landed. If it shows there but not in AIO, the stale copy is in AIO/client
   cache, not in Pictorium.

Do **not** edit the pattern to add `mv` or a nonce: AIO does not substitute
them and the URL would stop resolving.

## 13. Optional: episode thumbnails (Episode Thumbnail URL Pattern)

Posters do not need this. Stremio shows episode stills in season lists and
Continue Watching, and AIO exposes a separate **Episode Thumbnail URL
Pattern** for them; Pictorium serves a 16:9 composite of the still plus the
episode rating pill. Leave the field empty if you only want posters.

In **Art URL Overrides → URL Patterns**, fill **Episode Thumbnail URL
Pattern** with (replace `<host>`; on a localhost instance whose key is stored
in the browser, also append the same `api_key=...` the poster pattern carries —
see the status table below):

```
https://<host>/api/thumbnail/tv/{tmdb_id}/season/{season}/episode/{episode}?still={thumbnail}&w=320&badges=both&blur={blur}
```

- `{tmdb_id}`, `{season}`, `{episode}` are required. `{thumbnail}` is AIO's
  still URL (TMDB, or TheTVDB artwork when that metadata provider is selected);
  `{blur}` expands to `true`/`false` from AIO's **Blur Thumbnails** switch.
- Keep `{thumbnail}` **as-is**: AIO already URL-encodes it, so the `still=`
  value is the complete still URL. For TMDB only the file name is used — the
  server applies its own source size, so the URL and the bare `/abc.jpg` path
  are the same image and cache entry. A complete
  `https://artworks.thetvdb.com/...` raster URL is fetched directly (public
  artwork, no TVDB API key/lookup) and keeps its own cache entry.
- `w=320` is the thumbnail width (`160`/`320`/`480`/`640`/`768`/`1280`);
  `badges=both` draws the episode rating and custom-rating pills.
- The **Miniature** style/corner/scale/blur/source choices saved in Pictorium
  apply automatically to the `u=` space when the pattern omits them (explicit
  query params always win), so changing the style does not require editing the
  AIO pattern.
- Only `https://image.tmdb.org/t/p/<size>/<file>.jpg|jpeg|png` and
  `https://artworks.thetvdb.com/<raster path>.jpg|jpeg|png|webp` are accepted
  (no `http`, other hosts, query/fragment, `.svg`): those requests answer `400`
  instead of fetching anything.
- An episode with no TMDB still passes an empty `{thumbnail}`; the server
  auto-resolves the episode's first TMDB still (200, same bytes as the
  explicit path), and answers `400` only when TMDB has no still at all for that
  episode — those rows then keep the client's own placeholder.
- Like posters, the image is cached for 30 minutes with an ETag — Save
  Configuration once (Section 11) after adding the pattern.

**If every thumbnail fails**, the response body names the failing leg. Do not
diagnose a `502` as "the CDN is blocked" before reading it:

| Response | Meaning | What to do |
|---|---|---|
| `400` `Invalid still: expected a TMDB still path/URL or a TVDB still URL` | `{thumbnail}` is not a trusted image value: AIO's own `<aio-host>/missing_thumbnail.png`, another host, `.svg`, query/fragment, nested TMDB path. Rejected **before any fetch**, by design. | Fix the pattern value: only `https://image.tmdb.org/t/p/<size>/<file>.jpg`, the bare `/abc.jpg` path, or `https://artworks.thetvdb.com/<raster path>` are accepted. |
| `400` `No TMDB still for this episode` | `{thumbnail}` was empty and TMDB has no still for the episode (or the episode-images lookup failed), so there is no base image. | Keep the client placeholder; add/refresh stills on TMDB (AIO TMDB metadata) for that episode. Nothing to fix in Pictorium. |
| `502` `TMDB episode details unavailable` | The **rating** leg could not resolve the episode vote because the request has no usable TMDB key. The still was never the problem. | Append the same `api_key=...` the poster pattern carries (or save the TMDB key server-side). The Install Hub thumbnail pattern already inherits `u`/`api_key` from the poster template. |
| `502` `Episode still unavailable` | The still was accepted but TMDB's image CDN did not serve it (404/transport). | Transient upstream issue, not a configuration problem: retry after Save Configuration and re-check the episode's still on TMDB. |

## 14. Quick fixes and sibling guide

Wrong art after a save → see Section 12.1 (cache identity). Wrong art (first time) → confirm you edited the bookmarked space and pressed **Save
Poster** (Section 4). Pattern dead → re-copy from Install Hub and check
braces/placeholders (Sections 5–8). Search rows unchanged → expected:
overrides skip search results (Section 7). Shape ignored → confirm the
explicit `&shape=` override (Section 8, which takes precedence over your
Pictorium default) and the catalog's Poster Shape (Sections 9–10), then
re-did **Save Configuration** (Section 11).

Sibling guide: the plain Stremio-addon setup lives in this repo's `docs/`
folder (`discord-stremio-addon-guide.md`) — use it when you want Pictorium as
its own Stremio addon instead of art inside AIOMetadata.

## Appendix — sources

- Pictorium [README.md](../README.md): personal spaces (`/u/<uuid>/configure`), TMDB key setup, **Follow my space** template (`live=1`) for Nuvio/AIOMetadata, and the live revalidation policy (clients pick up new renders on re-request; cached copies refresh on the client's schedule).
- Pictorium [`src/components/InstallModal.tsx`](../src/components/InstallModal.tsx): **Connect Pictorium** dialog, **AIOMetadata** tab hint (*Art Providers → Poster URL Pattern*), **Link for AIO & Custom URL** field, **Follow my space** vs **Fixed settings in the link**, **Auto (recommended)** / TMDB / IMDb ID selector. AIO template carries no shape placeholder (unlike the Nuvio `shape={shape}` variant).
- Pictorium [`src/lib/poster-config.ts`](../src/lib/poster-config.ts) (`resolvePosterShape`): local endpoint honors `shape=poster` (portrait canvas; `square` also maps to portrait) and `shape=landscape` (16:9).
- Pictorium [`docs/INTEGRATION.md`](./INTEGRATION.md): `{tmdb_id|imdb_id}` auto alternation (first non-empty wins) for AIO/custom-URL consumers.
- AIOMetadata dev-branch source (verified Oct 2026; live-build parity NOT verified, e.g. hosted v3.2.3) — [repo](https://github.com/cedya77/aiometadata/tree/dev):
  - [`configure/src/components/sections/ArtProviderSettings.tsx`](https://github.com/cedya77/aiometadata/blob/dev/configure/src/components/sections/ArtProviderSettings.tsx): **Art Providers** matrix, **Art URL Overrides** with **Rating Poster Provider** (`Custom Art URLs` option), **URL Patterns** card (**Poster / Background / Landscape / Logo / Episode Thumbnail URL Pattern**), **Proxy Rating & Custom Art** switch, `{shape}` docs (*poster-pattern `{shape}` also fills landscape unless a Landscape pattern is set*), overrides-priority + search-results callouts.
  - [`addon/lib/metaArt.ts`](https://github.com/cedya77/aiometadata/blob/dev/addon/lib/metaArt.ts): **Episode Thumbnail URL Pattern** substitution — `{season}`/`{episode}` from the video id, `{blur}` = `true`/`false`, `{thumbnail}` = `encodeURIComponent(originalThumb)`, so the pattern receives the complete encoded TMDB still URL.
  - [`configure/src/components/sections/CatalogsSettings.tsx`](https://github.com/cedya77/aiometadata/blob/dev/configure/src/components/sections/CatalogsSettings.tsx): per-catalog gear dialogs with **Poster Shape** (**Poster** / **Landscape**) + dialog **Save**; dialogs note changes take effect after saving in the Configuration Manager; landscape falls back to background art.
  - [`configure/src/components/BulkActionBar.tsx`](https://github.com/cedya77/aiometadata/blob/dev/configure/src/components/BulkActionBar.tsx): bulk **Landscape Shape** / **Poster Shape** (desktop) and **Landscape** / **Poster** (mobile) actions for selected catalogs.
