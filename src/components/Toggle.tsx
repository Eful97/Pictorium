"use client"

// Fix L31: il toggle ha un nome accessibile esplicito — un role="switch"
// senza nome viene annunciato come "switch" senza contesto dagli screen reader.
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      className="inline-flex items-center justify-center min-h-[44px] min-w-[48px] p-2 cursor-pointer touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 select-none bg-transparent border-0"
    >
      <span
        aria-hidden="true"
        className={`toggle-track transition-all ${
          value ? "toggle-track-on" : "toggle-track-off"
        }`}
      >
        <span className={`toggle-thumb ${value ? "toggle-thumb-on" : "toggle-thumb-off"}`} />
      </span>
    </button>
  )
}