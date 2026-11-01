import path from "path"

/**
 * Elenco unico dei font passati a resvg. Prima viveva duplicato in quattro
 * punti (svg-badge + tre pill in poster-service) che avevano già divergito:
 * le copie di poster-service non caricavano il font dei simboli. Una sola
 * fonte di verità evita che il prossimo font aggiunto ne raggiunga solo metà.
 *
 * Rubik (SIL OFL 1.1) è il font ebraico e arabo: Inter non ha glifi ebraici né
 * arabi e senza Rubik nel fontdb ogni badge in ebraico o arabo verrebbe
 * rasterizzato come tofu.
 * resvg fa fallback per-glifo sull'intero fontdb, quindi la sua sola presenza
 * qui basta a evitare i quadratini anche dove `font-family` resta "Inter" —
 * ma il fallback per-glifo ignora il peso richiesto e ripiega sempre sul
 * regular, per questo il testo ebraico e arabo dichiara "Rubik" esplicitamente
 * via `fontFamilyFor` (badge-svg-shared).
 *
 * `FONT_FILES` resta il fontdb completo (ordine storico); `fontFilesFor`
 * seleziona i soli gruppi usabili da un render (fontdb resvg per-istanza).
 */
const fontPath = (file: string) => path.join(/* turbopackIgnore: true */ process.cwd(), "src", "assets", "fonts", file)

export const FONT_INTER_REGULAR = fontPath("Inter-Regular.ttf")
export const FONT_INTER_BOLD = fontPath("Inter-Bold.ttf")
export const FONT_INTER_BLACK = fontPath("Inter-Black.ttf")
export const FONT_SYMBOLS = fontPath("NotoSansSymbols2-Regular.ttf")
export const FONT_RUBIK_REGULAR = fontPath("Rubik-Regular.ttf")
export const FONT_RUBIK_BOLD = fontPath("Rubik-Bold.ttf")
export const FONT_RUBIK_BLACK = fontPath("Rubik-Black.ttf")
export const FONT_BARLOW_REGULAR = fontPath("BarlowCondensed-Regular.ttf")
export const FONT_BARLOW_BOLD = fontPath("BarlowCondensed-Bold.ttf")
export const FONT_BARLOW_BLACK = fontPath("BarlowCondensed-Black.ttf")
export const FONT_OSWALD_REGULAR = fontPath("Oswald-Regular.ttf")
export const FONT_OSWALD_SEMIBOLD = fontPath("Oswald-SemiBold.ttf")
export const FONT_OSWALD_BOLD = fontPath("Oswald-Bold.ttf")

const FONT_GROUP_INTER = [FONT_INTER_REGULAR, FONT_INTER_BOLD, FONT_INTER_BLACK] as const
const FONT_GROUP_RUBIK = [FONT_RUBIK_REGULAR, FONT_RUBIK_BOLD, FONT_RUBIK_BLACK] as const
const FONT_GROUP_BARLOW = [FONT_BARLOW_REGULAR, FONT_BARLOW_BOLD, FONT_BARLOW_BLACK] as const
const FONT_GROUP_OSWALD = [FONT_OSWALD_REGULAR, FONT_OSWALD_SEMIBOLD, FONT_OSWALD_BOLD] as const

/** Fontdb completo: ordine storico Inter → Noto → Rubik → Barlow → Oswald. */
export const FONT_FILES = [
  ...FONT_GROUP_INTER,
  FONT_SYMBOLS,
  ...FONT_GROUP_RUBIK,
  ...FONT_GROUP_BARLOW,
  ...FONT_GROUP_OSWALD,
] as const

/**
 * Gruppi che un singolo render SVG può davvero usare.
 *
 * Il fontdb di resvg è PER-ISTANZA (`index.d.ts` espone solo `fontFiles` /
 * `fontDirs`: nessun fontdb condiviso, nessun buffer di font), quindi ogni
 * `new Resvg` rilegge e ri-parsa i file elencati. Con i 13 file completi un
 * poster da 6-10 badge paga quel costo su ogni bitmap; passando solo i gruppi
 * necessari il caso comune (testo latino su Inter) scende a 3 file.
 *
 * La selezione è conservativa: Inter c'è sempre, Rubik/Barlow/Oswald solo se
 * l'SVG li dichiara, Noto Symbols2 solo se il testo esce dalle fasce coperte
 * da Inter/Rubik (vedi `fontSubsetFor` in `svg-badge.ts`). Quando tutti i
 * gruppi sono attivi l'ordine è IDENTICO a `FONT_FILES`: stesso fontdb, stessi
 * byte.
 */
export interface FontSubset {
  readonly rubik?: boolean
  readonly barlow?: boolean
  readonly oswald?: boolean
  readonly symbols?: boolean
}

export function fontFilesFor(subset: FontSubset = {}): string[] {
  const files: string[] = [...FONT_GROUP_INTER]
  if (subset.symbols) files.push(FONT_SYMBOLS)
  if (subset.rubik) files.push(...FONT_GROUP_RUBIK)
  if (subset.barlow) files.push(...FONT_GROUP_BARLOW)
  if (subset.oswald) files.push(...FONT_GROUP_OSWALD)
  return files
}
