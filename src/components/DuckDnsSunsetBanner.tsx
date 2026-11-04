"use client"

import { useEffect, useState, type ReactNode } from "react"
import { X } from "lucide-react"
import { createT } from "@/lib/i18n"
import { loadLanguage } from "@/lib/i18n-loader"

/**
 * One-off sunset notice for the DuckDNS instance.
 *
 * Rendered only when the server gate in `src/app/layout.tsx` sees
 * `PICTORIUM_DUCKDNS_NOTICE=1` (env only — never hostname sniffing, so public
 * instances can never show it by accident). The wrapper stays in the markup
 * (empty, zero height) so the server gate is observable in the HTML while the
 * visible bar is mounted client-side. The X closes the bar for the current view
 * only: dismissal is plain in-memory state, so a page refresh shows the notice
 * again (no localStorage persistence).
 */

// Reuses the deploy link already published in README ("Deploy to Vercel").
const VERCEL_DEPLOY_URL =
  "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FEful97%2FPictorium"

const ELFHOSTED_URL = "https://pictorium.elfhosted.com/"

const ACTION_LINK_CLASS =
  "font-semibold text-accent-orange underline-offset-2 hover:underline focus-visible:underline"

/**
 * Renders the third body paragraph, whose translated template embeds the two
 * action phrases as `{vercel}` / `{elfhosted}` placeholders. Translators keep
 * the placeholders (enforced by the translations-parity test) and can place
 * them in the natural order for their language.
 */
function renderBody3(
  template: string,
  t: (key: string) => string,
): ReactNode[] {
  return template
    .split(/(\{vercel\}|\{elfhosted\})/)
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (part === "{vercel}") {
        return (
          <a
            key={`vercel-${index}`}
            href={VERCEL_DEPLOY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={ACTION_LINK_CLASS}
          >
            {t("duckdnsSunset.vercelLabel")}
          </a>
        )
      }
      if (part === "{elfhosted}") {
        return (
          <a
            key={`elfhosted-${index}`}
            href={ELFHOSTED_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={ACTION_LINK_CLASS}
          >
            {t("duckdnsSunset.elfhostedLabel")}
          </a>
        )
      }
      return <span key={`text-${index}`}>{part}</span>
    })
}

export function DuckDnsSunsetBanner() {
  // `lang`/`ready` stay null/false until the persisted UI language resolves:
  // no raw i18n keys and no Italian flash for non-Italian spaces.
  const [lang, setLang] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let saved: string | null = null
    try {
      saved = window.localStorage.getItem("preferred_lang")
    } catch {
      /* storage unavailable: fall back to the document language */
    }
    const code = (saved || document.documentElement.lang || "it").toLowerCase()

    let cancelled = false
    void loadLanguage(code).then(
      () => {
        if (cancelled) return
        setLang(code)
        setReady(true)
      },
      () => {
        if (cancelled) return
        setLang("en")
        setReady(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  const dismiss = () => {
    setDismissed(true)
  }

  const t = createT(lang ?? "en")
  const visible = ready && !dismissed

  return (
    <div data-pictorium-duckdns-sunset="">
      {visible ? (
        <section
          role="region"
          aria-label={t("duckdnsSunset.title")}
          className="border-b border-accent-orange/35 bg-accent-orange/10 px-4 py-3 text-foreground backdrop-blur-sm"
        >
          <div className="mx-auto flex w-full max-w-5xl items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-snug">
                {t("duckdnsSunset.title")}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                {t("duckdnsSunset.body1")}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                {t("duckdnsSunset.body2")}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                {renderBody3(t("duckdnsSunset.body3"), t)}
              </p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("duckdnsSunset.dismiss")}
              className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-accent-orange/15 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-orange"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
