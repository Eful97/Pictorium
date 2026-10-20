import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    exclude: [
      "node_modules/**",
      ".kilo/**",
      ".claude/**",
      ".opencode/**",
      ".next/**",
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
