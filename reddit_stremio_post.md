Hey r/StremioAddons,

I’m excited to share **Posterium** — a free and open-source dynamic poster generator and complete metadata addon for Stremio.

I created Posterium because I wanted **absolute, granular control over every single poster in my library**. When an automated template places an awkward logo over an actor’s face, or picks a low-contrast backdrop, I wanted the power to open an editor, pick the exact clean artwork, choose the logo variant, adjust badge placement, and have it sync instantly to Stremio.

Posterium is the result: a **stateless, dynamic rendering proxy and complete Stremio metadata addon** powered by Sharp C++ and SVG, combining automated rules with the freedom to tailor any specific poster to perfection.

---

### 🌟 Key Features

* 🎯 **Live WYSIWYG Web Editor**: Full visual control in real-time. Change artwork whenever you want, pick between candidate posters, customize badge styles (*Shadow, Pill, Bar, Colored, Border, Glass*), gradients, and see the exact Stremio result live before saving.
* 🔄 **24h Daily Poster Rotation**: Save multiple posters for the same title and let Posterium automatically rotate them daily to keep your Stremio library fresh and cinematic.
* 🎬 **20+ Official Network & Studio Logos**: Automatic recognition and embedding for Netflix, Prime Video, Disney+, Apple TV+, HBO Max, Paramount+, Crunchyroll, and studios like Marvel, Pixar, A24, Studio Ghibli, and Warner Bros.
* 🧠 **Smart Best-Fit Algorithm**: Analyzes poster luminance and empty space to automatically size and position logos without obstructing actors' faces.
* 🏷️ **Dynamic Badges & Multi-Source Ratings**: Live streaming resolution (4K/1080p/720p), ratings aggregated from 16+ sources (IMDb, TMDB, Rotten Tomatoes, Letterboxd, MAL), awards (Oscars, Cannes, Emmy, BAFTA), and live Netflix Top 10 ribbons.
* 🌀 **Smart Anime & TV Season Unbundling**: Automatically splits TMDB's messy single-season anime dumps (e.g. *Re:ZERO* 80+ episodes, *Jujutsu Kaisen*) into true seasons, and natively detects TV show "Parts" (*Money Heist*, *Lupin*).
* 📦 **Complete Stremio Addon**: Serves clean transparent logos, 4K backdrops, localized synopsis, trailer embeds, and translated episode thumbnails directly to your Stremio library.

---

### 🛠️ Architecture & Under the Hood

* **Engine**: Next.js 16 standalone runner powered by `libvips` / `sharp` (C++) for sub-20ms blur and composite operations.
* **Multi-Arch Docker**: Native multi-architecture images built for both `linux/amd64` (x86 servers/PC) and `linux/arm64` (Raspberry Pi 4/5, Apple Silicon, Oracle Ampere ARM).
* **Strict Memory Bounding**: Pre-configured with `NODE_OPTIONS="--max-old-space-size=384"` and `SHARP_CACHE_MEMORY_MB=64` to run reliably within 512MB RAM constraints.
* **Security & Container Best Practices**: Runs as an unprivileged non-root user (`uid 1000 node`), includes built-in Docker `HEALTHCHECK`, and has Next.js telemetry strictly disabled (`NEXT_TELEMETRY_DISABLED=1`).
* **Cache Architecture**: Multi-tier cache (memory + local volume `/data`) with deterministic version hashes (`RENDER_VERSION`) to avoid stale images.
* **License**: AGPL-3.0 (100% Free and Open-Source).

---

### 🚀 How to Run & Install

You can host Posterium completely free either in the cloud or locally. The only requirement is a free [TMDB API key](https://www.themoviedb.org/settings/api).

#### Option A: ▲ 1-Click Free Cloud Setup (Vercel — No server needed)
If you don't have a 24/7 home server, you can deploy your personal instance to Vercel for free:
1. Click **[Deploy with Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FEful97%2FPosterium)**.
2. In your Vercel Dashboard, go to **Storage** → create a free **Upstash (Redis)** database and link it.
3. In **Settings → Environment Variables**, add:
   - `POSTERIUM_PUBLIC_INSTANCE` = `1`
   - `POSTERIUM_TMDB_KEY` = `your_tmdb_api_key`
4. Go to **Deployments** → click **Redeploy**.
5. Open your generated URL and click **"Install on Stremio"**!

#### Option B: 🐳 Docker Compose (Home Server / NAS / Pi)
```yaml
services:
  posterium:
    image: eful97/pictorium:latest
    container_name: posterium
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - POSTERIUM_PUBLIC_INSTANCE=1
      - POSTERIUM_TMDB_KEY=your_tmdb_api_key_here
    volumes:
      - ./posterium-data:/data
```
Run `docker compose up -d`, open `http://localhost:8080`, customize your look, and click **"Install on Stremio"**.

---

### 🔗 Links
* **GitHub**: https://github.com/Eful97/Pictorium
* **Docker Hub**: `eful97/pictorium:latest`
* **GHCR**: `ghcr.io/eful97/pictorium:latest`

I'd love to hear your feedback, bug reports, and ideas for new features!
