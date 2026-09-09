Hey r/selfhosted,

I wanted to share **Posterium**, an open-source project I’ve been building to scratch my own media-center itch: generating dynamic, high-resolution movie/TV posters and rich metadata on the fly without relying on closed-source, paid subscriptions like RPDB (Rating Poster Database).

### 💡 Why I built it
I was frustrated with the lack of control: **I wanted absolute, granular control over every single poster in my library**. If an automated template places an awkward logo over an actor's face, or picks a low-contrast backdrop, I wanted the power to open an editor, pick the exact clean artwork, choose the logo variant, adjust badge placement, and have it sync instantly to Stremio.

Posterium is the result: a **stateless, dynamic rendering proxy and complete Stremio metadata addon**. A single Sharp C++ / SVG pipeline renders posters on demand with smart caching, combining global automated rules with the freedom to tailor any specific poster to perfection.

---

### 🚀 Key Features

* 🎯 **Live WYSIWYG Web Editor**: Customize badge styles, borders, gradients, and logo placements in your browser, with real-time preview identical to the final rendered output.
* 🏷️ **Dynamic Badges & Multi-Source Ratings**: Shows streaming resolution (4K/1080p/720p), ratings aggregated from 16+ sources (IMDb, TMDB, Rotten Tomatoes, Letterboxd, MAL), awards (Oscars, Cannes), and live Netflix Top 10 ribbons.
* 🌀 **Smart Anime & TV Season Unbundling**: Solves the common TMDB issue of dumping multi-season anime (e.g. *Re:ZERO*, *Jujutsu Kaisen*) into a single 80-episode season, restoring proper season/special splits automatically.
* 🎨 **Clean Artwork & Best-Fit Logos**: Auto-detects textless official artwork and calculates luminance/empty space to place network/studio logos without obstructing faces.
* 📦 **Self-Contained Stremio Addon**: Serves clean backdrops, localized synopsis, trailer embeds, and translated episode metadata directly to Stremio.

---

### 🛠️ Architecture & Under the Hood

* **Engine**: Next.js 16 standalone runner powered by `libvips` / `sharp` (C++) for sub-20ms blur and composite operations.
* **Multi-Arch Docker**: Native multi-architecture images built for both `linux/amd64` (x86 servers/PC) and `linux/arm64` (Raspberry Pi 4/5, Apple Silicon, Oracle Ampere ARM).
* **Strict Memory Bounding**: Pre-configured with `NODE_OPTIONS="--max-old-space-size=384"` and `SHARP_CACHE_MEMORY_MB=64` to run reliably within 512MB RAM constraints (safe for low-spec VPS, Raspberry Pi, and minimal containers).
* **Security & Container Best Practices**: Runs as an unprivileged non-root user (`uid 1000 node`), includes built-in Docker `HEALTHCHECK`, and has Next.js telemetry strictly disabled (`NEXT_TELEMETRY_DISABLED=1`).
* **Cache Architecture**: Multi-tier cache (memory + local volume `/data`) with deterministic version hashes (`RENDER_VERSION`) to avoid stale images.
* **License**: AGPL-3.0.

---

### 🐳 Quickstart (Docker Compose)

The only requirement is a free [TMDB API key](https://www.themoviedb.org/settings/api).

```yaml
services:
  posterium:
    image: eful97/posterium:latest
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

Run `docker compose up -d`, navigate to `http://localhost:8080`, customize your look, and click **"Install on Stremio"**.

*(Note: For those without a home server, it also supports 1-click serverless deployment on Vercel with Upstash Redis).*

---

### 🔗 Links
* **GitHub**: https://github.com/Eful97/Pictorium
* **Docker Hub**: `eful97/posterium:latest`
* **GHCR**: `ghcr.io/eful97/posterium:latest`

I'd love to hear your feedback, bug reports, and ideas! What media center integrations would you like to see next?
