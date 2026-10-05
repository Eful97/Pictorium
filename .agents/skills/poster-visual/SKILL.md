---
name: poster-visual
description: >
  Visual regression and screenshot verification workflow for Pictorium. The project
  ships a Playwright suite (`e2e/pictorium-visual.spec.ts`) with 4 fixed UI screenshots
  plus 21 poster API tests (10 functional + 11 visual) that run against a deterministic
  local mock server — no TMDB_API_KEY needed. Use to verify the WYSIWYG preview matches
  the server poster, to confirm a render change looks right, to inspect screenshot diffs,
  and to update snapshots only when a change intentionally alters the look. Trigger:
  "run visual tests", "check poster screenshot", "update snapshots", "the poster looks
  wrong", "regressione visiva", or after any rendering change.
---

Pictorium guarantees WYSIWYG: the preview uses `/api/poster/{type}/{id}`, the same
route Stremio hits. Visual tests are the gate that proves client/server coherence.

## Available tools

- Playwright MCP browser tools for live inspection of the running app. The tool
  prefix depends on the client:
  - Kilo built-in: `kilo-playwright_browser_*`
  - VS Code / Claude Code (`@playwright/mcp`): `browser_*` (`browser_navigate`,
    `browser_snapshot`, `browser_take_screenshot`, `browser_evaluate`,
    `browser_console_messages`, `browser_network_requests`).
- The repo Playwright suite — deterministic, mock-based; commands in
  [`.agents/visual-testing.md`](../../visual-testing.md).

## The test suite

Commands, test inventory and snapshot policy are the canonical reference in
[`.agents/visual-testing.md`](../../visual-testing.md) — do not duplicate them here.

## Workflow

1. **Baseline check** — after ANY render-affecting change, run the visual suite
   (command in `.agents/visual-testing.md`). Failure means the client and server
   diverged, OR the look intentionally changed.

2. **Diagnose the diff.** For pixel-diff failures, locate the failing spec, read the
   diff image paths from the test output, and compare expected vs actual. Determine
   WHICH side regressed (client param not sent? server param not read? shared formula
   forked?).

3. **Fix, don't suppress.** If it's a real divergence, fix the code (see the
   `poster-sync` skill). Never edit baselines to hide a bug.

4. **Intentional change only** → update baselines (`--update-snapshots`, command in
   `.agents/visual-testing.md`). Inspect the new `.png` files before committing them,
   and remember RENDER_VERSION must be regenerated and `rv` updated in AGENTS.md
   (steps 3-4 of the `poster-sync` skill).

## Live inspection (Playwright MCP)

When a poster looks wrong but tests pass (or to eyeball a new feature):

1. `browser_navigate` to the app (dev server or `npm run build && npm start`).
2. `browser_snapshot` to find the preview `<img>`; `browser_take_screenshot` on it.
3. To compare client preview vs server output, navigate directly to the poster URL
   (e.g. `/api/poster/series/tt1234567?<params>`) and screenshot that too.
4. For console/network issues: `browser_console_messages` + `browser_network_requests`.
5. `browser_evaluate` can inspect the URL the preview img resolved to and the exact
   query params the client sent — confirm each one matches the server-side expectations
   in [`.agents/render-params.md`](../../render-params.md).

## Rules

The rules (failure = blocking, review snapshots before committing, snapshots in git
as the regression contract) live in `.agents/visual-testing.md` — follow those.
For scheduling, follow `AGENTS.md Verification Strategy` (cached visual during
iteration, fresh pass once at the final gate); do not run visual after every edit.
