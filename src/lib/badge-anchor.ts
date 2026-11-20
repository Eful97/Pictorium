/**
 * Ancora del badge qualità (solo layout Standard). `auto` = lato storico
 * (destra; a sinistra quando nastro/Coming Soon/numerale/network occupano
 * l'angolo destro), byte-identico. `tl`/`tr` forzano l'angolo alto sinistro o
 * destro, qualunque cosa ci sia nell'altro angolo. Browser-safe: nessun import.
 *
 * Il network NON ha un parametro a parte: allarga `networkLogoPosition`
 * (`auto | top | tl | tr`, vedi `NETWORK_LOGO_POSITIONS` in types.ts).
 */
export const QUALITY_ANCHORS = ["auto", "tl", "tr"] as const
export type QualityAnchor = (typeof QUALITY_ANCHORS)[number]

export function isQualityAnchor(v: unknown): v is QualityAnchor {
  return typeof v === "string" && (QUALITY_ANCHORS as readonly string[]).includes(v)
}

/** Ancora non-auto valida: il render la applica (altrimenti percorso storico). */
export function isActiveQualityAnchor(v: unknown): v is "tl" | "tr" {
  return v === "tl" || v === "tr"
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
 * Ancora della fascia inferiore (solo layout Standard): badge genere, riga
 * rating personalizzata e riga rating separati in modalità bottom. Sono
 * mutuamente esclusivi o impilati nello stesso asse, quindi un solo parametro
 * governa tutta la fascia. Cambia SOLO l'asse X: la quota verticale resta
 * quella storica (sopra il bordo basso, sotto il logo), quindi nessuna nuova
 * collisione verticale. `auto` = storico (centro in portrait, destra in
 * landscape), byte-identico. Non si applica a barra full-width portrait né al
 * genere spostato in alto (`genreTopWhenFree`): lì l'asse X non è libero.
 */
export const BOTTOM_ANCHORS = ["auto", "bl", "bc", "br"] as const
export type BottomAnchor = (typeof BOTTOM_ANCHORS)[number]

export function isBottomAnchor(v: unknown): v is BottomAnchor {
  return typeof v === "string" && (BOTTOM_ANCHORS as readonly string[]).includes(v)
}

/** Ancora non-auto valida: il render la applica (altrimenti percorso storico). */
export function isActiveBottomAnchor(v: unknown): v is "bl" | "bc" | "br" {
  return v === "bl" || v === "bc" || v === "br"
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
export function bottomAnchoredLeft(anchor: "bl" | "bc" | "br", contentW: number, canvasW: number): number {
  const pad = bottomAnchorPad(canvasW)
  const left = anchor === "bl" ? pad : anchor === "br" ? canvasW - contentW - pad : Math.round((canvasW - contentW) / 2)
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
  anchor: "bl" | "bc" | "br",
  bodyW: number,
  ratios: BodyInkRatios | null,
  canvasW: number,
): number {
  if (anchor === "bc" || !ratios) return bottomAnchoredLeft(anchor, bodyW, canvasW)
  const inkLeft = bottomAnchoredLeft(anchor, ratios.width * bodyW, canvasW)
  return Math.round(inkLeft - ratios.offset * bodyW)
}
