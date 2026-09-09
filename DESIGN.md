# Pictorium Design System

## Z-Index Layers

| Layer | Value | Usage |
|-------|-------|-------|
| Behind | `-z-10` | Background blur image |
| Content | `z-10` | Rank row posters, skeletons |
| Overlay | `z-20` | Loading spinners |
| Gradient | `z-30` | Rank row edge fade |
| Controls | `z-40` | Scroll buttons |
| Floating | `z-50` | FABs, dropdowns, version badge, settings panel |
| Mobile settings | `z-[70]` | Full-screen settings overlay (mobile) |
| Full-screen | `z-[100]` | Lang picker, search bar isolate |
| Confirm backdrop | `z-[199]` | Inline confirm dialog backdrop |
| Confirm dialog | `z-[200]` | Inline + full confirm dialogs |

## Touch Targets

Minimum 44×44px for interactive elements on mobile.
- Toggle: `w-12 h-7` (48×28px) — uses `role="switch"` + `aria-checked`
- Toolbar buttons: `h-11` (44px)
- Floating buttons: `h-11 w-11` (44×44px)
- Search submit: `w-10 h-10` (40×40px)
- Dropdown items: `py-2.5` minimum

## Color Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `background` | `#0a0a0a` | Page background |
| `foreground` | `#ededed` | Primary text |
| `surface` | `#18181b` | Card backgrounds |
| `surface2` | `#27272a` | Hover states |
| `border` | `#3f3f46` | Borders |
| `muted` | `#a1a1aa` | Secondary text |
| `accent-orange` | `#e85d2a` | Primary accent |
| `accent` | `#ffffff` | Text accent / links |
| `panel` | `rgba(18,18,22,0.74)` | Translucent glass panels with visible ambience |
| `panel-strong` | `rgba(21,21,26,0.92)` | Strong panel surfaces |
| `border-subtle` | `rgba(255,255,255,0.08)` | Default modern borders |
| `border-strong` | `rgba(255,255,255,0.14)` | Hover/active borders |
| `danger` | `#f87171` | Destructive actions (btn-danger) |
| `warning` | `#fbbf24` | Amber best-fit badge (`fit-badge-amber`) |

Light mode: `html.light-mode` overrides `background` → `#f5f5f5` and `foreground` → `#1a1a1a`.

## Modern Surface Classes

Defined in `src/app/globals.css` and preferred over repeating long Tailwind class strings.

| Class | Usage |
|-------|-------|
| `.app-shell` | Main app background with radial ambient light and subtle grid |
| `.glass-panel` | Dropdowns and elevated overlays |
| `.top-action-button` | Header action buttons |
| `.editor-panel` | Main three-column editor cards |
| `.editor-panel-header` | Panel header/tabs area |
| `.editor-panel-body` | Scrollable panel content |
| `.tab-chip` / `.tab-chip-active` | Compact segmented/tab controls |
| `.search-shell` / `.search-shell-active` | Search input shell |
| `.surface-card` | Search and saved-poster cards |
| `.poster-tile` / `.poster-tile-active` | Poster and logo selectable tiles |
| `.preview-frame` | Main rendered poster preview shell |
| `.floating-action` | Bottom-right floating controls |

Motion should stay subtle: transform/opacity only, usually 150-300ms. The modern look comes from layered surfaces, consistent borders, and compact spacing rather than large decorative blocks.

## Badge System

- Genre/Rating badges: `textColorForBg()` for adaptive text
- Badge styles: `shadow`, `pill`, `bar`, `colored`, `bordo`, `vetro`
- Ranking styles: `default`, `bar`, `colored`, `pill`, `netflix`
- Server-side SVG rendering with Resvg
- `CHAR_WIDTH = 0.62` for text measurement
- `RENDER_VERSION` must be bumped when badge rendering changes

## Component Architecture

```
AppShell
├── VersionBadge (fixed top-left)
├── LangPicker (full-screen overlay)
├── SearchView | MyPostersView | EditView
├── Floating buttons (fixed bottom-right)
│   ├── Refresh
│   ├── Status
│   └── Language
├── SettingsPanel (desktop: dropdown, mobile: full-screen)
└── Mobile settings overlay
```

## Hook Architecture

- `useNavigation` — view state, history, poster browser
- `useTrending` — trending/anime/streaming data (FlixPatrol lazy: batch 2 ogni 300ms, defer 2s)
- `useSearch` — query, results, error, pagination (solo TMDB, Groq rimosso)
- `useMappingsStore` — mappings CRUD, persistenza file/KV
- `useDefaults` — server-side default settings
- `usePosterSave` — poster save/preview logic
- `usePosterEditor` (`contexts/PosterEditorContext`) — stato editor (badge/blur/logo/backdrop/rotation)
- `usePosterFit` — best-fit poster selection (`concurrentMap` limit 5, `withTimeout` unref)
- `usePosterPreview` — preview reload (XHR blob URL) + toast
- `useRootColors` — estrazione accent/top-edge color dal poster
- `useCollections` — poster collections (localStorage)
- `useCustomCatalogs` — cataloghi personalizzati (customCatalogs, catalogOrder, renames)
- `useOutsideDismiss` — chiusura dropdown al click esterno

## i18n

- 8 languages: en, it, fr, de, es, ja, ko, pt
- Keys prefixed with `ui.` for UI strings, `badge.` for badge labels
- `__` prefix for badge keys that need translation at render time
- `createT(lang)` for server-side translation

## Accessibility

- All toggles use `role="switch"` + `aria-checked`
- Dialogs use `role="dialog"` + `aria-modal="true"` + `aria-label`
- Focus-visible rings on all interactive elements (orange outline)
- Minimum touch targets 44px on mobile
- Skeleton loading instead of text spinners
