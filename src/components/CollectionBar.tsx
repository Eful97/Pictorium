"use client"

import React, { useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"
import { Plus, X, Pencil, Trash2, Check } from "lucide-react"
import type { PosterCollection } from "@/lib/useCollections"

interface CollectionBarProps {
  collections: PosterCollection[]
  activeId: string | null
  onSelect: (id: string | null) => void
  onCreate: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  countByCollection: Record<string, number>
  totalCount?: number
  t: (key: string, params?: Record<string, string | number>) => string
}

export function CollectionBar({
  collections,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  countByCollection,
  totalCount,
  t,
}: CollectionBarProps) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState("")
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Indicatori di scroll orizzontale: su desktop con mouse classico non è
  // ovvio che la lista collezioni scorre — fade ai bordi solo quando serve.
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      setCanScrollLeft(el.scrollLeft > 4)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    return () => {
      el.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [collections])

  const openMenu = (e: React.MouseEvent, colId: string) => {
    e.stopPropagation()
    const button = e.currentTarget as HTMLElement
    const btnRect = button.getBoundingClientRect()
    const menuWidth = 144
    let left = btnRect.right - menuWidth
    if (typeof window !== "undefined") {
      left = Math.max(12, Math.min(left, window.innerWidth - menuWidth - 12))
    }
    setMenuPos({ top: btnRect.bottom + 4, left })
    setMenuOpen(colId)
  }

  const closeMenu = () => {
    setMenuOpen(null)
    setMenuPos(null)
  }

  useEffect(() => {
    if (creating || editing) inputRef.current?.focus()
  }, [creating, editing])

  // Chiude menu quando si clicca fuori
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null)
        setMenuPos(null)
      }
    }
    const raf = requestAnimationFrame(() =>
      document.addEventListener("mousedown", handler),
    )
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener("mousedown", handler)
    }
  }, [menuOpen])

  // Chiude menu allo scroll
  useEffect(() => {
    if (!menuOpen) return
    const handler = () => closeMenu()
    window.addEventListener("scroll", handler, true)
    return () => window.removeEventListener("scroll", handler, true)
  }, [menuOpen])

  const handleCreate = () => {
    const name = nameInput.trim()
    if (name) {
      onCreate(name)
      setNameInput("")
      setCreating(false)
    }
  }

  const handleRename = (id: string) => {
    const name = nameInput.trim()
    if (name) {
      onRename(id, name)
      setNameInput("")
      setEditing(null)
    }
  }

  const total = totalCount ?? Object.values(countByCollection).reduce((a, b) => a + b, 0)

  return (
    <>
      <div className="relative">
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-1 -mb-1" ref={scrollRef}>
        {/* "Tutti" chip */}
        <button type="button"
          onClick={() => onSelect(null)}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-150 active:scale-95 ${
            activeId === null
              ? "bg-accent-orange/15 text-accent-orange border border-accent-orange/25 shadow-[0_0_10px_rgba(232,93,42,0.12)]"
              : "collection-chip-glass text-muted hover:text-zinc-300"
          }`}
        >
          {t("ui.all")}
          <span className="counter-badge">{total}</span>
        </button>

        {collections.map((col) => {
          const isActive = activeId === col.id
          const isEditing = editing === col.id
          const isMenuOpen = menuOpen === col.id
          const count = countByCollection[col.id] ?? 0

          return (
            <div key={col.id} className="relative shrink-0 flex items-stretch" data-chip>
              {isEditing ? (
                <div className="flex items-center gap-1 bg-surface rounded-xl border border-border/50 px-2 py-1">
                  <input
                    ref={inputRef}
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(col.id)
                      if (e.key === "Escape") { setEditing(null); setNameInput("") }
                    }}
                    className="w-24 bg-transparent text-xs text-white outline-none"
                    maxLength={40}
                  />
                  <button type="button" onClick={() => handleRename(col.id)} className="p-0.5 text-muted hover:text-accent-orange transition-colors">
                    <Check className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div
                  className={`flex items-stretch rounded-xl border transition-all duration-150 overflow-hidden ${
                    isActive
                      ? "bg-accent-orange/15 text-accent-orange border-accent-orange/25 shadow-[0_0_10px_rgba(232,93,42,0.12)]"
                      : "collection-chip-glass text-muted"
                  }`}
                >
                  <button type="button"
                    onClick={() => onSelect(isActive ? null : col.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium active:scale-95 transition-transform"
                  >
                    <span className="max-w-24 truncate">{col.name}</span>
                    <span className="counter-badge">{count}</span>
                  </button>

                  <div className="w-px bg-zinc-700/30 my-1" />
                  <button type="button"
                    onClick={(e) => {
                      if (menuOpen === col.id) {
                        closeMenu()
                      } else {
                        openMenu(e, col.id)
                      }
                    }}
                    className={`px-2 flex items-center justify-center transition-colors active:scale-90 ${
                      isMenuOpen
                        ? "text-accent-orange bg-accent-orange/10"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                    aria-label={t("ui.collectionOptions")}
                  >
                    <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
                      <circle cx="8" cy="3" r="1.5" />
                      <circle cx="8" cy="8" r="1.5" />
                      <circle cx="8" cy="13" r="1.5" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {/* Create button / input */}
        {creating ? (
          <div className="flex items-center gap-1 shrink-0 bg-surface rounded-xl border border-border/50 px-2 py-1">
            <input
              ref={inputRef}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate()
                if (e.key === "Escape") { setCreating(false); setNameInput("") }
              }}
              placeholder={t("ui.collectionNamePh")}
              className="w-28 bg-transparent text-xs text-white outline-none placeholder:text-zinc-500"
              maxLength={40}
            />
            <button type="button" onClick={handleCreate} className="p-0.5 text-accent-orange hover:text-accent-orange/80 transition-colors">
              <Check className="w-3 h-3" />
            </button>
            <button type="button" onClick={() => { setCreating(false); setNameInput("") }} className="p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors">
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button type="button"
            onClick={() => setCreating(true)}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-all duration-150 active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {canScrollLeft && (
        <div aria-hidden="true" className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent" />
      )}
      {canScrollRight && (
        <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent" />
      )}
      </div>

      {/* Dropdown — PORTAL a document.body per evitare che i parent con transform/animation rovinino position: fixed */}
      {menuOpen && menuPos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
            zIndex: 99999,
          }}
          className="w-36 rounded-xl bg-surface/95 backdrop-blur-xl border border-white/15 shadow-2xl shadow-black/90 p-1 animate-fade-scale-in space-y-0.5"
        >
          {collections
            .filter((c) => c.id === menuOpen)
            .map((col) => (
              <React.Fragment key={col.id}>
                <button type="button"
                  onClick={() => { closeMenu(); setEditing(col.id); setNameInput(col.name) }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-200 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5 text-muted" />
                  {t("ui.rename")}
                </button>
                <button type="button"
                  onClick={() => { closeMenu(); onDelete(col.id) }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-danger hover:text-red-300 hover:bg-red-500/15 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5 text-danger" />
                  {t("ui.delete")}
                </button>
              </React.Fragment>
            ))}
        </div>,
        document.body
      )}
    </>
  )
}
