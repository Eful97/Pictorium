/**
 * Dedicated gate for poster format conversions (canonical <-> variant, C3).
 * Coalesces concurrent conversions of the same canonical revision and bounds
 * distinct ones to 2 natives. Encoders stay in `poster-runtime-cache.ts`
 * (passed in as `run`): same quality/format/bytes, no second renderer.
 * Inflight-only state — no TTL cache, so it can never serve stale bytes or
 * poison the error cache. No env knobs. The budget is dedicated, not the
 * render semaphore: conversions are short CPU encodes with a different
 * profile than full renders, and neither side should queue behind the other.
 */
export const MAX_FORMAT_CONVERSIONS = 2
// Bounded queue: each queued waiter retains its `run` closure (hence the
// canonical buffer), so the cap also bounds retained memory. Beyond it: 503.
export const FORMAT_QUEUE_LIMIT = 16
// Bounded wait for queueing only — never applied to active work.
export const FORMAT_SLOT_WAIT_MS = 5000

/** Transient overload: the caller answers 503 WITHOUT the error cache. */
export class FormatOverloadError extends Error {
  readonly status = 503 as const
  constructor(message = "Format conversion overloaded") {
    super(message)
    this.name = "FormatOverloadError"
  }
}

const inflight = new Map<string, Promise<Buffer>>()
let activeConversions = 0
const conversionWaiters: Array<() => void> = []
// Queued-waiter timers (same pattern as `pendingGraceTimers` in the render
// limiter): tracked so test reset clears them — no timer fires late.
const waiterTimers = new Set<ReturnType<typeof setTimeout>>()
// Test reset bumps this: accounting from a previous state detaches instead
// of corrupting the new one. Production never resets.
let gateGeneration = 0

function pumpConversionWaiters(): void {
  while (conversionWaiters.length > 0 && activeConversions < MAX_FORMAT_CONVERSIONS) {
    const next = conversionWaiters.shift()
    if (next) next()
  }
}

function releaseFor(gen: number): () => void {
  return () => {
    if (gen !== gateGeneration) return
    activeConversions = Math.max(0, activeConversions - 1)
    pumpConversionWaiters()
  }
}

/** Same bounded pattern as `acquirePosterRenderSlot`, on a dedicated budget:
 *  resolves with the release fn, or null on queue-full / wait-deadline. */
function acquireFormatSlot(): Promise<(() => void) | null> {
  if (activeConversions < MAX_FORMAT_CONVERSIONS) {
    activeConversions++
    return Promise.resolve(releaseFor(gateGeneration))
  }
  if (conversionWaiters.length >= FORMAT_QUEUE_LIMIT) {
    return Promise.resolve(null)
  }
  const gen = gateGeneration
  return new Promise<(() => void) | null>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      waiterTimers.delete(timer)
      const i = conversionWaiters.indexOf(handoff)
      if (i >= 0) conversionWaiters.splice(i, 1)
      resolve(null)
    }, FORMAT_SLOT_WAIT_MS)
    if (typeof timer.unref === "function") timer.unref()
    waiterTimers.add(timer)
    const handoff = () => {
      if (settled || gen !== gateGeneration) return
      settled = true
      waiterTimers.delete(timer)
      clearTimeout(timer)
      activeConversions++
      resolve(releaseFor(gen))
    }
    conversionWaiters.push(handoff)
  })
}

/**
 * Coalesced + bounded conversion. `key` must pin the exact canonical
 * revision AND the variant (`${variantKey}:${canonicalEtag}:${format}`):
 * same key means byte-identical input, so one shared encode is exact.
 * Cache hits never reach here — callers convert only on variant miss.
 * Same-key callers share the leader (one encode, no extra slot); overload
 * throws FormatOverloadError. The slot releases only after the native
 * promise settles (finally). Dual-handler cleanup (as in `sharedSourceFetch`):
 * the derived promise always resolves, the shared one still rejects to its
 * awaiters — no unhandled rejections either way.
 */
export function runFormatConversion(key: string, run: () => Promise<Buffer>): Promise<Buffer> {
  const existing = inflight.get(key)
  if (existing) return existing
  // Synchronous reservation (no await between get and set, as in
  // `beginPosterRender`): two callers cannot both lead the same key.
  const gate = (async (): Promise<Buffer> => {
    const release = await acquireFormatSlot()
    if (!release) throw new FormatOverloadError()
    try {
      return await run()
    } finally {
      release()
    }
  })()
  inflight.set(key, gate)
  void gate.then(
    () => { if (inflight.get(key) === gate) inflight.delete(key) },
    () => { if (inflight.get(key) === gate) inflight.delete(key) },
  )
  return gate
}

/** Test-only, call with all conversions settled: clears waiter timers and
 *  detaches any straggler accounting via a generation bump. */
export function __resetFormatGateForTests(): void {
  gateGeneration++
  inflight.clear()
  activeConversions = 0
  conversionWaiters.length = 0
  for (const t of waiterTimers) clearTimeout(t)
  waiterTimers.clear()
}
