import path from "node:path";
import type { NextConfig } from "next";

// Security headers statici (CSP esclusa: è calcolata per-request dal
// middleware così segue POSTER_CDN_URL a runtime senza rebuild).
// img-src copre i poster TMDB diretti, gli still episodi TVDB
// (artworks.thetvdb.com, anteprima Stagioni & Episodi e AniZip) e i blob:
// delle preview secure (useSecurePosterUrl/usePosterPreview).
// frame-ancestors permette l'embedding su HF Spaces.
//
// Frame embedding: le PAGINE restano senza X-Frame-Options. La policy reale è
// il `frame-ancestors` per-request (`src/lib/csp.ts`, override
// PICTORIUM_FRAME_ANCESTORS): un X-Frame-Options statico qui non potrebbe
// seguirla (richiederebbe un rebuild) e su browser legacy bloccherebbe
// l'embed su HF Spaces configurato dall'operatore. Le risposte `/api/*` non
// sono mai incorniciate dall'app, quindi lì SAMEORIGIN è un hardening gratuito.
//
// HSTS solo in produzione (build `next build`/standalone): in dev/localhost
// non ha effetto utile e non deve finire nei manifest statici.

const isProductionBuild = process.env.NODE_ENV === "production"

const nextConfig: NextConfig = {
  // `standalone` serve al self-hosting Docker (il Dockerfile copia
  // .next/standalone). Su Vercel NON va impostato: con Next 16.3+ l'output
  // standalone salta la generazione dei file di tracing serverless
  // (.nft.json) e il build fallisce con
  // "ENOENT .next/next-server.js.nft.json" — lì si usa l'output default.
  output: process.env.VERCEL ? undefined : "standalone",
  // React Compiler: ottimizza automaticamente il re-rendering dei componenti,
  // riducendo la necessita' di useMemo/useCallback manuali.
  reactCompiler: true,
  // DistDir separato per i test E2E (playwright.config.ts): evita il lock
  // "Another next dev server is already running" quando l'utente ha già un
  // `npm run dev` attivo su .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["127.0.0.1"],
  // Turbopack rileva la root risalendo ai lockfile: nella cartella utente
  // esiste un pnpm-lock.yaml fuori dal repository git e Next lo ignora con un
  // warning a ogni avvio (scansione inutile dei parent). Fissare la root alla
  // directory del progetto evita la scansione e il warning.
  turbopack: {
    root: path.join(__dirname),
  },
  serverExternalPackages: ["@resvg/resvg-js", "sharp", "ioredis"],
  outputFileTracingIncludes: {
    "/api/poster/**/*": ["src/assets/fonts/**/*"],
  },
  outputFileTracingExcludes: {
    "/api/poster/**/*": ["next.config.ts"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
    ],
  },
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      // HSTS: only meaningful over HTTPS (browsers ignore it on plain HTTP) and
      // only for production deployments. No preload, no includeSubDomains: a
      // self-hosted instance may serve other vhosts that do not speak HTTPS.
      ...(isProductionBuild
        ? [{ key: "Strict-Transport-Security", value: "max-age=15552000" }]
        : []),
    ]
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // API responses are never framed by the app (poster images, catalogs,
        // meta JSON): SAMEORIGIN closes framing without touching the page
        // embedding contract, which stays on the runtime frame-ancestors CSP.
        source: "/api/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ]
  },
};

export default nextConfig;
