"use client"

// Fix L31: il toggle ha un nome accessibile esplicito — un role="switch"
// senza nome viene annunciato come "switch" senza contesto dagli screen reader.
// `disabled`: interruttore non azionabile (es. genere/anno soppressi dal bottom) —
// mai distruggere il valore, solo bloccare il cambio con resa visiva attenuata.
export function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  const isDisabled = disabled === true
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      aria-disabled={isDisabled || undefined}
      disabled={isDisabled}
      onClick={() => { if (!isDisabled) onChange(!value) }}
      className={`inline-flex items-center justify-center min-h-[44px] min-w-[48px] p-2 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 select-none bg-transparent border-0 ${isDisabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
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