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
 *  geometria base (margine + badge). Solo portrait (il landscape non
 *  baked-in non lo usa); passare come `topOffset` ai call site portrait. */
export const PORTRAIT_LOGO_TOP_OFFSET = 10

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

export function computeLogoLayout(input: LogoLayoutInput): LogoLayout {
  const posterW = sanePositive(input.posterW, 1000)
  const posterH = sanePositive(input.posterH, 1500)
  const box = computeLogoBox(input)
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
