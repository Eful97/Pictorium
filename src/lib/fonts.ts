import path from "path"

/**
 * Elenco unico dei font passati a resvg. Prima viveva duplicato in quattro
 * punti (svg-badge + tre pill in poster-service) che avevano già divergito:
 * le copie di poster-service non caricavano il font dei simboli. Una sola
 * fonte di verità evita che il prossimo font aggiunto ne raggiunga solo metà.
 *
 * Rubik (SIL OFL 1.1) è il font ebraico: Inter non ha glifi ebraici e senza
 * Rubik nel fontdb ogni badge in ebraico verrebbe rasterizzato come tofu.
 * resvg fa fallback per-glifo sull'intero fontdb, quindi la sua sola presenza
 * qui basta a evitare i quadratini anche dove `font-family` resta "Inter" —
 * ma il fallback per-glifo ignora il peso richiesto e ripiega sempre sul
 * regular, per questo il testo ebraico dichiara "Rubik" esplicitamente via
 * `fontFamilyFor` (badge-svg-shared).
 */
const fontPath = (file: string) => path.join(/* turbopackIgnore: true */ process.cwd(), "src", "assets", "fonts", file)

export const FONT_INTER_REGULAR = fontPath("Inter-Regular.ttf")
export const FONT_INTER_BOLD = fontPath("Inter-Bold.ttf")
export const FONT_INTER_BLACK = fontPath("Inter-Black.ttf")
export const FONT_SYMBOLS = fontPath("NotoSansSymbols2-Regular.ttf")
export const FONT_RUBIK_REGULAR = fontPath("Rubik-Regular.ttf")
export const FONT_RUBIK_BOLD = fontPath("Rubik-Bold.ttf")
export const FONT_RUBIK_BLACK = fontPath("Rubik-Black.ttf")

export const FONT_FILES = [
  FONT_INTER_REGULAR,
  FONT_INTER_BOLD,
  FONT_INTER_BLACK,
  FONT_SYMBOLS,
  FONT_RUBIK_REGULAR,
  FONT_RUBIK_BOLD,
  FONT_RUBIK_BLACK,
] as const
