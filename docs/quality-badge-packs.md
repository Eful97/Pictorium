# Quality badge packs

Pictorium posters draw a **quality badge** (tier + age + A/V marks). The built-in
marks are `dv`, `hdr`, `hdr10plus`, `atmos`, `imax`, derived from the local
`src/data/av-specs.json` database. A **pack** adds more marks through a vendored
JSON manifest and vendored assets.

## Hard rules

- Assets are **vendored in the repo**, served from `public/quality-badges/pack/`.
  The app never fetches a remote asset at render time and the image allowlist is
  not touched.
- Only import assets you have the right to redistribute. The manifest records the
  source; add attribution to `NOTICE`. A repository without an explicit license
  is **not** redistributable.
- Pack marks are **manual**: they appear only when selected in the space defaults
  or per title. There is no automatic per-title attribution in this version.

## Manifest

The shipped default is **empty** (`"marks": []`): built-in A/V marks already
cover the title-level quality data, and these extra marks have no per-title
source, so nothing is invented by default. Add marks only when you have a
curated set (or run the importer below). The demo files left in
`public/quality-badges/pack/` are test fixtures for the mocked suites; with an
empty manifest they are not selectable.

`src/data/quality-badge-pack.json`:

```json
{
  "version": "1",
  "source": "internal",
  "marks": [
    {
      "id": "remux",
      "label": "REMUX",
      "icon": "quality-badges/pack/remux.svg",
      "mode": "tintable",
      "inkBox": { "x": 25.9, "y": 14.9, "w": 149.5, "h": 29.5 },
      "accent": "gold",
      "gradientStops": ["#FF2D2D", "#FFB800"],
      "home": "hdr"
    },
    {
      "id": "av1",
      "label": "AV1",
      "icon": "quality-badges/pack/av1.png",
      "mode": "opaque",
      "aspect": 2.5
    }
  ]
}
```

Fields:

| Field | Required | Notes |
|---|---|---|
| `id` | yes | `^[a-z0-9][a-z0-9_.-]{0,31}$`, unique, never a built-in id |
| `label` | yes | chip + text styles (`strip`/`nova`/`gradient`/`outline`), max 40 chars, unique |
| `icon` | yes | must start with `quality-badges/pack/`, no `..` |
| `mode` | yes | `tintable` or `opaque` |
| `inkBox` | tintable | measured ink bounds in viewBox units (`w/h > 0`) |
| `aspect` | opaque | natural width / height |
| `accent` | no | `gold` \| `cyan` \| `dolby` (premium style) |
| `gradientStops` | no | 2–8 hex colors (gradient style) |
| `home` | no | existing home kind: `tier` \| `age` \| `dolby` \| `hdr` \| `imax` |

Runtime validation is fail-open (invalid entries are skipped with a warning). The
shipped manifest is validated fail-closed by
`src/__tests__/rendering/quality-badge-pack.test.ts`, including a re-measurement
of every tintable `inkBox` and the opaque `aspect`.

## Importing an external pack

```bash
node scripts/import-quality-badge-pack.mjs <source.json|url> \
  [--out src/data/quality-badge-pack.json] \
  [--assets-dir public/quality-badges/pack] \
  [--include-disabled]
```

The importer accepts the common stream-badge editor shape
(`{ filters: [{ id, name, imageURL, isEnabled }] }`):

- downloads each asset once into `public/quality-badges/pack/` (cap 10 MB per file);
- SVG → `tintable` with a measured `inkBox`;
- PNG/WebP/JPEG → `opaque` with the measured `aspect`;
- discards `pattern` regexes, colors and stream-matching metadata: Pictorium has
  no stream name to match, so they would be dead weight;
- skips disabled filters unless `--include-disabled`;
- skips entries whose id or label duplicates a built-in A/V mark (`DV`, `HDR`,
  `HDR10+`, `ATMOS`, `IMAX`) or another pack mark — the built-ins already cover
  those, and duplicate labels would confuse the selector;
- reports skipped entries.

The import **replaces the active pack**: `--out` and `--assets-dir` default to the
shipped manifest/assets. Only one pack is active at a time in this version.

Then:

```bash
node scripts/write-render-version.mjs   # new pack assets change RENDER_VERSION
npm run verify
```

Never edit `src/lib/render-version.ts` by hand.

## Selecting marks

- Global defaults: Settings → Badge → Qualità → marchi qualità.
- Per title: the quality family in the editor.
- URL: `formats=<id>,<id>` (`formats=none` = no marks).
- Mapping/defaults store the same ids; unknown ids are dropped.

Built-in marks still require the title's local AV spec; pack marks do not (they
are manual), and are painted only when explicitly selected.

## Styles

- `tintable` marks follow every quality style (pill, mono, color, premium,
  knockout, naked, gradient, nova, outline, strip).
- `opaque` marks are placed as-is (no plate/frame/tint/mask); the style still
  governs the tier and the tintable marks.
- Text-only styles (`strip`, `nova`, `gradient`, `outline`) render the mark
  `label`, not the asset.

## Limits

- Max `MAX_QUALITY_MARKS = 8` extra marks per group.
- Pack labels are not localized.
- Raster tinting is not supported: use an SVG with `fill="currentColor"` when the
  mark must follow the poster style.

## Verification

```bash
npx vitest run src/__tests__/rendering/quality-badge-pack.test.ts \
               src/__tests__/rendering/quality-marks-selection.test.ts \
               src/__tests__/storage-cache/render-version-files.test.ts \
               src/__tests__/i18n-a11y/translations-parity.test.ts
npx playwright test e2e/pictorium-visual.spec.ts --grep "quality"
```

For rendering changes the visual gate is mandatory; if it cannot run, report
`visual gate pending`.
