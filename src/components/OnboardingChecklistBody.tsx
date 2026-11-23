"use client"

import React from "react"
import { Check, Circle, Images, KeyRound, QrCode, Search } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"

function StepRow({
  testId,
  icon,
  label,
  done,
  doneText,
  todoText,
  children,
}: {
  testId: string
  icon: React.ReactNode
  label: string
  done: boolean
  doneText: string
  todoText: string
  children?: React.ReactNode
}) {
  return (
    <li
      data-testid={testId}
      data-done={done ? "true" : "false"}
      className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5"
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          done ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 text-zinc-500"
        }`}
      >
        {done ? <Check className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
          <span aria-hidden="true" className="text-zinc-500">{icon}</span>
          {label}
        </span>
        <span className={`mt-0.5 block text-[11px] ${done ? "text-emerald-300/90" : "text-zinc-500"}`}>
          {done ? doneText : todoText}
        </span>
        {children}
      </span>
    </li>
  )
}

export interface OnboardingChecklistBodyProps {
  hasKey: boolean
  hasSavedPoster: boolean
  installOpened: boolean
  onInstall: () => void
  onCustomize: () => void
  onOpenKeySettings: () => void
  onSkip: () => void
  /** Il wizard mostra già la descrizione come sottotitolo del passo. */
  hideDescription?: boolean
}

/**
 * Corpo condiviso della guida "Inizia con Pictorium": due percorsi (installa
 * ora / personalizza un poster) + checklist live. Usato sia dal modale
 * `OnboardingTour` sia come ultimo passo del wizard di primo avvio
 * (`LangPicker`), così i due flussi non si impilano.
 *
 * Solo presentazione: nessuno stato proprio e nessuna scrittura; navigazione
 * e persistenza restano ai chiamanti.
 */
export function OnboardingChecklistBody({
  hasKey,
  hasSavedPoster,
  installOpened,
  onInstall,
  onCustomize,
  onOpenKeySettings,
  onSkip,
  hideDescription,
}: OnboardingChecklistBodyProps) {
  const { t } = useT()
  const doneText = t("ui.done")
  const todoText = t("ui.installCheckNotChecked")

  return (
    <>
      {!hideDescription && (
        <p id="onboarding-tour-desc" className="text-sm text-muted leading-relaxed">
          {t("ui.onboardingActionDesc")}
        </p>
      )}

      <div className="grid gap-2">
        <button
          type="button"
          data-testid="onboarding-path-install"
          onClick={onInstall}
          className="flex items-center gap-3 rounded-xl border border-accent-orange/30 bg-accent-orange/10 px-4 py-3 text-left transition duration-150 hover:bg-accent-orange/20 active:scale-[0.98]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-orange/20 text-accent-orange">
            <QrCode className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-foreground">
              {t("ui.onboardingPathInstall")}
            </span>
            <span className="block text-xs text-muted leading-relaxed">
              {t("ui.onboardingPathInstallDesc")}
            </span>
          </span>
        </button>

        <button
          type="button"
          data-testid="onboarding-path-customize"
          onClick={onCustomize}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left transition duration-150 hover:bg-white/[0.08] active:scale-[0.98]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-zinc-300">
            <Search className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-foreground">
              {t("ui.onboardingPathCustomize")}
            </span>
            <span className="block text-xs text-muted leading-relaxed">
              {t("ui.onboardingPathCustomizeDesc")}
            </span>
          </span>
        </button>
      </div>

      <ul
        data-testid="onboarding-checklist"
        aria-label={t("ui.onboardingChecklist")}
        aria-live="polite"
        className="grid gap-1.5"
      >
        <StepRow
          testId="onboarding-step-key"
          icon={<KeyRound className="h-3.5 w-3.5" />}
          label={t("ui.onboardingStepKey")}
          done={hasKey}
          doneText={doneText}
          todoText={todoText}
        >
          {!hasKey && (
            <button
              type="button"
              data-testid="onboarding-open-key-settings"
              onClick={onOpenKeySettings}
              className="mt-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-white/10"
            >
              {t("ui.onboardingOpenKeySettings")}
            </button>
          )}
          <span className="mt-1 block text-[11px] leading-relaxed text-zinc-500">
            {t("ui.onboardingKeyUnverified")}
          </span>
        </StepRow>
        <StepRow
          testId="onboarding-step-save"
          icon={<Images className="h-3.5 w-3.5" />}
          label={t("ui.onboardingStepSave")}
          done={hasSavedPoster}
          doneText={doneText}
          todoText={todoText}
        />
        <StepRow
          testId="onboarding-step-install"
          icon={<QrCode className="h-3.5 w-3.5" />}
          label={t("ui.onboardingStepInstall")}
          done={installOpened}
          doneText={doneText}
          todoText={todoText}
        />
      </ul>

      <button
        type="button"
        data-testid="onboarding-skip"
        onClick={onSkip}
        className="w-full rounded-xl py-2 text-xs text-zinc-600 transition-colors duration-150 hover:text-muted border-t border-white/5"
      >
        {t("ui.onboardingSkip")}
      </button>
    </>
  )
}
