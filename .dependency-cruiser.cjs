/**
 * Pictorium dependency guardrails (Fase 5).
 *
 * These rules encode architectural boundaries that the poster pipeline relies
 * on. They are additive checks only: they never change rendering, routing or
 * runtime behavior.
 *
 * - `@resvg/resvg-js` is loaded exclusively by `src/lib/svg-badge.ts` (single
 *   poster renderer). Any other importer breaks the "one renderer" invariant.
 * - Client components must never pull server-only runtimes (`sharp`, `ioredis`,
 *   `@upstash/redis`): those modules are Node-only and would break the browser
 *   bundle / leak storage credentials into the client graph.
 * - `src/lib` and `src/app` must not import each other circularly (route
 *   handlers stay a leaf consumer of the library).
 *
 * Every rule is error-severity on purpose: the CLI exit code is 1 only for
 * error-level violations, so making this gate blocking in CI is just removing
 * the step's `continue-on-error` (see ci.yml).
 */
module.exports = {
  forbidden: [
    {
      name: "resvg-single-renderer",
      comment:
        "Only src/lib/svg-badge.ts may load @resvg/resvg-js (single poster renderer boundary).",
      severity: "error",
      from: {
        pathNot: "^src/lib/svg-badge\\.ts$",
      },
      to: {
        path: "node_modules/@resvg/resvg-js/",
      },
    },
    {
      name: "no-server-runtime-in-components",
      comment:
        "Client components must not import server-only runtimes (sharp, ioredis, @upstash/redis).",
      severity: "error",
      from: {
        path: "^src/components/",
      },
      to: {
        path: "node_modules/(sharp|ioredis|@upstash/redis)/",
      },
    },
    {
      name: "no-circular-lib-app",
      comment: "No cycle may cross from src/lib into src/app and back.",
      severity: "error",
      from: {
        path: "^src/lib/",
      },
      to: {
        path: "^src/app/",
        circular: true,
      },
    },
    {
      name: "no-circular-app-lib",
      comment: "No cycle may cross from src/app into src/lib and back.",
      severity: "error",
      from: {
        path: "^src/app/",
      },
      to: {
        path: "^src/lib/",
        circular: true,
      },
    },
  ],

  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: "(\\.next[^/]*|coverage|test-results|playwright-report|artifacts)/",
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    skipAnalysisNotInRules: true,
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
