# Pictorium Design System Package

Portable design-system package for [Open Design](https://github.com/nexu-io/open-design) (and any agent that consumes `DESIGN.md` + `tokens.css`).

## Contents

| File | Purpose |
|---|---|
| `manifest.json` | Open Design v1 package manifest (`od-design-system-project/v1`) |
| `DESIGN.md` | Brand contract for agents — palette, glass recipe, components, motion, poster visual language |
| `tokens.css` | Compiled semantic tokens extracted from the app |
| `assets/` | Brand logo |

## Install

Copy the folder into Open Design's catalog (drop-in, slug = `pictorium`):

```bash
cp -r design-systems/pictorium <open-design-repo>/design-systems/pictorium
# or install as a local plugin:
od plugin install ./design-systems/pictorium
```

Then select **Pictorium** in the Design System surface (no daemon restart needed).

Ready-made generation briefs (editor mockup, landing page, pitch deck, social banner): see `docs/open-design-briefs.md` in the Pictorium repo.

## Provenance & regeneration

- **Source of truth**: `src/app/globals.css` (tokens) and `DESIGN.md` (root of the Pictorium repo) — v0.15.2, `RENDER_VERSION efbfbbbe94`.
- **Sync rule**: if the app palette or the glass recipe changes, update `tokens.css` (and `DESIGN.md` if the contract changed) in the same commit.
- **Deliberate extraction**: token names use the `--od-*` prefix to avoid clashing with the app's own `--color-*`/`--glass-*` variables; values are copied verbatim.
