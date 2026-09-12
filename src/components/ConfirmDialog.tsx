import React from "react"
import { useT } from "@/lib/contexts/TranslationContext"
import { Modal } from "@/components/ui/Modal"

export const ConfirmDialog = React.memo(function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  confirmClass,
  onConfirm,
  onCancel,
  inline,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  confirmClass?: string
  onConfirm: () => void
  onCancel: () => void
  inline?: boolean
}) {
  const { t } = useT()

  if (!open) return null

  if (inline) {
    return (
      <>
        <div className="fixed inset-0 z-[199]" onClick={onCancel} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="absolute top-full right-0 mt-2 z-[200] surface-card border border-white/10 rounded-2xl p-4 shadow-2xl shadow-black/80 min-w-56 max-w-[calc(100vw-2rem)] max-h-[80vh] overflow-y-auto animate-fade-scale-in select-text"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-sm font-semibold text-zinc-100 mb-2">{title}</h3>
          <p className="text-xs text-zinc-400 mb-4 leading-relaxed">{message}</p>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="btn-secondary px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer"
            >
              {t("ui.cancelAction")}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={`btn-danger px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer ${confirmClass ?? ""}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <Modal isOpen={open} onClose={onCancel} labelledBy="confirm-dialog-title" className="max-w-sm p-5 space-y-4">
      <div>
        <h3 id="confirm-dialog-title" className="text-base font-bold text-zinc-100 mb-2">{title}</h3>
        <p className="text-xs text-zinc-400 leading-relaxed">{message}</p>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary px-4 py-2 rounded-xl text-xs font-medium cursor-pointer"
        >
          {t("ui.cancelAction")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`btn-danger px-4 py-2 rounded-xl text-xs font-medium cursor-pointer ${confirmClass ?? ""}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
})
