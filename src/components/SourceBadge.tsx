import { RatingSourceIcon } from "@/components/RatingSourceIcon"

/** Etichetta fonte (logo + nome) sovrapposta in alto a sinistra al tile. */
export function SourceBadge({ id, label, className = "top-1" }: { id: string; label: string; className?: string }) {
  return (
    <span className={`absolute ${className} left-1 z-20 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-200 backdrop-blur-md border border-white/10 pointer-events-none`}>
      <RatingSourceIcon id={id} className="w-3 h-3" />
      {label}
    </span>
  )
}
