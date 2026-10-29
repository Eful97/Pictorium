# Badge & logo asset provenance ledger

Audit date: **2026-10-12** (UTC), reviewed against current target **2026-10-13** (UTC, HEAD `c50cf1b9`). Scope: the locally bundled badge/logo assets
under `public/rating/`, `public/networks/` and `public/quality-badges/` that the
poster renderer (Sharp/resvg) and the web UI embed.

This ledger records, per file, what was actually verified about its origin and
licensing, and what remains **unknown**. It is a documentation notice, **not
legal certification**: it grants no rights, claims no license, asserts no
public-domain status and claims no permission on behalf of any upstream project
or brand owner. Filenames are **not** treated as evidence of provenance — a file
named after a brand does not establish that the artwork came from that brand or
is licensed by it.

## 1. Inventory (exact)

- `public/rating/` — **16 files** (16 SVG; 14 audited 2026-10-12 + 2 added in `480138e7`, reviewed 2026-10-13).
- `public/networks/` — **62 files** (56 SVG + 5 PNG + 1 WebP).
- `public/quality-badges/` — **15 files** (15 SVG: `color/` 5, `mono/` 4, `video/` 6).
- **Total: 93 files = 87 SVG + 5 PNG + 1 WebP.** The historical 2026-10-12 audit covered 91 files (85 SVG + 5 PNG + 1 WebP); the 2 added rating SVGs are inventoried in §4.1 and assessed as UNASSESSED in §3.7/§5/§7.

A previous internal audit recorded "91 SVG"; that was incorrect — 6 of the 91
files are raster (5 PNG + 1 WebP), so there are **85 SVG**. Every file below is
listed exactly once, with its SHA256 and the git commits that first added it
(`added`) and last touched it (`last`), which makes the list reproducible.

## 2. Method and evidence

- **Hashes (historical, 2026-10-12):** SHA256 of every one of the original 91 files (`Get-FileHash -LiteralPath` /
  `node:crypto`), recorded per file in §4 and re-computed after this
  documentation change; all 91 re-computed hashes equalled the recorded values
  (see §7). Current verification method (2026-10-13, target HEAD `c50cf1b9`):
  SHA256 of raw target worktree bytes (`Get-FileHash -LiteralPath`) for the 2
  new files in §4.1; the existing 91 committed blobs are proven unchanged by
  `git diff --name-only 2a80ec7b..HEAD -- public/` (only the 2 new files),
  `git status -- public/` clean, and sampled blob equality (`A24_logo.svg`
  `8d20e483…`, `full-hd-label-color-icon.svg` `e92ceabb…` identical across
  base/attribution/target HEADs). The 51 raw-worktree SHA deltas vs the
  recorded values are a CRLF-checkout artifact (e.g. `A24_logo.svg` 1251
  bytes/11 CRLF vs 1240 bytes/0 CRLF), **not** drawing changes.
- **Embedded markers:** all 91 files were scanned for embedded source, license,
  copyright or attribution markers (`<!-- … -->`, `<metadata>`, `<title>`,
  `<desc>`, `license|licen|CC0|CC-BY|creativecommons|wikimedia|copyright|public
  domain|source`). Across the parsed markers listed above, no file showed an
  explicit artwork author, source URL, license grant or copyright line; this is
  scoped to those parsed text/XML markers and does not assert the absence of such
  data inside the binary raster files or in metadata that was not fully parsed.
  The `xmlns:cc="http://creativecommons.org/ns#"` attribute that
  appears in some SVGs is only an RDF namespace declaration and conveys no
  license; the `<metadata>`/`<rdf:RDF>`/`<cc:Work>` blocks (Netflix, Sky Cinema)
  contain only `dc:format`/`dc:type`/`dc:title` — no rights statement.
- **Git traceability:** `git log --diff-filter=A --name-only` and
  `git log --name-only` over the three directories (historical HEAD `2a80ec7b`, 1540 commits; current target HEAD `c50cf1b9`, 1542 commits; `base..HEAD -- public/` adds only `public/rating/art.svg` + `public/rating/tvdb.svg` in `480138e7`).
- **Bounded upstream check:** Simple Icons (§3.1) and the official TMDB logo
  (§3.5). No broader internet search was performed; the other 86 files stay
  `unknown` unless a marker exists.
- No build, test, install, network fetch of assets into the repo, commit, push or
  deploy was performed.

## 3. Findings

### 3.1 Simple Icons upstream drawing matches (4 files)

Four rating SVGs are byte-for-byte the **same drawing** as the current upstream
[Simple Icons](https://github.com/simple-icons/simple-icons) icons, with the only
local change being an added `fill` attribute (the upstream files carry no `fill`).
The match was proved against a **pinned, immutable revision**, not against a
"format-only" resemblance:

- Repository: `https://github.com/simple-icons/simple-icons`
- Default branch: `develop`; **pinned commit**
  `dc7b10662a0a2cfdfc9305e2a2b06c023c30724a` ("Bump version to 16.35.0",
  2026-10-11T01:01:30Z), read from the GitHub commits API on 2026-10-12.
- Upstream repository-level license, from the GitHub API: **CC0-1.0**. The pinned
  `LICENSE.md` is the CC0 1.0 Universal text (git blob
  `70d4a7b6740c5d9b594ff2fc27d3ea7e89413185`, 6569 bytes): its clause 4.1 states
  "No trademark or patent rights held by Affirmer are waived, abandoned,
  surrendered, licensed or otherwise affected by this document."

Evidence per icon (upstream path `<title>` and `viewBox="0 0 24 24"` and the
`<svg role="img" …>` shape are identical to local; the `path d` is character-for-
character equal):

| Local file (under `public/`) | Local SHA256 | Upstream URL (pinned) | Upstream git blob | Upstream content SHA256 | path `d` equal | local − `fill` == upstream |
|---|---|---|---|---|---|---|
| `rating/anilist.svg` | `d7412b0259d64adb9e248a4f9b18f8584219bba25793edd0842ace3b76c0156b` | `…/dc7b1066…/icons/anilist.svg` | `14384ac8f56cc815db2decf8d9197cbeda26d626` | `ac39519a8288aaf274c375c84a77e1b424a6665815d815c883064eb454fbabaf` | yes | yes |
| `rating/kitsu.svg` | `46902ae56588123792d2b9922c3a1c1cbe307945a0117ab2c4e2256eea92e601` | `…/dc7b1066…/icons/kitsu.svg` | `dbccdd0e3d8be6cee2cc5e073568d8420cb7e17e` | `7e4e5678aeee939672dc05994bbe91c994d6d44791a917d027b6b458fe12c803` | yes | yes |
| `rating/mal.svg` | `74828c0e171476cfe9805edc579b32470d5f8bb04605dfe48f65177b06de53c4` | `…/dc7b1066…/icons/myanimelist.svg` | `6e87b51397ca9933294ddb21339055ff09200aa2` | `fe248ea76ab41183b2a36fac69a627ea4a3d45af6b5e3c3c787640fec7304559` | yes | yes |
| `rating/mdblist.svg` | `3082767ad0a7dab245aea48e9b1e9f791df1ba5913b8abbbd2607d7551ce293b` | `…/dc7b1066…/icons/mdblist.svg` | `8dee4b74f17b6581e818b4af9a143b31b4588a91` | `9a4c9997112783200cdd17c66273561a7c7c0ab5611a527fdabb5153a56feda0` | yes | yes |

Full immutable URLs (the `…/dc7b1066…/` shorthand above expands to
`https://raw.githubusercontent.com/simple-icons/simple-icons/dc7b10662a0a2cfdfc9305e2a2b06c023c30724a`):

- `https://raw.githubusercontent.com/simple-icons/simple-icons/dc7b10662a0a2cfdfc9305e2a2b06c023c30724a/icons/anilist.svg`
- `https://raw.githubusercontent.com/simple-icons/simple-icons/dc7b10662a0a2cfdfc9305e2a2b06c023c30724a/icons/kitsu.svg`
- `https://raw.githubusercontent.com/simple-icons/simple-icons/dc7b10662a0a2cfdfc9305e2a2b06c023c30724a/icons/myanimelist.svg`
- `https://raw.githubusercontent.com/simple-icons/simple-icons/dc7b10662a0a2cfdfc9305e2a2b06c023c30724a/icons/mdblist.svg`

The local `fill` values equal the upstream per-icon `hex` (AniList `#02A9FF`,
Kitsu `#FD755C`, MyAnimeList `#2E51A2`, MDBList `#4284CA`).

**What this match does and does not prove.** It is evidence that the four local
vectors reproduce the Simple Icons *drawing* at that revision. It is **not**
proof of, and is not here used to claim, the historical origin of the artwork, a
license, or any permission — the underlying logos are third-party brand marks.

**Upstream licensing for these four (factual, not generalized).** Although the
Simple Icons *repository* is CC0-1.0, the project's own `DISCLAIMER.md` (pinned at
the same commit, SHA256 `5757a1f28eff735a8b5e7425478f367812d71e974530f5bedd01219480965f4a`)
states verbatim:

> Simple Icons is released under CC0 - though that doesn't mean to imply that all
> icons within the project are also CC0. Please see individual licenses where
> available.

> The addition of licenses to Simple Icons is an ongoing project. Hence, the
> absence of license data for a particular icon does not imply that the icon is
> not released under a license.

The upstream per-icon metadata file `data/simple-icons.json` (pinned at the same
commit, SHA256 `256322f4f06fe56b5ae8aed66375fda9d8f16a8955449f010c8533ef8b993ad2`)
records for these four icons only a `title`, a `hex` and a `source` URL — **no
`license` field**:

| Icon (slug) | `hex` | upstream `source` | `license` field upstream |
|---|---|---|---|
| `anilist` | `02A9FF` | `https://anilist.co` | absent |
| `kitsu` | `FD755C` | `https://kitsu.io` | absent |
| `myanimelist` | `2E51A2` | `https://myanimelist.net/wrap-up/anime-logo-mobile.svg` (alias "MAL") | absent |
| `mdblist` | `4284CA` | `https://mdblist.com/static/safari-pinned-tab.svg` | absent |

Therefore the repository's CC0 label is **not** extended to these four icons
here: upstream states no per-icon license, says the absence of per-icon license
data proves nothing, and excludes trademark rights. The brand names and marks
belong to their owners. This is recorded as an upstream **unknown**, not as a
license and not as proof that no rights exist.

### 3.2 Local adaptation comments (6 files)

Six `public/quality-badges/video/*.svg` files contain short HTML comments written
locally that describe an adaptation. They are **local comments, not provenance
evidence**: the word "official" in them is the author's description of the
artwork, not a license or a source citation.

- `video/imax.svg` — `<!-- IMAX official wordmark (2:1 calibrated) -->`
- `video/dolby-vision.svg` — `<!-- Dolby Vision official 2021 layout (2:1 calibrated) -->`
- `video/dolby-atmos.svg` — `<!-- Dolby Atmos official 2021 layout (2:1 calibrated) -->`
- `video/dolby-vision-atmos.svg` — `<!-- Dolby Vision · Atmos official combined layout (2:1 calibrated) -->`
- `video/hdr.svg` — `<!-- HDR bare mark (no container): letterforms only, viewBox cropped to the ink with uniform optical padding … -->`
- `video/hdr10-plus.svg` — `<!-- HDR10+ bare mark (no container): letterforms only, viewBox cropped to the ink … -->`

These files carry **no** source URL, author, or license text. The referenced
marks (IMAX, Dolby, HDR10+) are trademarks of their owners; no rights are
asserted here.

### 3.3 Third-party editor metadata only (53 files)

53 files contain only third-party editor/tool signatures — an Adobe Illustrator
"Generator" comment (50 files), an Inkscape comment (1: `DC_Studios_logo.svg`),
a Sketch `desc` (1: `rating/letterboxd.svg`), or an Inkscape/Adobe RDF
`<metadata>` block with no rights fields (Netflix, Sky Cinema; Sky Cinema also
carries an Adobe comment). These signatures show the file was produced or last
saved by a vector editor; they are **not** a source or license. Origin and
licensing remain unestablished for these files.

### 3.4 No embedded marker (27 files)

27 files carry no source, license, editor or adaptation marker at all. Their
origin and licensing are **unknown**. These comprise 12 network/studio raster or
plain SVGs (`12x16-batinthesun.png`, `American_Broadcasting_Company_Logo.svg`,
`Anton_United_Kingdom_logo.png`, `Bandai_Visual_corporate_logo.svg`,
`bellanova-big.png`, `Big+Talk+Studios+-+Logo+-+Brandmark.webp`,
`Gracie_Films_logo_webp.png`, `Hulu_logo_(2018).svg`, `jagged.svg`,
`Logo_of_RAI_(2016).svg`, `Showtime_logo.svg`, `ths-logo-300_webp.png`), 6 rating
SVGs (`filmweb`, `imdb`, `metacritic`, `popcorntime`, `tomatoes`, `trakt`), and
the 9 non-video quality SVGs (`color/` 5, `mono/` 4).

**Quality `mono/` and `color/` — corrected prior claim.** A previous audit called
these "local-authored AGPL" based only on the commits that added them and on
shared geometry. That is **not proven**. These files are generic resolution
labels ("4K"/"FHD"/"HD"/"SD" letterforms): local revisions are recorded in git
(see §4.2), but the original authorship and the applicable license are **not
established** by the available evidence. No AGPL, public-domain, or permission
status is assigned to them.

### 3.5 Official TMDB logo match (1 file)

`public/rating/tmdb.svg` reproduces the **official TMDB attribution logo**: its
bytes are byte-for-byte the drawing currently served by TMDB at the direct asset
URL

<https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg>

whose filename embeds the file's own SHA256. On 2026-10-12 the direct URL
returned **HTTP 200** and the downloaded bytes hashed to
`d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b` — identical
to the local `public/rating/tmdb.svg` hash recorded in §4.1. As with the Simple
Icons matches (§3.1), this is evidence that the local vector reproduces TMDB's
*official drawing*: it is **not** a license, a permission or a legal clearance,
and it waives no trademark right. The TMDB name and logo remain trademarks of
The Movie Database (TMDB). The separate `public/attribution/tmdb/` copy used by
the in-app "Credits" region is outside this ledger's scope and carries its own
asset notice (`docs/tmdb-attribution-asset.md`).

### 3.6 Consumers and `RENDER_VERSION`

- Rating assets: `src/components/RatingSourceIcon.tsx`,
  `src/lib/separate-rating-renderer.ts` (`SEPARATE_RATING_ICON_FILES`) and
  `src/lib/rating-svgs.ts` (inlined copies; `rating-svgs.ts` is a generated
  TS module, not a file reader).
- Network assets: `src/lib/network-svgs.ts` (`NETWORK_FILES`) and
  `src/lib/poster-service.ts`; only network/studio lookup can additionally fall
  back to TMDB-hosted images.
- Quality assets: `src/lib/quality-badge-styles.ts` (`QUALITY_BADGE_FILES`),
  `src/lib/av-specs.ts`, `src/lib/badge-styles.ts`.
- `scripts/write-render-version.mjs` hashes a fixed `RENDER_FILES` list: it
  includes the fonts and **14 of the 15 quality-badges SVGs**, but **not**
  `public/rating/*` nor `public/networks/*`, and it does not list
  `public/quality-badges/video/dolby-vision-atmos.svg`. `rating-svgs.ts` and
  `render-version.ts` are generated; this audit changed none of them.
- `public/quality-badges/color/full-hd-label-color-icon.svg` is present on disk
  (and listed in `RENDER_FILES`) but is not referenced by
  `quality-badge-styles.ts`, whose color `FHD` entry resolves to
  `full-hd-icon.svg`. Recorded as an observation, not a defect claim.

### 3.7 Two rating assets added after the 2026-10-12 audit (UNASSESSED, 2026-10-13 review)

`public/rating/art.svg` (worktree SHA256 `d5a5f9217384c27d64b4aac2cdb412a1eb204ab780b17c8e91984db1484a0624`, added + last `480138e7`) and `public/rating/tvdb.svg` (worktree SHA256 `7021f7cc38fb79128c51d1099414bf877fba77951036b021e05f59415ef7f8ff`, added + last `480138e7`) are committed in target `480138e7` and absent from the 2026-10-12 ledger §§1/4/7. Embedded-marker scan (same pattern as §2): `art.svg` carries only a generic `<title>images.png</title>` export title (no author, source URL, license grant or copyright line); `tvdb.svg` carries zero hits (single-line file; style fills only). A generic export title is **not** a source/license/permission marker. Both files are therefore **UNASSESSED**: no verified source, no license, no permission, no public-domain status is established or claimed here. Together with the 86 existing `unknown` files (§5), **88 of the current 93 files are without verified source/license/permission**. No clearance, public-domain, permission or compliance assertion is made for any of the 93 (same as §6).

### 3.8 `nova` quality/age style is code-only (no bundled asset)

The additive `nova` style for the streaming-quality badge (`qbs=nova`) and the
age certification badge (`agebs=nova`) is **100% generated by the renderer**
(`buildAgeEmphasisSvg(..., "nova")` in `src/lib/badge-svg-shared.ts`): a
near-black bluish plate, a metallic grey border gradient, an inner highlight
and bold white italic glyphs, all drawn as SVG from the dynamic label
(4K/FHD/HD/SD, DV/ATMOS/IMAX/HDR/HDR10+/DV+ATMOS, 12/PG-13/TV-MA).

Therefore this style adds **no file** to `public/`: no raster artwork, no
vendored WebP/PNG, no third-party CDN reference at render time. There is no
upstream artwork to attribute and **no license, permission or public-domain
status is claimed** — the palette is a local design choice, and the brand
names/marks (Dolby, IMAX, HDR10+, …) remain the property of their owners.
A previous plan to vendor third-party `xp_aurora` WebP plates was dropped by
explicit user decision before any asset was committed. This is recorded so a
future audit does not look for missing Nova files: the inventory of §4 is
unchanged, and `RENDER_FILES` lists only the code module that draws it.

## 4. Inventory (all 93 files, each exactly once)

### 4.1 `public/rating/` (16)

| File | SHA256 | added | last | status |
|---|---|---|---|---|
| `public/rating/anilist.svg` | `d7412b0259d64adb9e248a4f9b18f8584219bba25793edd0842ace3b76c0156b` | `0c517743` | `0c517743` | SI-match (§3.1) |
| `public/rating/filmweb.svg` | `3bcc830839fd7272a9c2f34d27d18735e322846148629808ed69d89359b82a30` | `0c517743` | `0c517743` | none (§3.4) |
| `public/rating/imdb.svg` | `77136937de2e4b3a6cb632be74e26c22a19c207fa5c708b28d6c6ae6e2d5380c` | `0c517743` | `0c517743` | none (§3.4) |
| `public/rating/kitsu.svg` | `46902ae56588123792d2b9922c3a1c1cbe307945a0117ab2c4e2256eea92e601` | `0c517743` | `0c517743` | SI-match (§3.1) |
| `public/rating/letterboxd.svg` | `58fee5e6af1ce586cf3f5a3a0fea2b82f865237079eb24fd77efac5ec06d0cd1` | `0c517743` | `0c517743` | editor-meta (§3.3) |
| `public/rating/mal.svg` | `74828c0e171476cfe9805edc579b32470d5f8bb04605dfe48f65177b06de53c4` | `0c517743` | `0c517743` | SI-match (§3.1) |
| `public/rating/mdblist.svg` | `3082767ad0a7dab245aea48e9b1e9f791df1ba5913b8abbbd2607d7551ce293b` | `0c517743` | `0c517743` | SI-match (§3.1) |
| `public/rating/metacritic.svg` | `0ca60d93575ec34ae4398fbd5a082ccb5f9e3bc074eccd16ebaa412da0b6269e` | `0c517743` | `0c517743` | none (§3.4) |
| `public/rating/popcorntime.svg` | `e56ff8ea4b56ce779365cedeaa807ba64761e6493466d0f073bf4537ee6134e0` | `0c517743` | `0c517743` | none (§3.4) |
| `public/rating/rogerebert.svg` | `c81ecf11c3cc875e328be59df570e24ec9459714a02be064f6e1972e900b30f3` | `0c517743` | `0c517743` | editor-meta (§3.3) |
| `public/rating/simkl.svg` | `1c26eddfb032a905f4e6012d7bca4dae66db53f74e10a456bee73954b46b7483` | `0c517743` | `0c517743` | editor-meta (§3.3) |
| `public/rating/tmdb.svg` | `d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b` | `0c517743` | `0c517743` | official-match (§3.5) |
| `public/rating/tomatoes.svg` | `ad590fe672e7501713a4e76bf478bd6106486f308cd6e1dbdd1157aa3492e2a8` | `0c517743` | `0c517743` | none (§3.4) |
| `public/rating/trakt.svg` | `4923b9cd284435e5716f235d4c27cd2f4a4c18643278930a4bc2c5843f3e8b6c` | `0c517743` | `0c517743` | none (§3.4) |
| `public/rating/art.svg` | `d5a5f9217384c27d64b4aac2cdb412a1eb204ab780b17c8e91984db1484a0624` | `480138e7` | `480138e7` | UNASSESSED (§3.7) |
| `public/rating/tvdb.svg` | `7021f7cc38fb79128c51d1099414bf877fba77951036b021e05f59415ef7f8ff` | `480138e7` | `480138e7` | UNASSESSED (§3.7) |

14 of the 16 rating files were added and last modified in commit `0c517743`
("feat(ratings): separate column, direct providers, keyless imdb/tmdb",
2026-09-20). The remaining 2 (`art.svg`, `tvdb.svg`) were added in `480138e7`
("feat: Redesign poster settings with independent presets and adaptive colors")
and are UNASSESSED (§3.7); the current-target git blob hashes are
`ca1d1210f73553e696be1003fb9e839b0d53942a` (`art.svg`) and
`0c5b58e49865c4a7961b3706dd2388c5ec648c6b` (`tvdb.svg`).

### 4.2 `public/quality-badges/` (15)

| File | SHA256 | added | last | status |
|---|---|---|---|---|
| `public/quality-badges/color/4k-label-color-icon.svg` | `39714e038d5bbee029d249f2109038ef784c3f2f69f16cdb0d0bc8031d6ef719` | `5566eaee` | `5566eaee` | none (§3.4) |
| `public/quality-badges/color/full-hd-icon.svg` | `76262bb4e85f487e7c32b0c53de01178e370b069035971127be701d53e37ea8e` | `5566eaee` | `de94ec53` | none (§3.4) |
| `public/quality-badges/color/full-hd-label-color-icon.svg` | `cac01d1bcd23cfc8c71636d5833f660b8e3343642dc28df994824409fffe329b` | `de94ec53` | `de94ec53` | none (§3.4) |
| `public/quality-badges/color/hd-label-color-icon.svg` | `1211ac4ba37a18de0c30fe034d26e3b5f13b59b865f078ceaa5cbd8574be7977` | `5566eaee` | `5566eaee` | none (§3.4) |
| `public/quality-badges/color/sd-label-color-icon.svg` | `5116c309599062fcd54c217662c322b85ecf394a4a8812f33aa4467ed6d5a85a` | `5566eaee` | `5566eaee` | none (§3.4) |
| `public/quality-badges/mono/4k-label-icon.svg` | `7e9f73027286363c39dc815af9d8a110a9ca919c10e59d51bdd956834ce2b2d1` | `5566eaee` | `5566eaee` | none (§3.4) |
| `public/quality-badges/mono/full-hd-label-icon.svg` | `4bcddf16b213f1925e3ba880c1df81314b355794e7ca2e1db35204935dfcfcc8` | `5566eaee` | `5566eaee` | none (§3.4) |
| `public/quality-badges/mono/hd-label-icon.svg` | `68e4f1129a8fff38c23b20b6848b246d2dce18473ba4ce21d604bdbdf29256eb` | `5566eaee` | `5566eaee` | none (§3.4) |
| `public/quality-badges/mono/sd-label-icon.svg` | `b5ec092b7c3c93ae8796ea819abb596df8d4b0a199a4de55955211c121ecff78` | `5566eaee` | `5566eaee` | none (§3.4) |
| `public/quality-badges/video/dolby-atmos.svg` | `47d6b8419f51be3fded9b7f095d9caa217b213f89fe113e1f7795342747dde4e` | `21220f94` | `8fe95aae` | adapt-comment (§3.2) |
| `public/quality-badges/video/dolby-vision-atmos.svg` | `b9bb3580146aafecb84a7543f848e211f63845095379bf7f0fcb4d94b7b34882` | `b8ba9370` | `232ff9cd` | adapt-comment (§3.2) |
| `public/quality-badges/video/dolby-vision.svg` | `6db12db0792c44b00f57743f9d970eb269ccdc3c36b268b1694c0858651ebfd3` | `21220f94` | `8fe95aae` | adapt-comment (§3.2) |
| `public/quality-badges/video/hdr.svg` | `d6890ecefd82cffa8c270ce6d14c657fd57cd7d4988130d16a35989a13c2893f` | `21220f94` | `2a80ec7b` | adapt-comment (§3.2) |
| `public/quality-badges/video/hdr10-plus.svg` | `bba61b2e5adbab21408d70e74acf26fe725fe1cd23505e23a26555126d182b25` | `21220f94` | `2a80ec7b` | adapt-comment (§3.2) |
| `public/quality-badges/video/imax.svg` | `f54a69a521165d106a8693ffcc276471e35546bbf2d52cc9d84f73700ea6abe9` | `21220f94` | `265b6fd2` | adapt-comment (§3.2) |

Relevant commits: `5566eaee` ("feat(poster): quality badge icon styles
(mono/color)", 2026-09-28), `de94ec53` (2026-09-29), `21220f94` ("Add local AV
specs database for 4K, Dolby Vision, Atmos and IMAX badges", 2026-09-29),
`8fe95aae`, `265b6fd2`, `b8ba9370`, `232ff9cd` (Dolby Vision/Atmos), `2a80ec7b`
(2026-10-11). These refs document local revisions only; they do not establish
original authorship or license (§3.4).

### 4.3 `public/networks/` (62)

| File | SHA256 | added | last | status |
|---|---|---|---|---|
| `public/networks/12x16-batinthesun.png` | `aea7bee534144e6be1fc82bf44449327dfc5d5e51b60ff2be6c147f494a704fd` | `f19c2341` | `f19c2341` | none (§3.4) |
| `public/networks/20th_Century_Studios_(2020) [Recuperato].svg` | `4066934f8abdbc7eaaa76e714e90210f76533a247a649a3e77c243a015600025` | `fb00d8ec` | `42044e63` | editor-meta (§3.3) |
| `public/networks/A24_logo.svg` | `f38c6ba5e266e101aeeb741df215911355ec5457e6c74e250d72579d839ec6d4` | `fb00d8ec` | `fb00d8ec` | editor-meta (§3.3) |
| `public/networks/Amc_logo.svg` | `33fa882ca32a1e666671905dc1169c23faec38cd1a744fe9a3cb4275c89bc8b4` | `c2cbfe6f` | `c2cbfe6f` | editor-meta (§3.3) |
| `public/networks/American_Broadcasting_Company_Logo.svg` | `e37d2d3fcd7514a82e568b7bb1efdcceee2aefb251ee96f9e517a8429f68c3ca` | `c2cbfe6f` | `f23cd044` | none (§3.4) |
| `public/networks/Anton_United_Kingdom_logo.png` | `177481c6cf3078f406b89eaec2c6614c227ed7ce6bdacdcfdeea3dbfeb3893e8` | `aea0ad93` | `aea0ad93` | none (§3.4) |
| `public/networks/Apple_TV_logo.svg` | `1bd2720fd94cb3704ab0689c03983cf8530f07a211a6faabadfe6300cabc211a` | `c2cbfe6f` | `c2cbfe6f` | editor-meta (§3.3) |
| `public/networks/Bandai_Visual_corporate_logo.svg` | `f0e8f1efe433ec48b24c303a962ecba85b42d72c20329493ebe3f6a110665e37` | `089e1522` | `089e1522` | none (§3.4) |
| `public/networks/Big+Talk+Studios+-+Logo+-+Brandmark.webp` | `87f5686d3949c248005ca3617af707cd5c3ff9bd3eee4d6fb49e9c8805479ffc` | `0c517743` | `0c517743` | none (§3.4) |
| `public/networks/CBS_logo_(2020).svg` | `2db6ba41fc176fbca5233d09b7930fb8f776cff251eb59dd947bdbb29935e48d` | `c2cbfe6f` | `c2cbfe6f` | editor-meta (§3.3) |
| `public/networks/CoMix Wave Films logo.svg` | `bf12d9c9fe17c28c2ab77404a16f451db176fbec99bf89d8993eb6104a528987` | `aea0ad93` | `aea0ad93` | editor-meta (§3.3) |
| `public/networks/Columbia_Pictures.svg` | `13de6a1615e09612579a3224b4d19290630c66b7cf32f8392b07cc637d8caba8` | `fb00d8ec` | `fb00d8ec` | editor-meta (§3.3) |
| `public/networks/DC_Studios_logo.svg` | `8ecaf1a7178f9bb7cbb6642180d2e514c2a6d0caf1473ccd57a9ed402cfd6175` | `f7a0b580` | `f7a0b580` | editor-meta (§3.3) |
| `public/networks/Disney+_logo.svg` | `827cac96456ad66baf2af779ce994963f71ad4b729804340956bf7708e2db8a3` | `c2cbfe6f` | `c2cbfe6f` | editor-meta (§3.3) |
| `public/networks/FOX_wordmark.svg` | `e6bef00714df025062d2e7904873db07177700e9c0201af20ec092cad9a88a1e` | `f23cd044` | `f23cd044` | editor-meta (§3.3) |
| `public/networks/FX_International_logo.svg` | `241c4a8308fc016801cf6ad98f50ffe1536efd5e4c4c17c1131cd262793a1456` | `c2cbfe6f` | `c2cbfe6f` | editor-meta (§3.3) |
| `public/networks/Fandango_logotipo.svg` | `8e24098f2abdb6bcaead8f2b40ba064b5d6a5b0cb34ea9024f4a2a0077bce756` | `089e1522` | `089e1522` | editor-meta (§3.3) |
| `public/networks/Gracie_Films_logo_webp.png` | `1aea2033bc15b8738e8f7b34799ee9e57329c380456dfd17aca031b246ac20a6` | `c93fbd90` | `c93fbd90` | none (§3.4) |
| `public/networks/HBO_logo.svg` | `0529eb25f187cb8a36e87b1673742fb55d3a915ebada00bc55349cb290f67c64` | `2f8ea5c3` | `2f8ea5c3` | editor-meta (§3.3) |
| `public/networks/Hulu_logo_(2018).svg` | `4d5cd0fda51a5d0f012044f4e36a5455899029fd5c8d4301dc085585fe044c08` | `c2cbfe6f` | `c2cbfe6f` | none (§3.4) |
| `public/networks/Indiana_Production.svg` | `638182a15bd2c513f82a094e75aefbac5f1168931702f5d500e8f94880487c60` | `e7ffd0fa` | `e7ffd0fa` | editor-meta (§3.3) |
| `public/networks/Legendary_Entertainment_logo.svg` | `b8e80f4e0e6b46df32fb6f15f69e51260488be0d7bf9f5ff24d46d8d08e05bee` | `fb00d8ec` | `fb00d8ec` | editor-meta (§3.3) |
| `public/networks/Lionsgate_Logo.svg` | `88dc3532651db96a8526c4de1bb44865a96a112e8d1015a13bbd9e4152c4c652` | `fb00d8ec` | `fb00d8ec` | editor-meta (§3.3) |
| `public/networks/Logo_of_RAI_(2016).svg` | `18a258257db9844c537c1ab326f1a43f497715968d3978ebae946482e2ac3d23` | `c2cbfe6f` | `f23cd044` | none (§3.4) |
| `public/networks/Lucasfilm_logo.svg` | `b06cf99a6a9665f8f8fc13b5d4742fb6487901c6485bd783eb73029cabe78f1d` | `87d56b2f` | `87d56b2f` | editor-meta (§3.3) |
| `public/networks/MAPPA_Logo.svg` | `0eecc0121868eddadf3c6bfa0e733b1096c5e77f2d766b68bf58af15a59c6ac1` | `089e1522` | `089e1522` | editor-meta (§3.3) |
| `public/networks/MGM+_logo.svg` | `19afe4a4e5e832d1eb42ef8ec9d9175e215886cbd8979c7e3e2e697d5795beaa` | `434f8458` | `42044e63` | editor-meta (§3.3) |
| `public/networks/Madhouse Studio logo.svg` | `bfab1358ff09c6bb2d89f975246672412c8058285f5bfb8f310afa3130447015` | `5dc9a3c8` | `5dc9a3c8` | editor-meta (§3.3) |
| `public/networks/Mainichi_Broadcasting_System_logo.svg` | `3dbb29019eb148fe290d72375fc3c0906bd935a4d9223a35d9d95ffc42f8e677` | `55820503` | `55820503` | editor-meta (§3.3) |
| `public/networks/Marvel_Studios_2016_logo.svg` | `9005fd7a818b441df605f5e1d6f14ecb6a048388b4230a924a2a9aa3fb6160c8` | `fb00d8ec` | `b6dd5924` | editor-meta (§3.3) |
| `public/networks/Mediaset_Infinity_logo.svg` | `3f4bdb56d3189bb0aefb2bb0d1e69aeb9365c4f4da4c05fb2a9285ea6623120f` | `c2cbfe6f` | `c2cbfe6f` | editor-meta (§3.3) |
| `public/networks/Medusa_Film_-_logo_(Italy,_2017-).svg` | `d22f33f0030aa9ec55a87122b66c315c397d7858da8b426137b80a4cfa62d228` | `fb00d8ec` | `42044e63` | editor-meta (§3.3) |
| `public/networks/Miramax_logo.svg` | `d9432e790f39ffb12d2779c1bcb9ac7f957f13f84f918e0ce6a5dea838238258` | `87d56b2f` | `87d56b2f` | editor-meta (§3.3) |
| `public/networks/NBC_logo.svg` | `17c07a947aea9f26232a93bf4ee06074d087f0220629cdbe6cb9599dc5788d61` | `c2cbfe6f` | `ae66064e` | editor-meta (§3.3) |
| `public/networks/National-Geographic-Logo.svg` | `f80dcf41fb61f2029bac884176c0008ad6aed1cedee1430a4f0ef47d36e17344` | `c2cbfe6f` | `c2cbfe6f` | editor-meta (§3.3) |
| `public/networks/Netflix_2016_N_logo.svg` | `13fe1ed72d6706bb925ed0629a203c16913d1fb2ec75ac6cf809162396432d5e` | `c2cbfe6f` | `b6dd5924` | editor-meta (§3.3) |
| `public/networks/New_Line_Cinema.svg` | `5d96cebe8ea48b3327149a74fe7ce7c89776e3f2d7b2ab86b78a0156862637ab` | `c93fbd90` | `c93fbd90` | editor-meta (§3.3) |
| `public/networks/Now_logo.svg` | `8af8fa99068590431a6c3ce22ad27f1b259214af003b26e7b4eb1fbd5bd7bca7` | `c2cbfe6f` | `c2cbfe6f` | editor-meta (§3.3) |
| `public/networks/Paramount_Plus.svg` | `af5199ec44faa6f2764e834f85614af69e802ce153ca355813458ad345aa65d9` | `c2cbfe6f` | `c2cbfe6f` | editor-meta (§3.3) |
| `public/networks/Pixar_logo.svg` | `3ac10b4145189101e578ace9d75f2b85168f25c06398c28346d747b293545192` | `2f8ea5c3` | `2f8ea5c3` | editor-meta (§3.3) |
| `public/networks/Pluto_TV_logo_2024.svg` | `7cefd55ca2346bb85e06b70d2981614cc2ada986e01de4fae502649de43692ab` | `c2cbfe6f` | `c2cbfe6f` | editor-meta (§3.3) |
| `public/networks/Prime_Video_logo_(2024).svg` | `5aee68dc7b9eb2a05d4f5d9fd7355f432c36781704de7c7d62b2f351456691be` | `2f8ea5c3` | `aa6ace5b` | editor-meta (§3.3) |
| `public/networks/Showtime_logo.svg` | `2a2ac03d2f357d7a4c429b213f4e3b3e9454d74ce553144a694d30e5933345ce` | `c2cbfe6f` | `8dc25719` | none (§3.4) |
| `public/networks/Sky_Cinema_-_Logo_2021.svg` | `cf9f0956b78a158bff0da57e4daae52a07b0283b450f1415b01640ada74c5dc1` | `e7ffd0fa` | `e7ffd0fa` | editor-meta (§3.3) |
| `public/networks/Skydance_Media_2020.svg` | `8a71297a886db475ef7fd1c3ef18cd2eeca5e15639b2abc34d2e42a34ed917e2` | `089e1522` | `089e1522` | editor-meta (§3.3) |
| `public/networks/Sony_logo.svg` | `e503ab1eb75bd8ab314433159c7113c1f3df99518c9f86f322c8f1c2b4cc35b9` | `fb00d8ec` | `fb00d8ec` | editor-meta (§3.3) |
| `public/networks/Studio_Ghibli.svg` | `fcb591e8cab7398bddc93d7e918f0194b90f491beadfd83ff86c9b073fa0278c` | `fb00d8ec` | `2f8ea5c3` | editor-meta (§3.3) |
| `public/networks/Studiocanal_2011_logo.svg` | `99f40e65bc2da2127295071551fcc07738d15f2f2ff044089ad734cea11ea62a` | `d8e463f6` | `d8e463f6` | editor-meta (§3.3) |
| `public/networks/Taodue_logo.svg` | `753241b84aa112d5d36f3e3136b4ce763348039c864e51e3397fa761ddee2644` | `e7ffd0fa` | `e7ffd0fa` | editor-meta (§3.3) |
| `public/networks/Tubi logo.svg` | `812e57b468b3b25ef7f56dc50c7b473aaadfcf3b1a158001d9de52979c69197b` | `c2cbfe6f` | `c2cbfe6f` | editor-meta (§3.3) |
| `public/networks/Universal_Pictures_logo.svg` | `97e66161f30bc27d5128f49ad7831f262f14e3e9da38fae30fb937c4d83d56e8` | `fb00d8ec` | `fb00d8ec` | editor-meta (§3.3) |
| `public/networks/Walt_Disney_Pictures_text_logo.svg` | `54f43627e2d539cd79eba6b98cae330f837afccde459bfb3e55755e0e724e1cb` | `fb00d8ec` | `2f8ea5c3` | editor-meta (§3.3) |
| `public/networks/Warner_Bros_logo.svg` | `f0ba80ca2098123ce27b20e5176c6bc6b2d838d9f41a01060c92f936a8771fb0` | `fb00d8ec` | `fb00d8ec` | editor-meta (§3.3) |
| `public/networks/bellanova-big.png` | `a4a57f96e7e2ab9d90b6507c0878c66e2c8946918f9c85ad2067bc2dcfcc040d` | `c93fbd90` | `c93fbd90` | none (§3.4) |
| `public/networks/castle-rock-entertainment.svg` | `346159d3a6f2a58452b54595679946a7d062ef560061cf7e43a1a079a6a7a897` | `87d56b2f` | `d7487481` | editor-meta (§3.3) |
| `public/networks/cr_logo_noTagline.svg` | `bfeacbff53067745a2922539d8d74d2dd22b9c036e863736ba1b2ccb4905ce6e` | `2f8ea5c3` | `089e1522` | editor-meta (§3.3) |
| `public/networks/deseo.svg` | `c548bc4ca5a95e59648320024308e74cd3ba77e5bd278d2f35a4d0c5c16e8231` | `c93fbd90` | `c93fbd90` | editor-meta (§3.3) |
| `public/networks/direzione-generale-cinema-e-audiovisivo-vector-logo.svg` | `c2690050150201887388be78e703cedd7341219e7fdddcc51533240d51f1da8f` | `089e1522` | `089e1522` | editor-meta (§3.3) |
| `public/networks/dreamworks-animation-logo-vector.svg` | `65da73b270545916ad65d02c0a69d8e1354184eb61c5b4a5466fb1f5c537be32` | `e7ffd0fa` | `e7ffd0fa` | editor-meta (§3.3) |
| `public/networks/jagged.svg` | `f150ce1dc0704824c107582062237677b1012fc9195e3f1b9e13cbae0eb8e465` | `c93fbd90` | `c93fbd90` | none (§3.4) |
| `public/networks/metro-goldwyn-mayer.svg` | `17283fa878539f31ca8d4d66f8478daab7568ddccfa9af9e041172ebbed90c88` | `b331463d` | `b331463d` | editor-meta (§3.3) |
| `public/networks/ths-logo-300_webp.png` | `8504e815b748b7009e27bc4b12467ec099a326c211112001ef4ec4f860dea0d1` | `f19c2341` | `f19c2341` | none (§3.4) |

The networks directory was added and extended across commits `c2cbfe6f`
(2026-08-23), `fb00d8ec`, `f23cd044`, `2f8ea5c3`, `434f8458`, `87d56b2f`,
`d970538e`, `e7ffd0fa`, `089e1522`, `b6dd5924`, `d7487481`, `f7a0b580`,
`b331463d`, `42044e63`, `0c517743`, `5dc9a3c8`, `d8e463f6`, `f19c2341`,
`c93fbd90`, `aea0ad93` and `aa6ace5b` (viewBox correction). These refs document
local revisions only; they do not establish original authorship or license.

## 5. Open gaps and unknowns

1. 88 of 93 files have **no verified source/license/permission** (86 existing `unknown` + 2 new UNASSESSED, §3.7); their origin and terms
   are unresolved. Only the four Simple Icons drawing matches (§3.1) and the one
   official TMDB logo match (§3.5) have a precise upstream drawing reference, and
   even there no license or permission is established.
2. For those four, the upstream per-icon `license` field is **absent**, upstream
   explicitly warns that CC0 does not imply every icon is CC0, and CC0 does not
   waive trademark rights. The brand marks remain owned by their respective
   owners; no permission is claimed.
3. The repository-level CC0-1.0 label of Simple Icons is **not** generalized to
   the third-party brand artworks.
4. The quality `mono/`/`color/` resolution labels are generic letterform artwork;
   original authorship and license are not established (§3.4). No AGPL,
   public-domain or permission status is assigned.
5. This audit is **bounded** (Simple Icons and the official TMDB logo only) and
   does not cover the wider set of networks/studios/logos; no full internet
   provenance hunt was run.

## 6. No compliance claim

This ledger is a factual notice about what was inspected on 2026-10-12 and reviewed on 2026-10-13. It is
**not** a legal opinion, a license, or a clearance. It does not assert that any
asset is public domain, freely licensed, or used with permission, and it does
not conclude that any use is compliant. Rights review for these assets remains
open.

## 7. Verification record

Historical checks were run on **2026-10-12** against the working tree (HEAD
`2a80ec7b`). They concern the reproducibility of this ledger, not the licensing
of the assets.

- **Inventory completeness (historical):** the three directories held exactly **91** files
  (14 + 62 + 15). The inventory in §4 contained **91 rows** naming **91 distinct
  paths**, so every file was listed exactly once, with no duplicate or missing
  path.
- **Hash re-check (historical):** the SHA256 of all 91 files was recomputed and compared with
  the value recorded for each file in §4; **all 91 matched**, so no asset changed
  while this ledger was written. This is the check referenced in §2.
- **File types (historical):** the 91 files were **85 SVG + 5 PNG + 1 WebP**, counted directly
  from the directories. See §2 for the hashing/extraction tooling.
- **Section references:** every `§` cross-reference in this document resolves to
  an existing section.
- **Method and limits:** the counts and hashes were produced by reading each file
  on disk; no asset, build, test, install, network fetch into the repo, commit,
  push or deploy was performed by this documentation work.

Current-target review (2026-10-13, HEAD `c50cf1b9`, 1542 commits; method: raw target worktree bytes via `Get-FileHash -LiteralPath` for new rows + git content proof for existing rows):

- **Inventory completeness (current):** the three directories hold exactly **93** files (16 + 62 + 15 = 87 SVG + 5 PNG + 1 WebP); §4 holds **93 rows** (91 historical + 2 new in §4.1), each path exactly once.
- **Existing 91 unchanged (committed content):** `git diff --name-only 2a80ec7b..HEAD -- public/` lists only `public/rating/art.svg` + `public/rating/tvdb.svg`; `git status -- public/` is clean; sampled git blob hashes are identical across base/attribution/target HEADs (`A24_logo.svg` `8d20e483…`, `full-hd-label-color-icon.svg` `e92ceabb…`). Changed = 0, missing = 0, unlisted-new = 2. The 51 raw-worktree SHA deltas vs §4 are a CRLF-checkout artifact, **not** drawing changes (see §2).
- **New rows:** `art.svg` worktree SHA256 `d5a5f9217384c27d64b4aac2cdb412a1eb204ab780b17c8e91984db1484a0624` + git blob `ca1d1210…`; `tvdb.svg` worktree SHA256 `7021f7cc38fb79128c51d1099414bf877fba77951036b021e05f59415ef7f8ff` + git blob `0c5b58e4…`; both added + last `480138e7` (`git log --diff-filter=A`); embedded-marker scan in §3.7 (generic title only / zero hits) — UNASSESSED, no permission claimed.
- **Preserved evidence:** the 4 Simple Icons drawing matches (§3.1) and the official TMDB logo match (§3.5) are carried forward unchanged; font/OFL hashes (§2 of `src/assets/fonts/README.md`) are unchanged.
