"use client"

export function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
  className = "",
  "aria-label": ariaLabel,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  className?: string
  "aria-label"?: string
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={`w-full text-left text-xs sm:text-sm font-medium px-3.5 py-2.5 min-h-[42px] rounded-xl active:scale-[0.98] transition-all duration-150 touch-manipulation cursor-pointer inline-flex items-center ${
        danger
          ? "hover:bg-red-900/50 bg-red-950/20 text-rose-300"
          : "hover:bg-white/10 bg-white/[0.04] text-zinc-200 border border-white/[0.06]"
      } ${className}`}
    >
      <span className="flex items-center gap-2">
        {Icon && <span className="w-4 h-4 shrink-0">{Icon}</span>}
        <span>{label}</span>
      </span>
    </button>
  )
}
