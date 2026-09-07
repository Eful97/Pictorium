# Posterium

Generatore di poster cinematografici per Stremio/Nuvio: un solo endpoint (`/api/poster/{type}/{id}`) serve sia il preview client (WYSIWYG) sia il poster finale Stremio. Non duplicare la logica di rendering.

## Agent Operating Rules

Be a ruthless mentor, don't sugarcoat it.
If my idea is weak, call it crap and explain why.
Your job is to test everything until the idea is bulletproof.
You can suggest a perfect idea for the project yourself.

### 1. Inspect Before Editing

Before modifying code:

1. Identify the exact files involved in the requested change.
2. Read the existing implementation before proposing a replacement.
3. Read the relevant `.agents/*.md` documentation and skills.
4. Search for all usages of functions, components, parameters, routes, and types that will be changed.
5. Check whether the requested behavior already exists elsewhere in the repository.
6. Do not modify files that are unrelated to the task.

Do not start coding from assumptions about the architecture.

### 2. Minimal Change Principle

Prefer the smallest change that completely solves the requested problem.

- Do not refactor unrelated code.
- Do not rename things without a concrete reason.
- Do not reorganize files merely for style.
- Do not introduce abstractions for a single use case.
- Do not rewrite working code when a targeted change is sufficient.
- Do not introduce new dependencies unless they are necessary.
- Reuse existing utilities, types, patterns, and components whenever possible.
- Preserve existing behavior outside the requested change.

If a broader refactor appears beneficial but is not required, do not perform it as part of the task.

### 3. No Speculative Fixes

Do not fix problems that have not been demonstrated.

- Do not change code because something "might" be wrong.
- Do not change APIs or configuration without evidence that the task requires it.
- Do not alter rendering parameters merely to make a test pass.
- Do not suppress warnings or errors without understanding their cause.
- Do not add fallback logic unless the existing behavior or task requires it.

If the cause of a problem is uncertain, investigate first.

### 4. Stop Conditions

Do not repeatedly modify code after a failed verification without understanding the failure.

When a test or build fails:

1. Read the complete relevant error.
2. Identify the likely root cause.
3. Make one focused correction.
4. Re-run the narrowest relevant verification.
5. Only continue if the new result provides evidence that further changes are necessary.

Avoid trial-and-error modification loops.

If the same failure persists after a reasonable focused attempt, stop and report the blocker instead of repeatedly changing unrelated code.

### 5. No Test-Gaming

Tests must validate the implementation, not be manipulated to accept an incorrect implementation.

Never:

- weaken assertions just to make tests pass;
- delete failing tests;
- disable tests without explicit justification;
- update snapshots solely because they fail;
- add mocks that hide the actual regression;
- change expected output to match an unintended implementation.

When a snapshot changes, determine whether the visual change is intentional before updating it.

---

## Golden Rule: Client ↔ Server Sync

When modifying any parameter that affects visual rendering, update and verify the corresponding implementation on both sides.

The preview client and final Stremio poster must render the same visual result.

This applies especially to:

- geometry;
- dimensions;
- spacing;
- gradients;
- colors;
- borders;
- logos;
- badges;
- genres;
- rankings;
- typography;
- image positioning;
- scaling;
- opacity;
- URL parameters;
- conditional rendering.

Never implement a visual parameter in only the client or only the server unless the architecture explicitly requires it.

---

## Visual Regression Protection

Visual output is part of the application's contract.

Before changing rendering code:

1. Identify the existing rendering path.
2. Read `.agents/render-params.md`.
3. Check the relevant visual regression tests.
4. Determine whether the change affects snapshots or `RENDER_VERSION`.

After changing rendering code:

1. Run the narrowest relevant test first.
2. Run the visual regression test when visual output may have changed.
3. Inspect differences rather than blindly updating snapshots.
4. Update snapshots only when the visual change is intentional and expected.
5. Ensure the client preview and server-rendered poster remain synchronized.

Do not consider a rendering task complete merely because TypeScript and unit tests pass.

---

## Next.js System Notice

This project uses a Next.js version whose APIs, conventions, and file structure may differ from the model's training data.

Before writing or modifying Next.js-specific code:

1. Check the installed version.
2. Read the relevant documentation in `node_modules/next/dist/docs/`.
3. Follow the APIs and conventions present in the installed version.
4. Heed deprecation notices.
5. Prefer the repository's existing patterns over generic Next.js examples.

Do not rely on remembered Next.js behavior when the installed documentation is available.

---

## Source of Truth

When documentation and code disagree:

**CODE WINS.**

Use the actual implementation as the source of truth, then update the documentation if the discrepancy is relevant.

Do not modify working code merely to make it match outdated documentation.

Generated values and files must be regenerated using their designated scripts rather than edited manually.

---

## Versioning and Generated Values

App version and render version identifiers are generated by repository scripts.

`APP_VERSION` is automatic: `<major>.<minor>` come from `package.json`, the patch is the commit count since that version was set in `package.json`. Every new commit produces a new app version patch without manual bump. When git is unavailable (e.g. a Docker build without `.git`), it falls back to the base version in `package.json`.

Current values:

`APP_VERSION: 1.10.<commit count>` — `RENDER_VERSION: f920e34805` — `rv: f920e34805`

Do not manually edit generated render-version or app-version files.

Use:

```bash
node scripts/write-render-version.mjs
node scripts/write-app-version.mjs
```

When a task changes the rendering implementation and the repository workflow requires a new render version, regenerate it using the script.

Never manually edit `render-version.ts`.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run verify` | Typecheck + lint + unit test + build |
| `npm run test` | Unit tests (Vitest) |
| `npx playwright test e2e/posterium-visual.spec.ts` | Visual regression tests |
| `npm run e2e:visual` | Visual regression tests (riusa `.next-e2e` se presente — iterazione veloce) |
| `npm run e2e:visual:clean` | Visual regression tests con `.next-e2e` ricostruito da zero (run affidabile) |
| `npx playwright test e2e/` | Complete Playwright suite |
| `npx playwright test --update-snapshots` | Update snapshots after intentional visual changes only |
| `node scripts/write-render-version.mjs` | Regenerate `RENDER_VERSION` |
| `node scripts/load-smoke.mjs` | Render pipeline load smoke test |
| `node scripts/bench-image-cache.mjs` | Benchmark cache image-level (stesso titolo, cache key diverse) |

`predev`, `prebuild`, and `pretest` regenerate the app/render version automatically.

### Verification Strategy

Use progressive verification instead of immediately running everything after every edit.

**For a localized code change:**
1. Run the narrowest relevant test.
2. Fix failures.
3. Run `npm run verify` when the change is stable.

**For a visual change:**
1. Run the relevant unit test if applicable.
2. Run `e2e/posterium-visual.spec.ts`.
3. Inspect snapshot differences.
4. Run `npm run verify`.

**For a render-pipeline or performance change:**
1. Run the relevant tests.
2. Run `scripts/load-smoke.mjs` when applicable.
3. Run `npm run verify`.

Do not repeatedly run expensive full suites while still making exploratory edits unless necessary.

---

## Render Pipeline Hardening

The poster render pipeline is:

`route.ts → poster-runtime-cache.ts → poster-service.ts`

It contains concurrency limiting and an overall deadline to protect against OOM and excessive rendering load.

Default values, environment variables, slot behavior, queueing, deadlines, and negative caching are documented in `README.md` under **Variabili d'Ambiente**.

Important operational behavior:

- Environment variables are read at module level.
- Changing them requires a restart; hot reload does not change already-loaded values.
- Unmapped posters composed on demand use a 6h TTL.
- Mapped posters use a 24h TTL.

Do not modify concurrency, caching, timeout, or deadline behavior without first understanding the existing pipeline and its documentation.

---

## Rendering Architecture

There must be a single conceptual source of truth for poster rendering.

Do not create a second independent implementation of the poster renderer.

When adding or modifying a rendering parameter:

1. Locate its existing definition.
2. Identify every consumer.
3. Update the shared/source representation where appropriate.
4. Update both client and server implementations when required.
5. Run visual regression tests.

Avoid duplicating constants or calculations when an existing shared mechanism is available.

---

## API and Data Contract Safety

Treat existing routes, URL parameters, metadata formats, and rendering parameters as public contracts.

Do not change:

- API routes;
- parameter names;
- parameter semantics;
- response formats;
- metadata identifiers;
- cache keys;
- environment variable names;

unless the requested task explicitly requires the change.

Before changing a contract, search the repository for all consumers.

If a breaking change is required, identify the affected consumers and update them deliberately rather than relying on runtime failures to reveal them.

---

## Catalogs

Catalog architecture and metadata resolution are documented in:

`.agents/catalog.md`

Before modifying catalog behavior, read that document.

Pay particular attention to:

- Stremio catalog architecture;
- resolvable metadata IDs;
- `tt...` identifiers;
- `tmdb:` identifiers;
- caching;
- warmup behavior.

Do not change catalog resolution logic without checking its existing cache and warmup behavior.

---

## Skills and Specialized Workflows

Read the relevant skill before performing specialized work.

- `.agents/render-params.md` — rendering parameters, geometry, badges, genres, ranking, gradients, borders, logos, URL parameters, and affected files.
- `.agents/visual-testing.md` — Playwright, mock server, snapshot policy, `RENDER_VERSION`, and active tests.
- `.agents/catalog.md` — Stremio catalog architecture, metadata IDs, caching, and warmup.
- `.agents/skills/poster-sync/SKILL.md` — complete client/server synchronization workflow.
- `.agents/skills/poster-visual/SKILL.md` — visual regression and screenshot workflow.

Do not bypass a specialized workflow when the task clearly falls within its scope.

---

## Completion Criteria

A task is complete only when:

- The requested behavior has been implemented.
- No unrelated behavior has been changed.
- Relevant tests pass.
- Visual tests pass when rendering is affected.
- Client/server rendering remains synchronized.
- Generated files have been regenerated through the correct scripts when required.
- No unnecessary dependency or architectural change was introduced.
- The final diff contains only changes justified by the task.

Before finishing, inspect the final diff.

If the diff contains unrelated changes, remove them.

---

## Communication

When reporting completed work:

1. State what was changed.
2. State which verification commands were run.
3. Mention relevant test results.
4. Mention intentional visual/snapshot changes.
5. Mention blockers or unverified areas explicitly.

Do not claim that a change is verified if the relevant verification was not actually run.

---

## Language

Reply in the same language used by the user.

Repository files, code, comments, and documentation remain in English unless the project explicitly uses another language.

Project documentation is intentionally written in Italian:

- `AGENTS.md`
- `.agents/render-params.md`
- `.agents/visual-testing.md`

Skill files under `.agents/skills/*/SKILL.md` remain in English.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
