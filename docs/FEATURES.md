# Pictorium — Features in detail

[← Back to README](../README.md) · [🇮🇹 Italiano](FEATURES.it.md)

## 🛠 Features in detail

<details>
<summary><strong>🖼️ Posters, logos & graphics</strong></summary>

* **Clean poster selection**: pick textless posters from official TMDB candidates (`iso_639_1 === null`) in one click.
* **Custom poster import**: import artwork from a direct URL, Pinterest, Imgur, Reddit or Postimages with live preview, tile management and persistence.
* **Smart best-fit algorithm**: analyzes brightness and empty space to scale and position logos without covering faces.
* **Cinematic background blur (Sharp C++)**: progressive intensity toward the base, same-hue scene tint, quadratic darkening and anti-seam, in a few ms with minimal RAM.
* **24h auto-rotation**: rotates through multiple saved clean posters daily for the same title.
* **Official network logos**: automatic detection and embedding for Netflix, Prime Video, Disney+, Apple TV+, HBO Max, Paramount+, Sky/NOW, Crunchyroll, Rai, Mediaset and 30+ studios (Marvel, Pixar, Ghibli, Warner Bros, A24).

</details>

<details>
<summary><strong>🏷️ Badges, ratings & accolades</strong></summary>

* **✨ Streaming quality (4K / FHD / HD / SD)**: detected live from Stremio video streams, with automatic fallback to JustWatch. Optional quality badge packs: see [docs/quality-badge-packs.md](quality-badge-packs.md).
* **8 genre & rating badge styles**: *Shadow, Pill, Bar, Color, Border, Glass, Minimal, Ink* (`Genre | Rating | Year`), with an adaptive palette matching the poster. Env/URL keys: `shadow`, `pill`, `bar`, `colored`, `bordo` (Border), `vetro` (Glass), `minimal`, `ink`.
* **Vertical Netflix Top 10 ribbon**: the iconic red side ribbon with live rank position (dedicated support for anime series).
* **Film awards & accolades**: automatic recognition of Oscars, Cannes, BAFTA, Emmy, and the *"Absolute Cinema"* badge for IMDb Top 250 titles.
* **Always-in-sync charts**: Top 10/20 badges track live charts; if a title leaves the ranking, its badge updates automatically.
* **✨ Pre-Digital Effect (Coming Soon)**: for movies out in theaters but not yet streaming (detected via JustWatch/TMDB): darkened poster with a red "Coming Soon" corner ribbon. It is a per-request URL flag (`pre=1`) or a library-wide default, not a per-title saved field.
* **🔌 Custom rating provider**: display external ratings from any HTTP(S) API (via IMDb ID) with dedicated pills. See [docs/custom-rating.md](custom-rating.md).

</details>

<details>
<summary><strong>📺 Seasons, episodes & anime</strong></summary>

* **✨ Smart parts detection**: automatically detects split-part series like *Money Heist* (5 parts) or *Lupin* (4 parts).
* **🌀 Anime season unpacking**: fixes TMDB's compression of multi-season anime into a single season, restoring official seasons (S1, S2, S3, S4 + Specials in S0).
* **TVDB & AniZip support**: manually select alternate ordering from TheTVDB (*Aired, DVD, Absolute, Alternate*) or AniZip (*AniList / AniDB*).
* **Live episode preview**: see exactly how seasons, episode titles and thumbnails will appear on Stremio before saving.

</details>

<details>
<summary><strong>🗂️ Library, automation & backups</strong></summary>

* **Batch poster management**: multi-select saved posters in "My Posters" for batch deletions and a tidy collection.
* **Full space backup & restore**: one-click export and import of your entire space configuration, saved posters, custom presets and preferences.
* **Nuvio & AIOMetadata auto URL**: dedicated poster template URLs for external catalog managers with automatic TMDB ID resolution. User spaces default to **Follow my space**: copy the template once and saved changes apply without replacing the link. **Fixed settings in the link** stays available under advanced options, and existing templates keep their explicit overrides. The automatic Nuvio variant still lets the client choose the image shape, and also covers anime catalogs (`kitsu:`, `anilist:`, `mal:`, `anidb:`, `tvdb:` IDs mapped to TMDB).
  Follow links (`live=1`) require HTTP revalidation and reuse fresh internal renders. AIOMetadata and other image proxies must honor that policy; refresh any previously cached image using the controls available in your installed version. New headers cannot purge existing external copies, and an already displayed poster updates only when the client requests it again. Live rankings and other upstream data retain their internal refresh schedules. Endpoint details: [docs/INTEGRATION.md](INTEGRATION.md).

</details>

<details>
<summary><strong>🔒 Security: PIN & multi-user spaces</strong></summary>

#### PIN lock (single / personal instances)
* **Lock on launch & refresh**: password prompt on app launch and page reload (F5) protects your settings and saved posters.
* **Quick setup**: configure your PIN during step 3 of the setup wizard, or anytime in Settings.
* **Zero Stremio impact**: the PIN protects only the web editor; Stremio endpoints (`/manifest.json`, `/api/poster/*`, `/catalog/*`) remain open and functional.
* **Rotation**: when a PIN is set using an admin token, rotating `PICTORIUM_ADMIN_TOKEN` automatically invalidates it (cryptographic binding against persistence). After rotating the token, set a new PIN if desired.

#### Multi-user spaces (public / shared instances)
With `PICTORIUM_MULTI_USER=1`, multiple users share one server with complete isolation:
* **Personal space via UUID**: each user has a `/u/<uuid>/configure` URL with separate mappings, preferences and API keys (TMDB, MDBList, TVDB, Simkl, Fanart.tv).
* **Encrypted at rest**: user API keys are stored encrypted on disk using AES-256-GCM via `PROFILE_ENCRYPTION_KEY`.
* **Authentication & recovery**:
  * **Session password**: required on each visit to unlock the editor (never stored permanently in the browser).
  * **Recovery key (secret)**: shown once at account creation — save it now. It stays valid to recover access or rotate credentials until you rotate it.
* **Anti-brute-force protection**: automatic rate limiting on incorrect password attempts.

</details>

> 📢 To report vulnerabilities privately (never via public issues), see [SECURITY.md](../SECURITY.md).
