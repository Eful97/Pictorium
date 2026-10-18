/**
 * Combina un signal esterno (es. deadline del render poster) con un timeout
 * interno oppure con un secondo signal: il signal risultante scatta al primo
 * dei due.
 *
 * Senza, i fetch con solo `AbortSignal.timeout()` sopravvivono allo scatto
 * del watchdog e continuano in background come zombie (heap + socket) anche
 * dopo che la route ha già risposto 503 (R3). Request-scoped: nessun listener
 * globale; il ramo fallback copre i runtime senza `AbortSignal.any` (stesso
 * idioma già usato in `fetchImg` e `hasJWOffers`).
 */
export function combineAbortSignals(
  external: AbortSignal | undefined | null,
  timeoutMsOrSignal: number | AbortSignal,
): AbortSignal {
  const second: AbortSignal =
    typeof timeoutMsOrSignal === "number"
      ? AbortSignal.timeout(timeoutMsOrSignal)
      : timeoutMsOrSignal
  if (!external) return second
  if (typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
    return (AbortSignal as unknown as { any: (signals: AbortSignal[]) => AbortSignal }).any([
      external,
      second,
    ])
  }
  const ctrl = new AbortController()
  const onAbort = () =>
    ctrl.abort((external as unknown as { reason?: unknown })?.reason ?? (second as unknown as { reason?: unknown })?.reason)
  if (external.aborted || second.aborted) ctrl.abort()
  else {
    external.addEventListener("abort", onAbort, { once: true })
    second.addEventListener("abort", onAbort, { once: true })
  }
  return ctrl.signal
}

/**
 * Abort reason fidelity across runtimes: DOM `AbortSignal` reasons are
 * usually DOMExceptions (`AbortError` by default, `TimeoutError` from
 * `AbortSignal.timeout`), but `DOMException instanceof Error` is false in
 * browser/jsdom runtimes (true only in Node) — an `instanceof Error` check
 * alone would collapse a genuine `TimeoutError` into a generic `AbortError`
 * there. Accept both, so the internal image cap stays distinguishable from
 * an external abort everywhere. In Node this is a no-op (a DOMException
 * already passes `instanceof Error`): zero production behavior change, caps
 * and paths untouched.
 */
export function signalAbortReason(signal: AbortSignal): Error | DOMException {
  const reason = (signal as unknown as { reason?: unknown }).reason
  if (reason instanceof Error || reason instanceof DOMException) return reason
  return new DOMException("Aborted", "AbortError")
}

/**
 * Gara tra una promise condivisa (es. inflight dedup) e il signal del
 * chiamante: il waiter esce al proprio abort invece di restare ostaggio della
 * promise altrui. Senza signal ritorna la promise invariata. Il listener è
 * sempre rimosso all'esito (niente leak sui signal a timeout lungo).
 */
export function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined | null): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    return Promise.reject(signalAbortReason(signal))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signalAbortReason(signal))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (err) => {
        signal.removeEventListener("abort", onAbort)
        reject(err)
      },
    )
  })
}
