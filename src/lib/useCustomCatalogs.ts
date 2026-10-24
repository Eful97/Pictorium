"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { flushSync } from "react-dom"
import type { CustomCatalogConfig } from "./types"
import { PICTORIUM_CATALOGS } from "./catalog-definitions"
import {
  CATALOG_SHAPES_STORAGE_KEY,
  normalizeCatalogShapeKeys,
  sanitizeCatalogShapes,
  type CatalogShapeOverride,
  type CatalogShapes,
} from "./catalog-shape"
import { isProfilelessOnMultiUser, notifyProfilelessOnce, shouldSkipServerSync } from "./guest-guard"
import { sanitizeSeasonalCustomKeywords } from "./seasonal-theme"
import { userFetch } from "./http"
import { USER_UNLOCK_EVENT } from "./user-token"
import { t } from "./i18n"
import { sanitizeGenericStreamingSelections, streamingCatalogId, type StreamingSelection, type StreamingService } from "./streaming-catalogs"
import type { GenericStreamingSection, SanitizedGenericStreamingSelection, StreamingSourceMode } from "./streaming-catalogs"
import {
  ANIME_TOP_CATALOG_IDS,
  STREAMING_SELECTIONS_STORAGE_KEY,
  addGenericSelectionsToList,
  derivedIdsForGenericSelection,
  genericSelectionKey,
  toPersistedSelections,
  type BatchAddResult,
  type GenericAddEntry,
} from "./streaming-catalog-client"
import { isDefaultTop20CatalogId, withoutDefaultTop20Ids, withoutDefaultTop20Keys } from "./default-lists-reset"
import { readOnboardingProgress, ONBOARDING_DONE_KEY } from "./onboarding-progress"
import { currentPathUuid } from "./user-token"

/** localStorage keys for the user-scoped seasonal keyword settings. */
export const SEASONAL_HALLOWEEN_KEYWORDS_STORAGE_KEY = "pictorium_seasonal_halloween_keywords"
export const SEASONAL_CHRISTMAS_KEYWORDS_STORAGE_KEY = "pictorium_seasonal_christmas_keywords"

/**
 * Derived catalog ids owned by one custom/addon config (single source of
 * truth for shared-record cleanup on remove — single and bulk alike).
 */
export function customDerivedIds(cfg: { id: string; type: string }): string[] {
  return cfg.type === "mixed"
    ? [`pictorium-custom-movie-${cfg.id}`, `pictorium-custom-series-${cfg.id}`]
    : [`pictorium-custom-${cfg.type}-${cfg.id}`]
}

export function useCustomCatalogs(
  safeGetItem: (key: string) => string | null,
  safeSetItem: (key: string, val: string) => void
) {
  const [customCatalogs, setCustomCatalogsState] = useState<CustomCatalogConfig[]>([])
  const [disabledCatalogIds, setDisabledCatalogIdsState] = useState<string[]>([])
  const [homeDisabledCatalogIds, setHomeDisabledCatalogIdsState] = useState<string[]>([])
  const [catalogOrder, setCatalogOrderState] = useState<string[]>([])
  const [catalogRenames, setCatalogRenamesState] = useState<Record<string, string>>({})
  const [catalogShapes, setCatalogShapesState] = useState<CatalogShapes>({})
  // Custom seasonal keywords per theme (user-scoped): extra whole-word/phrase
  // matches for the automatic catalog-name recognition (seasonal-theme.ts).
  // Same persistence as the other catalog records: localStorage + canonical
  // catalog PUT to /api/defaults (+ profileless config token, see
  // useLocalConfigToken). Sanitized on every write and read.
  const [seasonalHalloweenKeywords, setSeasonalHalloweenKeywordsState] = useState<string[]>([])
  const [seasonalChristmasKeywords, setSeasonalChristmasKeywordsState] = useState<string[]>([])
  /**
   * Opt-in streaming selections (service + country). `undefined` = absent =
   * legacy mode (historical built-in platform catalogs keep serving, byte
   * identical). Any explicit value (`[]` or a list) = curated opt-in mode.
   * Sanitized on every write and read (see `streaming-catalogs.ts`).
   */
  const [streamingSelections, setStreamingSelectionsState] = useState<StreamingSelection[] | undefined>(undefined)
  // Catalog-name emoji visibility (display only, default shown): true unless
  // explicitly set to false. Stored names are never rewritten by the toggle.
  const [catalogShowEmojis, setCatalogShowEmojisState] = useState(true)
  const lastSyncRef = useRef<string>("")
  const pendingRef = useRef("")
  const [syncAttempt, setSyncAttempt] = useState(0)
  // Bumped on every acknowledged catalog PUT so rank consumers (badge,
  // preview poster) refetch when a custom list changes under the same
  // ranking selection (edited URL/type, disable, delete).
  const [catalogsSyncNonce, setCatalogsSyncNonce] = useState(0)
  const [hydrated, setHydrated] = useState(false)
  // Serializza i PUT in ordine d'arrivo: senza, due modifiche rapide con
  // risposte ritardate possono chiudere il server con il payload vecchio
  // (A lenta che atterra dopo B). La catena garantisce A-poi-B.
  const putChainRef = useRef<Promise<void>>(Promise.resolve())

  // Refresh cataloghi dal server (namespace via userFetch su /u/<uuid>).
  // Rilegge i flag "saved" fresh da localStorage e riempie solo ciò che è
  // ancora vuoto (stessa semantica del mount). Riusato post-unlock: la prima
  // fetch può aver girato senza token (race col #key=).
  const refreshCatalogsFromServer = useCallback(() => {
    const hasSaved = (key: string, isRecord?: boolean): boolean => {
      const raw = safeGetItem(key)
      if (!raw) return false
      try {
        const parsed = JSON.parse(raw)
        // Presenza valida = salvato, anche se vuoto: una lista svuotata di
        // proposito (`[]`/`{}`) non va ripopolata dai defaults server obsoleti.
        if (isRecord) return !!parsed && typeof parsed === "object" && !Array.isArray(parsed)
        return Array.isArray(parsed)
      } catch { return false }
    }
    const savedCustomCats = hasSaved("pictorium_custom_catalogs")
    const savedDisabledCats = hasSaved("pictorium_disabled_catalogs")
    const savedHomeDisabledCats = hasSaved("pictorium_home_disabled_catalogs")
    const savedOrder = hasSaved("pictorium_catalog_order")
    const savedRenames = hasSaved("pictorium_catalog_renames", true)
    const savedShapes = hasSaved(CATALOG_SHAPES_STORAGE_KEY, true)
    const savedEmojis = safeGetItem("pictorium_catalog_show_emojis") !== null
    const savedSeasonalHalloween = hasSaved(SEASONAL_HALLOWEEN_KEYWORDS_STORAGE_KEY)
    const savedSeasonalChristmas = hasSaved(SEASONAL_CHRISTMAS_KEYWORDS_STORAGE_KEY)
    const savedStreaming = hasSaved(STREAMING_SELECTIONS_STORAGE_KEY)
    // Hydrate missing or server-configured defaults
    userFetch("/api/defaults")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        const serverStreaming = sanitizeGenericStreamingSelections(data.streamingSelections)
        lastSyncRef.current = JSON.stringify({
          customCatalogs: data.customCatalogs ?? [],
          disabledCatalogIds: data.disabledCatalogIds ?? [],
          homeDisabledCatalogIds: data.homeDisabledCatalogIds ?? [],
          catalogOrder: data.catalogOrder ?? [],
          catalogRenames: data.catalogRenames ?? {},
          catalogShapes: normalizeCatalogShapeKeys(data.catalogShapes) ?? {},
          catalogShowEmojis: data.catalogShowEmojis ?? true,
          seasonalHalloweenKeywords: sanitizeSeasonalCustomKeywords(data.seasonalHalloweenKeywords),
          seasonalChristmasKeywords: sanitizeSeasonalCustomKeywords(data.seasonalChristmasKeywords),
          streamingSelections: serverStreaming ? toPersistedSelections(serverStreaming) : undefined,
        })
        if (Array.isArray(data.customCatalogs) && !savedCustomCats) {
          setCustomCatalogsState((prev) => {
            if (prev.length === 0) {
              safeSetItem("pictorium_custom_catalogs", JSON.stringify(data.customCatalogs))
              return data.customCatalogs
            }
            return prev
          })
        }
        if (Array.isArray(data.disabledCatalogIds) && !savedDisabledCats) {
          setDisabledCatalogIdsState((prev) => {
            if (prev.length === 0) {
              safeSetItem("pictorium_disabled_catalogs", JSON.stringify(data.disabledCatalogIds))
              return data.disabledCatalogIds
            }
            return prev
          })
        }
        if (Array.isArray(data.homeDisabledCatalogIds) && !savedHomeDisabledCats) {
          setHomeDisabledCatalogIdsState((prev) => {
            if (prev.length === 0) {
              safeSetItem("pictorium_home_disabled_catalogs", JSON.stringify(data.homeDisabledCatalogIds))
              return data.homeDisabledCatalogIds
            }
            return prev
          })
        }
        if (Array.isArray(data.catalogOrder) && !savedOrder) {
          setCatalogOrderState((prev) => {
            if (prev.length === 0) {
              safeSetItem("pictorium_catalog_order", JSON.stringify(data.catalogOrder))
              return data.catalogOrder
            }
            return prev
          })
        }
        if (data.catalogRenames && typeof data.catalogRenames === "object" && !Array.isArray(data.catalogRenames) && !savedRenames) {
          setCatalogRenamesState((prev) => {
            if (Object.keys(prev).length === 0) {
              safeSetItem("pictorium_catalog_renames", JSON.stringify(data.catalogRenames))
              return data.catalogRenames
            }
            return prev
          })
        }
        if (data.catalogShapes && typeof data.catalogShapes === "object" && !Array.isArray(data.catalogShapes) && !savedShapes) {
          const clean = normalizeCatalogShapeKeys(data.catalogShapes) ?? {}
          setCatalogShapesState((prev) => {
            if (Object.keys(prev).length === 0) {
              safeSetItem(CATALOG_SHAPES_STORAGE_KEY, JSON.stringify(clean))
              return clean
            }
            return prev
          })
        }
        if (typeof data.catalogShowEmojis === "boolean" && !savedEmojis) {
          const serverShow = data.catalogShowEmojis
          setCatalogShowEmojisState(serverShow)
          safeSetItem("pictorium_catalog_show_emojis", JSON.stringify(serverShow))
        }
        if (!savedSeasonalHalloween) {
          const clean = sanitizeSeasonalCustomKeywords(data.seasonalHalloweenKeywords)
          if (clean.length > 0) {
            setSeasonalHalloweenKeywordsState(clean)
            safeSetItem(SEASONAL_HALLOWEEN_KEYWORDS_STORAGE_KEY, JSON.stringify(clean))
          }
        }
        if (!savedSeasonalChristmas) {
          const clean = sanitizeSeasonalCustomKeywords(data.seasonalChristmasKeywords)
          if (clean.length > 0) {
            setSeasonalChristmasKeywordsState(clean)
            safeSetItem(SEASONAL_CHRISTMAS_KEYWORDS_STORAGE_KEY, JSON.stringify(clean))
          }
        }
        // Explicit server selections hydrate only when nothing is saved
        // locally. An absent server field NEVER writes: absent (undefined,
        // or null from a foreign write) is legacy mode and must survive
        // hydration byte-identical — a mere mount must not migrate it (and no
        // auto-PUT may persist a derived value over it).
        if (data.streamingSelections != null && !savedStreaming) {
          const sanitized = sanitizeGenericStreamingSelections(data.streamingSelections) ?? []
          const clean = toPersistedSelections(sanitized)
          setStreamingSelectionsState((prev) => {
            if (prev !== undefined) return prev
            safeSetItem(STREAMING_SELECTIONS_STORAGE_KEY, JSON.stringify(clean))
            return clean
          })
        }
        // Genuine-new space default (task 3 owns it): ONLY general JustWatch
        // Top 20 movies+series — no legacy platform lists, no anime. Fires
        // only on positive new-space evidence, never on mere mount of a
        // legacy space, a server failure, or an untrusted (locked) read:
        // - server fetch succeeded (data non-null, checked above) with an
        //   EMPTY catalog domain (streaming absent, no customs/disables),
        // - no catalog-domain key saved locally (this mount read them fresh),
        // - a blank device (no API keys, no onboarding trace for this space),
        // - and sync is not skipped for a locked foreign namespace (a locked
        //   read is global defaults, NOT proof of a new space; a
        //   profileless-local space may still init: its sync is skipped so a
        //   local default can never wipe server state, and the device token
        //   carries it instead).
        void (async () => {
          try {
            const serverCatalogEmpty =
              data.streamingSelections === undefined &&
              (!Array.isArray(data.customCatalogs) || data.customCatalogs.length === 0) &&
              (!Array.isArray(data.disabledCatalogIds) || data.disabledCatalogIds.length === 0) &&
              (!Array.isArray(data.homeDisabledCatalogIds) || data.homeDisabledCatalogIds.length === 0) &&
              (!Array.isArray(data.catalogOrder) || data.catalogOrder.length === 0) &&
              (!data.catalogRenames || Object.keys(data.catalogRenames).length === 0)
            if (!serverCatalogEmpty) return
            if (
              savedCustomCats || savedDisabledCats || savedHomeDisabledCats ||
              savedOrder || savedRenames || savedShapes || savedEmojis ||
              savedSeasonalHalloween || savedSeasonalChristmas || savedStreaming
            ) return
            if (
              safeGetItem("tmdb_key") || safeGetItem("mdblist_key") || safeGetItem("tvdb_key") ||
              safeGetItem(ONBOARDING_DONE_KEY) !== null ||
              readOnboardingProgress(currentPathUuid()) !== null
            ) return
            if (await shouldSkipServerSync()) {
              if (!(await isProfilelessOnMultiUser())) return
            }
            setStreamingSelectionsState((prev) => {
              if (prev !== undefined) return prev
              safeSetItem(STREAMING_SELECTIONS_STORAGE_KEY, JSON.stringify([]))
              return []
            })
            setDisabledCatalogIdsState((prev) => {
              if (prev.length > 0) return prev
              const next = [...ANIME_TOP_CATALOG_IDS]
              safeSetItem("pictorium_disabled_catalogs", JSON.stringify(next))
              return next
            })
          } catch {
            // New-space default is best-effort only: any failure leaves the
            // legacy behavior untouched instead of half-initializing.
          }
        })()
      })
      .catch(() => {})
      .finally(() => setHydrated(true))
  }, [safeGetItem, safeSetItem])

  // Initial load: localStorage + fetch /api/defaults
  useEffect(() => {
    let localCustom: CustomCatalogConfig[] = []
    let localDisabled: string[] = []
    let localHomeDisabled: string[] = []
    let localOrder: string[] = []
    let localRenames: Record<string, string> = {}
    let localShapes: CatalogShapes = {}
    let localShowEmojis = true
    let localSeasonalHalloween: string[] = []
    let localSeasonalChristmas: string[] = []
    let localStreaming: StreamingSelection[] | undefined = undefined

    const savedCustomCats = safeGetItem("pictorium_custom_catalogs")
    if (savedCustomCats) {
      try {
        const parsed = JSON.parse(savedCustomCats)
        if (Array.isArray(parsed)) {
          localCustom = parsed
          setCustomCatalogsState(localCustom)
        }
      } catch {}
    }
    const savedDisabledCats = safeGetItem("pictorium_disabled_catalogs")
    if (savedDisabledCats) {
      try {
        const parsed = JSON.parse(savedDisabledCats)
        if (Array.isArray(parsed)) {
          localDisabled = parsed
          setDisabledCatalogIdsState(localDisabled)
        }
      } catch {}
    }
    const savedHomeDisabledCats = safeGetItem("pictorium_home_disabled_catalogs")
    if (savedHomeDisabledCats) {
      try {
        const parsed = JSON.parse(savedHomeDisabledCats)
        if (Array.isArray(parsed)) {
          localHomeDisabled = parsed
          setHomeDisabledCatalogIdsState(localHomeDisabled)
        }
      } catch {}
    }
    const savedOrder = safeGetItem("pictorium_catalog_order")
    if (savedOrder) {
      try {
        const parsed = JSON.parse(savedOrder)
        if (Array.isArray(parsed)) {
          localOrder = parsed
          setCatalogOrderState(localOrder)
        }
      } catch {}
    }
    const savedRenames = safeGetItem("pictorium_catalog_renames")
    if (savedRenames) {
      try {
        const parsed = JSON.parse(savedRenames)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          localRenames = parsed
          setCatalogRenamesState(localRenames)
        }
      } catch {}
    }
    const savedShapesRaw = safeGetItem(CATALOG_SHAPES_STORAGE_KEY)
    if (savedShapesRaw) {
      try {
        const parsed = JSON.parse(savedShapesRaw)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          localShapes = sanitizeCatalogShapes(parsed)
          setCatalogShapesState(localShapes)
        }
      } catch {}
    }
    const savedShowEmojisRaw = safeGetItem("pictorium_catalog_show_emojis")
    if (savedShowEmojisRaw !== null) {
      try {
        const parsed = JSON.parse(savedShowEmojisRaw)
        if (typeof parsed === "boolean") {
          localShowEmojis = parsed
          setCatalogShowEmojisState(localShowEmojis)
        }
      } catch {}
    }
    const savedSeasonalHalloweenRaw = safeGetItem(SEASONAL_HALLOWEEN_KEYWORDS_STORAGE_KEY)
    if (savedSeasonalHalloweenRaw) {
      try {
        const clean = sanitizeSeasonalCustomKeywords(JSON.parse(savedSeasonalHalloweenRaw))
        localSeasonalHalloween = clean
        setSeasonalHalloweenKeywordsState(clean)
      } catch {}
    }
    const savedSeasonalChristmasRaw = safeGetItem(SEASONAL_CHRISTMAS_KEYWORDS_STORAGE_KEY)
    if (savedSeasonalChristmasRaw) {
      try {
        const clean = sanitizeSeasonalCustomKeywords(JSON.parse(savedSeasonalChristmasRaw))
        localSeasonalChristmas = clean
        setSeasonalChristmasKeywordsState(clean)
      } catch {}
    }
    // Absent key = legacy mode (undefined): never default to `[]` here — an
    // explicit opt-in is only ever written by user action (Add), server fill
    // of an explicit value, or the genuine-new default above.
    const savedStreamingRaw = safeGetItem(STREAMING_SELECTIONS_STORAGE_KEY)
    if (savedStreamingRaw) {
      try {
        const parsed: unknown = JSON.parse(savedStreamingRaw)
        if (Array.isArray(parsed)) {
          // Generic sanitize (fail-closed, never Italy) + persisted model
          // (mutable arrays, absent source/variant for auto/base): unknown
          // future fields are dropped from state exactly like before, while
          // storage keeps the raw bytes until an explicit write.
          localStreaming = toPersistedSelections(sanitizeGenericStreamingSelections(parsed) ?? [])
          setStreamingSelectionsState(localStreaming)
        }
      } catch {}
    }

    lastSyncRef.current = JSON.stringify({
      customCatalogs: localCustom,
      disabledCatalogIds: localDisabled,
      homeDisabledCatalogIds: localHomeDisabled,
      catalogOrder: localOrder,
      catalogRenames: localRenames,
      catalogShapes: localShapes,
      catalogShowEmojis: localShowEmojis,
      seasonalHalloweenKeywords: localSeasonalHalloween,
      seasonalChristmasKeywords: localSeasonalChristmas,
      streamingSelections: localStreaming,
    })

    refreshCatalogsFromServer()
  }, [safeGetItem, safeSetItem, refreshCatalogsFromServer])

  // Post-unlock: ricarica i cataloghi del namespace senza refresh pagina.
  useEffect(() => {
    const onUnlock = () => { refreshCatalogsFromServer(); setSyncAttempt((n) => n + 1) }
    window.addEventListener(USER_UNLOCK_EVENT, onUnlock)
    return () => window.removeEventListener(USER_UNLOCK_EVENT, onUnlock)
  }, [refreshCatalogsFromServer])

  // Keep the latest desired payload separate from the last acknowledged PUT.
  // `streamingSelections: undefined` (absent = legacy) stringifies to an
  // omitted key on BOTH sides, so legacy spaces never emit a field they
  // never set and no auto-PUT can persist a derived value over absent.
  const payloadStr = JSON.stringify({ customCatalogs, disabledCatalogIds, homeDisabledCatalogIds, catalogOrder, catalogRenames, catalogShapes, catalogShowEmojis, seasonalHalloweenKeywords, seasonalChristmasKeywords, streamingSelections })
  useEffect(() => {
    pendingRef.current = payloadStr
    if (!hydrated || lastSyncRef.current === payloadStr) return
    const timer = setTimeout(() => {
      // Queue the guard together with the write so slow auth checks cannot reorder PUTs.
      putChainRef.current = putChainRef.current.then(async () => {
        if (pendingRef.current !== payloadStr || lastSyncRef.current === payloadStr) return
        try {
          if (await shouldSkipServerSync()) {
            if (await isProfilelessOnMultiUser()) notifyProfilelessOnce()
            return
          }
          if (pendingRef.current !== payloadStr) return
          const res = await userFetch("/api/defaults", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: payloadStr,
            signal: AbortSignal.timeout(15000),
          })
          if (!res.ok) throw new Error("HTTP " + res.status)
          lastSyncRef.current = payloadStr
          setCatalogsSyncNonce((n) => n + 1)
          if (pendingRef.current !== payloadStr) setSyncAttempt((n) => n + 1)
        } catch (error) {
          if (pendingRef.current !== payloadStr) return
          console.warn("[catalogs] Sync failed:", error)
          const { toast } = await import("sonner")
          toast.warning(t("ui.catalogSyncFailed"), {
            action: { label: t("ui.retry"), onClick: () => setSyncAttempt((n) => n + 1) },
          })
        }
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [payloadStr, syncAttempt, hydrated])

  const setCustomCatalogs = useCallback((catalogs: CustomCatalogConfig[]) => {
    setCustomCatalogsState(catalogs)
    safeSetItem("pictorium_custom_catalogs", JSON.stringify(catalogs))
  }, [safeSetItem])

  const addCustomCatalog = useCallback((catalog: Omit<CustomCatalogConfig, "id">) => {
    const id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    setCustomCatalogsState((prev) => {
      const next = [...prev, { ...catalog, id }]
      safeSetItem("pictorium_custom_catalogs", JSON.stringify(next))
      return next
    })
  }, [safeSetItem])

  const dropDerivedIds = useCallback((derived: string[]) => {
    const dropIds = (ids: string[]) => ids.filter((id) => !derived.includes(id))
    setCatalogOrderState((prev) => {
      const next = dropIds(prev)
      if (next.length !== prev.length) safeSetItem("pictorium_catalog_order", JSON.stringify(next))
      return next
    })
    setDisabledCatalogIdsState((prev) => {
      const next = dropIds(prev)
      if (next.length !== prev.length) safeSetItem("pictorium_disabled_catalogs", JSON.stringify(next))
      return next
    })
    setHomeDisabledCatalogIdsState((prev) => {
      const next = dropIds(prev)
      if (next.length !== prev.length) safeSetItem("pictorium_home_disabled_catalogs", JSON.stringify(next))
      return next
    })
    setCatalogRenamesState((prev) => {
      if (!derived.some((id) => id in prev)) return prev
      const next = { ...prev }
      for (const id of derived) delete next[id]
      safeSetItem("pictorium_catalog_renames", JSON.stringify(next))
      return next
    })
    setCatalogShapesState((prev) => {
      if (!derived.some((id) => id in prev)) return prev
      const next = { ...prev }
      for (const id of derived) delete next[id]
      safeSetItem(CATALOG_SHAPES_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [safeSetItem])

  const removeCustomCatalog = useCallback((id: string) => {
    // Read the doomed config synchronously: the derived ids must be cleaned
    // from the shared records (same contract as bulk remove) — removing the
    // config alone would orphan order/disabled/rename/home/shape entries.
    const target = customCatalogs.find((c) => c.id === id)
    setCustomCatalogsState((prev) => {
      const next = prev.filter((c) => c.id !== id)
      safeSetItem("pictorium_custom_catalogs", JSON.stringify(next))
      return next
    })
    if (target) dropDerivedIds(customDerivedIds(target))
  }, [customCatalogs, safeSetItem, dropDerivedIds])

  const toggleCustomCatalog = useCallback((id: string) => {
    setCustomCatalogsState((prev) => {
      // `enabled` assente = attivo (come in UI/manifest): il primo toggle di
      // una config legacy deve disabilitare, non consolidare `true`.
      const next = prev.map((c) => (c.id === id ? { ...c, enabled: !(c.enabled !== false) } : c))
      safeSetItem("pictorium_custom_catalogs", JSON.stringify(next))
      return next
    })
  }, [safeSetItem])

  const setDisabledCatalogIds = useCallback((ids: string[]) => {
    setDisabledCatalogIdsState(ids)
    safeSetItem("pictorium_disabled_catalogs", JSON.stringify(ids))
  }, [safeSetItem])

  const toggleBuiltinCatalog = useCallback((id: string) => {
    setDisabledCatalogIdsState((prev) => {
      const next = prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
      safeSetItem("pictorium_disabled_catalogs", JSON.stringify(next))
      return next
    })
  }, [safeSetItem])

  /**
   * Opt-in streaming selection writers. All sanitize through the shared
   * backend leaf and persist locally + through the single canonical catalog
   * PUT (same chain as every other catalog record — never a second system).
   * Writing ANY explicit value (including `[]`) switches the space to
   * curated mode; callers surface that consequence before the first Add.
   */
  /**
   * Generic identity match on sanitized entries (service + chart slug +
   * source + variant): the same provider in another country, source or
   * variant is a distinct identity and never merges.
   */
  const matchGenericEntry = (
    entry: SanitizedGenericStreamingSelection,
    service: string,
    country: string,
    source?: StreamingSourceMode | null,
    variant?: string | null,
  ): boolean =>
    genericSelectionKey(entry) ===
    genericSelectionKey({ service, country, source: source ?? "auto", variant: variant ?? null })

  const setStreamingSelections = useCallback((selections: StreamingSelection[]) => {
    const clean = toPersistedSelections(sanitizeGenericStreamingSelections(selections) ?? [])
    setStreamingSelectionsState(clean)
    safeSetItem(STREAMING_SELECTIONS_STORAGE_KEY, JSON.stringify(clean))
  }, [safeSetItem])

  const addStreamingSelections = useCallback((entries: GenericAddEntry[]) => {
    // Synchronous outcome against the latest committed state: flushSync
    // runs the functional updater immediately, so back-to-back writers in
    // one tick (and the returned status/counts) never read stale snapshots.
    let result: BatchAddResult = { selections: [], added: 0, merged: 0, duplicates: 0, status: "invalid" }
    flushSync(() => {
      setStreamingSelectionsState((prev) => {
        const current = sanitizeGenericStreamingSelections(prev ?? []) ?? []
        result = addGenericSelectionsToList(current, entries)
        if (result.status !== "added" && result.status !== "merged") return prev
        const persisted = toPersistedSelections(result.selections)
        safeSetItem(STREAMING_SELECTIONS_STORAGE_KEY, JSON.stringify(persisted))
        return persisted
      })
    })
    return result
  }, [safeSetItem])

  const addStreamingSelection = useCallback((
    service: string,
    country: string,
    sections: GenericStreamingSection[],
    source?: StreamingSourceMode,
    variant?: string | null,
  ) => {
    return addStreamingSelections([{ service, country, sections, source, variant }]).status
  }, [addStreamingSelections])

  /**
   * Remove streaming lists. With a `section`, ONLY that derived list id is
   * removed (the sibling Film/Serie list and every other provider/country/
   * source/variant entry stay untouched; the entry narrows, or disappears
   * when its last section goes). Without it, the whole entry (all its
   * derived ids) is removed. Shared records lose ONLY the dropped ids, so
   * no unrelated persisted choice is touched.
   */
  const removeStreamingSelection = useCallback((
    service: string,
    country: string,
    source?: StreamingSourceMode | null,
    variant?: string | null,
    section?: GenericStreamingSection,
  ) => {
    // flushSync + functional updater: the next state AND the dropped ids
    // derive from the latest committed array, so same-tick writers compose
    // instead of recomputing from a stale snapshot.
    let dropped: string[] = []
    flushSync(() => {
      setStreamingSelectionsState((prev) => {
        const current = sanitizeGenericStreamingSelections(prev ?? []) ?? []
        const target = current.find((s) => matchGenericEntry(s, service, country, source, variant))
        if (!target) return prev
        // Whole-entry remove (no section) drops the entry's full derived-id
        // footprint: for legacy entries BOTH static ids (an entry narrowed to
        // one section earlier still owns the other's lingering record keys —
        // the historical static cleanup, byte-identical); for generic entries
        // the current sections' ids. Per-list remove (section given) drops ONLY
        // that derived id; siblings stay.
        const ids = section
          ? derivedIdsForGenericSelection(target).filter((id) => {
              if (target.legacy) return id.endsWith(`-${section}`)
              return id.includes(`--${section}--`)
            })
          : target.legacy
            ? [
                streamingCatalogId(target.service as StreamingService, target.country, "movies"),
                streamingCatalogId(target.service as StreamingService, target.country, "series"),
              ]
            : derivedIdsForGenericSelection(target)
        if (ids.length === 0) return prev
        dropped = ids
        let next: SanitizedGenericStreamingSelection[]
        if (section) {
          const remaining = target.sections.filter((s) => s !== section)
          next = remaining.length === 0
            ? current.filter((s) => s !== target)
            : current.map((s) => (s === target ? { ...s, sections: remaining } : s))
        } else {
          next = current.filter((s) => s !== target)
        }
        const persisted = toPersistedSelections(next)
        safeSetItem(STREAMING_SELECTIONS_STORAGE_KEY, JSON.stringify(persisted))
        return persisted
      })
    })
    if (dropped.length > 0) dropDerivedIds(dropped)
  }, [safeSetItem, dropDerivedIds])

  /**
   * Atomic bulk remove of derived streaming lists (manager multi-delete).
   * One flushSync'd functional update computes AND persists once: each item
   * is an exact per-section identity (service + chart country + source +
   * variant + section); factory JW ids never enter (toggle-only, filtered
   * by the caller). Returns the actually removed count + the dropped
   * derived ids (empty when nothing matched).
   */
  const removeStreamingSelections = useCallback((items: ReadonlyArray<{
    service: string
    country: string
    source?: StreamingSourceMode | null
    variant?: string | null
    section: GenericStreamingSection
  }>) => {
    let dropped: string[] = []
    flushSync(() => {
      setStreamingSelectionsState((prev) => {
        const current = sanitizeGenericStreamingSelections(prev ?? []) ?? []
        let next = [...current]
        const ids: string[] = []
        for (const item of items) {
          const target = next.find((s) => matchGenericEntry(s, item.service, item.country, item.source, item.variant))
          if (!target) continue
          const itemIds = derivedIdsForGenericSelection(target).filter((id) => {
            if (target.legacy) return id.endsWith(`-${item.section}`)
            return id.includes(`--${item.section}--`)
          })
          if (itemIds.length === 0) continue
          ids.push(...itemIds)
          const remaining = target.sections.filter((s) => s !== item.section)
          next = remaining.length === 0
            ? next.filter((s) => s !== target)
            : next.map((s) => (s === target ? { ...s, sections: remaining } : s))
        }
        if (ids.length === 0) return prev
        dropped = ids
        const persisted = toPersistedSelections(next)
        safeSetItem(STREAMING_SELECTIONS_STORAGE_KEY, JSON.stringify(persisted))
        return persisted
      })
    })
    if (dropped.length > 0) dropDerivedIds(dropped)
    return { removed: dropped.length, droppedIds: dropped }
  }, [safeSetItem, dropDerivedIds])

  /**
   * Atomic bulk remove of whole custom/addon providers (manager multi-delete).
   * The data model owns one config per provider: only whole providers are
   * removed (the caller includes a provider only when ALL its emitted rows
   * are selected — never one section of a mixed pair). Derived ids are
   * computed by the caller from live rows and cleaned once.
   */
  const removeCustomCatalogs = useCallback((baseIds: readonly string[], derivedIds: readonly string[]) => {
    if (baseIds.length === 0) return
    const wanted = new Set(baseIds)
    setCustomCatalogsState((prev) => {
      const next = prev.filter((c) => !wanted.has(c.id))
      safeSetItem("pictorium_custom_catalogs", JSON.stringify(next))
      return next
    })
    if (derivedIds.length > 0) dropDerivedIds([...derivedIds])
  }, [safeSetItem, dropDerivedIds])

  /**
   * Independent Hide (keep config, don't expose to Stremio): flips the entry
   * `enabled` flag. Re-showing restores the stored sections untouched.
   */
  const toggleStreamingSelection = useCallback((
    service: string,
    country: string,
    source?: StreamingSourceMode | null,
    variant?: string | null,
  ) => {
    // Functional updater: sequential same-tick toggles compose on the
    // latest queued state (no mirror needed, nothing read synchronously).
    setStreamingSelectionsState((prev) => {
      if (!prev) return prev
      const current = sanitizeGenericStreamingSelections(prev) ?? []
      const next = current.map((s) =>
        matchGenericEntry(s, service, country, source, variant)
          ? { ...s, enabled: !(s.enabled !== false) }
          : s,
      )
      const persisted = toPersistedSelections(next)
      safeSetItem(STREAMING_SELECTIONS_STORAGE_KEY, JSON.stringify(persisted))
      return persisted
    })
  }, [safeSetItem])

  /**
   * Per-section toggle for one entry (Catalog Manager rows are per section):
   * hiding the last remaining section Hides the entry (enabled=false, config
   * kept); showing a section of a hidden entry re-enables it with its stored
   * sections; otherwise the section set narrows/widens.
   */
  const toggleStreamingSection = useCallback((
    service: string,
    country: string,
    section: GenericStreamingSection,
    source?: StreamingSourceMode | null,
    variant?: string | null,
  ) => {
    // Functional updater like every other state write (see above).
    setStreamingSelectionsState((prev) => {
      if (!prev) return prev
      const current = sanitizeGenericStreamingSelections(prev) ?? []
      const next = current.map((s) => {
        if (!matchGenericEntry(s, service, country, source, variant)) return s
        const has = (s.sections as readonly string[]).includes(section)
        if (s.enabled === false) {
          return { ...s, enabled: true }
        }
        if (has && s.sections.length <= 1) {
          return { ...s, enabled: false }
        }
        return {
          ...s,
          sections: (has
            ? (s.sections as readonly string[]).filter((x) => x !== section)
            : [...s.sections, section]) as SanitizedGenericStreamingSelection["sections"],
        }
      })
      const persisted = toPersistedSelections(next)
      safeSetItem(STREAMING_SELECTIONS_STORAGE_KEY, JSON.stringify(persisted))
      return persisted
    })
  }, [safeSetItem])

  const setHomeDisabledCatalogIds = useCallback((ids: string[]) => {
    setHomeDisabledCatalogIdsState(ids)
    safeSetItem("pictorium_home_disabled_catalogs", JSON.stringify(ids))
  }, [safeSetItem])

  const toggleCatalogHome = useCallback((id: string) => {
    setHomeDisabledCatalogIdsState((prev) => {
      const next = prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
      safeSetItem("pictorium_home_disabled_catalogs", JSON.stringify(next))
      return next
    })
  }, [safeSetItem])

  const setCatalogOrder = useCallback((order: string[]) => {
    setCatalogOrderState(order)
    safeSetItem("pictorium_catalog_order", JSON.stringify(order))
  }, [safeSetItem])

  const moveCatalog = useCallback((id: string, direction: "up" | "down") => {
    setCatalogOrderState((prev) => {
      const allIds: string[] = []
      const existing = new Set<string>()
      prev.forEach((catId) => {
        allIds.push(catId)
        existing.add(catId)
      })
      PICTORIUM_CATALOGS.forEach((c) => {
        if (!existing.has(c.id)) {
          allIds.push(c.id)
          existing.add(c.id)
        }
      })
      customCatalogs.forEach((c) => {
        if (c.type === "mixed") {
          const mId = `pictorium-custom-movie-${c.id}`
          const sId = `pictorium-custom-series-${c.id}`
          if (!existing.has(mId)) { allIds.push(mId); existing.add(mId) }
          if (!existing.has(sId)) { allIds.push(sId); existing.add(sId) }
        } else {
          const cId = `pictorium-custom-${c.type}-${c.id}`
          if (!existing.has(cId)) { allIds.push(cId); existing.add(cId) }
        }
      })
      // Opt-in streaming rows are per derived list id (same as custom
      // mixed splits): without them here a first move would no-op.
      // Generic entries expand to their full derived ids (legacy ids stay
      // byte-identical, new ids carry source/variant).
      for (const stored of streamingSelections ?? []) {
        const sanitized = sanitizeGenericStreamingSelections([stored]) ?? []
        for (const sel of sanitized) {
          for (const sectionId of derivedIdsForGenericSelection(sel)) {
            if (!existing.has(sectionId)) { allIds.push(sectionId); existing.add(sectionId) }
          }
        }
      }

      const idx = allIds.indexOf(id)
      if (idx === -1) return prev
      const targetIdx = direction === "up" ? idx - 1 : idx + 1
      if (targetIdx < 0 || targetIdx >= allIds.length) return allIds

      const next = [...allIds]
      const [item] = next.splice(idx, 1)
      next.splice(targetIdx, 0, item)
      safeSetItem("pictorium_catalog_order", JSON.stringify(next))
      return next
    })
  }, [customCatalogs, streamingSelections, safeSetItem])

  const setCatalogRenames = useCallback((renames: Record<string, string>) => {
    setCatalogRenamesState(renames)
    safeSetItem("pictorium_catalog_renames", JSON.stringify(renames))
  }, [safeSetItem])

  const renameCatalog = useCallback((id: string, newName: string) => {
    setCatalogRenamesState((prev) => {
      const next = { ...prev, [id]: newName }
      if (!newName.trim()) delete next[id]
      safeSetItem("pictorium_catalog_renames", JSON.stringify(next))
      return next
    })
  }, [safeSetItem])

  const resetCatalogNames = useCallback(() => {
    setCatalogRenamesState({})
    try { localStorage.removeItem("pictorium_catalog_renames") } catch {}
  }, [])

  /**
   * Catalog-name emoji visibility (display only): persists the choice locally
   * and syncs it through the canonical catalog PUT. Stored renames/defaults
   * are never rewritten — display layers strip via the shared pure helper.
   */
  const setCatalogShowEmojis = useCallback((show: boolean) => {
    setCatalogShowEmojisState(show)
    safeSetItem("pictorium_catalog_show_emojis", JSON.stringify(show))
  }, [safeSetItem])

  const setCatalogShapes = useCallback((shapes: CatalogShapes) => {
    const clean = sanitizeCatalogShapes(shapes)
    setCatalogShapesState(clean)
    safeSetItem(CATALOG_SHAPES_STORAGE_KEY, JSON.stringify(clean))
  }, [safeSetItem])

  /**
   * Per-catalog format override: `poster`/`landscape` persist an explicit
   * choice for that catalog only; `null` (follow global) deletes the key so
   * the catalog re-inherits the global setting on both client and server.
   */
  const setCatalogShape = useCallback((id: string, shape: CatalogShapeOverride | null) => {
    setCatalogShapesState((prev) => {
      const next = { ...prev }
      if (shape === null) delete next[id]
      else next[id] = shape
      safeSetItem(CATALOG_SHAPES_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [safeSetItem])

  const resetCatalogShapes = useCallback(() => {
    setCatalogShapesState({})
    try { localStorage.removeItem(CATALOG_SHAPES_STORAGE_KEY) } catch {}
  }, [])

  /**
   * Custom seasonal keywords per theme (see seasonal-theme.ts): sanitized on
   * every write (literal whole-word/phrase match, no regex), persisted
   * locally and synced through the canonical catalog PUT. An empty list =
   * built-ins only (legacy behavior).
   */
  const setSeasonalHalloweenKeywords = useCallback((keywords: string[]) => {
    const clean = sanitizeSeasonalCustomKeywords(keywords)
    setSeasonalHalloweenKeywordsState(clean)
    safeSetItem(SEASONAL_HALLOWEEN_KEYWORDS_STORAGE_KEY, JSON.stringify(clean))
  }, [safeSetItem])

  const setSeasonalChristmasKeywords = useCallback((keywords: string[]) => {
    const clean = sanitizeSeasonalCustomKeywords(keywords)
    setSeasonalChristmasKeywordsState(clean)
    safeSetItem(SEASONAL_CHRISTMAS_KEYWORDS_STORAGE_KEY, JSON.stringify(clean))
  }, [safeSetItem])

  const resetSeasonalKeywords = useCallback(() => {
    setSeasonalHalloweenKeywordsState([])
    setSeasonalChristmasKeywordsState([])
    try { localStorage.removeItem(SEASONAL_HALLOWEEN_KEYWORDS_STORAGE_KEY) } catch {}
    try { localStorage.removeItem(SEASONAL_CHRISTMAS_KEYWORDS_STORAGE_KEY) } catch {}
  }, [])

  const resetCatalogOrder = useCallback(() => {
    setCatalogOrderState([])
    try { localStorage.removeItem("pictorium_catalog_order") } catch {}
  }, [])

  /**
   * Default Top 20 lists reset (catalog slice only, task G): restores the
   * two factory lists (`pictorium-jw-movies` / `pictorium-jw-series`) by
   * clearing ONLY their entries from the shared records — disabled ids,
   * home-hidden ids, order positions, renames. Everything unrelated
   * (custom catalogs, streaming selections — verbatim, unknown fields
   * included — shapes/card formats, seasonal keywords, emojis) is
   * preserved. The Top 20 source slots live in `useRankingSources` and are
   * reset alongside this by the composed `resetDefaultLists` context
   * action (same established split as `removeCustomCatalog`).
   */
  const resetDefaultCatalogs = useCallback(() => {
    setDisabledCatalogIdsState((prev) => {
      if (!prev.some(isDefaultTop20CatalogId)) return prev
      const next = withoutDefaultTop20Ids(prev)
      safeSetItem("pictorium_disabled_catalogs", JSON.stringify(next))
      return next
    })
    setHomeDisabledCatalogIdsState((prev) => {
      if (!prev.some(isDefaultTop20CatalogId)) return prev
      const next = withoutDefaultTop20Ids(prev)
      safeSetItem("pictorium_home_disabled_catalogs", JSON.stringify(next))
      return next
    })
    setCatalogOrderState((prev) => {
      if (!prev.some(isDefaultTop20CatalogId)) return prev
      // Dropping the ids restores factory-first order (unordered catalogs
      // keep manifest order, where the general Top 20s come first) without
      // destroying the custom order of every other row.
      const next = withoutDefaultTop20Ids(prev)
      safeSetItem("pictorium_catalog_order", JSON.stringify(next))
      return next
    })
    setCatalogRenamesState((prev) => {
      const next = withoutDefaultTop20Keys(prev)
      if (next === prev) return prev
      safeSetItem("pictorium_catalog_renames", JSON.stringify(next))
      return next
    })
  }, [safeSetItem])

  return {
    customCatalogs,
    setCustomCatalogs,
    addCustomCatalog,
    removeCustomCatalog,
    toggleCustomCatalog,
    catalogsSyncNonce,
    disabledCatalogIds,
    setDisabledCatalogIds,
    toggleBuiltinCatalog,
    homeDisabledCatalogIds,
    setHomeDisabledCatalogIds,
    toggleCatalogHome,
    catalogOrder,
    setCatalogOrder,
    moveCatalog,
    catalogRenames,
    setCatalogRenames,
    renameCatalog,
    resetCatalogNames,
    resetCatalogOrder,
    resetDefaultCatalogs,
    catalogShowEmojis,
    setCatalogShowEmojis,
    catalogShapes,
    setCatalogShapes,
    setCatalogShape,
    resetCatalogShapes,
    seasonalHalloweenKeywords,
    setSeasonalHalloweenKeywords,
    seasonalChristmasKeywords,
    setSeasonalChristmasKeywords,
    resetSeasonalKeywords,
    streamingSelections,
    setStreamingSelections,
    addStreamingSelection,
    addStreamingSelections,
    removeStreamingSelection,
    removeStreamingSelections,
    toggleStreamingSelection,
    toggleStreamingSection,
    removeCustomCatalogs,
  }
}
