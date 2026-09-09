# Bundled fonts

Scaricati da `node scripts/download-fonts.mjs`, versionati nel repo perché il
render dei poster (`src/lib/fonts.ts` → resvg) li legge da disco con
`loadSystemFonts: false`: senza i file il badge esce vuoto.

| File | Famiglia | Licenza | Uso |
|---|---|---|---|
| `Inter-Regular.ttf`, `Inter-Bold.ttf`, `Inter-Black.ttf` | Inter | SIL Open Font License 1.1 | Testo latino di tutti i badge (pesi 400/700/900) |
| `NotoSansSymbols2-Regular.ttf` | Noto Sans Symbols 2 | SIL Open Font License 1.1 | Glifo stella ★ del badge genere |
| `Rubik-Regular.ttf`, `Rubik-Bold.ttf`, `Rubik-Black.ttf` | Rubik | SIL Open Font License 1.1 | Testo ebraico: Inter non ha glifi ebraici |

Rubik copre latino ed ebraico. resvg fa fallback per-glifo sull'intero fontdb,
quindi la sola presenza dei file evita i quadratini anche dove `font-family`
resta `Inter` — ma quel fallback ignora il peso richiesto e ripiega sempre sul
regular, per questo `fontFamilyFor` (in `src/lib/badge-svg-shared.ts`) dichiara
`Rubik` esplicitamente quando il testo contiene ebraico.
