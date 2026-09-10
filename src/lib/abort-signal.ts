/**
 * Combina un signal esterno (es. deadline del render poster) con un timeout
 * interno: il signal risultante scatta al primo dei due.
 *
 * Senza, i fetch con solo `AbortSignal.timeout()` sopravvivono allo scatto
 * del watchdog e continuano in background come zombie (heap + socket) anche
 * dopo che la route ha già risposto 503 (R3). Request-scoped: nessun listener
 * globale; il ramo fallback copre i runtime senza `AbortSignal.any` (stesso
 * idioma già usato in `fetchImg` e `hasJWOffers`).
 */
export function combineAbortSignals(
  external: AbortSignal | undefined | null,
  timeoutMs: number,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  if (!external) return timeoutSignal
  if (typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
    return (AbortSignal as unknown as { any: (signals: AbortSignal[]) => AbortSignal }).any([
      external,
      timeoutSignal,
    ])
  }
  const ctrl = new AbortController()
  const onAbort = () =>
    ctrl.abort((external as unknown as { reason?: unknown })?.reason ?? timeoutSignal.reason)
  if (external.aborted || timeoutSignal.aborted) ctrl.abort()
  else {
    external.addEventListener("abort", onAbort, { once: true })
    timeoutSignal.addEventListener("abort", onAbort, { once: true })
  }
  return ctrl.signal
}
