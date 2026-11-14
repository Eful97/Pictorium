# Pictorium — Deploy

[← Back to README](../README.md) · [🇮🇹 Italiano](DEPLOY.it.md)

## 🚢 Deploy

| Platform | Cost | Type | Persistence | Best for |
|---|---|---|---|---|
| [▲ **Vercel**](#-vercel-recommended) | **Free** | Serverless | Upstash Redis (KV) | **Recommended**: 1-click, zero maintenance, global CDN ([📺 Video guide](https://www.youtube.com/watch?v=FP6VJ2vGYiY)) |
| [🐳 **Docker Compose**](#-docker--compose) | **Free** | Container | Local volume (`/data`) | NAS, home server, mini-PC (Unraid, TrueNAS, CasaOS) |
| [🤗 **Hugging Face**](#-other-installation-methods) | **Free** | Docker (16 GB RAM) | Storage bucket | Plenty of free RAM for shared instances |
| [🦾 **Oracle Cloud**](#-other-installation-methods) | **Free** | VPS ARM (24 GB RAM) | Local disk | Dedicated free always-on cloud server |

### ▲ Vercel (recommended)

[![YouTube Video Guide](https://img.shields.io/badge/YouTube-Setup_Video_Guide-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=FP6VJ2vGYiY)

> 📺 Follow the [step-by-step YouTube guide](https://www.youtube.com/watch?v=FP6VJ2vGYiY) to complete setup in under 2 minutes.

1. **Get a free TMDB API key**: sign up at [themoviedb.org](https://www.themoviedb.org/signup), open **Settings → API** and copy the **API Key (v3 auth)** (32 characters).
2. **Fork the repository**: click **Fork** on [github.com/Eful97/Pictorium](https://github.com/Eful97/Pictorium).
3. **Import to Vercel**: [vercel.com](https://vercel.com) → **Add New… → Project** → import your fork. Environment variables (all optional except `CONFIG_HMAC_SECRET`; Redis comes next):
   * `PICTORIUM_ADMIN_TOKEN` = *a secret you choose* (optional: without it, the first PIN set from the UI is free)
   * `CONFIG_HMAC_SECRET` = *a long random secret* (required in production for `?config=` share/install links)
   * `PROFILE_ENCRYPTION_KEY` = *64-char hex* (required only with `PICTORIUM_MULTI_USER=1`)
   * `PICTORIUM_TMDB_KEY` = *your TMDB v3 key* (optional: you can save it after deploy in Settings → Data & Cache → Configure API keys)
   * `CRON_SECRET` = *a random secret* (lets the nightly `/api/warmup` Vercel Cron authenticate — Vercel sends it as `Authorization: Bearer <CRON_SECRET>`; without it the route answers 401)
4. **Connect Upstash Redis — always required**: Vercel's filesystem is read-only, so without Redis mappings and settings are not persisted and spaces fall back to stateless `?config=` links. In the project dashboard open **Storage → Connect Store → Upstash (Redis)** and click Create & Connect. Vercel injects `KV_REST_API_URL` / `KV_REST_API_TOKEN` (accepted legacy names); the canonical `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` work too, as does a native `PICTORIUM_REDIS_URL`.
5. **Redeploy**: **Deployments** tab → **⋯** on the latest deployment → **Redeploy** (needed to bind Upstash).
6. **Unlock the editor, add keys and install**: open your instance URL, set the first PIN (Settings → Data & Cache) or paste `PICTORIUM_ADMIN_TOKEN` in **Settings → Admin token**. Save your TMDB/MDBList/TVDB keys in **Settings → Data & Cache → Configure API keys** (encrypted at rest, resolved by anonymous Stremio requests with no env var). Then click **Install to Stremio**.

> **Function duration**: with Fluid compute (the current default) Hobby functions allow up to 300s, and the app caps its own routes well below that (poster 40s, catalogs 60s, warmup 60s). A cold render or a slow upstream can still return a bounded 503; keeping catalogs warm reduces the chance.

> **Future updates**: in your fork, click **Sync fork → Update branch**. Vercel redeploys in about 60 seconds while preserving your database and settings.

### 🐳 Docker & Compose

Use the `docker-compose.yml` included in the repo (hardening, healthcheck, persistent `posterium-data` volume mounted on `/data` — saves survive container rebuilds):

```bash
git clone https://github.com/Eful97/Pictorium && cd Pictorium
cp .env.example .env
docker compose up -d
```

Put values in `.env` — Docker Compose does not read `.env.local`. Both `PICTORIUM_TMDB_KEY` and `PICTORIUM_ADMIN_TOKEN` are optional:

* **Home / LAN instance**: leave them empty and start. On first launch set the PIN in **Settings → Data & Cache** (6+ digits, or an 8–128 character password): with no admin token the first PIN is free and unlocks the editor from then on. Stremio endpoints stay public.
* **Exposed to the internet or `PICTORIUM_MULTI_USER=1`**: set `PICTORIUM_ADMIN_TOKEN` (plus `PROFILE_ENCRYPTION_KEY` with multi-user). If a token exists before any PIN, paste it in **Settings → Admin token** first: it is required to set the first PIN.
* **API keys**: you do not need `PICTORIUM_TMDB_KEY` in the file. After unlocking, open **Settings → Data & Cache → Configure API keys** and save your TMDB key (free at [themoviedb.org/signup](https://www.themoviedb.org/signup) → **Settings → API → API Key (v3 auth)**), plus MDBList/TVDB if you use them. They are encrypted at rest in the `/data` volume; anonymous Stremio requests resolve them with no env var, while scoped `?u=` requests never use them.

> The first start builds the image locally (a few minutes, longer on ARM). To start immediately with the prebuilt image: `docker compose pull pictorium && docker compose up -d --no-build`. Admin routes are closed by default (fail-closed): a valid PIN session (or the token pasted in **Settings → Admin token**, session only) unlocks warmup, cache and saves from the UI. The old `PICTORIUM_PUBLIC_INSTANCE` switch has been removed: if it is still set it is ignored and opens nothing.
>
> Coming from the old example with a `pictorium-data` volume and existing saves? Copy them before switching to the repo compose: `docker run --rm -v pictorium-data:/from -v posterium-data:/to alpine cp -a /from/. /to/`

Open `http://<SERVER-IP>:8080`, unlock the editor and click **Install to Stremio**. The manifest lives at the same origin (`/manifest.json`).

### 👉 Other installation methods

<details>
<summary><strong>Hugging Face, Oracle Cloud, VPS Caddy, Termux</strong></summary>

#### 🤗 Hugging Face Spaces
Hugging Face reads the Space configuration from the YAML header of the Space `README.md`. Put this at the top of your Space README (`app_port: 8080` is required, the default 7860 does not work):

```yaml
---
title: Pictorium
emoji: 🖼️
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 8080
pinned: false
---
```

1. Create a Space on Hugging Face using the **Docker** SDK pointing to `Eful97/Pictorium`.
2. Under **Settings → Variables and secrets**:
   * `NODE_OPTIONS` = `--max-old-space-size=1024`
   * `PICTORIUM_ADMIN_TOKEN` = *a secret you choose* (a public Space needs it; paste the same value in Settings → Admin token to unlock the editor)
   * `PICTORIUM_TMDB_KEY` = *your TMDB key* (optional: you can also save it from Settings → Data & Cache → Configure API keys after the first unlock)
3. Under **Settings → Storage**, attach a Storage Bucket mounted to `/data`.

#### 🦾 Oracle Cloud Always Free (ARM Ampere)
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
git clone https://github.com/Eful97/Pictorium && cd Pictorium
cp .env.example .env
```
Fill in `PICTORIUM_TMDB_KEY` and `PICTORIUM_ADMIN_TOKEN` in `.env` (you can leave the TMDB key out and save it later from Settings → Data & Cache → Configure API keys), add `CONFIG_HMAC_SECRET` if you need `?config=` install links, then run `sudo docker compose up -d`. Paste the token in **Settings → Admin token** (session only). Admin routes are always fail-closed without a token or PIN session; the old `PICTORIUM_PUBLIC_INSTANCE` is removed and ignored.

#### 🖥️ VPS + Caddy (automatic HTTPS)
```caddyfile
yourdomain.com {
    reverse_proxy pictorium:8080
}
```
On a public domain protect the editor with `PICTORIUM_ADMIN_TOKEN` (unlock in Settings → Admin token): without it the admin routes stay closed (fail-closed). Add `CONFIG_HMAC_SECRET` for `?config=` links and `PROFILE_ENCRYPTION_KEY` when `PICTORIUM_MULTI_USER=1`.

#### 📱 Termux (Android)
Plain Termux is not supported: it has no glibc and `sharp` ships no Android build. Use Debian via proot-distro instead:
```bash
pkg install proot-distro -y
proot-distro install debian
proot-distro login debian
# inside Debian (bookworm's nodejs is v18, the project needs Node 22+):
apt update && apt install -y curl ca-certificates gnupg git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # must print v22.x
git clone https://github.com/Eful97/Pictorium && cd Pictorium
npm ci && npm run build
PORT=8080 node .next/standalone/server.js
```

</details>
