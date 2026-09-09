# Pictorium Design System

> Brand contract for AI-assisted design generation. Pictorium is a **dark, glassmorphism, cinema-grade UI** for a Stremio poster manager: it edits and serves personalized movie posters. The aesthetic is a premium streaming app — layered glass surfaces, a single warm orange accent, compact dense typography — with one signature behavior: **the UI accent adapts to the poster being edited** (`.ui-accent` theming).

## Brand

- **Product**: Pictorium — generate and manage custom posters for Stremio/media centers.
- **Audience**: Stremio power users, self-hosters, media-library enthusiasts.
- **Tone**: premium, cinematic, quietly technical. No gradients-on-gradients, no cartoonish decoration; the "modern look comes from layered surfaces, consistent borders, and compact spacing rather than large decorative blocks."
- **Reference palette feel**: Netflix-dark, warm ember accent, frosted glass.

## Palette

Dark is the default and the only fully-designed mode; light mode swaps the two base tokens only.

| Token | Value | Usage |
|---|---|---|
| `background` | `#0a0a0a` | Page background |
| `foreground` | `#ededed` | Primary text |
| `surface` | `#18181b` | Card backgrounds |
| `surface2` | `#27272a` | Hover states |
| `border` | `#3f3f46` | Borders |
| `muted` | `#a1a1aa` | Secondary text |
| `accent-orange` | `#e85d2a` | **The accent.** Primary actions, active states, glows |
| `accent` | `#ffffff` | Text accent / links |
| `danger` | `#f87171` | Destructive actions |
| `warning` | `#fbbf24` | Amber "best fit" badge |
| light bg / fg | `#f5f5f5` / `#1a1a1a` | `html.light-mode` overrides |

The accent is also available as RGB components: `--accent-rgb: 232 93 42`, used as `rgb(var(--accent-rgb) / <alpha>)` for glows, focus rings, borders, scrollbars and subtle tints. **Never hardcode the orange elsewhere.**

### Signature behavior: adaptive accent

The entire UI (toggles, tab chips, sliders, borders, glows, selection rings) re-tints itself with the dominant color of the poster currently edited, via a `.ui-accent` root class and `color-mix(in srgb, var(--color-accent, var(--color-accent-orange)) <pct>, transparent)`. When designing: active/selected states take an accent color at low alpha (10–20%) with a matching border (30–45%) and a soft glow (~12–18% alpha). This is what makes the editor feel alive — preserve it.

## Typography

- **UI**: Geist (sans) + Geist Mono for code/numbers; fallback Inter, Arial.
- **Poster badges** (server-rendered SVG): Inter Regular/Bold/Black + Noto Sans Symbols 2.
- **Density**: UI is deliberately compact. Labels 10–12px with `font-weight: 600–700`; section titles small-caps with `letter-spacing: 0.08–0.14em`; body 12–13px; tabular-nums for counters and ratings. Touch targets stay ≥44px even when text is small.
- **Display headings**: the header logo is an image; hero uses kicker pills (10–11px uppercase, accent color on 10% accent background) above a title.

## Surfaces — the glass recipe

Every elevated surface composes the same four ingredients (per-component overrides allowed):

```css
background: var(--glass-grad), var(--glass-tint);   /* white 3–7% gradient over near-black tint */
border: 1px solid var(--glass-border);              /* white 6–8% */
box-shadow: 0 16–20px 36–50px rgba(0,0,0,0.26–0.45), inset 0 1px 0 rgba(255,255,255,0.03–0.06);
backdrop-filter: blur(12–18px);
```

Defaults: `--glass-grad: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015))`, `--glass-tint: rgba(13,13,16,0.80)`, `--glass-border: rgba(255,255,255,0.08)`, `--glass-shadow: 0 16px 36px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.03)`.

Members of the glass family: editor panels, dropdowns (`glass-panel`), search shell (18px blur, darker tint `rgba(3,3,4,0.40)`), surface cards, poster tiles, preview frame, floating action buttons/groups, hero section, carousel cards, simkl-style list cards. Hover = border to white 14–18% + deeper shadow (+ optional accent glow ring). Active/selected = accent border + `0 0 0 1px accent@18%` ring.

Page background: `#0a0a0a` + a soft radial accent glow top-center (`rgb(var(--accent-rgb) / 0.12–0.16)`, 28–34rem) and a faint white radial at 12% 16%; the app shell adds a subtle 64px grid masked radially (opacity ~0.08) and a bottom vignette. A blurred poster image (mix-blend screen, opacity 0.20) floats behind as ambient light when editing.

## Components

- **Buttons**: primary = accent-orange gradient, white text, `inset 0 1px 0 rgba(255,255,255,0.20)`, glow `0 12–14px 30–34px accent@16–24%`, active `scale(0.95–0.97)`. Secondary = white 6% bg, white 10% border. Danger = red-900/30 bg, red border 50%, `--color-danger` text. All `font-weight: 600`, radius 0.75–0.875rem.
- **Toggles**: pill track 48×26, thumb 22px white; ON = accent bg + `0 0 12px accent@25%`; springy 0.35s `cubic-bezier(0.22,1,0.36,1)` thumb slide.
- **Tab chips**: 11–12px bold, radius 0.75rem, height ~2rem; active = accent text on accent 14% bg, accent border 40%, 2px accent underline hairline below.
- **Segmented control**: 2px-gap container, white 3% bg, active option accent text on accent 18% bg.
- **Sliders**: 6px track, gradient fill accent → accent-mix, 18px circular thumb with halo ring.
- **Pills/badges** (status, kicker, counter): 10–11px bold uppercase, letter-spacing 0.04–0.12em, accent or white 10% bg, accent/white 18–22% border, optional blur.
- **Editor layout**: three columns (options | live preview on a frosted podium with accent glow ring when active | details), each an `editor-panel` with a 2px accent hairline at the top edge. Poster tiles: 2/3 aspect, hover lift `translateY(-2px) scale(1.015)` + accent glow; selected = accent border + ring.
- **Floating group**: bottom-right glass island (radius 1rem) of 36–44px icon buttons; tooltips on hover via `aria-label` (dark, white 10% border).
- **Scrollbars**: 6px, gradient `accent@55% → accent@28%` thumb.
- **Search shell**: glass with focus ring `0 0 0 3px accent@8%`.

## Motion

150–300ms, transform/opacity only, easing `cubic-bezier(0.22, 1, 0.36, 1)`. Entrance: fade + 6–24px translate (hero/panels), staggered lists. Hover lifts −1 to −4px. Press scale 0.93–0.97. Respect `prefers-reduced-motion` (disable all).

## Layout & density

- Compact: panel padding 0.75–0.875rem, controls 11–12px, gaps 0.125–0.5rem; section dividers with an accent tint in the middle.
- Min touch target 44×44px; safe-area bottom padding on mobile.
- Max content width 1680px; floating toolbar top-right (desktop) / row under the header (mobile).
- Header: logo (image) centered, uppercase tagline beneath (`letter-spacing 0.14em`, muted 55%), version badge fixed top-left.

## Poster visual language (the product output)

500×750 JPEG posters composed server-side (Sharp + SVG badges via Resvg). Badge families:

- **Genre/rating badge**, 6 styles: `shadow` (text with drop shadow), `pill`, `bar` (full-width bottom bar), `colored` (solid accent bg), `bordo` (bordered), `vetro` (glass). Components genre/year/rating toggleable; text color adapts to badge background luminance (`textColorForBg`).
- **Ranking/trend badge**, 5 styles: `default`, `bar`, `colored`, `pill`, `netflix` (iconic vertical red ribbon, left by default, right for Stremio; extended variant with "anime" label for anime charts).
- **Network logo** overlays next to ranking badge (Netflix, Disney+, HBO Max, Prime Video, Apple TV+, Paramount+, Rai, Crunchyroll, Sky/NOW, Mediaset Infinity, Tubi, Pluto TV).
- Accent colors are extracted from the poster image; bottom blur gradient (native sharp blur ~10–20ms) with fade + darken.

## Do / Don't

- ✅ Layered glass over flat fills; one warm accent; compact dense labels; accent-adaptive active states; soft glows at low alpha; consistent 0.22,1,0.36,1 easing.
- ❌ No second accent color; no pure-white large surfaces; no text smaller than 10px in UI; no shadows without an inset top highlight; no layout that breaks at 44px touch targets; don't hardcode the accent hex — use the tokens.
