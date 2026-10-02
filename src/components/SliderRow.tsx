"use client"

import { RotateCcw } from "lucide-react"

export function SliderRow({ icon, label, value, min, max, boundsMin, boundsMax, onChange, onDoubleClick, editingValue, editText, setEditingValue, setEditText, editingKey, suffix }: {
  icon?: React.ReactNode; label: string; value: number; min: number; max: number; boundsMin: number; boundsMax: number;
  onChange: (v: number) => void; onDoubleClick: () => void;
  editingValue: string | null; editText: string;
  setEditingValue: (v: string | null) => void; setEditText: (v: string) => void;
  editingKey: string; suffix?: string
}) {
  const range = max - min
  const step = Math.max(1, Math.round(range / 100))
  return (
    <div className="control-row flex items-center gap-2 group min-h-[38px] py-0.5">
      <span className="text-sm text-zinc-400 w-6 shrink-0 text-center flex items-center justify-center">{icon}</span>
      <span className="text-[13px] text-zinc-300 w-14 shrink-0 font-medium select-none">{label}</span>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={`${value}${suffix ?? ""}`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={onDoubleClick}
        className="flex-1 min-w-0 h-6 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange rounded"
        style={{ "--pct": `${boundsMax !== boundsMin ? ((value - boundsMin) / (boundsMax - boundsMin)) * 100 : 50}%` } as React.CSSProperties}
      />
      {editingValue === editingKey ? (
        <input
          autoFocus
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => { const v = Math.min(boundsMax, Math.max(boundsMin, Number(editText) || 0)); onChange(v); setEditingValue(null) }}
          onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur() } }}
          className="editor-input w-14 text-right px-1.5 py-1 text-xs rounded border border-white/20 bg-zinc-900 text-white"
        />
      ) : (
        <button
          type="button"
          onClick={() => { setEditText(String(value)); setEditingValue(editingKey) }}
          aria-label={`${label}: ${value}${suffix ?? (editingKey === "scale" ? "%" : "px")}`}
          className="text-[13px] text-zinc-200 w-14 min-h-[36px] flex items-center justify-end cursor-pointer hover:text-accent-orange transition-colors tabular-nums font-semibold focus-visible:outline-2 focus-visible:outline-accent-orange rounded px-1"
        >
          {value}{suffix ?? (editingKey === "scale" ? "%" : "px")}
        </button>
      )}
      <button
        type="button"
        aria-label={`Reset ${label}`}
        title={`Reset ${label}`}
        onClick={onDoubleClick}
        className="w-9 h-9 min-w-[36px] min-h-[36px] shrink-0 flex items-center justify-center rounded-lg text-zinc-500 hover:text-accent-orange hover:bg-white/[0.08] active:scale-90 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange"
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
