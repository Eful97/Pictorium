import type { NextConfig } from "next";

// Security headers statici (CSP esclusa: è calcolata per-request dal
// middleware così segue POSTER_CDN_URL a runtime senza rebuild).
// img-src copre i poster TMDB diretti, gli still episodi TVDB
// (artworks.thetvdb.com, anteprima Stagioni & Episodi e AniZip) e i blob:
// delle preview secure (useSecurePosterUrl/usePosterPreview).
// frame-ancestors permette l'embedding su HF Spaces.

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
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
