"use client"

import React, { useState, useRef, useEffect } from "react"
import { Smile, ChevronDown, ChevronUp } from "lucide-react"

export const EMOJI_CATEGORIES = [
  {
    name: "Streaming e Cinema",
    emojis: ["🍿", "🎬", "📺", "⛩️", "☁️", "🍎", "🏔️", "🏰", "🔴", "📦", "🟣", "🌶️", "🏆", "🔥", "⭐", "🎭"],
  },
  {
    name: "Generi e Temi",
    emojis: ["🚀", "🧟", "👽", "🤖", "🤠", "🕵️", "🗡️", "🩸", "🎃", "🦖", "🛸", "💎", "👑", "🎯", "⚡", "🔮", "🕶️", "💣", "🎪"],
  },
  {
    name: "Paesi e Simboli",
    emojis: ["🇮🇹", "🇺🇸", "🇬🇧", "🇯🇵", "🇰🇷", "🇫🇷", "🇪🇸", "🇩🇪", "🌍", "🪐", "🏖️", "🎵", "🎸", "📜", "⏳", "🦄", "🐉"],
  },
] as const

const QUICK_EMOJIS = ["🍿", "🎬", "📺", "⛩️", "🔴", "📦", "🏆", "🔥", "⭐"]

interface EmojiPickerProps {
  currentName: string
  onSelectEmoji: (emoji: string) => void
}

export function EmojiPicker({ currentName, onSelectEmoji }: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const currentEmojiMatch = currentName.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji})/u)
  const currentEmoji = currentEmojiMatch ? currentEmojiMatch[0] : null

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex items-center justify-between gap-1.5 mb-1.5">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
          {QUICK_EMOJIS.map((em) => {
            const isSelected = currentEmoji === em
            return (
              <button
                key={em}
                type="button"
                onClick={() => onSelectEmoji(em)}
                className={`shrink-0 w-6 h-6 flex items-center justify-center text-xs rounded-lg transition ${
                  isSelected
                    ? "bg-accent-orange/20 border border-accent-orange/40 scale-110 shadow-sm"
                    : "hover:bg-white/10 hover:scale-110 opacity-80 hover:opacity-100"
                }`}
                title={`Imposta ${em}`}
              >
                {em}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition ${
            isOpen
              ? "bg-accent-orange/20 text-accent-orange border-accent-orange/40 shadow-sm"
              : "bg-surface2/80 hover:bg-surface2 text-zinc-400 hover:text-zinc-200 border-white/5"
          }`}
        >
          <Smile className="w-3 h-3 text-accent-orange" />
          <span>{isOpen ? "Chiudi" : "Altre emoji"}</span>
          {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {isOpen && (
        <div className="p-2.5 bg-surface border border-white/10 rounded-xl shadow-xl space-y-2.5 mb-2 animate-fade-in">
          {EMOJI_CATEGORIES.map((cat) => (
            <div key={cat.name} className="space-y-1">
              <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider px-0.5">
                {cat.name}
              </div>
              <div className="flex flex-wrap gap-1">
                {cat.emojis.map((em) => {
                  const isSelected = currentEmoji === em
                  return (
                    <button
                      key={em}
                      type="button"
                      onClick={() => {
                        onSelectEmoji(em)
                        setIsOpen(false)
                      }}
                      className={`w-7 h-7 flex items-center justify-center text-sm rounded-lg transition-transform ${
                        isSelected
                          ? "bg-accent-orange/20 border border-accent-orange/40 scale-110 shadow-sm"
                          : "hover:bg-white/10 hover:scale-125 active:scale-95"
                      }`}
                      title={`Seleziona ${em}`}
                    >
                      {em}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
