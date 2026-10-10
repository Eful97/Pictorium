# Pictorium posters in Nuvio — setup guide

## 1. What this guide does (Pictorium art inside Nuvio)

This guide feeds your Pictorium space's posters into **Nuvio** as custom
artwork: same Nuvio catalogs and order — only the poster image URLs change.
No server setup needed. You use a hosted Pictorium site, style your space,
copy one template link from Pictorium's Install Hub, and paste it into
Nuvio's Poster URL field.

What it is not: this is not a Stremio manifest install, and it does not
reskin Nuvio's whole interface. Each Nuvio view asks Pictorium for the shape
it wants (portrait or landscape), and Pictorium renders that shape on demand.

## 2. Pick a host and create your personal space

Open one verified public Pictorium instance (also listed in the README):

- https://pictorium.duckdns.org (community VPS)
- https://pictorium.elfhosted.com/ (ElfHosted)

Create your **own personal space**: pick a password and you receive a
**recovery key**. Save that recovery key somewhere safe — it is shown only
once, and it is your way back if you forget the password. Bookmark your
space URL (placeholder, yours will differ):

```
https://<host>/u/<your-space-uuid>/configure
```

Always return through that bookmark so you edit *your* settings. Anyone with
your editor link plus password can open your editor, so never post the link,
passwords, or recovery keys publicly or in screenshots.

## 3. Add your TMDB key (free, 2 minutes)

Pictorium reads movie and series info from TMDB, so it needs your TMDB key.
Sign up free at `themoviedb.org` (free account), open **Settings → API**
there, and copy the **API Key (v3 auth)** — the v3 key, not the v4 token.

Back in your Pictorium space, open **Settings**, find the **Your API keys**
section, paste the key into **Personal TMDB Key**, save, and wait for the
**Keys saved.** confirmation (use **Verify key** where offered). If search
later says **Enter a TMDB key in Settings to search**, you are likely in the
wrong space or the key never saved — re-paste, save, and re-test one poster.

## 4. Set your style, then save one poster as a test

Style in two passes. First, global defaults: in your space open **Settings**
(Tabs **Poster Style** and **Preferences**), pick the closest base (**Quick
setups** / presets, previewed in the **Global preview** sample poster), tune
badges, ratings, ranking, logo, gradient and blur, then press **Save as
defaults** and wait for the saved confirmation.

Optional but useful test: save one real title. Search it from your space
home, check the live WYSIWYG preview (what you see is what Nuvio receives),
and press **Save Poster**. Confirm it under **My Posters**. Your defaults
already render unsaved titles too, so this save is a verification step, not
a prerequisite — do it to prove the pipeline works before touching Nuvio.

## 5. Copy your Nuvio link (Install Hub, Follow mode)

In your space press **Install Hub** (the dialog is titled **Connect
Pictorium**). Switch to the **Nuvio** tab — its hint reads like *"Paste this
link into Nuvio's Poster URL field. Format adapts automatically to portrait
or landscape for each view."* Copy the template link field.

Check two things before leaving: the mode line says **Follow my space**
(*"Use saved changes without copying the link again"*), and the
**Fixed settings in the link** box under **Advanced options** stays **off**.
Keep the **ID** dropdown on **Auto (recommended)** unless you know you need
a TMDB- or IMDb-only variant. Placeholder template (yours will differ):

```
https://<host>/api/poster/{type}/{tmdb_id|imdb_id}?u=<your-space-uuid>&live=1&shape={shape}
```

Never share a link containing a raw `api_key` value, and use placeholders —
no real IDs or secrets — in any public example.

## 6. Paste into Nuvio's Poster URL field (not a manifest)

In Nuvio, find the **Poster URL** field and paste the full template from
Section 5. This is a per-title artwork URL template, not an addon manifest:
do not paste it into any addon/manifest install box, and do not paste a
Stremio `manifest.json` link into the Poster URL field — they are different
contracts and are not interchangeable.

Version honesty: Nuvio's settings layout differs across apps, platforms, and
releases, so this guide names only the destination field (**Poster URL**)
and does not assert an exact parent menu path. Open Nuvio's settings on the
device/version you use, locate that field, and paste there. Press
**Save**/**Apply** if your build offers it, then re-open a catalog to test.
If your build has no Poster URL field at all, your version may not support a
custom poster template — update to a supported Nuvio release rather than
assuming the field just moved.

## 7. Keep `shape={shape}` exactly as copied

The Nuvio template ends with the literal text `shape={shape}`. Keep it
byte-identical: do not "fix" the braces, do not replace it with
`shape=landscape` or `shape=poster`, and do not paste the AIOMetadata-tab
link here (that variant has no shape placeholder and does not let Nuvio
dynamically request a shape per view).

Why it matters: Nuvio substitutes `{shape}` per view with `poster`,
`landscape`, or `square`. Pictorium renders `poster` as the vertical canvas
and `landscape` as 16:9; `square` has no dedicated canvas server-side, so it
falls back to the portrait render (see `resolvePosterShape` in the sources).
A hardcoded `shape=landscape` would serve wide art even where Nuvio asked
for a poster — the placeholder lets each view get the art it asked for.

## 8. Let Nuvio actually ask for landscape (Landscape Posters)

Pasting the template only makes landscape art *available*. Whether you *see*
wide cards depends on Nuvio's own layout settings: enable **Landscape
Posters** in Nuvio's UI/appearance/home-layout settings (per Nuvio's
Cross-Platform UI and Customization wiki, this control lives under the
**Shared** Home Screen & Layout Structures section, next to Poster Card
Style sizing and Card Depth Effect). The exact parent menu and wording vary
by app (TV vs mobile), platform, and Nuvio version, so look for the
**Landscape Posters** toggle in your client's display/layout settings rather
than following a fixed click path from another device's screenshots.

Two real distinctions from that same wiki page: on TV the result also
depends on the view layout (**Modern** expands the focused poster into a
hero/backdrop area, **Classic** and **Grid** use a rotating Hero Carousel),
and on mobile the **Continue Watching** shelf has its own style switch
(**Card** vs **Wide** vs **Poster**). Related but separate: episode entries
may prefer episode thumbnails/stills over series artwork — that is Nuvio's
thumbnail preference, not the series poster shape.

## 9. Who decides the shape: space default, title, or Nuvio view

Three independent layers, in plain order. (1) Your Pictorium global
**Poster shape** default (Settings → **Preferences** → **Poster Style**)
covers new and never-saved titles. (2) A title you edited and **Save
Poster**-ed keeps its own saved shape. (3) Nuvio's per-view `{shape}`
request overrides the stored space default and per-title shape: Pictorium
renders the requested shape with the matching shape-profile settings for
that slot.

There is deliberately no per-catalog shape recipe in this guide: no
Nuvio-side per-catalog shape control has been verified for current builds,
so none is documented here (a copied AIO-style gear-dialog recipe would be
invented). Contrast: AIOMetadata does expose per-catalog Poster Shape plus
bulk actions — that flow belongs to the sibling AIOMetadata guide
(`docs/discord-aiometadata-guide.md`), not to Nuvio. In Nuvio, shape choice
is the client's own view/layout setting (Section 8), not a Pictorium switch.

## 10. Checks, caching, IDs, and honest limits

Checks: a known saved title shows your Pictorium art; a never-saved title
renders from your global defaults. Portrait slots fetch vertical art,
landscape slots fetch wide art — then judge the final row look inside your
client, since each client's own card layout decides it.

Caching caveat: edits apply to future requests, but Nuvio/proxy/client
caches mean changes are **not instant**. Follow links (`live=1`) revalidate
per request, yet copies already cached elsewhere refresh on that client's
schedule — wait and re-request the view instead of saving repeatedly.

IDs: **Auto** (`{tmdb_id|imdb_id}`) fits supported views that provide IDs,
because different Nuvio rows carry different IDs; when a view provides neither ID, the template
keeps Nuvio's original poster. `{tmdb_id}` is exact but only where TMDB IDs
exist; `{imdb_id}` resolves server-side but can 404 on franchise-shared
`tt...` IDs (anthology splits) even when the title exists — prefer numeric
TMDB IDs or ask the instance operator for a manual alias. Limits: saved art
replaces artwork where your template serves it; it does not promise to
replace Nuvio's entire UI, heroes, or thumbnails.

## 11. Quick fixes, Follow vs Fixed, and privacy

Wrong art → confirm you edited the bookmarked space and pressed **Save
Poster** (Section 4). Template dead → re-copy from Install Hub's **Nuvio**
tab and check braces/placeholders (Sections 5 and 7). Everything portrait →
confirm the literal `shape={shape}` survived the paste and that
**Landscape Posters** is on in Nuvio (Sections 7–8).

Follow vs Fixed: with **Follow my space** (`live=1`), later **Save Poster**
/ **Save as defaults** edits apply without copying a new link; with **Fixed
settings in the link**, the visuals are frozen in the URL, so any later
style change needs a fresh copy and re-paste. Saving any single title is
optional, never a prerequisite for the integration.

Privacy and keys: `u=` is your space's public image namespace, not a
password. Optional MDBList and similar keys improve ratings sources but no
key guarantees any particular rating badge. Never post links, passwords,
recovery keys, or key-bearing exports (`api_key` in a URL) publicly — keep
backups on your own device only.

## Appendix — sources

- Pictorium [README.md](../README.md): personal spaces (`/u/<uuid>/configure`), TMDB key setup, **Follow my space** template (`live=1`) for Nuvio/AIOMetadata with live revalidation (clients pick up new renders on re-request; cached copies refresh on the client's schedule), and the automatic Nuvio variant letting the client choose the image shape.
- Pictorium [`src/components/InstallModal.tsx`](../src/components/InstallModal.tsx): **Connect Pictorium** dialog (**Install Hub** button), **Nuvio** tab hint (*Poster URL field; format adapts per view*), **Follow my space** vs **Fixed settings in the link** (**Advanced options**), **Auto (recommended)** / TMDB / IMDb ID selector; Nuvio templates carry literal `shape={shape}`, unlike the AIO variant.
- Pictorium [`src/lib/poster-url.ts`](../src/lib/poster-url.ts) (`buildUrlPattern`): Nuvio variant keeps one literal `shape={shape}` (URL-encoded braces restored post-encode); follow-space mode emits only identity (`u`), placeholders, keys per policy, and `live=1`.
- Pictorium [`src/lib/poster-config.ts`](../src/lib/poster-config.ts) (`resolvePosterShape`): `shape=landscape` renders 16:9, `shape=poster` and `shape=square` render the portrait canvas (no dedicated square canvas); unrecognized values fall through to mapping/config/defaults.
- Pictorium [`docs/INTEGRATION.md`](./INTEGRATION.md): `{tmdb_id|imdb_id}` auto alternation (consumer substitutes whichever ID the view provides, keeps the original poster when neither exists; verified against Nuvio `{a|b}` markers); `{tmdb_id}` exact alternative; `{imdb_id}` universal fallback with franchise-split 404 caveat; unmapped/mapped cache TTLs and fail-safe fallbacks.
- Pictorium English strings [`src/lib/translations/en.json`](../src/lib/translations/en.json): **Connect Pictorium**, **Your API keys**, **Personal TMDB Key**, **Verify key**, **Keys saved.**, **Global preview**, **Quick setups**, **Save as defaults**, **Save Poster**, **My Posters**, **Preferences**, **Poster Style**, **Poster shape**, **Link for AIO & Custom URL:**.
- Nuvio wiki [Cross-Platform UI and Customization](https://nuvio.wiki/settings/ui-and-customization) (fetched Oct 2026): **Shared** Home Screen & Layout Structures section documents **Landscape Posters** (portrait vs landscape cards), TV **Modern**/**Classic**/**Grid** layouts, mobile **Continue Watching** styles (**Card**/**Wide**/**Poster**), and episode-thumbnail vs series-artwork preferences. Exact parent menu paths vary by platform/version — field/setting names cited, paths not asserted.
- Sibling guide [`docs/discord-aiometadata-guide.md`](./discord-aiometadata-guide.md): AIOMetadata per-catalog **Poster Shape** gear dialogs and bulk actions — referenced as the AIO-only counterpart, not transplanted into Nuvio steps.
