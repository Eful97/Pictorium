"use client"

import React from "react"
// Fix M20: i fallback testuali seguono la lingua attiva (setLang aggiorna il
// modulo i18n), anche in un component a classi senza accesso agli hook.
import { t } from "@/lib/i18n"

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
  title?: string
  message?: string
  retryLabel?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      const title = this.props.title || t("ui.errorDefaultTitle")
      const message = this.props.message || this.state.error?.message || t("ui.errorUnknown")
      const retryLabel = this.props.retryLabel || t("ui.retry")
      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] p-6 text-center animate-fade-scale-in">
          <div className="empty-state-illustration mb-4">
            <svg className="w-10 h-10 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" opacity="0.3"/>
              <line x1="12" y1="8" x2="12" y2="12" opacity="0.6"/>
              <circle cx="12" cy="16" r="0.5" fill="currentColor" opacity="0.6"/>
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-zinc-200 mb-1.5">{title}</h3>
          <p className="text-xs text-zinc-500 mb-6 max-w-sm leading-relaxed">{message}</p>
          <button type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-surface2 border border-border text-zinc-300 hover:bg-zinc-700 hover:text-white hover:border-zinc-500 active:scale-95 transition duration-200 press-scale"
          >
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              {retryLabel}
            </span>
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
