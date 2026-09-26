---
title: Pictorium
emoji: 🖼️
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 8080
pinned: false
---

<p align="center">
  <img src="public/pictorium.png" alt="Pictorium" width="380" />
</p>

<h3 align="center">Dynamic Movie & TV Poster Generator for Stremio & Media Centers</h3>

<p align="center">
  <a href="README.md"><b>🇮🇹 Leggi in Italiano</b></a> • <a href="README.en.md"><b>🇬🇧 Read in English</b></a>
</p>

<p align="center">
  Textless clean posters, high-definition vector logos, IMDb/TMDB/Rotten Tomatoes ratings, 4K streaming quality badges, live Netflix Top 10 ribbons, and smart season splitting. All rendered on the fly with Sharp C++ & SVG.
</p>

<p align="center">
  <a href="https://discord.gg/sYfWyXYVUp"><img src="https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord Community" /></a>
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FEful97%2FPictorium"><img src="https://vercel.com/button" alt="Deploy with Vercel" /></a>
  <a href="#-docker--compose"><img src="https://img.shields.io/badge/Docker-Supported-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" /></a>
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js&logoColor=white" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22-green?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square" alt="License AGPLv3" />
  <a href="https://github.com/Eful97/Pictorium/actions/workflows/ci.yml"><img src="https://github.com/Eful97/Pictorium/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
</p>

> [!TIP]
> 🚀 **Try the [public instance](https://pictorium.duckdns.org)**: create your personal space with your free TMDB key.  
> 💬 **Join the community on [Discord](https://discord.gg/sYfWyXYVUp)** for support, updates, bug reports, and feature requests.  
> ☕ Support the project on [Ko-fi](https://ko-fi.com/eful97) to help keep the public VPS running.

---

## 📸 Preview

<div align="center">
  <img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/home.png" alt="Pictorium Home" width="100%" style="border-radius: 8px; margin-bottom: 8px;" />
</div>

<table align="center" width="100%">
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/editor.png" alt="Pictorium Editor" style="border-radius: 6px;" /></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/myposters.png" alt="Pictorium My Posters" style="border-radius: 6px;" /></td>
  </tr>
  <tr>
    <td align="center"><em>WYSIWYG Editor & Live Preview</em></td>
    <td align="center"><em>My Posters & Personal Library</em></td>
  </tr>
  <tr>
    <td colspan="2"><img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/catalogs.png" alt="Pictorium Catalogs" style="border-radius: 6px; margin-top: 8px;" /></td>
  </tr>
  <tr>
    <td align="center" colspan="2"><em>Dynamic Catalogs & JustWatch Streaming Charts</em></td>
  </tr>
</table>

<div align="center" style="margin-top: 12px;">
  <img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/1405.jpg" alt="Poster Demo — Dexter" width="31%" style="border-radius: 6px; margin: 1%;" />
  <img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/155.jpg" alt="Poster Demo — The Dark Knight" width="31%" style="border-radius: 6px; margin: 1%;" />
  <img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/66732.jpg" alt="Poster Demo — Stranger Things" width="31%" style="border-radius: 6px; margin: 1%;" />
</div>

<div align="center" style="margin-top: 8px;">
  <img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/1368337.jpg" alt="Pre-Digital Effect — Coming Soon" width="31%" style="border-radius: 6px;" />
  <br />
  <em>Pre-Digital Effect: dark veil + "Coming Soon" ribbon on movies not yet streaming</em>
</div>

---

## ⚡ Key Features

| Feature | Description |
|---|---|
| 🎯 **WYSIWYG Graphics Engine** | A single endpoint (`/api/poster/{type}/{id}`) powered by Sharp C++ and SVG serves both the real-time web preview and the final poster on Stremio with pixel-perfect sync. |
| 📦 **100% Standalone Addon** | Directly delivers rich metadata cards, multilingual synopses, transparent logos, 4K backdrops, YouTube trailers, and full seasons with thumbnails and translated episodes to Stremio. |
| 📺 **Smart Parts & Anime Splitting** | Automatically detects **Original Parts** (*Money Heist*, *Lupin*) and splits giant single-season anime entries on TMDB (*Re:ZERO*, *Jujutsu Kaisen*) into their true release seasons. |
| 🏷️ **Quality Badges & Ratings** | Real-time video resolution detection (4K/FHD/HD), aggregated ratings from over 16 sources (IMDb, TMDB, Rotten Tomatoes, Letterboxd, MAL), Academy/Cannes awards, and Netflix Top 10 ribbons. |
| 🌐 **Custom Catalogs** | Import watchlists and custom lists from **Letterboxd, Trakt, TMDb, TheTVDB, MDBList**, along with real-time trending charts via JustWatch GraphQL. |
| 🌍 **Dynamic Multilingual UI** | Fully localized interface in 10 languages with instant real-time language switching without page refresh. |
| 🔒 **PIN Protection & User Spaces** | PIN code lock protection for single instances, or full multi-user support with isolated spaces and AES-256-GCM encryption. Stremio manifests and posters remain permanently functional. |
| ⚡ **Zero Cache Conflicts** | Deterministic versioning with automated `RENDER_VERSION` and `APP_VERSION`. Change any styling parameter and Stremio updates cached images immediately. |

---

## 🛠️ Detailed Features

### 🖼️ Posters, Logos & Graphics
* **Clean Poster Selection**: Select textless posters with one click from official TMDB candidates (`iso_639_1 === null`).
* **Smart Best-Fit Algorithm**: Analyzes brightness and empty space to automatically scale and position logos without obscuring faces.
* **Cinematic Background Blur (Sharp C++)**: Progressive intensity toward the base with same-hue scene tint, quadratic darkening and anti-seam, in a few ms with minimal RAM usage.
* **24h Auto-Rotation**: Automatically rotates through multiple saved clean posters daily for the same title.
* **Official Network Logos**: Automatic detection and embedding for Netflix, Prime Video, Disney+, Apple TV+, HBO Max, Paramount+, Sky/NOW, Crunchyroll, Rai, Mediaset and 30+ studios (Marvel, Pixar, Ghibli, Warner Bros, A24).

### 🏷️ Badges, Ratings & Accolades
* **✨ Streaming Quality (4K / FHD / HD / SD)**: Detected live from Stremio video streams with automatic fallback to JustWatch.
* **7 Genre & Rating Badge Styles**: *Shadow, Pill, Bar, Colored, Border, Glass, Minimal* (`Genre | Rating | Year`) with adaptive palette matching the poster.
* **Vertical Netflix Top 10 Ribbon**: The iconic red side ribbon with live rank position (dedicated support for Anime series).
* **Film Awards & Accolades**: Automatic recognition of Oscars, Cannes, BAFTA, Emmy, and the *"Absolute Cinema"* badge for IMDb Top 250 titles.
* **Always-in-Sync Charts**: Top 10/20 badges track live charts; if a title leaves the ranking, its badge updates automatically.
* **✨ Pre-Digital Effect (Coming Soon)**: For movies out in theaters but not yet streaming (detected via JustWatch/TMDB): darkened poster with a red "Coming Soon" corner ribbon.
* **🔌 Custom Rating Provider**: Display external ratings from any HTTP(S) API (via IMDb ID) with dedicated pills. See [docs/custom-rating.md](docs/custom-rating.md).

### 📺 Seasons, Episodes & Anime
* **✨ Smart Parts Detection**: Automatically detects split-part series like *Money Heist* (5 parts) or *Lupin* (4 parts).
* **🌀 Anime Season Unpacking**: Fixes TMDB's compression of multi-season anime into a single season, restoring official seasons (S1, S2, S3, S4 + Specials in S0).
* **TVDB & AniZip Support**: Manually select alternate ordering from TheTVDB (*Aired, DVD, Absolute, Alternate*) or AniZip (*AniList / AniDB*).
* **Live Episode Preview**: See exactly how seasons, episode titles, and thumbnails will appear on Stremio before saving.

### 🔒 Security: PIN & Multi-User Spaces

#### PIN Lock (Single / Personal Instances)
* **Lock on Launch & Refresh**: Password prompt appears on app launch and page reload (F5) to protect your settings and saved posters.
* **Quick Setup**: Configure your PIN code in seconds during Step 3 of the setup wizard, or manage it anytime in Settings.
* **Zero Stremio Impact**: PIN only protects the web editor; Stremio endpoints (`/manifest.json`, `/api/poster/*`, `/catalog/*`) remain open and functional.
* **Rotation**: when a PIN is set using an admin token, rotating `PICTORIUM_ADMIN_TOKEN` automatically invalidates it (cryptographic binding against persistence). After rotating the token, simply set a new PIN if desired.

#### Multi-User Spaces (Public / Shared Instances)
When `PICTORIUM_MULTI_USER=1` is enabled, multiple users can share a single server with complete isolation:
* **Personal Space via UUID**: Each user has their own URL (`/u/<uuid>/configure`) with separate mappings, preferences, and TMDB keys.
* **Encrypted at Rest**: User API keys are stored encrypted on disk using AES-256-GCM via `PROFILE_ENCRYPTION_KEY`.
* **Authentication & Recovery**:
  * **Session Password**: Required on each visit to unlock the editor (never stored permanently in the browser).
  * **Recovery Key (Secret)**: Single-use code shown upon account creation to recover access or rotate credentials.
* **Anti-Brute-Force Protection**: Automatic rate limiting on incorrect password attempts to prevent attacks.

---

## 🚀 Quick Deploy

| Platform | Cost | Type | Persistence | Best For |
|---|---|---|---|---|
| [▲ **Vercel**](#-vercel-recommended) | **Free** | Serverless | Upstash Redis (KV) | **Recommended**: 1-click, zero maintenance, global CDN ([📺 Video Guide](https://www.youtube.com/watch?v=FP6VJ2vGYiY)) |
| [🐳 **Docker Compose**](#-docker--compose) | **Free** | Container | Local Volume (`/data`) | NAS, Home Server, mini-PC (Unraid, TrueNAS, CasaOS) |
| [🤗 **Hugging Face**](#-other-installation-methods) | **Free** | Docker (16GB RAM) | Storage Bucket | Great free RAM for shared instances |
| [🦾 **Oracle Cloud**](#-other-installation-methods) | **Free** | VPS ARM (24GB RAM) | Local Disk | Dedicated free always-on cloud server |

---

### ▲ Vercel (Recommended)

[![YouTube Video Guide](https://img.shields.io/badge/YouTube-Setup_Video_Guide-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=FP6VJ2vGYiY)

> 📺 **Video Tutorial**: Follow the [step-by-step YouTube guide](https://www.youtube.com/watch?v=FP6VJ2vGYiY) to complete setup in under 2 minutes.

1. **Get your free TMDB API Key**:
   * Sign up at [themoviedb.org](https://www.themoviedb.org/signup) and head to **Settings → API**.
   * Copy the **API Key (v3 auth)** (32-character string).
2. **Fork the repository**:
   * Click **Fork** at the top right of [github.com/Eful97/Pictorium](https://github.com/Eful97/Pictorium).
3. **Import to Vercel**:
   * Sign in to [vercel.com](https://vercel.com) and click **Add New… → Project**.
   * Import your Pictorium fork and configure Environment Variables:
     * `PICTORIUM_TMDB_KEY` = *your TMDB v3 key*
     * `PICTORIUM_PUBLIC_INSTANCE` = `1`
   * Click **Deploy**.
4. **Connect Upstash Redis Database (Free)**:
   * Once deployed, open the project dashboard on Vercel.
   * Go to **Storage → Connect Store → Upstash (Redis)** and click Create & Connect.
5. **Redeploy**:
   * Under the **Deployments** tab, click the three dots (**⋯**) on the latest deployment and select **Redeploy**.
6. **Install on Stremio**:
   * Open your instance URL (e.g. `https://your-pictorium.vercel.app`), complete the initial setup wizard, and click **Install to Stremio**!

> **Future Updates**: To update your instance, simply open your GitHub fork and click **Sync fork → Update branch**. Vercel will automatically redeploy in 60 seconds while preserving your database and settings.

---

### 🐳 Docker & Compose

Use the `docker-compose.yml` already included in the repo (hardening, healthcheck and persistent `posterium-data` volume preconfigured) — no need to write one by hand:

```bash
git clone https://github.com/Eful97/Pictorium && cd Pictorium
cp .env.example .env
```

Fill in at least `PICTORIUM_TMDB_KEY` and `PICTORIUM_ADMIN_TOKEN` (a long secret of your choice) in `.env`, then:

```bash
docker compose up -d
```

> The first start builds the image locally (a few minutes, longer on ARM). To start immediately with the prebuilt image: `docker compose pull pictorium && docker compose up -d --no-build`. Admin routes are closed by default: paste the token in **Settings → Admin token** (session only) to use warmup, cache and saves from the UI. Only on a trusted LAN you may use `PICTORIUM_PUBLIC_INSTANCE=1` instead of the token.
>
> If you came from the old example with a `pictorium-data` volume and already have saves, copy them before switching to the repo compose: `docker run --rm -v pictorium-data:/from -v posterium-data:/to alpine cp -a /from/. /to/`

Your instance and Stremio manifest will be accessible at `http://<SERVER-IP>:8080`.

---

<details>
<summary><strong>👉 Other installation methods (Hugging Face, Oracle Cloud, VPS Caddy, Termux)</strong></summary>

#### 🤗 Hugging Face Spaces
1. Create a Space on Hugging Face using the **Docker** SDK pointing to `Eful97/Pictorium`.
2. Under **Settings → Variables and secrets**:
   * `NODE_OPTIONS` = `--max-old-space-size=1024`
   * `PICTORIUM_PUBLIC_INSTANCE` = `1`
   * `PICTORIUM_TMDB_KEY` = *your TMDB key*
3. Under **Settings → Storage**, attach a Storage Bucket mounted to `/data`.

#### 🦾 Oracle Cloud Always Free (ARM Ampere)
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
git clone https://github.com/Eful97/Pictorium && cd Pictorium
cp .env.example .env
```
Fill in `PICTORIUM_TMDB_KEY` and `PICTORIUM_ADMIN_TOKEN` in `.env`, then `sudo docker compose up -d` (uses the repo compose). Then paste the token in **Settings → Admin token** (session only). On an exposed instance do not use `PICTORIUM_PUBLIC_INSTANCE=1`.

#### 🖥️ VPS + Caddy (Automatic HTTPS)
```caddyfile
yourdomain.com {
    reverse_proxy pictorium:8080
}
```
On a public domain protect the editor with `PICTORIUM_ADMIN_TOKEN` (unlock in Settings → Admin token), not with `PICTORIUM_PUBLIC_INSTANCE=1`.

#### 📱 Termux (Android)
```bash
pkg update && pkg install nodejs git -y
git clone https://github.com/Eful97/Pictorium && cd Pictorium
npm install --ignore-scripts && npm run build && npm start
```
</details>

---

## 🔑 Environment Variables

### Core Variables

| Variable | Default | Description |
|---|:---:|---|
| `PICTORIUM_PUBLIC_INSTANCE` | `0` | Set `1` to leave admin routes open without a token (trusted LAN, public demos). On exposed instances keep `0` and use the token below. |
| `PICTORIUM_ADMIN_TOKEN` | *(optional)* | Secret for private instances (`PUBLIC_INSTANCE=0`): paste it in Settings → Admin token (session only, dies with the tab) to enable warmup, cache clear and saves from the UI. |
| `PICTORIUM_TMDB_KEY` | *(optional)* | Server-side TMDB API key to render posters and catalogs without client keys. |
| `PICTORIUM_TVDB_API_KEY` | *(optional)* | TheTVDB key for alternate season ordering and episode descriptions. |
| `PICTORIUM_MDBLIST_KEY` | *(optional)* | MDBList key for custom lists and anime catalogs. |
| `PICTORIUM_REGION` | `IT` | Default country for streaming charts and availability (`IT`, `US`, `GB`, `FR`, `DE`, `ES`, etc.). |
| `PICTORIUM_DATA_DIR` | `./data` | Directory path for persisting settings and saved posters on disk. In Docker it must point at a persistent volume (`/data`, `posterium-data` volume, writable by uid 1000): the data file is created on first save, so "not found" with 0 posters on a fresh install is normal. |
| `PICTORIUM_REDIS_URL` | *(empty)* | Native Redis (TCP) for multi-replica HA without a `/data` volume: mappings, defaults, profiles, epochs and rate limits become shared across replicas. Wins over `KV_REST_*` when both are set (no automatic migration). On ElfHosted/K8s plain `REDIS_URL` is enough (read as fallback). |
| `KV_REST_API_URL` / `TOKEN` | *(empty)* | Upstash Redis credentials for Vercel serverless deployments. |
| `PICTORIUM_HOSTED_BY` | *(empty)* | Public hosting sponsor: `elfhosted` shows the ElfHosted banner on the home page (auto-detected from an `elfhosted.com` host as fallback). Empty = no banner. |
| `PICTORIUM_POSTER_PARAMS` | *(auto)* | Poster cache-busting hardening: `presets` restricts non-preview requests to a finite render set (cache-key allowlist, coarse 5/10/5px numeric steps, palette-only `ac`, no anonymous free-text/keyless overrides), `free` is the historic behavior. Auto-`presets` on public instances (`PUBLIC_INSTANCE=1`, `HOSTED_BY=elfhosted` or `MULTI_USER=1`); the WYSIWYG preview stays live for user spaces and unlocked sessions. |
| `PICTORIUM_PREVIEW_AUTH` | *(auto)* | Preview hardening: on public instances anonymous previews (`preview=1` without a space or session) are downgraded and cached like normal requests (no bot bypass). Existing user spaces and unlocked sessions stay live. Auto-on on public instances (`PUBLIC_INSTANCE=1`, `HOSTED_BY=elfhosted`, `MULTI_USER=1`); `0` forces OFF, `1` forces ON. |
| `PICTORIUM_FRAME_ANCESTORS` | *(HF default)* | Overrides the CSP `frame-ancestors` (default is HF Spaces compatible). E.g. `'self'` for public instances that should never be embedded. |

### Multi-User Mode

| Variable | Default | Description |
|---|:---:|---|
| `PICTORIUM_MULTI_USER` | `0` | Set `1` to enable isolated user spaces on `/u/<uuid>/configure`. |
| `PROFILE_ENCRYPTION_KEY` | *(empty)* | **Required** when `MULTI_USER=1`. 64-character hex key (AES-256-GCM, generate via `openssl rand -hex 32`). |
| `PICTORIUM_MAX_MAPPINGS_PER_USER` | `500` | Maximum number of saved posters allowed per user space. |
| `PICTORIUM_MAX_USERS` | *(unlimited)* | Maximum number of user spaces that can be created. |
| `PICTORIUM_PUBLIC_STATS` | `1` | Set `0` to return user counts from `/api/status` only to admins (the home "spaces" strip is then hidden for visitors). |

<details>
<summary><strong>⚙️ Advanced Variables, Default Styles & Performance Pipeline</strong></summary>

### Catalog Render Styles
| Variable | Default | Description |
|---|:---:|---|
| `PICTORIUM_BADGE_STYLE` | `shadow` | Genre & rating badge style (`shadow`, `pill`, `bar`, `colored`, `bordo`, `vetro`). |
| `PICTORIUM_RANKING_BADGE_STYLE` | `default` | Ranking badge style (`default`, `bar`, `colored`, `pill`, `netflix`). |
| `PICTORIUM_RIBBON_SIDE` | `left` | Netflix Top 10 ribbon side (`left` / `right`). |
| `PICTORIUM_BLUR_ENABLED` | `1` | Enable or disable cinematic background blur. |
| `PICTORIUM_TINT_STRENGTH` | `20` | Scene tint strength for background blur (0–100). |
| `PICTORIUM_BADGE_QUALITY` | `1` | Show or hide video streaming resolution badges (4K/FHD). |
| `PICTORIUM_QUALITY_SOURCE` | `torrentio` | Streaming quality source: `torrentio` (with JustWatch fallback), `justwatch` (JW only), `none` (badge never shown, zero upstream). |
| `PICTORIUM_NETWORK_LOGO` | `1` | Show or hide production network/studio logos. |
| `PICTORIUM_PRE_RELEASE` | `0` | Dark veil + "Coming Soon" ribbon for movies not yet streaming. |
| `PICTORIUM_GRADIENT_HEIGHT` | `65` | Percentage height of the bottom dark gradient. |

### Concurrency & Performance
| Variable | Default | Description |
|---|:---:|---|
| `PICTORIUM_MAX_CONCURRENT_RENDERS` | `4` | Max concurrent Sharp renders to prevent OOM. |
| `PICTORIUM_RENDER_TIMEOUT_MS` | `30000` | Max render timeout before falling back (ms). |
| `PICTORIUM_CACHE_MAX_MB` | `150` | Maximum RAM allocated for in-memory image cache. |
| `PICTORIUM_SELF_WARMUP` | `1` | Automatically pre-warm core catalogs on server start. |
</details>

---

## 🧪 Local Development

```bash
# 1. Clone the repository
git clone https://github.com/Eful97/Pictorium.git && cd Pictorium

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev

# 4. Run unit test suite (Vitest)
npm test

# 5. Full project verification (Typecheck + Lint + Tests + Build)
npm run verify
```

---

## 📄 License & Credits

* Released under open-source **GNU Affero General Public License v3.0 (AGPL-3.0)**.
* Inspired by the [erdb](https://github.com/realbestia1/erdb) project by realbestia1.
* Metadata provided by [TMDb](https://www.themoviedb.org/), [TheTVDB](https://thetvdb.com/) and [JustWatch](https://www.justwatch.com/).
* Network and studio logos courtesy of [Wikimedia Commons](https://commons.wikimedia.org/).
