/**
 * Independent CLASSIFICA vs EXTRA tuning: materialization rule.
 *
 * `topBadgeScale/OffsetX/Y` is the CLASSIFICA tuning (legacy); `extraBadge*`
 * is the EXTRA tuning, nullable with legacy fallback (null/absent = follow
 * the classifica). The two groups stay independent by one rule:
 *
 * - editing CLASSIFICA first freezes the previous independent EXTRA (every
 *   still-following axis whose rank value really changes) BEFORE the rank
 *   change, so the extra badge keeps its pixels while the rank badge moves;
 * - editing EXTRA never touches the classifica.
 *
 * Follow is per-axis (sliders write one axis at a time): axes already
 * independent (explicit on the target or on its fallback layer) and axes
 * whose rank value does not change are never rewritten. In particular a
 * landscape profile never freezes values that still follow the flat
 * defaults, and a no-op re-apply (preset roundtrip) writes nothing. Pure
 * and testable in isolation.
 */

export interface ExtraRankTuning {
  readonly scale: number
  readonly offsetX: number
  readonly offsetY: number
}

export interface ExtraTuningMaybe {
  readonly scale?: number | null
  readonly offsetX?: number | null
  readonly offsetY?: number | null
}

/** Writable materialized triple (to merge into the target's own layer). */
export interface MaterializedExtraTuning {
  scale: number
  offsetX: number
  offsetY: number
}

/** Writable cleared triple (explicit kept, missing/null reset to null). */
export interface MaterializedExtraTuningWithNull {
  scale: number | null
  offsetX: number | null
  offsetY: number | null
}

/**
 * Legacy-preset clear for ONE target layer on full-look apply: missing/null
 * extra axes become null (follow the layer's own rank) when the patch
 * carries that layer's rank keys; explicit values always win; layers without
 * rank keys (partial other-family patches) are left untouched, and the
 * caller selects the layer, so the other shape is never touched. Returns the
 * triple to write, or null when nothing must change. Pure.
 */
export function clearedExtraForPresetApply(
  rank: ExtraTuningMaybe | null | undefined,
  extra: ExtraTuningMaybe | null | undefined,
): MaterializedExtraTuningWithNull | null {
  if (rank == null) return null
  if (rank.scale === undefined && rank.offsetX === undefined && rank.offsetY === undefined) return null
  const ex = extra ?? {}
  if (ex.scale != null && ex.offsetX != null && ex.offsetY != null) return null
  return {
    scale: ex.scale ?? null,
    offsetX: ex.offsetX ?? null,
    offsetY: ex.offsetY ?? null,
  }
}

/**
 * Extra axes to freeze alongside a classifica edit (to write into the
 * target's own layer), or null when nothing must be frozen.
 *
 * - `rank`: current EFFECTIVE classifica of the edit target
 *   (profile-effective for a landscape target);
 * - `nextRank`: incoming classifica values (only present keys are changing);
 * - `extra`: current explicit extra of the edit target;
 * - `fallbackExtra`: explicit extra of the fallback layer (flat defaults
 *   for a landscape target or a per-title target; omit for flat targets).
 */
export function materializeExtraTuning(layers: {
  readonly rank: ExtraRankTuning
  readonly nextRank: ExtraTuningMaybe
  readonly extra?: ExtraTuningMaybe | null
  readonly fallbackExtra?: ExtraTuningMaybe | null
}): MaterializedExtraTuning | null {
  const own = layers.extra ?? {}
  const fb = layers.fallbackExtra ?? {}
  const out: MaterializedExtraTuning = { scale: 0, offsetX: 0, offsetY: 0 }
  let dirty = false
  const consider = (key: "scale" | "offsetX" | "offsetY"): void => {
    const o = own[key]
    if (o != null) {
      out[key] = o
      return
    }
    const f = fb[key]
    if (f != null) {
      out[key] = f
      return
    }
    out[key] = layers.rank[key]
    const incoming = layers.nextRank[key]
    if (incoming != null && incoming !== layers.rank[key]) dirty = true
  }
  consider("scale")
  consider("offsetX")
  consider("offsetY")
  return dirty ? out : null
}
