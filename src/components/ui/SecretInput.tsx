import { useState } from "react"
import { Eye, EyeOff, Check, X, Loader2, ShieldCheck } from "lucide-react"

export function SecretInput({
  label,
  icon: Icon,
  value,
  onChange,
  onBlur,
  onKeyDown,
  placeholder,
  className = "",
  error,
  onValidate,
}: {
  label: string
  icon: React.ReactNode
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  placeholder?: string
  className?: string
  error?: string
  onValidate?: (v: string) => Promise<boolean | void>
}) {
  const [show, setShow] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validStatus, setValidStatus] = useState<"valid" | "invalid" | null>(null)

  const handleValidate = async () => {
    if (!onValidate || validating) return
    setValidating(true)
    setValidStatus(null)
    try {
      const res = await onValidate(value)
      if (res !== false) {
        setValidStatus("valid")
      } else {
        setValidStatus("invalid")
      }
    } catch {
      setValidStatus("invalid")
    } finally {
      setValidating(false)
      setTimeout(() => setValidStatus(null), 3000)
    }
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-xs text-muted font-medium flex items-center gap-1.5">
        {Icon && <span className="shrink-0 w-3 h-3 [&>svg]:w-3 [&>svg]:h-3">{Icon}</span>}
        {label}
      </label>
      <div className="flex gap-1">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setValidStatus(null)
          }}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          // API key / secret: Latin machine string, LTR in both modes
          // (the eye toggle flips type but never the writing direction).
          dir="ltr"
          className={`flex-1 bg-background border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-accent placeholder:text-zinc-500 transition-colors duration-150 ${error ? "border-red-500/70 focus:border-red-500" : "border-border"}`}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="px-2 bg-surface2 rounded-lg text-xs hover:bg-zinc-700 active:scale-90 transition duration-150 text-zinc-300"
          aria-label={show ? "Hide password" : "Show password"}
          title={show ? "Nascondi chiave" : "Mostra chiave"}
        >
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
        {onValidate && (
          <button
            type="button"
            disabled={validating || !value.trim()}
            onClick={handleValidate}
            className={`px-2 rounded-lg text-xs font-medium border transition duration-150 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed ${
              validStatus === "valid"
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                : validStatus === "invalid"
                  ? "bg-red-500/20 text-red-400 border-red-500/40"
                  : "bg-surface2 border-surface2/60 text-zinc-300 hover:text-white hover:bg-zinc-700 active:scale-90"
            }`}
            title="Verifica validità chiave"
            aria-label="Verifica validità chiave"
          >
            {validating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-orange" />
            ) : validStatus === "valid" ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : validStatus === "invalid" ? (
              <X className="w-3.5 h-3.5 text-red-400" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>
      {error && <p className="text-[10px] text-danger font-medium">{error}</p>}
    </div>
  )
}
