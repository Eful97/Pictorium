"use client"

import React, { useState, useRef, useEffect } from "react"
import { useT } from "@/lib/contexts/TranslationContext"
import { Search, ArrowRight, AlertCircle } from "lucide-react"

interface Props {
  tmdbKey: string
  /** True se l'istanza ha una chiave TMDB env: la ricerca funziona senza chiave browser. */
  hasServerKey?: boolean
  onSearch: (q: string) => void
  large?: boolean
  value?: string
  onChange?: (v: string) => void
  onFocus?: () => void
  onBlur?: () => void
  error?: string | null
}

export function SearchBar({
  tmdbKey,
  hasServerKey = false,
  onSearch,
  large,
  value,
  onChange,
  onFocus,
  onBlur,
  error,
}: Props) {
  const { t } = useT()
  const [text, setText] = useState(value || "")
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const h = large ? "h-12" : "h-10"

  useEffect(() => {
    if (value !== undefined) setText((prev) => (prev === value ? prev : value))
  }, [value])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const placeholder = large ? t("ui.searchPlaceholderLarge") : t("ui.searchPlaceholder")
  const canSearch = !!tmdbKey || hasServerKey

  return (
    <div
      role="search"
      className={`search-shell flex items-center ${h} ${
        focused ? "search-shell-active" : ""
      } rounded-2xl transition-all duration-300 group ${error ? "ring-1 ring-red-500/50" : ""}`}
    >
      <span
        className="shrink-0 pl-3.5 transition-colors text-zinc-500 group-focus-within:text-zinc-300"
        aria-hidden="true"
      >
        <Search className="w-4 h-4" />
      </span>
      <input
        suppressHydrationWarning
        ref={inputRef}
        value={text}
        enterKeyHint="search"
        aria-label={large ? t("ui.searchAriaLabelLarge") : t("ui.searchAriaLabel")}
        onChange={(e) => {
          setText(e.target.value)
          onChange?.(e.target.value)
        }}
        onFocus={() => {
          setFocused(true)
          onFocus?.()
        }}
        onBlur={() => {
          setFocused(false)
          onBlur?.()
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && text.trim().length >= 2 && canSearch) {
            onSearch(text.trim())
          }
        }}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-xs md:text-sm outline-none px-2 h-full transition-colors duration-200 placeholder:text-zinc-500 focus:placeholder:text-muted"
      />

      {!focused && text.length === 0 && (
        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 mr-3 text-[10px] font-mono font-medium text-zinc-500 bg-white/[0.06] border border-white/10 rounded-md pointer-events-none select-none">
          ⌘K
        </kbd>
      )}
      {error && (
        <span className="shrink-0 pr-1.5" aria-hidden="true">
          <AlertCircle className="w-4 h-4 text-danger" />
        </span>
      )}
      {text.length > 0 && (
        <button
          type="button"
          aria-label={t("ui.searchButton")}
          onClick={() => {
            if (text.trim().length >= 2 && canSearch) {
              onSearch(text.trim())
            }
          }}
          disabled={!canSearch || text.trim().length < 2}
          className="shrink-0 w-8 sm:w-10 h-8 sm:h-10 mr-1.5 flex items-center justify-center text-white rounded-full active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 transition-all duration-200 bg-accent-orange hover:shadow-lg hover:shadow-accent-orange/30 cursor-pointer"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
