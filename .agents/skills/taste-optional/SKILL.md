---
name: taste-optional
description: >
  OPTIONAL opt-in design/critique reference adapter for the upstream Taste Skill
  (https://github.com/Leonxlnx/taste-skill). Use ONLY on explicit request —
  invocation keyword "taste-optional" or an explicit Taste Skill request for a
  design/critique aid. Never auto-trigger on broad design/UI work. This skill
  installs nothing and copies no scripts or dependencies; it is a lightweight
  reference pointer. Read the upstream skill on use and treat its aesthetic
  rules as non-binding suggestions that never override Pictorium's visual
  identity, single poster renderer, or repository rules.
---

Pictorium does not install the upstream Taste Skill. This is a lightweight,
project-local reference adapter: documentation only, no packages, no script
copies, no downloads, no builds.

## Upstream reference

- Repo: https://github.com/Leonxlnx/taste-skill
- Main skill to read on use:
  https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md

The upstream skill's primary target is public-facing websites, not app
dashboards. Its taste rules are written for that context and only partly
transfer to Pictorium (an app dashboard plus a single shared poster renderer).
Read the upstream `SKILL.md` at invocation time — do not rely on a cached
summary — and apply only what fits the explicit request.

## When this skill triggers (explicit only)

- The user says `taste-optional`, OR
- the user explicitly requests the Taste Skill (e.g. "use the Taste Skill",
  "run a taste critique", "review this with taste-skill").

No broad automatic design triggers. Words like "design", "UI", "style",
"review", "improve the look", or a rendering-file edit alone NEVER invoke
this skill. When in doubt, do not invoke it — ask.

## Limited integration

1. **Reference only.** Follow the upstream skill's own usage section from the
   live `SKILL.md`. Do not copy its scripts, dependencies, or setup steps into
   this repo.
2. **Critique aid, not a migration.** Use it as an opt-in second opinion on
   taste/clarity for UI or poster-adjacent questions the user explicitly
   asks about. It does not redesign Pictorium.
3. **Screenshot review only when requested and appropriate.** Use the project's
   existing browser/screenshot tooling, and only under the scheduling rules in
   `AGENTS.md` → Verification Strategy (narrow during work; visual runs only
   for requested diagnosis or demonstrated need, full gates in the final batch
   before push/integration). Never launch a visual session just because this
   skill was mentioned.
4. **No automatic code changes.** A taste critique never implies a renderer,
   poster, or UI edit. Any follow-up change needs its own explicit task, stays
   minimal, and goes through the normal verification gates.

## What upstream does NOT override

- **Current visual identity, scope, and working behavior are preserved.**
  Pictorium's gradients, glass/vetro treatments, shadows, accent colors
  (including purple), badge styles, and poster geometry are intentional and
  covered by visual regression snapshots.
- **Upstream bans or quotas are suggestions, not gates.** Rigid upstream rules
  such as bans on gradients/glass/purple/shadows, or image/animation quotas
  written for marketing websites, do not gate Pictorium work and never justify
  renderer/poster changes on their own.
- **Single renderer stays single.** No second poster implementation, no forked
  geometry, no duplicated constants (see the `poster-sync` skill and
  `.agents/render-params.md`).
- **No installs without need and authorization.** No packages, no downloaded
  scripts, no builds, no snapshot updates, and no `RENDER_VERSION` regeneration
  as part of a taste critique.

## Precedence

Repository instructions, security policies, and tests prevail over any
upstream suggestion. On conflict: `AGENTS.md` and the `.agents/*.md` docs win,
code wins over stale descriptive docs, and failing tests block — never weaken
assertions or update snapshots to satisfy a taste opinion (see No Test-Gaming
in `AGENTS.md`).
