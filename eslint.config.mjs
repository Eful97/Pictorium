import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // L'estensione eslint-plugin-react-compiler NON e' installata: l'entry
      // "react-compiler/react-compiler": "off" era un'opzione fantasma che non
      // controllava nulla. Il React Compiler e' comunque attivo a build-time
      // via `reactCompiler: true` in next.config.ts.
      //
      // react-hooks/refs e set-state-in-effect restano disattivate volontariamente:
      // riabilitarle oggi produce 33 violazioni in 17 file (per lo piu' setState
      // in effect con pattern di trottling/fetch legittimi e ref usati come cache
      // di stato non serializzabile). E' una scelta documentata, non un default silenzioso.
      // Prima di attivarle servirebbe un refactor mirato file-per-file.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "@next/next/no-img-element": "warn",
      // Schema esterno non validato runtime (TMDB/Trakt): i cast `as X` residui
      // andrebbero coperti da zod. Error i due sotto ora che sono puliti.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Artefatti di build E2E (distDir .next-e2e di playwright.config.ts):
    // senza questo ignore, `npm run lint` fallisce in locale dopo i test E2E.
    ".next-e2e/**",
    // DistDir isolato dell'harness E2E autenticato (NEXT_DIST_DIR
    // ".next-e2e-auth" di playwright.preset-auth.config.ts): stesso pattern
    // di .next-e2e — senza questo ignore, `npm run lint` fallisce dopo i
    // test E2E autenticati (migliaia di errori dai chunk generati da Next,
    // es. require()/no-unused-vars/@ts-ignore).
    ".next-e2e-auth/**",
    // DistDir di load-smoke.mjs (PICTORIUM_DATA_DIR/NEXT_DIST_DIR dedicati).
    ".next-load/**",
    // DistDir di bench-image-cache.mjs (stesso pattern di .next-load).
    ".next-bench/**",
    // DistDir di riprese/screenshot (NEXT_DIST_DIR ".next-shot ", con spazio
    // finale): output generato da Next/Turbopack come gli altri distDir sopra.
    // Entrambe le varianti: ordinaria e con spazio finale effettivo.
    ".next-shot/**",
    ".next-shot /**",
    // DistDir di tune-env.mjs (NEXT_DIST_DIR ".next-tune", cfr. next.config.ts
    // `distDir: process.env.NEXT_DIST_DIR || ".next"`): stesso pattern degli
    // altri distDir sopra — senza questo ignore, `npm run lint` fallisce dopo
    // i tuning run (chunk generati da Next/Turbopack).
    ".next-tune/**",
    // DistDir ad-hoc NEXT_DIST_DIR ".next-e2e-probe" (runtime di probe):
    // stesso pattern degli altri distDir sopra — output generato da
    // Next/Turbopack, mai sorgente (git-ignored, untracked, layout distDir
    // canonico con build-manifest.json/routes-manifest.json/trace).
    ".next-e2e-probe/**",
    // Isolated build-output distDir (NEXT_DIST_DIR ".next-verify"): same
    // pattern as the other distDirs above — without this ignore,
    // `npm run lint` fails with thousands of errors from the generated
    // Next/Turbopack chunks (and the standalone copy even pulls in the
    // e2e/* suites, which vitest would collect as repo tests).
    // NOTE: unlike the other distDirs this one is not .gitignore-listed;
    // it is still untracked build output, never source.
    ".next-verify/**",
    // Worktree Claude (.claude/worktrees/**): contengono una copia del repo con
    // il proprio .next generato, che altrimenti verrebbe lintato (868 errori
    // dai tipi generati da Next).
    ".claude/**",
    // Tooling locale .opencode (plugin + node_modules con test di terze
    // parti): non e' codice dell'app — vitest li raccoglie come suite del
    // repo e falliscono per dipendenze/env mancanti loro, non nostre.
    ".opencode/**",
    // Artefatti di audit/documentazione generati localmente
    "artifacts/**",
  ]),
]);

export default eslintConfig;
