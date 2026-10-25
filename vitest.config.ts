import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  plugins: [
    // Tests import the CLI scripts in scripts/*.mjs directly (fixture source
    // of truth): those files carry a `#!/usr/bin/env node` shebang on line 1
    // (executable contract: they also run as `./scripts/x.mjs`). The Vitest /
    // Rolldown SSR transform prepends an import helper BEFORE the shebang and
    // parsing fails (`Invalid Character !`). This plugin strips only the
    // first-line shebang inside the test module graph — files on disk and CLI
    // behavior stay intact, no other semantics change.
    {
      name: "pictorium-strip-shebang",
      enforce: "pre",
      transform(code: string, id: string) {
        if (id.endsWith(".mjs") && code.startsWith("#!")) {
          return { code: code.replace(/^#![^\n]*\n/, ""), map: null }
        }
        return null
      },
    },
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    exclude: [
      "node_modules/**",
      ".kilo/**",
      ".claude/**",
      ".opencode/**",
      ".next/**",
      // Isolated build-output distDir (NEXT_DIST_DIR ".next-verify"):
      // the standalone build copies the whole app including the e2e/*
      // suites, which vitest would collect as repo tests (collection
      // failure: the Playwright APIs do not exist under vitest). Same
      // pattern as the other distDirs above.
      // NOTE: unlike the other distDirs this one is not .gitignore-listed;
      // it is still untracked build output, never source.
      ".next-verify/**",
      "e2e/**",
      "e2e-auth/**",
      "test-results/**",
      "playwright-report/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**/*.ts", "src/components/**/*.tsx", "src/app/**/*.ts"],
      exclude: ["src/generated/**", "src/lib/render-version.ts", "src/**/__tests__/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The Workers runtime builtin `cloudflare:workers` does not exist
      // under Node: map it to a local stub so the paste-ready worker module
      // stays importable in unit tests (production uses the real builtin).
      "cloudflare:workers": path.resolve(__dirname, "./src/__tests__/cloudflare-workers-stub.ts"),
    },
  },
})
