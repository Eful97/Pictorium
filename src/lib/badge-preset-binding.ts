import { isBadgePresetId, isBadgePresetRev } from "./badge-preset"
import { effectiveMappingForShape, type Mapping, type PosterShape } from "./types"

/**
 * Binding Badge Lab effettivo per il render poster (foglia pura, client-safe).
 *
 * Precedenza: query valida (`?badgePreset=<id>&prv=<rev>`, già passata per
 * l'hardening ma rivalidata qui per difesa in profondità) > coppia salvata
 * effettiva per formato (profilo landscape atomico via
 * `effectiveMappingForShape`: una sola chiave presente nel profilo rende la
 * coppia interamente di profilo, mai mescolata col flat).
 *
 * Preview (`preview=1` effettiva): SOLO query, mai il mapping. Senza, pulire
 * il preset nell'editor (che omette il parametro) resusciterebbe il binding
 * salvato — la preview mostrerebbe un preset che il save sta rimuovendo
 * (desync WYSIWYG). Lo staged esplicito viaggia in query e rende quello.
 *
 * Identità invalide (query o salvate) → nessun binding (fail-open: il
 * renderer degrada sullo stile standard, mai 500). La revisione assente o
 * invalida viaggia null (il resolver la usa solo come identità di cache).
 */
export interface PresetBinding {
  id: string | null
  rev: string | null
}

export function resolvePresetBinding(args: {
  queryId: string | null
  queryRev: string | null
  mapping: Mapping | null
  shape: PosterShape
  isPreview: boolean
}): PresetBinding {
  const none: PresetBinding = { id: null, rev: null }
  const qid = args.queryId && isBadgePresetId(args.queryId) ? args.queryId : null
  if (qid) {
    return {
      id: qid,
      rev: args.queryRev && isBadgePresetRev(args.queryRev) ? args.queryRev : null,
    }
  }
  if (args.isPreview) return none
  const eff = effectiveMappingForShape(args.mapping, args.shape)
  const mid = eff?.badgePresetId
  if (!mid || !isBadgePresetId(mid)) return none
  const mrev = eff?.badgePresetRev
  return { id: mid, rev: mrev && isBadgePresetRev(mrev) ? mrev : null }
}
