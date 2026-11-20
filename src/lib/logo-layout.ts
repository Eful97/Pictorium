/**
 * Ancora del logo titolo (solo layout Standard). `auto` = posizione storica
 * (centro-basso portrait, sinistra-basso landscape), byte-identica.
 * - `bl`/`bc`/`br`: stessa quota verticale storica (sopra la zona genere), solo
 *   l'asse orizzontale cambia: nessuna collisione nuova con i badge in basso.
 * - `tl`/`tr`: angolo alto con margine `logoAlignPadX` su entrambi gli assi.
 * Gli offset utente si sommano alla posizione ancorata (relativi all'angolo,
 * mai alla posizione automatica che dipende dal contenuto). Il centro-alto
 * non esiste per scelta: è la casa del badge rank centrale.
 */
export const LOGO_ANCHORS = ["auto", "tl", "tr", "bl", "bc", "br"] as const
export type LogoAnchor = (typeof LOGO_ANCHORS)[number]

export function isLogoAnchor(v: unknown): v is LogoAnchor {
  return typeof v === "string" && (LOGO_ANCHORS as readonly string[]).includes(v)
}

/**
 * Catena unica di risoluzione dell'ancora (stesso ordine ovunque): query valida
 * > mapping effettivo per formato > config token > defaults effettivi per
 * formato > "auto". Un livello assente o con valore non valido cade al
 * successivo (mai errore). Puro: i chiamanti passano i valori già "effettivi".
 */
export function resolveLogoAnchor(chain: {
  readonly query?: string | null
  readonly mapping?: unknown
  readonly config?: unknown
  readonly defaults?: unknown
}): LogoAnchor {
  const q = (chain.query ?? "").toLowerCase()
  if (isLogoAnchor(q)) return q
  for (const v of [chain.mapping, chain.config, chain.defaults]) if (isLogoAnchor(v)) return v
  return "auto"
}

/** Ancora non-auto valida: il render la applica (altrimenti percorso storico). */
export function isActiveLogoAnchor(v: unknown): v is Exclude<LogoAnchor, "auto"> {
  return isLogoAnchor(v) && v !== "auto"
}

/** Ancora sul bordo alto (il logo sale nella fascia chrome superiore). */
export function isTopLogoAnchor(v: unknown): v is "tl" | "tr" {
  return v === "tl" || v === "tr"
}

type LogoLayoutInput = {
  readonly posterW: number
  readonly posterH: number
  readonly logoW: number
  readonly logoH: number
  readonly logoScale: number
  readonly logoOffsetX: number
  readonly logoOffsetY: number
  readonly hasBadges: boolean
  /** Allineamento orizzontale: "center" (default) o "left" (Cinematic). */
  readonly align?: "left" | "center"
  /** Cap larghezza logo in % del poster (default 100 = nessun cap). */
  readonly maxWidthPct?: number
  /** Cap altezza logo in % dell'altezza poster (default 100 = nessun cap).
   *  Impedisce ai loghi quadrati/verticali di esplodere in altezza. */
  readonly maxHeightPct?: number
  /** Margine inferiore in % dell'altezza poster (default 10). */
  readonly bottomMarginPct?: number
  /** Offset Y fisso di calibrazione (es. +55 nel layout landscape,
   *  +10 portrait via PORTRAIT_LOGO_TOP_OFFSET). */
  readonly topOffset?: number
  /** Ancora d'angolo (vedi `LogoAnchor`). Assente/`auto` = percorso storico. */
  readonly anchor?: LogoAnchor | null
}

type LogoBoxInput = Pick<LogoLayoutInput, "posterW" | "posterH" | "logoW" | "logoH" | "logoScale" | "maxWidthPct" | "maxHeightPct">

type LogoBox = {
  readonly width: number
  readonly height: number
}

type LogoLayout = LogoBox & {
  readonly left: number
  readonly top: number
}

type LogoOffsetBounds = {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

/** Cap altezza logo sui canvas portrait: i loghi quadrati/verticali non
 *  superano il 25% dell'altezza poster (375px su 1500px), in linea con
 *  `logoDefaultScale` in logo-selection.ts. Solo altezza: la larghezza resta
 *  libera (uncapped) così i wordmark panoramici possono respirare. */
export const PORTRAIT_LOGO_MAX_HEIGHT_PCT = 25

/** Calibrazione verticale portrait: il logo scende di 10px rispetto alla
 *  geometria base (margine + badge). Solo portrait (il landscape usa le sue
 *  costanti dedicate); passare come `topOffset` ai call site portrait. */
export const PORTRAIT_LOGO_TOP_OFFSET = 10

/** Vincoli logo sul canvas landscape 16:9 (usati da server, bound slider
 *  client e auto-fit — Golden Rule: stessa terna ovunque).
 *  Il fondo del logo resta a ~10px dal bordo, in linea col badge genere. */
export const LANDSCAPE_LOGO_MAX_WIDTH_PCT = 40
export const LANDSCAPE_LOGO_MAX_HEIGHT_PCT = 24
export const LANDSCAPE_LOGO_BOTTOM_MARGIN_PCT = 0
export const LANDSCAPE_LOGO_TOP_OFFSET = -10

/** Calibrazione geometrica landscape invisibile agli slider (X +10px a destra,
 *  Y -10px in alto, in aggiunta al TOP_OFFSET sopra): si somma SEMPRE agli
 *  offset utente/mapping/default (anche 0), come PORTRAIT_LOGO_TOP_OFFSET in
 *  portrait. Gli slider mostrano 0 ma il render è spostato — è voluto. */
export const LANDSCAPE_LOGO_SHIFT_X = 10
export const LANDSCAPE_LOGO_SHIFT_Y = -10

function sanePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value
}

export function computeLogoBox(input: LogoBoxInput): LogoBox {
  const posterW = sanePositive(input.posterW, 1000)
  const posterH = sanePositive(input.posterH, 1500)
  const logoW = sanePositive(input.logoW, 1)
  const logoH = sanePositive(input.logoH, 1)
  const scalePct = Math.max(input.logoScale, 10) / 100
  const capPct = input.maxWidthPct != null && Number.isFinite(input.maxWidthPct)
    ? Math.min(Math.max(input.maxWidthPct, 10), 100) / 100
    : 1
  const capHeightPct = input.maxHeightPct != null && Number.isFinite(input.maxHeightPct)
    ? Math.min(Math.max(input.maxHeightPct, 10), 100) / 100
    : 1
  const targetW = Math.min(Math.round(posterW * scalePct), Math.round(posterW * capPct), posterW)
  let targetH = Math.round(logoH * (targetW / logoW))
  // Vincolo altezza: i loghi quadrati/verticali scalano per larghezza e
  // possono superare l'altezza utile (in landscape il canvas è basso).
  const maxAllowedH = Math.round(posterH * capHeightPct)
  if (targetH > maxAllowedH) {
    targetH = Math.max(maxAllowedH, 1)
    return { width: Math.max(Math.round(logoW * (targetH / logoH)), 1), height: targetH }
  }
  if (targetH <= posterH) return { width: targetW, height: targetH }

  const ratio = posterH / targetH
  return {
    width: Math.max(Math.round(targetW * ratio), 1),
    height: posterH,
  }
}

/** Padding sinistro dell'ancoraggio "left", in scala col canvas (36px a 768). */
export function logoAlignPadX(posterW: number): number {
  return Math.round(36 * (sanePositive(posterW, 768) / 768))
}

function bottomMargin(input: { readonly bottomMarginPct?: number }): number {
  const pct = input.bottomMarginPct
  return pct != null && Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 50) / 100 : 0.1
}

/**
 * Posizione base (offset utente esclusi) del logo ancorato, o null con ancora
 * `auto`/assente. Verticale: `tl`/`tr` al margine alto, `bl`/`bc`/`br` sulla
 * quota storica del fondo. Orizzontale: margine `logoAlignPadX` o centro.
 */
function anchoredBase(input: LogoLayoutInput, box: LogoBox): { left: number; top: number } | null {
  const anchor = input.anchor
  if (!isActiveLogoAnchor(anchor)) return null
  const posterW = sanePositive(input.posterW, 1000)
  const posterH = sanePositive(input.posterH, 1500)
  const pad = logoAlignPadX(posterW)
  const left = anchor === "tl" || anchor === "bl"
    ? pad
    : anchor === "tr" || anchor === "br"
      ? posterW - box.width - pad
      : Math.round((posterW - box.width) / 2)
  const badgeOffset = input.hasBadges ? 0 : Math.round(40 * posterH / 1500)
  const top = isTopLogoAnchor(anchor)
    ? pad
    : Math.round(posterH - box.height - posterH * bottomMargin(input) + badgeOffset + (input.topOffset ?? 0))
  return { left, top }
}

export function computeLogoLayout(input: LogoLayoutInput): LogoLayout {
  const posterW = sanePositive(input.posterW, 1000)
  const posterH = sanePositive(input.posterH, 1500)
  const box = computeLogoBox(input)
  const anchored = anchoredBase(input, box)
  if (anchored) {
    return { ...box, left: Math.round(anchored.left + input.logoOffsetX), top: Math.max(0, Math.round(anchored.top + input.logoOffsetY)) }
  }
  const margin = bottomMargin(input)
  const badgeOffset = input.hasBadges ? 0 : Math.round(40 * posterH / 1500)
  const left = input.align === "left"
    ? logoAlignPadX(posterW) + input.logoOffsetX
    : Math.round((posterW - box.width) / 2 + input.logoOffsetX)
  const top = Math.max(0, Math.round(posterH - box.height - posterH * margin + input.logoOffsetY + badgeOffset + (input.topOffset ?? 0)))
  return { ...box, left, top }
}

export function computeLogoOffsetBounds(input: Omit<LogoLayoutInput, "logoOffsetX" | "logoOffsetY">): LogoOffsetBounds {
  const posterW = sanePositive(input.posterW, 1000)
  const posterH = sanePositive(input.posterH, 1500)
  const box = computeLogoBox(input)
  const anchored = anchoredBase({ ...input, logoOffsetX: 0, logoOffsetY: 0 }, box)
  if (anchored) {
    // Corsa dall'angolo ancorato: dal bordo sinistro/alto al destro/basso.
    return {
      minX: cleanZero(-anchored.left),
      maxX: cleanZero(posterW - box.width - anchored.left),
      minY: cleanZero(-anchored.top),
      maxY: cleanZero(posterH - box.height - anchored.top),
    }
  }
  const margin = bottomMargin(input)
  const badgeOffset = input.hasBadges ? 0 : Math.round(40 * posterH / 1500)
  const baseTop = Math.round(posterH - box.height - posterH * margin + badgeOffset + (input.topOffset ?? 0))
  const maxY = Math.round(posterH * margin - badgeOffset - (input.topOffset ?? 0))
  // Center: corsa simmetrica attorno al centro; left: dal bordo sinistro
  // (meno padX) al bordo destro (meno padX e larghezza logo).
  const padX = logoAlignPadX(posterW)
  const halfX = Math.round((posterW - box.width) / 2)
  const minX = input.align === "left" ? -padX : -halfX
  const maxX = input.align === "left" ? posterW - box.width - padX : halfX
  return { minX: cleanZero(minX), maxX: cleanZero(maxX), minY: cleanZero(-baseTop), maxY: cleanZero(maxY) }
}
