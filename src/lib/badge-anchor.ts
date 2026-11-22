/**
 * Ancora del badge qualità (solo layout Standard). `auto` = lato storico
 * (destra; a sinistra quando nastro/Coming Soon/numerale/network occupano
 * l'angolo destro), byte-identico. `tl`/`tr` forzano l'angolo alto sinistro o
 * destro, qualunque cosa ci sia nell'altro angolo. Browser-safe: nessun import.
 *
 * Il network NON ha un parametro a parte: allarga `networkLogoPosition`
 * (`auto | top | tl | tr`, vedi `NETWORK_LOGO_POSITIONS` in types.ts).
 */
/**
 * Posizioni di ancoraggio condivise da tutti i parametri d'ancora (`lanc`,
 * `netPos`, `qanc`, `banc`, `tanc`, `xanc`). Formato `<riga><colonna>`:
 * riga `t`/`m`/`b` = top/middle/bottom, colonna `l`/`c`/`r` = left/center/right.
 * Browser-safe: nessun import (importato anche da `types.ts` e dagli schemi).
 */
export const ANCHOR_POSITIONS = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"] as const
export type AnchorPosition = (typeof ANCHOR_POSITIONS)[number]

/** `auto` (comportamento storico, con evitamento collisioni) + le 9 posizioni fisse. */
export const ANCHOR_CHOICES = ["auto", ...ANCHOR_POSITIONS] as const
export type AnchorChoice = (typeof ANCHOR_CHOICES)[number]

/**
 * Posizioni relative al LOGO (`above` = sopra, `below` = sotto), accettate da
 * `netPos`, `qanc`, `tanc`, `xanc`, `banc` ma NON da `lanc` (il logo non ha
 * un logo a cui riferirsi). Sono manuali: fisse, mai spostate per collisioni.
 * Browser-safe.
 */
export const LOGO_RELATIVE_POSITIONS = ["above", "below"] as const
export type LogoRelativePosition = (typeof LOGO_RELATIVE_POSITIONS)[number]

export function isLogoRelativePosition(v: unknown): v is LogoRelativePosition {
  return typeof v === "string" && (LOGO_RELATIVE_POSITIONS as readonly string[]).includes(v)
}

/** Scelte dei badge: `auto` + 9 posizioni fisse + above/below (senza `lanc`). */
export const ANCHOR_CHOICES_REL = [...ANCHOR_CHOICES, ...LOGO_RELATIVE_POSITIONS] as const
export type AnchorChoiceRel = (typeof ANCHOR_CHOICES_REL)[number]

export function isAnchorChoiceRel(v: unknown): v is AnchorChoiceRel {
  return typeof v === "string" && (ANCHOR_CHOICES_REL as readonly string[]).includes(v)
}

export function isAnchorPosition(v: unknown): v is AnchorPosition {
  return typeof v === "string" && (ANCHOR_POSITIONS as readonly string[]).includes(v)
}

export function isAnchorChoice(v: unknown): v is AnchorChoice {
  return typeof v === "string" && (ANCHOR_CHOICES as readonly string[]).includes(v)
}

/**
 * Riga/colonna di una posizione. `rowOf` è `t`/`m`/`b`, `colOf` è `l`/`c`/`r`.
 * Il valore è già validato da `isAnchorPosition`: nessun fallback qui.
 */
export function anchorRow(pos: AnchorPosition): "t" | "m" | "b" {
  return pos[0] as "t" | "m" | "b"
}

export function anchorCol(pos: AnchorPosition): "l" | "c" | "r" {
  return pos[1] as "l" | "c" | "r"
}

export interface AnchorRectInput {
  readonly canvasW: number
  readonly canvasH: number
  /** Dimensioni del corpo visibile da posizionare. */
  readonly w: number
  readonly h: number
  /** Margine laterale (usato da l/r). */
  readonly marginX: number
  /** Margine dall'alto (usato da t). */
  readonly marginTop: number
  /** Margine dal basso (usato da b). */
  readonly marginBottom: number
}

/**
 * Top-left (px) del corpo per una posizione fissa. x: l = marginX, c = centrato,
 * r = canvasW - w - marginX. y: t = marginTop, m = centrato, b = canvasH - h -
 * marginBottom. Il risultato non è clampato: il chiamante decide.
 */
export function anchorRect(pos: AnchorPosition, r: AnchorRectInput): { left: number; top: number } {
  const col = anchorCol(pos)
  const row = anchorRow(pos)
  const left = col === "l" ? r.marginX : col === "c" ? Math.round((r.canvasW - r.w) / 2) : r.canvasW - r.w - r.marginX
  const top = row === "t" ? r.marginTop : row === "m" ? Math.round((r.canvasH - r.h) / 2) : r.canvasH - r.h - r.marginBottom
  return { left, top }
}

export const QUALITY_ANCHORS = ANCHOR_CHOICES_REL
export type QualityAnchor = AnchorChoiceRel

export function isQualityAnchor(v: unknown): v is QualityAnchor {
  return isAnchorChoiceRel(v)
}

/** Ancora non-auto valida: il render la applica (altrimenti percorso storico). */
export function isActiveQualityAnchor(v: unknown): v is AnchorPosition {
  return isAnchorPosition(v)
}

/**
 * Catena unica di risoluzione (stesso ordine di `resolveLogoAnchor`): query
 * valida > mapping effettivo per formato > config token > defaults effettivi
 * per formato > "auto". Livello assente o non valido cade al successivo.
 */
export function resolveQualityAnchor(chain: {
  readonly query?: string | null
  readonly mapping?: unknown
  readonly config?: unknown
  readonly defaults?: unknown
}): QualityAnchor {
  const q = (chain.query ?? "").toLowerCase()
  if (isQualityAnchor(q)) return q
  for (const v of [chain.mapping, chain.config, chain.defaults]) if (isQualityAnchor(v)) return v
  return "auto"
}

/**
 * Ancora del badge superiore centrato (rank/extra, solo Standard). `auto` =
 * posizione storica al centro, byte-identica. `tl`/`tr` portano il corpo
 * all'angolo alto sinistro/destro (margine netPadX, offset X relativi
 * all'angolo); corner e numerale hanno già un angolo proprio e il nastro
 * Netflix resta ancorato: lì l'ancora non si applica (vedi render).
 */
export const TOP_BADGE_ANCHORS = ANCHOR_CHOICES_REL
export type TopBadgeAnchor = AnchorChoiceRel

export function isTopBadgeAnchor(v: unknown): v is TopBadgeAnchor {
  return isAnchorChoiceRel(v)
}

/** Ancora non-auto valida: il render la applica (altrimenti percorso storico). */
export function isActiveTopBadgeAnchor(v: unknown): v is AnchorPosition {
  return isAnchorPosition(v)
}

/**
 * Stessa catena di `resolveQualityAnchor`: query valida > mapping effettivo
 * per formato > config token > defaults effettivi per formato > "auto".
 */
export function resolveTopBadgeAnchor(chain: {
  readonly query?: string | null
  readonly mapping?: unknown
  readonly config?: unknown
  readonly defaults?: unknown
}): TopBadgeAnchor {
  const q = (chain.query ?? "").toLowerCase()
  if (isTopBadgeAnchor(q)) return q
  for (const v of [chain.mapping, chain.config, chain.defaults]) if (isTopBadgeAnchor(v)) return v
  return "auto"
}

/**
 * Ancora del badge extra (`xanc`): stesso insieme e stessa catena di `tanc`,
 * ma indipendente. Si applica solo quando il badge superiore è di tipo extra;
 * `tanc` governa solo i rank.
 */
export const EXTRA_BADGE_ANCHORS = TOP_BADGE_ANCHORS
export type ExtraBadgeAnchor = (typeof EXTRA_BADGE_ANCHORS)[number]

export function isExtraBadgeAnchor(v: unknown): v is ExtraBadgeAnchor {
  return isTopBadgeAnchor(v)
}

export function resolveExtraBadgeAnchor(chain: Parameters<typeof resolveTopBadgeAnchor>[0]): ExtraBadgeAnchor {
  return resolveTopBadgeAnchor(chain)
}

/**
 * Ancora della fascia inferiore (solo layout Standard): badge genere, riga
 * rating personalizzata e riga rating separati in modalità bottom. Sono
 * mutuamente esclusivi o impilati nello stesso asse, quindi un solo parametro
 * governa tutta la fascia. Cambia SOLO l'asse X: la quota verticale resta
 * quella storica (sopra il bordo basso, sotto il logo), quindi nessuna nuova
 * collisione verticale. `auto` = storico (centro in portrait, destra in
 * landscape), byte-identico. Non si applica a barra full-width portrait né al
 * genere spostato in alto (`genreTopWhenFree`): lì l'asse X non è libero.
 */
export const BOTTOM_ANCHORS = ANCHOR_CHOICES_REL
export type BottomAnchor = AnchorChoiceRel

export function isBottomAnchor(v: unknown): v is BottomAnchor {
  return isAnchorChoiceRel(v)
}

/** Ancora non-auto valida: il render la applica (altrimenti percorso storico). */
export function isActiveBottomAnchor(v: unknown): v is AnchorPosition {
  return isAnchorPosition(v)
}

/** Stessa catena di `resolveQualityAnchor` (query > mapping > token > defaults > auto). */
export function resolveBottomAnchor(chain: {
  readonly query?: string | null
  readonly mapping?: unknown
  readonly config?: unknown
  readonly defaults?: unknown
}): BottomAnchor {
  const q = (chain.query ?? "").toLowerCase()
  if (isBottomAnchor(q)) return q
  for (const v of [chain.mapping, chain.config, chain.defaults]) if (isBottomAnchor(v)) return v
  return "auto"
}

/** Margine laterale della fascia inferiore: stessa griglia di network/qualità (18/380 della larghezza). */
export function bottomAnchorPad(canvasW: number): number {
  return Math.round(18 * canvasW / 380)
}

/**
 * Left (px) di un elemento di larghezza `contentW` (corpo visibile) nella
 * fascia inferiore sotto un'ancora attiva. Sempre dentro il canvas.
 */
export function bottomAnchoredLeft(anchor: AnchorPosition, contentW: number, canvasW: number): number {
  const pad = bottomAnchorPad(canvasW)
  const col = anchorCol(anchor)
  const left = col === "l" ? pad : col === "r" ? canvasW - contentW - pad : Math.round((canvasW - contentW) / 2)
  return Math.min(Math.max(0, canvasW - contentW), Math.max(0, left))
}

/** Posizione dell'inchiostro visibile dentro il corpo del badge, in rapporto alla larghezza del corpo. */
export interface BodyInkRatios {
  /** Sinistra dell'inchiostro rispetto alla sinistra del corpo / larghezza corpo. */
  readonly offset: number
  /** Larghezza dell'inchiostro / larghezza corpo. */
  readonly width: number
}

/**
 * Left (px) del CORPO tale che l'INCHIOSTRO visibile stia sull'ancora (bl/br);
 * `bc` centra il corpo (= percorso storico portrait, byte-identico). Serve
 * perché negli stili senza riquadro (es. `shadow`) il corpo è una scatola più
 * larga del testo: ancorare il corpo sposterebbe il testo di pochi pixel. I
 * rapporti sono lineari, quindi restano validi dopo uno shrink anti-collisione.
 * Senza rapporti (bitmap vuota) ripiega sul corpo.
 */
export function bottomAnchoredBodyLeft(
  anchor: AnchorPosition,
  bodyW: number,
  ratios: BodyInkRatios | null,
  canvasW: number,
): number {
  if (anchorCol(anchor) === "c" || !ratios) return bottomAnchoredLeft(anchor, bodyW, canvasW)
  const inkLeft = bottomAnchoredLeft(anchor, ratios.width * bodyW, canvasW)
  return Math.round(inkLeft - ratios.offset * bodyW)
}

/**
 * Le ancore (solo layout Standard) sono raggiungibili quando almeno una parte
 * dei poster esce in Standard: layout Standard, oppure Fresh/Card con ambito
 * "ranked" (i titoli senza classifica ricadono su Standard). Solo UI.
 */
export function standardAnchorsReachable(layout: string | null | undefined, scope: string | null | undefined): boolean {
  return (layout ?? "standard") === "standard" || (scope ?? "ranked") !== "all"
}
