"use client"



export function PosterCardSkeleton() {
  return (
    <div className="bg-surface2/50 rounded-xl overflow-hidden border border-surface2">
      <div className="aspect-[2/3] relative overflow-hidden">
        <div className="w-full h-full skeleton-shimmer-subtle" />
      </div>
      <div className="px-2 py-2">
        <div className="h-2.5 w-3/4 rounded skeleton-shimmer-subtle" />
      </div>
    </div>
  )
}

