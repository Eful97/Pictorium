/**
 * Posizione indipendente del logo network ("Segui il logo del titolo" OFF).
 *
 * Contratto minimo, condiviso da server e builder URL senza duplicare la
 * logica di risoluzione.
 *
 * GRAFICO IMPORT SICURO (browser-safe): questo modulo importa SOLO tipi
 * (`import type`, cancellati a compile time) e non esegue alcun import
 * runtime. In particolare NON importa `poster-config` (trascina `ratings` e
 * affini), `server-defaults` (`node:fs`, KV) né `config-token` (`zod`).
 * I consumer client-reachable (`poster-url`, `stremio-poster-url`) importano
 * da qui; `poster-config` riusa e ri-esporta queste funzioni per i consumer
 * server/test esistenti.
 *
 * Unità di risoluzione:
 * - il toggle segue/non-segue eredita su entrambe le shape (solo le
 *   coordinate assolute sono per-shape);
 * - le coordinate assolute si risolvono a unità di layer (vedi sotto): un
 *   layer vale solo con follow===false ED entrambe le coordinate finite;
 * - gli offset relativi (modalità ON) ereditano flat→landscape come
 *   storicamente, TRANNE i flat di un layer fixed (follow===false): quelli
 *   sono assoluti di un'altra shape e non devono mai rientrare come relativi.
 */

import type { PosterShape } from "./types"

/** Sottoinsieme campi network letti dai resolver (Mapping/ServerDefaults lo soddisfano strutturalmente). */
export interface NetworkFollowLayer {
  readonly networkLogoFollowTitle?: boolean | null
  readonly networkLogoOffsetX?: number | null
  readonly networkLogoOffsetY?: number | null
}

/** Layer con eventuale profilo landscape (Mapping/ServerDefaults). */
export interface NetworkFollowShapedLayer extends NetworkFollowLayer {
  readonly landscape?: NetworkFollowLayer | null
}

/** Override da config token: flat + shape dichiarata (shape guard). */
export interface NetworkFollowToken extends NetworkFollowLayer {
  readonly posterShape?: PosterShape | null
}

function clampAxis(v: number): number {
  return Math.min(Math.max(Math.round(v), -2000), 2000)
}

function finiteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

/**
 * Il network segue il layout storico ancorato al titolo (default true).
 * Catena: query `netFollow` ("0" = false, presente-altro = true, assente =
 * sotto) > mapping effettivo per formato > config token > defaults effettivi
 * per formato > true. False esplicito prevale sempre; null/undefined
 * ereditano (mai adattivi impliciti). Puro e testabile in isolamento.
 */
export function resolveNetworkFollowTitle(
  searchParams: URLSearchParams,
  mapping: NetworkFollowShapedLayer | null,
  configOverride: NetworkFollowToken | null,
  sd: NetworkFollowShapedLayer,
  shape: PosterShape,
): boolean {
  const q = searchParams.get("netFollow")
  if (q !== null) return q !== "0"
  // Merge effettivi inline (stessa semantica di effectiveMappingForShape /
  // effectiveDefaultsForShape per il toggle, senza import runtime server):
  // profilo ?? flat, null incluso come ereditarietà.
  const mFollow = shape === "landscape"
    ? (mapping?.landscape?.networkLogoFollowTitle ?? mapping?.networkLogoFollowTitle)
    : mapping?.networkLogoFollowTitle
  const esdFollow = shape === "landscape"
    ? (sd.landscape?.networkLogoFollowTitle ?? sd.networkLogoFollowTitle)
    : sd.networkLogoFollowTitle
  return mFollow
    ?? configOverride?.networkLogoFollowTitle
    ?? esdFollow
    ?? sd.networkLogoFollowTitle
    ?? true
}

/**
 * Follow effettivo per-shape: ON finché la shape non ha coordinate fisse
 * configurate. Un follow spento senza coordinate è incoerente (nessun
 * punto dove mettere la pill): rende follow, non una modalità falsa.
 * Puro e testabile in isolamento.
 */
export function resolveEffectiveNetworkFollow(
  follow: boolean,
  fixed: { x: number | null; y: number | null },
): boolean {
  if (!follow && (fixed.x == null || fixed.y == null)) return true
  return follow
}

function completeCoords(x: unknown, y: unknown): { x: number; y: number } | null {
  if (!finiteNumber(x) || !finiteNumber(y)) return null
  return { x: clampAxis(x), y: clampAxis(y) }
}

/**
 * Coordinate assolute del box network (top-left) in px nel canvas del
 * formato, solo con follow spento. Risoluzione a unità di layer in ordine:
 * query completa > mapping di shape > token (con shape guard) > defaults di
 * shape > null. Un layer vale solo se ha follow===false ED entrambe le
 * coordinate finite: i layer parziali o in modalità diversa non si mescolano
 * mai (niente X da un layer e Y da un altro). In particolare un mapping
 * legacy con nox/noy relativi (follow assente) non sovrascrive i fixed
 * defaults come assoluti: si eredita il layer fixed sottostante e le
 * relative restano tali. In landscape il flat non entra mai; in portrait il
 * profilo non esiste. Query parziale/invalida = si ignora del tutto (eredita
 * dai layer, mai sentinella). Null = nessun fisso (mai (0,0)).
 * Puro e testabile in isolamento.
 */
export function resolveNetworkFixedCoords(
  searchParams: URLSearchParams,
  mapping: NetworkFollowShapedLayer | null,
  configOverride: NetworkFollowToken | null,
  sd: NetworkFollowShapedLayer,
  shape: PosterShape,
): { x: number | null; y: number | null } {
  // Query: vale solo completa (entrambi finiti), altrimenti si ignora del
  // tutto — mai mixing con assi salvati.
  const qx = searchParams.get("nox")
  const qy = searchParams.get("noy")
  if (qx !== null && qx !== "" && qy !== null && qy !== "") {
    const fixed = completeCoords(Number(qx), Number(qy))
    if (fixed) return fixed
  }
  // Mapping di shape: solo se il layer è fixed (follow esplicito false).
  const land = shape === "landscape" ? mapping?.landscape : null
  const mFollow = shape === "landscape" ? land?.networkLogoFollowTitle : mapping?.networkLogoFollowTitle
  const mFixed = mFollow === false
    ? completeCoords(
      shape === "landscape" ? land?.networkLogoOffsetX : mapping?.networkLogoOffsetX,
      shape === "landscape" ? land?.networkLogoOffsetY : mapping?.networkLogoOffsetY,
    )
    : null
  if (mFixed) return mFixed
  // Token: flat ma con shape guard — vale solo per la shape dichiarata
  // (token.posterShape assente = inidoneo: un flat coprirebbe entrambe le
  // shape violando le coordinate per-shape).
  const cFollow = configOverride?.networkLogoFollowTitle
  if (cFollow === false && configOverride?.posterShape === shape) {
    const cFixed = completeCoords(configOverride?.networkLogoOffsetX, configOverride?.networkLogoOffsetY)
    if (cFixed) return cFixed
  }
  // Defaults di shape: solo se il layer è fixed.
  const sdLand = shape === "landscape" ? sd.landscape : null
  const sFollow = shape === "landscape" ? sdLand?.networkLogoFollowTitle : sd.networkLogoFollowTitle
  if (sFollow === false) {
    const sFixed = completeCoords(
      shape === "landscape" ? sdLand?.networkLogoOffsetX : sd.networkLogoOffsetX,
      shape === "landscape" ? sdLand?.networkLogoOffsetY : sd.networkLogoOffsetY,
    )
    if (sFixed) return sFixed
  }
  return { x: null, y: null }
}

/**
 * Effective per-shape network view for UI state (load/reset/bindings):
 * same server semantics (flat never leaks into landscape absolutes, follow
 * without fixed coords reads ON), so checkboxes, sliders and resets always
 * agree with the render. Portrait has no profile: pass `null`.
 */
export interface NetworkShapeView {
  /** Effective follow (false only with complete fixed coords). */
  readonly follow: boolean
  /** Absolute box coords when follow is false, else null. */
  readonly fixedX: number | null
  readonly fixedY: number | null
  /** Relative offsets when follow is true (profile, then non-fixed flat). */
  readonly relativeX: number
  readonly relativeY: number
}

export function resolveNetworkShapeView(
  flat: NetworkFollowLayer | null | undefined,
  profile: NetworkFollowLayer | null | undefined,
  shape: PosterShape,
): NetworkShapeView {
  return resolveNetworkEffectiveView(null, flat, profile, shape)
}

/**
 * Effective per-shape network view composing a saved per-title mapping with
 * the global defaults (same layers and precedence as the server: query
 * absent here, no config token in these UI/load paths). Complete mapping
 * overrides always win; without them the defaults view applies — a flat
 * fixed layer never leaks its absolutes into the other shape. Pure and
 * testable in isolation.
 */
export function resolveNetworkEffectiveView(
  mapping: NetworkFollowShapedLayer | null | undefined,
  flat: NetworkFollowLayer | null | undefined,
  profile: NetworkFollowLayer | null | undefined,
  shape: PosterShape,
): NetworkShapeView {
  const params = new URLSearchParams()
  const m = mapping ?? null
  const sd: NetworkFollowShapedLayer = {
    networkLogoFollowTitle: flat?.networkLogoFollowTitle,
    networkLogoOffsetX: flat?.networkLogoOffsetX,
    networkLogoOffsetY: flat?.networkLogoOffsetY,
    landscape: shape === "landscape" ? (profile ?? undefined) : undefined,
  }
  const fixed = resolveNetworkFixedCoords(params, m, null, sd, shape)
  const follow = resolveEffectiveNetworkFollow(
    resolveNetworkFollowTitle(params, m, null, sd, shape),
    fixed,
  )
  if (!follow) {
    return {
      follow,
      fixedX: fixed.x,
      fixedY: fixed.y,
      relativeX: 0,
      relativeY: 0,
    }
  }
  if (shape === "landscape") {
    const rel = resolveLandscapeNetworkOffsets(params, m, null, sd)
    return { follow, fixedX: null, fixedY: null, relativeX: rel.x, relativeY: rel.y }
  }
  // Portrait historic chain (no query/token here): a fixed layer contributes
  // no relative offsets — same exclusion as the server config builder.
  const relNum = (mv: number | null | undefined, fv: number | null | undefined): number => {
    if (finiteNumber(mv)) return clampAxis(mv)
    if (finiteNumber(fv)) return clampAxis(fv)
    return 0
  }
  return {
    follow,
    fixedX: null,
    fixedY: null,
    relativeX: relNum(
      m?.networkLogoFollowTitle === false ? undefined : m?.networkLogoOffsetX,
      flat?.networkLogoFollowTitle === false ? undefined : flat?.networkLogoOffsetX,
    ),
    relativeY: relNum(
      m?.networkLogoFollowTitle === false ? undefined : m?.networkLogoOffsetY,
      flat?.networkLogoFollowTitle === false ? undefined : flat?.networkLogoOffsetY,
    ),
  }
}

/**
 * Offset relativi network per il canvas landscape (modalità ON).
 * Stessa semantica query della catena storica (presente → finito?clamp:0),
 * poi profilo mapping, token, profilo defaults e — SOLO se non fixed —
 * flat mapping/defaults. I valori di un layer fixed (follow===false,
 * qualsiasi shape dichiarata o meno) sono assoluti e restano esclusi dai
 * relativi, salvo query esplicita (che vince sempre). Il portrait usa la
 * catena storica invariata. Puro e testabile in isolamento.
 */
export function resolveLandscapeNetworkOffsets(
  searchParams: URLSearchParams,
  mapping: NetworkFollowShapedLayer | null,
  configOverride: NetworkFollowToken | null,
  sd: NetworkFollowShapedLayer,
): { x: number; y: number } {
  const mFlatFixed = mapping?.networkLogoFollowTitle === false
  const mLandFixed = mapping?.landscape?.networkLogoFollowTitle === false
  const sFlatFixed = sd.networkLogoFollowTitle === false
  const sLandFixed = sd.landscape?.networkLogoFollowTitle === false
  const cExcluded = configOverride?.networkLogoFollowTitle === false
  const axis = (
    key: string,
    layers: (number | null | undefined)[],
  ): number => {
    const raw = searchParams.get(key)
    if (raw !== null) {
      const n = raw ? Number(raw) : NaN
      return Number.isFinite(n) ? clampAxis(n) : 0
    }
    for (const v of layers) {
      if (finiteNumber(v)) return clampAxis(v)
    }
    return 0
  }
  const layersFor = (
    profile: number | null | undefined,
    profileFixed: boolean,
    flat: number | null | undefined,
    flatFixed: boolean,
  ): (number | null | undefined)[] => [
    ...(profileFixed ? [] : [profile]),
    ...(flatFixed ? [] : [flat]),
  ]
  return {
    x: axis("nox", [
      ...layersFor(mapping?.landscape?.networkLogoOffsetX, mLandFixed, mapping?.networkLogoOffsetX, mFlatFixed),
      ...(cExcluded ? [] : [configOverride?.networkLogoOffsetX]),
      ...layersFor(sd.landscape?.networkLogoOffsetX, sLandFixed, sd.networkLogoOffsetX, sFlatFixed),
    ]),
    y: axis("noy", [
      ...layersFor(mapping?.landscape?.networkLogoOffsetY, mLandFixed, mapping?.networkLogoOffsetY, mFlatFixed),
      ...(cExcluded ? [] : [configOverride?.networkLogoOffsetY]),
      ...layersFor(sd.landscape?.networkLogoOffsetY, sLandFixed, sd.networkLogoOffsetY, sFlatFixed),
    ]),
  }
}
