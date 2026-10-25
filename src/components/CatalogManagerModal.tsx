"use client"

import React, { useState, useMemo, useEffect } from "react"
import {
  X,
  Home,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  ChevronDown,
  Edit2,
  Check,
  RotateCcw,
  Power,
  Trash2,
  SlidersHorizontal,
  Film,
  Tv,
  Menu,
  CheckSquare,
  Square,
} from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { PICTORIUM_CATALOGS, regionJwName, partitionAnimeCatalogsLast } from "@/lib/catalog-definitions"
import { sanitizeGenericStreamingSelections, streamingCatalogName, genericStreamingCatalogName, genericVariantLabel } from "@/lib/streaming-catalogs"
import { customDerivedIds } from "@/lib/useCustomCatalogs"
import { derivedIdsForGenericSelection } from "@/lib/streaming-catalog-client"
import type { GenericStreamingSection, StreamingSourceMode } from "@/lib/streaming-catalogs"
import { isStreamingOptIn as isOptInMode } from "@/lib/streaming-catalog-client"
import { rankingSourceCatalogName, resolveCatalogDisplayName } from "@/lib/ranking-source"
import { areDefaultListsDirty, isDefaultTop20CatalogId } from "@/lib/default-lists-reset"
import { getRegionDef } from "@/lib/regions"
import { EmojiPicker } from "@/components/ui"
import { Modal } from "@/components/ui/Modal"
import { SeasonalKeywordsSection } from "@/components/SeasonalKeywordsSection"

interface CatalogManagerModalProps {
  isOpen: boolean
  onClose: () => void
}

interface CatalogEntryItem {
  id: string
  name: string
  originalName: string
  type: "movie" | "series" | "all"
  isCustom: boolean
  customBaseId?: string
  /** Opt-in streaming row (per derived list id): reorder/rename/home/shape reuse the existing machinery. */
  isStreaming?: boolean
  streamingService?: string
  streamingCountry?: string
  streamingSection?: GenericStreamingSection
  streamingSource?: StreamingSourceMode
  streamingVariant?: string | null
  enabled: boolean
  showInHome: boolean
}

export function CatalogManagerModal({ isOpen, onClose }: CatalogManagerModalProps) {
  const { t } = useT()
  // Regione attiva: i nomi dei cataloghi JW seguono la classifica (bandiera
  // dinamica via regionJwName, stessa del manifest Stremio). Senza, il modal
  // restava inchiodato al nome statico "Top 20 Italia" al cambio regione.
  const { defaultRegion, defaultPosterShape } = usePosterEditor()
  const activeRegion = getRegionDef(defaultRegion)
  // Live global format for the per-row "follow global" hint: an explicit
  // per-catalog choice always wins for that catalog, otherwise the card
  // follows this global shape (same rule as the server resolution).
  const customCatalogs = usePSelector((v) => v.customCatalogs)
  const toggleCustomCatalog = usePSelector((v) => v.toggleCustomCatalog)
  const removeCustomCatalog = usePSelector((v) => v.removeCustomCatalog)
  const disabledCatalogIds = usePSelector((v) => v.disabledCatalogIds)
  const toggleBuiltinCatalog = usePSelector((v) => v.toggleBuiltinCatalog)
  const homeDisabledCatalogIds = usePSelector((v) => v.homeDisabledCatalogIds)
  const toggleCatalogHome = usePSelector((v) => v.toggleCatalogHome)
  const catalogOrder = usePSelector((v) => v.catalogOrder)
  const setCatalogOrder = usePSelector((v) => v.setCatalogOrder)
  const moveCatalog = usePSelector((v) => v.moveCatalog)
  const catalogRenames = usePSelector((v) => v.catalogRenames)
  const catalogShowEmojis = usePSelector((v) => v.catalogShowEmojis)
  const setCatalogShowEmojis = usePSelector((v) => v.setCatalogShowEmojis)
  // Opt-in streaming selections: rows are per derived section id (same split
  // as custom mixed lists) so reorder/rename/home/shape reuse the machinery.
  const streamingSelectionsState = usePSelector((v) => v.streamingSelections)
  const toggleStreamingSection = usePSelector((v) => v.toggleStreamingSection)
  const toggleStreamingSelection = usePSelector((v) => v.toggleStreamingSelection)
  const removeStreamingSelection = usePSelector((v) => v.removeStreamingSelection)
  const isStreamingOptIn = isOptInMode(streamingSelectionsState)
  const rankingSourceMovie = usePSelector((v) => v.rankingSourceMovie)
  const rankingSourceSeries = usePSelector((v) => v.rankingSourceSeries)
  const renameCatalog = usePSelector((v) => v.renameCatalog)
  const resetCatalogNames = usePSelector((v) => v.resetCatalogNames)
  const resetCatalogOrder = usePSelector((v) => v.resetCatalogOrder)
  const resetDefaultLists = usePSelector((v) => v.resetDefaultLists)
  const catalogShapes = usePSelector((v) => v.catalogShapes)
  const setCatalogShape = usePSelector((v) => v.setCatalogShape)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  // Two-step factory reset confirmation (destructive to the default slots
  // only): first click arms, second click executes. Disarms on close.
  const [resetArmed, setResetArmed] = useState(false)
  const [resetSaving, setResetSaving] = useState(false)
  // Bulk delete confirmation (destructive batch): the arm freezes against
  // the EXACT deletable target signature. Switching the selection (or an
  // inventory change) lapses a stale arm — the next click only re-arms,
  // never executes against a different target set. Signature comparison
  // (not render identity) keeps a stable confirm clickable.
  const [bulkArmedFor, setBulkArmedFor] = useState<string | null>(null)
  // Seasonal keywords disclosure: closed by default (huge always-open area
  // otherwise); reset on every open. Fields stay mounted while hidden (no
  // remount, drafts preserved) and hide accessibly via `hidden`.
  const [seasonalOpen, setSeasonalOpen] = useState(false)
  const removeStreamingSelections = usePSelector((v) => v.removeStreamingSelections)
  const removeCustomCatalogs = usePSelector((v) => v.removeCustomCatalogs)
  useEffect(() => {
    if (isOpen) {
      setSeasonalOpen(false)
      setBulkArmedFor(null)
    }
  }, [isOpen])

  // Escape is handled here (the shared Modal has closeOnEscape={false}):
  // while renaming it cancels the rename, with a selection it clears the
  // selection, otherwise it closes. Backdrop click-outside stays owned by the
  // shared Modal (no duplicated listener, no close race).
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (editingId) {
        e.stopPropagation()
        setEditingId(null)
      } else if (selectedIds.size > 0) {
        e.stopPropagation()
        setSelectedIds(new Set())
      } else {
        setResetArmed(false)
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen, onClose, editingId, selectedIds])

  const allCatalogs = useMemo(() => {
    const list: CatalogEntryItem[] = []

    // Built-in catalogs (i nomi JW seguono la regione attiva; i Top 20
    // seguono anche la fonte ranking selezionata, come nel manifest Stremio:
    // rinomine utente > nome fonte ranking > nome regionale Top 20).
    // La visibilità emoji è solo display (mai storage): i nomi salvati
    // restano intatti e le sorgenti dinamiche continuano ad aggiornarsi.
    // Ghost inventory rule (same as the manifest in build-manifest.ts): in
  // opt-in mode the legacy platform built-ins are NOT served, so they are
  // not listed either (their stored toggles persist untouched). The two
  // general JW rows and the anime rows always stay (anime is not
  // service-based); disabled factory JW rows stay manageable via Power.
  const hideLegacyPlatforms = isStreamingOptIn
  for (const c of PICTORIUM_CATALOGS) {
    if (hideLegacyPlatforms && !isDefaultTop20CatalogId(c.id) && !c.id.startsWith("pictorium-anime")) continue
      const defaultName =
        rankingSourceCatalogName(
          c.id,
          c.type,
          { customCatalogs, rankingSourceMovie, rankingSourceSeries },
          activeRegion,
        ) ?? regionJwName(c.id, c.type, activeRegion) ?? c.name
      const storedName = catalogRenames[c.id] || defaultName
      list.push({
        id: c.id,
        name: resolveCatalogDisplayName(storedName, catalogShowEmojis),
        originalName: defaultName,
        type: c.type,
        isCustom: false,
        enabled: !disabledCatalogIds.includes(c.id),
        showInHome: !homeDisabledCatalogIds.includes(c.id),
      })
    }

    // Opt-in streaming selections (per derived list id, like the custom
    // mixed splits): shown with independent Hide (entry `enabled` flag, the
    // config stays) vs Remove (JUST that list id, siblings untouched).
    // Rows persist from state even when hidden or narrowed — they are
    // managed here, not in the manifest.
    const sanitizedStreaming = sanitizeGenericStreamingSelections(streamingSelectionsState ?? undefined) ?? []
    for (const sel of sanitizedStreaming) {
      for (const section of sel.sections) {
        const derivedIds = derivedIdsForGenericSelection(sel)
        const derivedId = derivedIds[sel.sections.indexOf(section)]
        const defaultName = sel.legacy
          ? streamingCatalogName(sel.service as import("@/lib/streaming-catalogs").StreamingService, sel.country, section as "movies" | "series")
          : genericStreamingCatalogName(sel.service, sel.chartSlug, section, sel.variant)
        const storedName = catalogRenames[derivedId] || defaultName
        list.push({
          id: derivedId,
          name: resolveCatalogDisplayName(storedName, catalogShowEmojis),
          originalName: defaultName,
          type: section === "movies" ? "movie" : section === "series" ? "series" : "all",
          isCustom: false,
          isStreaming: true,
          streamingService: sel.service,
          streamingCountry: sel.chartSlug,
          streamingSection: section,
          streamingSource: sel.source,
          streamingVariant: sel.variant,
          enabled: sel.enabled !== false && !disabledCatalogIds.includes(derivedId),
          showInHome: !homeDisabledCatalogIds.includes(derivedId),
        })
      }
    }

    // Custom catalogs
    for (const cc of customCatalogs) {
      const isCustomHomeDisabled = homeDisabledCatalogIds.includes(cc.id)
      if (cc.type === "mixed") {
        const mId = `pictorium-custom-movie-${cc.id}`
        const sId = `pictorium-custom-series-${cc.id}`
        const mStored = catalogRenames[mId] || `${cc.name} — ${t("ui.movie")}`
        const sStored = catalogRenames[sId] || `${cc.name} — ${t("ui.tvSeries")}`
        list.push({
          id: mId,
          name: resolveCatalogDisplayName(mStored, catalogShowEmojis),
          originalName: `${cc.name} — ${t("ui.movie")}`,
          type: "movie",
          isCustom: true,
          customBaseId: cc.id,
          enabled: cc.enabled !== false,
          showInHome: !isCustomHomeDisabled && !homeDisabledCatalogIds.includes(mId),
        })
        list.push({
          id: sId,
          name: resolveCatalogDisplayName(sStored, catalogShowEmojis),
          originalName: `${cc.name} — ${t("ui.tvSeries")}`,
          type: "series",
          isCustom: true,
          customBaseId: cc.id,
          enabled: cc.enabled !== false,
          showInHome: !isCustomHomeDisabled && !homeDisabledCatalogIds.includes(sId),
        })
      } else {
        const cId = `pictorium-custom-${cc.type}-${cc.id}`
        const cStored = catalogRenames[cId] || cc.name
        list.push({
          id: cId,
          name: resolveCatalogDisplayName(cStored, catalogShowEmojis),
          originalName: cc.name,
          type: cc.type,
          isCustom: true,
          customBaseId: cc.id,
          enabled: cc.enabled !== false,
          showInHome: !isCustomHomeDisabled && !homeDisabledCatalogIds.includes(cId),
        })
      }
    }

    // Sort according to catalogOrder
    if (catalogOrder && catalogOrder.length > 0) {
      const orderMap = new Map<string, number>()
      catalogOrder.forEach((id, idx) => orderMap.set(id, idx))
      list.sort((a, b) => {
        const orderA = orderMap.has(a.id) ? orderMap.get(a.id)! : 9999
        const orderB = orderMap.has(b.id) ? orderMap.get(b.id)! : 9999
        return orderA - orderB
      })
    }

    // Anime always last ("gli anime mettiamoli sempre alla fine"): stable
    // partition AFTER the user order, same rule as the Stremio manifest.
    // Drag/bulk moves cannot make a built-in anime precede non-anime —
    // the display re-projects (stored order untouched, no moves lost).
    return partitionAnimeCatalogsLast(list)
  }, [customCatalogs, rankingSourceMovie, rankingSourceSeries, disabledCatalogIds, homeDisabledCatalogIds, catalogOrder, catalogRenames, catalogShowEmojis, activeRegion, streamingSelectionsState, isStreamingOptIn, t])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = allCatalogs.length > 0 && selectedIds.size === allCatalogs.length
  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(allCatalogs.map((c) => c.id)))
  }

  const startRename = (item: CatalogEntryItem) => {
    setEditingId(item.id)
    // Il campo parte dal nome memorizzato (rinomina esplicita o default
    // completo), mai dal testo con emoji nascoste: salvare non deve
    // congelare la versione spogliata.
    setEditName(catalogRenames[item.id] || item.originalName)
  }

  const saveRename = (id: string) => {
    const trimmed = editName.trim()
    // Mai pinnare il default dinamico: salvare il nome uguale al default
    // bloccherebbe la bandiera al cambio regione (la chiave rename vince
    // sempre). In quel caso si cancella l'override ed emerge il dinamico.
    const item = allCatalogs.find((c) => c.id === id)
    if (trimmed && item && trimmed === item.originalName) {
      renameCatalog(id, "")
    } else if (trimmed) {
      renameCatalog(id, trimmed)
    }
    setEditingId(null)
  }

  const cancelRename = () => {
    setEditingId(null)
  }

  const handleToggle = (item: CatalogEntryItem) => {
    if (item.isCustom && item.customBaseId) {
      toggleCustomCatalog(item.customBaseId)
    } else if (item.isStreaming && item.streamingService && item.streamingCountry && item.streamingSection) {
      // Streaming rows (per list): a disabled entry re-enables first; a
      // row disabled via the shared disabled list is un-disabled (same as
      // built-ins); otherwise the entry narrows (Hide when the last section
      // goes, config kept). Same provider in another country/source/variant
      // is a distinct identity and never toggled.
      const sel = sanitizeGenericStreamingSelections(streamingSelectionsState ?? undefined)?.find(
        (s) => s.service === item.streamingService && s.chartSlug === item.streamingCountry && s.source === (item.streamingSource ?? "auto") && (s.variant ?? null) === (item.streamingVariant ?? null),
      )
      if (!sel) return
      if (sel.enabled === false) {
        toggleStreamingSelection(item.streamingService, item.streamingCountry, item.streamingSource, item.streamingVariant)
      } else if (disabledCatalogIds.includes(item.id)) {
        toggleBuiltinCatalog(item.id)
      } else {
        toggleStreamingSection(item.streamingService, item.streamingCountry, item.streamingSection, item.streamingSource, item.streamingVariant)
      }
    } else {
      toggleBuiltinCatalog(item.id)
    }
  }

  const handleRemoveStreaming = (item: CatalogEntryItem) => {
    // Remove deletes JUST this derived list (sibling Film/Serie lists and
    // every other provider/country/source/variant entry stay); the entry
    // narrows, or disappears with its last section. Derived ids are cleaned
    // from the shared records, nothing else is touched.
    if (item.streamingService && item.streamingCountry && item.streamingSection) {
      removeStreamingSelection(item.streamingService, item.streamingCountry, item.streamingSource, item.streamingVariant, item.streamingSection)
    }
  }

  // Factory Top 20 lists are toggle-only (never deletable: rankings can
  // be disabled but not removed, by explicit user decision). Power hides
  // via the shared disabled list (nondestructive, re-enableable here); the
  // factory reset below restores defaults. No per-list Remove exists.

  // Factory restore entry point: visible whenever any default-list
  // configuration differs from factory (removed, renamed, home-hidden, or
  // a Top 20 slot on a non-charts source). Lives in the toolbar, so it
  // stays reachable even when both default rows are removed.
  const defaultsDirty = areDefaultListsDirty({
    disabledCatalogIds,
    homeDisabledCatalogIds,
    catalogRenames,
    rankingSourceMovie,
    rankingSourceSeries,
  })

  // Bulk delete target computation (per selected inventory row):
  // - factory JW ids are NEVER deletable (toggle-only, excluded even when
  //   selected for a bulk move);
  // - streaming rows delete by exact per-section identity (service + chart
  //   country + source + variant + section), siblings untouched;
  // - custom/addon rows delete whole providers ONLY when ALL their emitted
  //   rows are selected (a partial mixed selection can never delete one
  //   section of a pair — the data model owns one config per provider);
  // - every other built-in (legacy platforms, anime) has no delete API and
  //   is skipped (Power only).
  // Stale selected ids (inventory changed underneath) are pruned, never executed.
  const bulkDeletable = useMemo(() => {
    const valid = new Set(allCatalogs.map((c) => c.id))
    const selected = allCatalogs.filter((c) => selectedIds.has(c.id) && valid.has(c.id))
    const streaming: Array<{
      service: string
      country: string
      source?: StreamingSourceMode | null
      variant?: string | null
      section: GenericStreamingSection
    }> = []
    const customByBase = new Map<string, string[]>()
    for (const item of selected) {
      if (isDefaultTop20CatalogId(item.id)) continue
      if (
        item.isStreaming &&
        item.streamingService &&
        item.streamingCountry &&
        item.streamingSection
      ) {
        streaming.push({
          service: item.streamingService,
          country: item.streamingCountry,
          source: item.streamingSource,
          variant: item.streamingVariant,
          section: item.streamingSection,
        })
        continue
      }
      if (item.isCustom && item.customBaseId) {
        const arr = customByBase.get(item.customBaseId) ?? []
        arr.push(item.id)
        customByBase.set(item.customBaseId, arr)
      }
    }
    const custom: Array<{ baseId: string; derivedIds: string[] }> = []
    for (const baseId of customByBase.keys()) {
      const cfg = customCatalogs.find((c) => c.id === baseId)
      if (!cfg) continue
      const allIds = customDerivedIds(cfg)
      if (allIds.every((id) => selectedIds.has(id))) custom.push({ baseId, derivedIds: allIds })
    }
    return { streaming, custom }
  }, [allCatalogs, selectedIds, customCatalogs])
  const bulkCount =
    bulkDeletable.streaming.length +
    bulkDeletable.custom.reduce((n, c) => n + c.derivedIds.length, 0)
  // Exact deletable target signature (stable string, never render identity):
  // the armed confirm only fires against THIS set. Factory JW toggles (or
  // any other irrelevant change) leave the signature untouched, so a valid
  // arm is never dropped spuriously — but ANY effective target-set change
  // (selection switch, inventory narrowing/removal) lapses it.
  const bulkSignature = useMemo(() => {
    const stream = bulkDeletable.streaming.map(
      (i) => `${i.service}|${i.country}|${i.source ?? "auto"}|${i.variant ?? "-"}|${i.section}`,
    )
    const custom = bulkDeletable.custom.flatMap((c) => c.derivedIds)
    return [...stream, ...custom].sort().join("\n")
  }, [bulkDeletable])
  const bulkArmed = bulkArmedFor !== null && bulkArmedFor === bulkSignature

  const handleBulkDelete = () => {
    if (!bulkArmed) {
      setBulkArmedFor(bulkSignature)
      return
    }
    if (bulkDeletable.streaming.length > 0) removeStreamingSelections(bulkDeletable.streaming)
    const baseIds = bulkDeletable.custom.map((c) => c.baseId)
    const derivedIds = bulkDeletable.custom.flatMap((c) => c.derivedIds)
    if (baseIds.length > 0) removeCustomCatalogs(baseIds, derivedIds)
    setBulkArmedFor(null)
    setSelectedIds(new Set())
  }

  // Prune selected ids that no longer exist in the effective inventory
  // (a delete narrowed an entry). Never resurrects, never touches the rest.
  useEffect(() => {
    const valid = new Set(allCatalogs.map((c) => c.id))
    setSelectedIds((prev) => {
      if ([...prev].every((id) => valid.has(id))) return prev
      return new Set([...prev].filter((id) => valid.has(id)))
    })
  }, [allCatalogs])
  // A stale arm lapses as soon as the effective target set changes
  // (selection switch, inventory narrowing/removal, empty selection).
  useEffect(() => {
    if (bulkArmedFor !== null && bulkArmedFor !== bulkSignature) setBulkArmedFor(null)
  }, [bulkArmedFor, bulkSignature])
  useEffect(() => {
    if (selectedIds.size === 0) setBulkArmedFor(null)
  }, [selectedIds])

  const handleResetDefaults = async () => {
    if (!resetArmed) {
      setResetArmed(true)
      return
    }
    setResetSaving(true)
    try {
      await resetDefaultLists()
    } finally {
      setResetSaving(false)
      setResetArmed(false)
    }
  }

  const handleClose = () => {
    setResetArmed(false)
    setBulkArmedFor(null)
    onClose()
  }

  // Batch move operations
  const moveSelectedToTop = () => {
    if (selectedIds.size === 0) return
    const selectedList = allCatalogs.filter((c) => selectedIds.has(c.id)).map((c) => c.id)
    const remainingList = allCatalogs.filter((c) => !selectedIds.has(c.id)).map((c) => c.id)
    setCatalogOrder([...selectedList, ...remainingList])
  }

  const moveSelectedToBottom = () => {
    if (selectedIds.size === 0) return
    const selectedList = allCatalogs.filter((c) => selectedIds.has(c.id)).map((c) => c.id)
    const remainingList = allCatalogs.filter((c) => !selectedIds.has(c.id)).map((c) => c.id)
    setCatalogOrder([...remainingList, ...selectedList])
  }

  const moveSelectedUp = () => {
    if (selectedIds.size === 0) return
    const order = allCatalogs.map((c) => c.id)
    const next = [...order]
    for (let i = 1; i < next.length; i++) {
      if (selectedIds.has(next[i]) && !selectedIds.has(next[i - 1])) {
        const temp = next[i]
        next[i] = next[i - 1]
        next[i - 1] = temp
      }
    }
    setCatalogOrder(next)
  }

  const moveSelectedDown = () => {
    if (selectedIds.size === 0) return
    const order = allCatalogs.map((c) => c.id)
    const next = [...order]
    for (let i = next.length - 2; i >= 0; i--) {
      if (selectedIds.has(next[i]) && !selectedIds.has(next[i + 1])) {
        const temp = next[i]
        next[i] = next[i + 1]
        next[i + 1] = temp
      }
    }
    setCatalogOrder(next)
  }

  // Drag and drop handlers (support single & multi drag)
  const handleDragStart = (e: React.DragEvent, index: number) => {
    const item = allCatalogs[index]
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", `${index}`)

    if (!selectedIds.has(item.id)) {
      // Se trascina un elemento non selezionato, mantieni solo quello
    }
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    if (dragOverIndex !== index) {
      setDragOverIndex(index)
    }
  }

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null)
      setDragOverIndex(null)
      return
    }

    const draggedItem = allCatalogs[draggedIndex]

    if (selectedIds.has(draggedItem.id) && selectedIds.size > 1) {
      // Sposta tutti gli elementi selezionati insieme nel punto target
      const targetItem = allCatalogs[targetIndex]
      const selectedList = allCatalogs.filter((c) => selectedIds.has(c.id)).map((c) => c.id)
      const remainingList = allCatalogs.filter((c) => !selectedIds.has(c.id)).map((c) => c.id)

      const targetInRemaining = remainingList.indexOf(targetItem.id)
      const insertPos =
        targetInRemaining >= 0
          ? targetIndex > draggedIndex
            ? targetInRemaining + 1
            : targetInRemaining
          : remainingList.length

      remainingList.splice(insertPos, 0, ...selectedList)
      setCatalogOrder(remainingList)
    } else {
      const orderIds = allCatalogs.map((c) => c.id)
      const [movedItem] = orderIds.splice(draggedIndex, 1)
      orderIds.splice(targetIndex, 0, movedItem)
      setCatalogOrder(orderIds)
    }

    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      closeOnEscape={false}
      labelledBy="catalog-manager-title"
      testId="catalog-manager-modal"
      className="!max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden !p-0 !space-y-0"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-surface2/50 shrink-0">
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal className="w-5 h-5 text-accent-orange" />
          <div>
            <h3 id="catalog-manager-title" className="text-sm font-bold text-foreground">{t("ui.catMgrTitle")}</h3>
            <p className="text-[11px] text-muted">
              {t("ui.catMgrSubtitle")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("ui.close")}
          className="p-1.5 rounded-xl text-muted hover:text-white hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Multi-Selection & Global Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface2/30 border-b border-white/10 text-xs gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-white/10 text-zinc-300 hover:text-white hover:border-white/20 transition-all font-medium text-[11px]"
          >
            {allSelected ? <CheckSquare className="w-3.5 h-3.5 text-accent-orange" /> : <Square className="w-3.5 h-3.5" />}
            <span>{selectedIds.size > 0 ? t("ui.selectedCount", { count: selectedIds.size }) : t("ui.selectAll")}</span>
          </button>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-1 bg-accent-orange/15 border border-accent-orange/30 px-2 py-0.5 rounded-lg text-accent-orange font-semibold text-[11px]">
              <span>{t("ui.moveGroup")}</span>
              <button
                type="button"
                onClick={moveSelectedToTop}
                title={t("ui.moveTop")}
                className="p-1 hover:bg-accent-orange/20 rounded transition-colors"
              >
                <ChevronsUp className="w-3.5 h-3.5" />
              </button>
              {/* Bulk delete (destructive batch, two-step confirm): removes
                  ONLY the deletable selection — per-section streaming lists
                  and whole custom providers — atomically. Factory JW and
                  other built-ins are never deletable (toggle-only). */}
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={bulkCount === 0}
                title={bulkArmed ? t("ui.bulkDeleteConfirm", { count: bulkCount }) : t("ui.bulkDelete", { count: bulkCount })}
                aria-label={bulkArmed ? t("ui.bulkDeleteConfirm", { count: bulkCount }) : t("ui.bulkDelete", { count: bulkCount })}
                className={`flex items-center gap-1 px-1.5 py-1 rounded transition-colors disabled:opacity-40 ${
                  bulkArmed
                    ? "bg-red-500/25 border border-red-500/50 text-red-200 hover:bg-red-500/35 font-semibold"
                    : "hover:bg-accent-orange/20"
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{bulkArmed ? t("ui.bulkDeleteConfirm", { count: bulkCount }) : t("ui.bulkDelete", { count: bulkCount })}</span>
              </button>
              <button
                type="button"
                onClick={moveSelectedUp}
                title={t("ui.moveUp1")}
                className="p-1 hover:bg-accent-orange/20 rounded transition-colors"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={moveSelectedDown}
                title={t("ui.moveDown1")}
                className="p-1 hover:bg-accent-orange/20 rounded transition-colors"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={moveSelectedToBottom}
                title={t("ui.moveBottom")}
                className="p-1 hover:bg-accent-orange/20 rounded transition-colors"
              >
                <ChevronsDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="ml-1 text-[10px] underline hover:text-white"
              >
                {t("ui.deselect")}
              </button>
            </div>
          )}
          {selectedIds.size > 0 && bulkCount === 0 && (
            <p role="status" className="text-[11px] text-muted">
              {t("ui.bulkDeleteProtected")}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Visibilità emoji nei nomi (solo display, mai storage): nasconde
              tutte le emoji dai nomi mostrati, i salvataggi restano intatti. */}
          <button
            type="button"
            onClick={() => setCatalogShowEmojis(!catalogShowEmojis)}
            aria-pressed={catalogShowEmojis}
            title={t("ui.catalogEmojis")}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg border text-muted hover:text-zinc-200 hover:bg-white/5 transition-colors text-[11px] border-white/10"
          >
            {catalogShowEmojis ? <CheckSquare className="w-3.5 h-3.5 text-accent-orange" /> : <Square className="w-3.5 h-3.5" />}
            <span>{t("ui.catalogEmojis")}</span>
          </button>
          {catalogOrder.length > 0 && (
            <button
              type="button"
              onClick={resetCatalogOrder}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-muted hover:text-zinc-200 hover:bg-white/5 transition-colors text-[11px]"
            >
              <RotateCcw className="w-3 h-3" /> {t("ui.resetOrder")}
            </button>
          )}
          {Object.keys(catalogRenames).length > 0 && (
            <button
              type="button"
              onClick={resetCatalogNames}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-muted hover:text-zinc-200 hover:bg-white/5 transition-colors text-[11px]"
            >
              <RotateCcw className="w-3 h-3" /> {t("ui.resetNames")}
            </button>
          )}
          {/* Factory restore of the two general Top 20 lists only (never
              the added streaming/custom rows): two-step confirmation,
              always reachable even when both default rows are removed. */}
          {defaultsDirty && (
            <button
              type="button"
              onClick={handleResetDefaults}
              disabled={resetSaving}
              title={resetArmed ? t("ui.confirmRestoreDefaults") : t("ui.restoreDefaults")}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-colors text-[11px] disabled:opacity-60 ${
                resetArmed
                  ? "bg-accent-orange/20 border border-accent-orange/50 text-accent-orange hover:bg-accent-orange/30 font-semibold"
                  : "text-muted hover:text-zinc-200 hover:bg-white/5"
              }`}
            >
              <RotateCcw className="w-3 h-3" /> {resetArmed ? t("ui.confirmRestoreDefaults") : t("ui.restoreDefaults")}
            </button>
          )}
        </div>
      </div>

      {/* Catalog List */}
      {/* Seasonal keywords: collapsed by default (huge always-open area
          otherwise). Native disclosure button (keyboard Enter/Space),
          aria-expanded + aria-controls; the fields stay mounted under
          `hidden` (no remount, drafts preserved) and hide accessibly. */}
      <div className="px-4 py-2 border-b border-white/10 bg-surface2/20 shrink-0">
        <button
          type="button"
          onClick={() => setSeasonalOpen((o) => !o)}
          aria-expanded={seasonalOpen}
          aria-controls="seasonal-keywords-panel"
          className="flex w-full items-center gap-2 text-left rounded-lg px-1 py-1 text-zinc-200 hover:text-white transition-colors"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 shrink-0 transition-transform ${seasonalOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
          <span className="text-xs font-semibold">{t("ui.seasonalKeywordsTitle")}</span>
        </button>
      </div>
      <div id="seasonal-keywords-panel" hidden={!seasonalOpen}>
        <SeasonalKeywordsSection />
      </div>
      {/* Curated mode: the historical platform rows are not listed while
          opt-in (they are not served to Stremio; stored toggles persist
          untouched and reappear if the space ever leaves curated mode). */}
      {isStreamingOptIn && (
        <p role="status" className="mx-4 mb-2 text-[11px] text-muted rounded-xl border border-white/5 bg-surface2/40 px-3 py-2">
          {t("ui.streamOptInNote")}
        </p>
      )}
      <div className="p-4 space-y-2 overflow-y-auto flex-1 min-h-0 scrollbar-thin">
        {allCatalogs.map((item, index) => {
          const isEditing = editingId === item.id
          const isSelected = selectedIds.has(item.id)
          const isCustomRenamed = Boolean(catalogRenames[item.id] && catalogRenames[item.id] !== item.originalName)
          const isBeingDragged = draggedIndex === index
          const isDragTarget = dragOverIndex === index

          return (
            <div
              key={item.id}
              draggable={!isEditing}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={`flex items-center justify-between gap-3 p-3 rounded-2xl border transition-all ${
                isBeingDragged
                  ? "opacity-25 border-dashed border-accent-orange/70 bg-accent-orange/5"
                  : isDragTarget
                  ? "border-accent-orange bg-accent-orange/15 scale-[1.01] shadow-lg"
                  : isSelected
                  ? "bg-accent-orange/10 border-accent-orange/40 shadow-sm"
                  : item.enabled
                  ? "bg-surface2/70 border-white/10 hover:border-white/20 shadow-sm"
                  : "bg-surface2/30 border-white/5 opacity-50"
              }`}
            >
              {/* Left: Checkbox + 3 lines Grip + Priority Index + Quick Arrows */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Selection Checkbox */}
                <button
                  type="button"
                  onClick={() => toggleSelect(item.id)}
                  className="p-1 rounded-md text-muted hover:text-white transition-colors"
                >
                  {isSelected ? (
                    <CheckSquare className="w-4 h-4 text-accent-orange" />
                  ) : (
                    <Square className="w-4 h-4 text-zinc-500" />
                  )}
                </button>

                {/* 3 lines Drag Handle: solo mouse (su touch il drag HTML5 non
                    esiste — restano le frecce qui sotto, sempre funzionanti) */}
                <div
                  className="pointer-coarse:hidden cursor-grab active:cursor-grabbing p-1.5 rounded-lg hover:bg-white/10 text-muted hover:text-white transition-colors"
                  title={
                    isSelected && selectedIds.size > 1
                      ? t("ui.dragMany", { count: selectedIds.size })
                      : t("ui.dragOne")
                  }
                >
                  <Menu className="w-4 h-4 stroke-[2.5]" />
                </div>

                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => (isSelected ? moveSelectedUp() : moveCatalog(item.id, "up"))}
                    title={t("ui.moveUp")}
                    className="p-1 pointer-coarse:p-2 rounded hover:bg-white/10 text-muted hover:text-white disabled:opacity-15 transition-colors"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    disabled={index === allCatalogs.length - 1}
                    onClick={() => (isSelected ? moveSelectedDown() : moveCatalog(item.id, "down"))}
                    title={t("ui.moveDown")}
                    className="p-1 pointer-coarse:p-2 rounded hover:bg-white/10 text-muted hover:text-white disabled:opacity-15 transition-colors"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                </div>

                <span className="w-6 text-center text-xs font-mono font-bold text-muted">
                  #{index + 1}
                </span>
              </div>

              {/* Center: Title & inline edit */}
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <div className="space-y-1.5">
                    <EmojiPicker
                      currentName={editName}
                      onSelectEmoji={(em) => {
                        const cleaned = editName.replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji})\s*/u, "")
                        setEditName(`${em} ${cleaned}`)
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          // Enter commits the rename. preventDefault is
                          // REQUIRED: saveRename unmounts this input synchronously
                          // and focus lands on the modal header; without it the
                          // browser's Enter default action clicks the focused
                          // element (the X close button) and the manager closes
                          // right after saving.
                          if (e.key === "Enter") { e.preventDefault(); saveRename(item.id) }
                          if (e.key === "Escape") cancelRename()
                        }}
                        className="flex-1 px-3 py-1.5 bg-surface border border-accent-orange/50 rounded-xl text-xs text-foreground focus:outline-none focus:border-accent-orange"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => saveRename(item.id)}
                        className="p-2 rounded-xl bg-green-500/20 border border-green-500/40 text-green-300 hover:bg-green-500/30 transition-colors"
                        title={t("ui.saveName")}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={cancelRename}
                        className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted hover:text-white transition-colors"
                        title={t("ui.cancel")}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground truncate">{item.name}</span>
                    <button
                      type="button"
                      onClick={() => startRename(item)}
                      className="p-1 rounded text-muted hover:text-white hover:bg-white/5 transition-colors shrink-0"
                      title={t("ui.renameCatalog")}
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    {isCustomRenamed && (
                      <button
                        type="button"
                        onClick={() => renameCatalog(item.id, "")}
                        className="text-[10px] text-foreground hover:underline shrink-0"
                        title={t("ui.origName", { name: item.originalName })}
                      >
                        {t("ui.restoreName")}
                      </button>
                    )}
                  </div>
                )}

                {!isEditing && (
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider ${
                        item.type === "movie"
                          ? "bg-blue-500/15 text-blue-400 border border-blue-500/20"
                          : item.type === "all"
                            ? "bg-teal-500/15 text-teal-300 border border-teal-500/20"
                            : "bg-purple-500/15 text-purple-400 border border-purple-500/20"
                      }`}
                    >
                      {item.type === "movie" ? <Film className="w-3 h-3" /> : <Tv className="w-3 h-3" />}
                      {item.type === "movie" ? t("ui.movie") : item.type === "all" ? t("ui.streamSectionMixed") : t("ui.tvSeries")}
                    </span>
                {item.isCustom && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">
                        Custom
                      </span>
                    )}
                    {item.isStreaming && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/20">
                        Top 10
                      </span>
                    )}
                    {item.isStreaming && item.streamingVariant && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-white/5 text-zinc-300 border border-white/10">
                        {genericVariantLabel(item.streamingVariant)}
                      </span>
                    )}
                  </div>
                )}

                {/* Per-catalog card format: explicit portrait/landscape wins for
                    this catalog only, "follow global" deletes the override so
                    the catalog re-inherits the global setting. Independent of
                    visibility toggles; stopPropagation keeps the select out of
                    drag/select handling, keyboard works natively. */}
                {!isEditing && (
                  <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={catalogShapes?.[item.id] ?? "global"}
                      onChange={(e) => {
                        const v = e.target.value
                        setCatalogShape(item.id, v === "global" ? null : (v as "poster" | "landscape"))
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      aria-label={`${item.name} — ${t("ui.posterShape")}`}
                      className="max-w-full px-2 py-1 bg-surface border border-white/10 rounded-lg text-[11px] text-zinc-300 hover:text-white hover:border-white/20 focus:outline-none focus:border-accent-orange transition-colors"
                    >
                      <option value="global">
                        {t("ui.catalogShapeFollowGlobal")} ({defaultPosterShape === "landscape" ? t("ui.posterShapeLandscape") : t("ui.posterShapePortrait")})
                      </option>
                      <option value="poster">{t("ui.posterShapePortrait")}</option>
                      <option value="landscape">{t("ui.posterShapeLandscape")}</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => toggleCatalogHome(item.id)}
                  title={
                    item.showInHome
                      ? t("ui.homeVisible")
                      : t("ui.homeHidden")
                  }
                  className={`p-1.5 rounded-xl border transition-colors ${
                    item.showInHome
                      ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25"
                      : "bg-white/5 border-white/5 text-muted hover:text-white"
                  }`}
                >
                  <Home className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleToggle(item)}
                  title={item.enabled ? t("ui.disableStremio") : t("ui.enableStremio")}
                  className={`p-1.5 rounded-xl border transition-colors ${
                    item.enabled
                      ? "bg-accent-orange/15 border-accent-orange/30 text-accent-orange hover:bg-accent-orange/25"
                      : "bg-white/5 border-white/5 text-muted hover:text-white"
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                </button>
                {item.isCustom && item.customBaseId && (
                  <button
                    type="button"
                    onClick={() => removeCustomCatalog(item.customBaseId!)}
                    title={t("ui.deleteCatalog")}
                    className="p-1.5 rounded-xl border border-white/5 text-muted hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                {/* Factory JW rows are toggle-only (Power): no per-list trash
                    (rankings can be disabled but never deleted), and bulk
                    delete skips them. The factory reset above restores. */}
                {/* Remove deletes JUST this derived streaming list (sibling
                    sections stay); the entry narrows, or disappears with its
                    last section. Derived ids are cleaned from the shared
                    records, nothing else is touched. Hide (Power) keeps the
                    config. */}
                {item.isStreaming && (
                  <button
                    type="button"
                    onClick={() => handleRemoveStreaming(item)}
                    title={t("ui.deleteCatalog")}
                    className="p-1.5 rounded-xl border border-white/5 text-muted hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-white/10 bg-surface2/40 shrink-0">
        <span className="text-xs text-muted font-medium">
          {t("ui.enabledCount", { count: allCatalogs.filter((c) => c.enabled).length })}
        </span>
        <button
          type="button"
          onClick={handleClose}
          className="px-4 py-2 rounded-xl bg-accent-orange text-white text-xs font-semibold hover:bg-accent-orange/90 active:scale-95 transition-all shadow-md"
        >
          {t("ui.done")}
        </button>
      </div>
    </Modal>
  )
}
