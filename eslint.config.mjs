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
    // DistDir di load-smoke.mjs (PICTORIUM_DATA_DIR/NEXT_DIST_DIR dedicati).
    ".next-load/**",
    // DistDir di bench-image-cache.mjs (stesso pattern di .next-load).
    ".next-bench/**",
    // Worktree Claude (.claude/worktrees/**): contengono una copia del repo con
    // il proprio .next generato, che altrimenti verrebbe lintato (868 errori
    // dai tipi generati da Next).
    ".claude/**",
    // Tooling locale .pi (estensioni agenti): non e' codice dell'app e non
    // rispetta le regole eslint dell'app (require(), export anonimi). Come
    // .claude/**, fuori dal lint -- altrimenti npm run verify fallisce.
    ".pi/**",
  ]),
]);

export default eslintConfig;
