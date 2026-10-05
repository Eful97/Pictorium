---
name: testing
description: >
  Test commands and workflow for Pictorium — Vitest unit suite (~771 tests,
  92 files), Playwright E2E (pictorium-visual.spec.ts + pictorium-smoke.spec.ts + pictorium-catalog-meta.spec.ts),
  the deterministic mock server (e2e/mock-server.mjs), snapshot update policy,
  and the full `npm run verify` gate (tsc + eslint + vitest + next build).
  Trigger: "run tests", "vitest", "playwright", "snapshot", "e2e", "test fails",
  "update snapshots", "mock server", "verifica".
---

The test gate for any change. For render-affecting changes the visual suite is a
HARD gate (see `poster-visual` skill and `.agents/visual-testing.md`).

## Unit tests (Vitest)

```bash
npm test            # vitest run (single pass)
npx vitest          # watch mode
npx vitest run --coverage
```

- ~771 tests / 92 files across store, API routes, React components, badge SVG,
  poster-fit, utilities.
- `pretest` auto-regenerates RENDER_VERSION (and app version) before running.
- To run one file: `npx vitest run src/__tests__/poster-render-deadline.test.ts`.

## E2E (Playwright)

```bash
npx playwright install chromium     # first time
npx playwright test e2e/pictorium-visual.spec.ts    # visual regression (4 UI + 21 poster API)
npx playwright test e2e/pictorium-smoke.spec.ts     # functional smoke
npx playwright test e2e/            # everything
npm run e2e:ui                      # Playwright UI runner
```

- **No TMDB_API_KEY needed**: `playwright.config.ts` auto-starts
  `e2e/mock-server.mjs` (dedicated port + `.next-e2e` distDir), so tests work
  even with `npm run dev` running.
- **Update snapshots** (only for INTENTIONAL appearance changes):
  ```bash
  npx playwright test e2e/pictorium-visual.spec.ts --update-snapshots
  ```
  Review the `.png` diffs before committing them.

## Adding a new external API mock

1. Add a handler in `e2e/mock-server.mjs` (deterministic data).
2. Add the matching env override in `playwright.config.ts` so the app points at
   the mock URL (e.g. `TMDB_BASE_URL`, `MDBLIST_API_URL`, `JUSTWATCH_API_URL`).

## Full verification gate

```bash
npm run verify    # tsc --noEmit && eslint . && vitest run && next build
```

Run this once before the final commit that contains code changes. It is exactly what the
`poster-render` agent's workflow ends with. During work, run only the narrow relevant
tests; do not run the full gate for micro-tasks or intermediate refactors. For
docs-only tasks (no code/render/deps/config changes), static read + `git diff` is
sufficient. Do not repeat the full gate before push if the exact code/config/lock/render-asset
state is already verified with a recorded success; any change invalidates it — rerun the
affected narrow tests and the final full gate before push. CI never replaces local gates.
Run the full serial E2E (`npx playwright test e2e/`) only for broad UI/contract changes or
before integration, not for every badge edit. On failure: narrow first, understand root cause,
max 3 focused attempts, never skip/weaken tests; rerun the final full gate after fix when needed.
Implementation-ready without gate is `verification pending`, not verified.

## Rules

- Never update snapshots to hide a real divergence — fix the code instead.
- Render-affecting changes require a final visual pass (hard gate at the final commit, see `.agents/visual-testing.md` for cached-vs-fresh scheduling; not a clean run per edit).
- Mock server is deterministic — don't rely on the live network in tests.
