import {
  BADGE_FAMILY_IDS,
  isBadgePresetId,
  isBadgePresetRev,
  resolveLegacyTargetFamilies,
  type BadgeFamilyId,
  type BadgeTarget,
} from "./badge-preset"
import { effectiveMappingForShape, effectiveFamilyFollows, type Mapping, type PosterShape } from "./types"

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

/**
 * Staged per-family esplicito (presenza query-equivalente in preview):
 * chiave presente — incluso null — ombreggia il mapping; assente = nessun
 * override. Valori malformati falliscono chiusi (binding nullo, mai throw).
 */
export interface FamilyStagedBinding {
  id: string
  rev?: string | null
}

export type FamilyStagedBindings = Partial<Record<BadgeFamilyId, FamilyStagedBinding | null>>

/** Lettura own-property proto-sicura di un binding family (staged o mapping). */
function readOwnFamilyBinding(source: unknown, family: BadgeFamilyId): PresetBinding | undefined {
  if (!source || typeof source !== "object") return undefined
  if (!Object.prototype.hasOwnProperty.call(source, family)) return undefined
  const v = (source as Record<string, unknown>)[family]
  if (v === null || v === undefined) return { id: null, rev: null }
  if (typeof v !== "object") return { id: null, rev: null }
  const rec = v as { id?: unknown; rev?: unknown }
  if (!isBadgePresetId(rec.id)) return { id: null, rev: null }
  return { id: rec.id, rev: isBadgePresetRev(rec.rev) ? rec.rev : null }
}

/**
 * Risolve un binding indipendente per ogni badge family (foglia pura,
 * client-safe, nessuno store fetch: i target legacy viaggiano già risolti
 * dal chiamante via store lookup).
 *
 * Precedenza per family: staged esplicito (presenza own-property, incluso
 * null = clear) > query follow (`bpf`: own `true` = follow per questa
 * richiesta, vince su legacy/mappa anche in preview) > follow persistiti
 * (`badgePresetFollows` effettivi per forma, solo fuori preview) > legacy
 * query valida sul suo target risolto > mapping effettivo per forma (solo
 * fuori preview: in preview senza staged non si resuscita mai il salvato,
 * come il singleton) > singleton legacy salvato sul suo target risolto
 * (solo fuori preview e per le family senza voce mapping esplicita: una
 * voce presente-ma-invalida resta null fail-closed e non riesuma il legacy)
 * > config token della richiesta (own family) > default globali effettivi
 * per forma (own family; il profilo landscape è già fuso dal chiamante) >
 * nessun binding.
 *
 * Config e default restano consultati anche in preview (a differenza del
 * mapping): sono la configurazione corrente dello spazio, non un valore
 * salvato per-titolo che un clear esplicito deve poter rimuovere. Un `null`
 * esplicito a un livello più alto blocca i livelli sotto. Uno staged
 * esplicito (binding o clear `null` in `bp`) cancella il follow intent di
 * query per quella family (staged vince su `bpf`).
 *
 * Persisted follow flags (`badgePresetFollows` flat + profilo, G2 c1):
 * quando la forma effettiva segue la family, il mapping salvato, il
 * singleton legacy E la query legacy vengono saltati per quella
 * family/forma (config > default globali), così un drop landscape non
 * risuscita mai il pin flat e un drop flat non tocca la forma opposta.
 * Solo `true` persiste. Lo stesso vale per il follow di query (`bpf`),
 * anche in preview.
 *
 * Il singleton legacy `top` copre `rank` + `extra` (alias storico dello
 * slot superiore); la disambiguazione dello slot resta al resolver di
 * render successivo, mai una riscrittura qui. Ritorna sempre tutte le
 * family (null-filled): pulire una family non tocca mai le sorelle.
 */
export function resolveFamilyPresetBindings(args: {
  staged?: FamilyStagedBindings | null
  mapping: Mapping | null
  shape: PosterShape
  isPreview: boolean
  legacyQueryId?: string | null
  legacyQueryRev?: string | null
  legacyQueryTarget?: BadgeTarget | null
  legacyMappingTarget?: BadgeTarget | null
  /** Query follow intent (`bpf` parsed): own `true` = follow per family (preview + non-preview). */
  queryFollows?: Partial<Record<BadgeFamilyId, true>> | null
  /** Own-family map del config token firmato (`?config=`), già validato. */
  configFamilies?: unknown
  /** Own-family map dei default globali effettivi per la forma. */
  defaultsFamilies?: unknown
}): Record<BadgeFamilyId, PresetBinding> {
  const out = {} as Record<BadgeFamilyId, PresetBinding>
  const eff = effectiveMappingForShape(args.mapping, args.shape)
  const follows = effectiveFamilyFollows(args.mapping, args.shape)
  const mapFamilies: unknown = eff?.badgePresets
  const qid = args.legacyQueryId && isBadgePresetId(args.legacyQueryId) ? args.legacyQueryId : null
  const qrev = args.legacyQueryRev && isBadgePresetRev(args.legacyQueryRev) ? args.legacyQueryRev : null
  const queryFamilies = qid ? resolveLegacyTargetFamilies(args.legacyQueryTarget) : []
  const mid = eff?.badgePresetId && isBadgePresetId(eff.badgePresetId) ? eff.badgePresetId : null
  const mrev = eff?.badgePresetRev && isBadgePresetRev(eff.badgePresetRev) ? eff.badgePresetRev : null
  const mappingFamilies = mid ? resolveLegacyTargetFamilies(args.legacyMappingTarget) : []
  for (const family of BADGE_FAMILY_IDS) {
    const staged = readOwnFamilyBinding(args.staged, family)
    if (staged !== undefined) {
      out[family] = staged
      continue
    }
    // Explicit query follow (`bpf`): bypasses the legacy query, the saved map
    // and the legacy singleton for THIS family (preview + non-preview), then
    // config > defaults. Siblings keep their legacy/query path untouched.
    if (args.queryFollows && Object.prototype.hasOwnProperty.call(args.queryFollows, family)) {
      const configured = readOwnFamilyBinding(args.configFamilies, family)
      if (configured !== undefined) {
        out[family] = configured
        continue
      }
      const defaulted = readOwnFamilyBinding(args.defaultsFamilies, family)
      if (defaulted !== undefined) {
        out[family] = defaulted
        continue
      }
      out[family] = { id: null, rev: null }
      continue
    }
    // Persisted follow (G2 c1): same bypass as query follow, non-preview only
    // (preview carries the flag explicitly via `bpf` so the preview never
    // inherits the mapping). Placed BEFORE the legacy query so a covering
    // legacy top cannot resurrect a followed family.
    if (!args.isPreview) {
      if (Object.prototype.hasOwnProperty.call(follows, family)) {
        const configured = readOwnFamilyBinding(args.configFamilies, family)
        if (configured !== undefined) {
          out[family] = configured
          continue
        }
        const defaulted = readOwnFamilyBinding(args.defaultsFamilies, family)
        if (defaulted !== undefined) {
          out[family] = defaulted
          continue
        }
        out[family] = { id: null, rev: null }
        continue
      }
    }
    if (qid && queryFamilies.includes(family)) {
      out[family] = { id: qid, rev: qrev }
      continue
    }
    if (!args.isPreview) {
      const saved = readOwnFamilyBinding(mapFamilies, family)
      if (saved !== undefined) {
        out[family] = saved
        continue
      }
      if (mid && mappingFamilies.includes(family)) {
        out[family] = { id: mid, rev: mrev }
        continue
      }
    }
    const configured = readOwnFamilyBinding(args.configFamilies, family)
    if (configured !== undefined) {
      out[family] = configured
      continue
    }
    const defaulted = readOwnFamilyBinding(args.defaultsFamilies, family)
    if (defaulted !== undefined) {
      out[family] = defaulted
      continue
    }
    out[family] = { id: null, rev: null }
  }
  return out
}
