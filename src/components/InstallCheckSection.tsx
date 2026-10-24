"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Circle, Loader2, ShieldCheck, X } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { userAuthHeaders, USER_UNLOCK_EVENT } from "@/lib/user-token"
import { RENDER_VERSION } from "@/lib/render-version"

type StepId = "key" | "manifest" | "poster"
type StepState = "idle" | "running" | "pass" | "fail"

interface InstallCheckContext {
  u: string | null
  config: string | null
}

const STEPS: readonly StepId[] = ["key", "manifest", "poster"]
const STEP_LABEL_KEYS: Record<StepId, string> = {
  key: "ui.installCheckStepKey",
  manifest: "ui.installCheckStepManifest",
  poster: "ui.installCheckStepPoster",
}

// Per-step budget: diagnostics must never hang the UI. The poster gets
// the widest cap (shared renderer, potentially cold).
const KEY_TIMEOUT_MS = 12000
const MANIFEST_TIMEOUT_MS = 10000
const POSTER_TIMEOUT_MS = 15000
// Below this size a "poster" is not a usable image response
// (zero-byte truncated body). Size alone NEVER proves a valid
// image: the final verdict belongs to the real browser decode
// (decodeInstallCheckImage). No arbitrary KB floor: even a
// small but decodable poster is a success.
const MIN_IMAGE_BYTES = 1
// Known stable title for the real poster probe (Fight Club, TMDB 550):
// goes through the shared renderer like any Stremio installation.
const PROBE_MEDIA_TYPE = "movie"
const PROBE_TMDB_ID = 550

/**
 * Install context derived from the selected manifest URL
 * (`/u/<uuid>/…`, `/c/<token>/…`, `?u=`/`?config=`). Returns null for
 * non same-origin (never cross-origin fetch: no client-side SSRF) or
 * unparseable URLs. Exported for tests.
 */
export function parseInstallCheckContext(manifestUrl: string): InstallCheckContext | null {
  try {
    const parsed = new URL(manifestUrl, window.location.href)
    if (parsed.origin !== window.location.origin) return null
    let u: string | null = null
    let config: string | null = null
    const pathMatch = parsed.pathname.match(/^\/(u|c)\/([^/]+)/)
    if (pathMatch?.[1] === "u") u = decodeURIComponent(pathMatch[2])
    else if (pathMatch?.[1] === "c") config = decodeURIComponent(pathMatch[2])
    const qUser = parsed.searchParams.get("u") ?? parsed.searchParams.get("user")
    const qConfig = parsed.searchParams.get("config") ?? parsed.searchParams.get("c")
    if (!u && qUser) u = qUser
    if (!config && qConfig) config = qConfig
    return { u, config }
  } catch {
    return null
  }
}

/** Magic bytes of the formats served by the shared renderer (PNG/JPEG/WebP/AVIF).
 * Pre-filter sanity only: a match does NOT prove a valid image (an MP4
 * shares the `ftyp` box, PNG bytes + zeros are not a PNG). The verdict
 * requires `decodeInstallCheckImage`. */
export function isInstallCheckImagePayload(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  if (png) return true
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (jpeg) return true
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
  const webp = riff && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  if (webp) return true
  const ftyp =
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  if (ftyp) return true
  return false
}

/**
 * Real browser-side image decode: the magic-bytes sanity check is not
 * enough (MP4 `ftyp`, corrupt PNG). Returns true only if the browser really
 * decodes the bytes. Bound by the step signal (run timeout/abort):
 * on an aborted signal it throws (AbortError/TimeoutError) so the caller
 * reports "network/retry", never success. Always cleans up object URLs and
 * listeners. No second renderer: native browser decoders only.
 */
export async function decodeInstallCheckImage(
  bytes: Uint8Array,
  contentType: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (!isInstallCheckImagePayload(bytes)) return false
  if (signal.aborted) {
    throw new DOMException("Install check decode aborted", "AbortError")
  }
  const bitmapCtor = (
    globalThis as unknown as {
      createImageBitmap?: (blob: Blob) => Promise<{ close?: () => void }>
    }
  ).createImageBitmap
  if (typeof bitmapCtor === "function") {
    const copy = bytes.slice()
    const blob =
      typeof Blob !== "undefined"
        ? new Blob([copy as unknown as BlobPart], { type: contentType || "image/png" })
        : null
    if (!blob) return false
    // Dedicated decode abort: named handler always removed in
    // finally (success and failure), never an orphaned anonymous listener. If
    // the abort wins the race, the late-resolving bitmap is still
    // closed (no ImageBitmap leak).
    let onAbort: (() => void) | null = null
    const abortPromise = new Promise<never>((_, reject) => {
      onAbort = () => {
        reject(new DOMException("Install check decode aborted", "AbortError"))
      }
      signal.addEventListener("abort", onAbort, { once: true })
    })
    const bitmapPromise = bitmapCtor.call(globalThis, blob) as Promise<{ close?: () => void }>
    let won: { close?: () => void } | null = null
    try {
      won = await Promise.race([bitmapPromise, abortPromise])
      // Near-simultaneous abort after the bitmap won: never success.
      if (signal.aborted) {
        try {
          won?.close?.()
        } catch {
          /* best-effort close */
        }
        throw new DOMException("Install check decode aborted", "AbortError")
      }
      try {
        won?.close?.()
      } catch {
        /* best-effort close */
      }
      return true
    } catch (e) {
      if (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError")) {
        // The abort won the race: the pending bitmap closes on late
        // resolution. If the bitmap had already won (won != null) it is already
        // closed above: no second close.
        if (!won) {
          bitmapPromise.then(
            (late) => {
              try {
                late?.close?.()
              } catch {
                /* best-effort close */
              }
            },
            () => {
              /* decode fallito dopo l'abort: niente da chiudere */
            },
          )
        }
        throw e
      }
      return false
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort)
    }
  }
  // Fallback without createImageBitmap (old jsdom/webkit): <img> on object URL.
  const URLCtor = (
    globalThis as unknown as {
      URL?: { createObjectURL?: (blob: Blob) => string; revokeObjectURL?: (url: string) => void }
    }
  ).URL
  if (
    typeof document === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URLCtor?.createObjectURL !== "function"
  ) {
    return false
  }
  const copy = bytes.slice()
  const blob = new Blob([copy as unknown as BlobPart], { type: contentType || "image/png" })
  const url = URLCtor.createObjectURL!(blob)
  try {
    await new Promise<void>((resolve, reject) => {
      const img = document.createElement("img")
      const cleanup = () => {
        img.removeEventListener("load", onLoad)
        img.removeEventListener("error", onError)
        signal.removeEventListener("abort", onAbort)
      }
      const onLoad = () => {
        // Zero natural dimensions = failed decode (unusable pixels).
        const w = typeof img.naturalWidth === "number" ? img.naturalWidth : 1
        const h = typeof img.naturalHeight === "number" ? img.naturalHeight : 1
        cleanup()
        if (w <= 0 || h <= 0) {
          reject(new Error("Install check image decode failed"))
          return
        }
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(new Error("Install check image decode failed"))
      }
      const onAbort = () => {
        cleanup()
        img.removeAttribute("src")
        reject(new DOMException("Install check decode aborted", "AbortError"))
      }
      img.addEventListener("load", onLoad)
      img.addEventListener("error", onError)
      signal.addEventListener("abort", onAbort, { once: true })
      img.src = url
    })
    return true
  } catch (e) {
    if (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError")) throw e
    return false
  } finally {
    try {
      URLCtor.revokeObjectURL?.(url)
    } catch {
      /* best-effort revoke */
    }
  }
}

/** Media types a Pictorium Stremio catalog may declare. `movie`/`series` cover
 * content/search/people catalogs; `all` is Stremio's public mixed-catalog type,
 * emitted by build-manifest for generic `all` (overall) streaming selections
 * (root `types` gains `all` for the `/catalog/all/...` route while `meta`
 * keeps its explicit movie/series types — the /meta resolver has no `all`
 * branch). Accepted for any entry on purpose: the checker validates manifest
 * structure, it does not re-enforce builder id policy (that would couple it to
 * `stream2-*` naming and risk false-rejecting future legitimate `all`
 * catalogs). Every other gate (id/name/version/root types/resources/meta)
 * stays fail-closed, so malformed manifests still fail. */
const INSTALL_CHECK_CATALOG_TYPES = new Set(["movie", "series", "all"])

/** Minimal catalog entry: present only if the manifest declares it. */
function isInstallCheckCatalogEntry(c: unknown): boolean {
  if (!c || typeof c !== "object" || Array.isArray(c)) return false
  const e = c as Record<string, unknown>
  if (typeof e.id !== "string" || !e.id) return false
  if (typeof e.name !== "string" || !e.name) return false
  if (typeof e.type !== "string" || !INSTALL_CHECK_CATALOG_TYPES.has(e.type)) return false
  if (e.extra !== undefined && !Array.isArray(e.extra)) return false
  if (Array.isArray(e.extra)) {
    for (const x of e.extra) {
      if (!x || typeof x !== "object" || Array.isArray(x)) return false
      if (typeof (x as Record<string, unknown>).name !== "string") return false
    }
  }
  return true
}

/** Minimal Pictorium manifest shape (never the catalog contents).
 * A manifest with zero catalogs is legitimate (user with all catalogs
 * disabled, or a mode without content): catalogs are validated entry by entry
 * only when present. Still required: id/addon, non-empty name, semver
 * version, types, resources with catalog + meta. */
const INSTALL_CHECK_VERSION_PATTERN = /^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/
export function isInstallCheckManifestValid(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false
  const m = data as Record<string, unknown>
  if (typeof m.id !== "string" || !m.id.startsWith("org.pictorium")) return false
  if (typeof m.name !== "string" || !m.name.trim()) return false
  if (typeof m.version !== "string" || !INSTALL_CHECK_VERSION_PATTERN.test(m.version)) return false
  if (!Array.isArray(m.catalogs)) return false
  for (const c of m.catalogs) {
    if (!isInstallCheckCatalogEntry(c)) return false
  }
  if (!Array.isArray(m.types) || (!m.types.includes("movie") && !m.types.includes("series"))) return false
  if (!Array.isArray(m.resources)) return false
  const hasCatalog = m.resources.includes("catalog")
  const hasMeta = m.resources.some(
    (r) => typeof r === "object" && r !== null && (r as Record<string, unknown>).name === "meta",
  )
  return hasCatalog && hasMeta
}

/**
 * Signal with its own cap tied to the run abort: expires on timeout without
 * cancelling the run, aborts immediately if the run is superseded/closed.
 */
function stepSignal(runSignal: AbortSignal, ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const onAbort = () => {
    try {
      controller.abort(runSignal.reason)
    } catch {
      controller.abort()
    }
  }
  if (runSignal.aborted) onAbort()
  else runSignal.addEventListener("abort", onAbort, { once: true })
  const timer = setTimeout(() => {
    try {
      controller.abort(new DOMException("Install check timed out", "TimeoutError"))
    } catch {
      controller.abort()
    }
  }, ms)
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer)
      runSignal.removeEventListener("abort", onAbort)
    },
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException ? e.name === "AbortError" || e.name === "TimeoutError" : false
}

interface KeyCheckOutcome {
  pass: boolean
  guideKey: string | null
}

/**
 * "Check my configuration" section of the install modal.
 *
 * Three LIVE, independent checks on the selected context (same manifest
 * URL, same space namespace/config, same shared poster endpoint):
 * effective TMDB key (via a server diagnostic that never exposes
 * secrets), manifest structure, real poster validated beyond HTTP
 * 200 (content-type + real browser image decode: never ready on
 * magic bytes alone). Never blocks installation:
 * links stay copyable. No demo, no preview override —
 * and success requires ALL steps (a cached poster with a wrong key
 * is never enough).
 */
export function InstallCheckSection({ manifestUrl }: { manifestUrl: string }) {
  const { t } = useT()
  const [states, setStates] = useState<Record<StepId, StepState>>({
    key: "idle",
    manifest: "idle",
    poster: "idle",
  })
  const [guides, setGuides] = useState<Record<StepId, string | null>>({
    key: null,
    manifest: null,
    poster: null,
  })
  const runningRef = useRef(false)
  const runIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const [running, setRunning] = useState(false)

  // Honest reset on context change: results belong to the manifest
  // URL that produced them, never to the new one.
  useEffect(() => {
    runIdRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    runningRef.current = false
    setRunning(false)
    setStates({ key: "idle", manifest: "idle", poster: "idle" })
    setGuides({ key: null, manifest: null, poster: null })
  }, [manifestUrl])

  // Effective credentials may change for the same manifest URL
  // (space unlock, secret saved/rotated/deleted in another tab):
  // a previous green must not stay green. Existing signals, no
  // secrets in URLs: session unlock + persisted-secret storage.
  // Known limit: the session password lives only in memory (never in
  // storage, no cross-tab events) and server-side global key changes
  // (env) are not observable from the client — those cases stay covered only
  // by a manual re-run (button always available, never blocking).
  useEffect(() => {
    const invalidate = () => {
      runIdRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
      runningRef.current = false
      setRunning(false)
      setStates({ key: "idle", manifest: "idle", poster: "idle" })
      setGuides({ key: null, manifest: null, poster: null })
    }
    const onUnlock = () => invalidate()
    const onStorage = (e: StorageEvent) => {
      try {
        if (typeof e.key === "string" && e.key.startsWith("pictorium-user-token:")) invalidate()
      } catch {
        /* never break the caller */
      }
    }
    window.addEventListener(USER_UNLOCK_EVENT, onUnlock)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(USER_UNLOCK_EVENT, onUnlock)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  useEffect(() => {
    return () => {
      runIdRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const setStep = useCallback((id: StepId, state: StepState, guideKey: string | null = null) => {
    setStates((prev) => (prev[id] === state ? prev : { ...prev, [id]: state }))
    if (guideKey !== undefined) {
      setGuides((prev) => (prev[id] === guideKey ? prev : { ...prev, [id]: guideKey }))
    }
  }, [])

  const run = useCallback(() => {
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)
    const myId = runIdRef.current + 1
    runIdRef.current = myId
    abortRef.current?.abort()
    const runController = new AbortController()
    abortRef.current = runController
    const alive = () => runIdRef.current === myId

    const finish = () => {
      if (!alive()) return
      runningRef.current = false
      setRunning(false)
    }

    void (async () => {
      // Only the active step is "running": future steps stay
      // not-checked until their turn really arrives. Once the run completes
      // no "running" may remain (stuck-spinner regression).
      setStates({ key: "running", manifest: "idle", poster: "idle" })
      setGuides({ key: null, manifest: null, poster: null })

      // --- Step 1: effective TMDB key (server-side, never exposed). ---
      let keyOutcome: KeyCheckOutcome = { pass: false, guideKey: "ui.installCheckGuideNetwork" }
      {
        const { signal, cancel } = stepSignal(runController.signal, KEY_TIMEOUT_MS)
        try {
          const ctx = parseInstallCheckContext(manifestUrl)
          if (!ctx) throw new Error("foreign manifest url")
          const headers: Record<string, string> = { "Content-Type": "application/json" }
          if (ctx.u) Object.assign(headers, userAuthHeaders(ctx.u))
          const res = await fetch("/api/diagnostics/install-key", {
            method: "POST",
            headers,
            body: JSON.stringify({ u: ctx.u, config: ctx.config }),
            signal,
            cache: "no-store",
          })
          if (!alive()) return
          if (res.status === 401) {
            keyOutcome = { pass: false, guideKey: "ui.installCheckGuideUnauthorized" }
          } else if (res.status === 429) {
            keyOutcome = { pass: false, guideKey: "ui.installCheckGuideNetwork" }
          } else {
            const data = (await res.json().catch(() => null)) as {
              ok?: boolean
              code?: string
            } | null
            if (res.ok && data?.ok === true) {
              keyOutcome = { pass: true, guideKey: null }
            } else if (data?.code === "missing") {
              keyOutcome = { pass: false, guideKey: "ui.installCheckGuideKeyMissing" }
            } else if (data?.code === "unauthorized") {
              keyOutcome = { pass: false, guideKey: "ui.installCheckGuideUnauthorized" }
            } else if (data?.code === "bad-config") {
              keyOutcome = { pass: false, guideKey: "ui.installCheckGuideManifest" }
            } else if (data?.code === "invalid") {
              keyOutcome = { pass: false, guideKey: "ui.installCheckGuideKeyInvalid" }
            } else {
              keyOutcome = { pass: false, guideKey: "ui.installCheckGuideNetwork" }
            }
          }
        } catch {
          if (!alive()) return
          // Run abort (context changed or modal closed): no outcome.
          if (runController.signal.aborted) return
          // Own-cap timeout, network, unreadable JSON: retryable.
          keyOutcome = { pass: false, guideKey: "ui.installCheckGuideNetwork" }
        } finally {
          cancel()
        }
        if (!alive()) return
        setStep("key", keyOutcome.pass ? "pass" : "fail", keyOutcome.guideKey)
      }

      // --- Step 2: selected manifest (same URL as the installation). ---
      // Exact fetch of the selected URL (including ?mode=search/catalogs).
      let manifestOk = false
      setStep("manifest", "running")
      {
        const { signal, cancel } = stepSignal(runController.signal, MANIFEST_TIMEOUT_MS)
        try {
          const ctx = parseInstallCheckContext(manifestUrl)
          if (!ctx) throw new Error("foreign manifest url")
          const res = await fetch(manifestUrl, {
            headers: { Accept: "application/json" },
            signal,
            cache: "no-store",
          })
          if (!alive()) return
          if (!res.ok) {
            setStep("manifest", "fail", "ui.installCheckGuideManifest")
          } else {
            const data: unknown = await res.json().catch(() => null)
            if (!alive()) return
            if (isInstallCheckManifestValid(data)) {
              manifestOk = true
              setStep("manifest", "pass", null)
            } else {
              setStep("manifest", "fail", "ui.installCheckGuideManifest")
            }
          }
        } catch (e) {
          if (!alive()) return
          if (runController.signal.aborted) return
          // Timeout/network → retryable; anything else (never expected here) → manifest guide.
          setStep(
            "manifest",
            "fail",
            isAbortError(e) || e instanceof TypeError
              ? "ui.installCheckGuideNetwork"
              : "ui.installCheckGuideManifest",
          )
        } finally {
          cancel()
        }
        if (!alive()) return
      }

      // --- Step 3: real poster from the same shared endpoint. ---
      // Only with a readable manifest: without it the installation cannot be
      // evaluated and the probe would stay orphaned (poster stays not-checked,
      // never spinner). A wrong key does NOT stop the probe (it still needs
      // verification), but alone it is never enough for success.
      if (!manifestOk) {
        setStep("poster", "idle")
        finish()
        return
      }
      setStep("poster", "running")
      {
        const { signal, cancel } = stepSignal(runController.signal, POSTER_TIMEOUT_MS)
        try {
          const ctx = parseInstallCheckContext(manifestUrl)
          if (!ctx) throw new Error("foreign manifest url")
          const params = new URLSearchParams()
          params.set("rv", RENDER_VERSION)
          if (ctx.u) params.set("u", ctx.u)
          if (ctx.config) params.set("config", ctx.config)
          const probeUrl = `${window.location.origin}/api/poster/${PROBE_MEDIA_TYPE}/${PROBE_TMDB_ID}?${params.toString()}`
          const res = await fetch(probeUrl, { signal, cache: "no-store" })
          if (!alive()) return
          const contentType = res.headers.get("content-type") ?? ""
          if (!res.ok || !contentType.includes("image/")) {
            setStep("poster", "fail", "ui.installCheckGuidePoster")
          } else {
            const buf = new Uint8Array(await res.arrayBuffer())
            if (!alive()) return
            // Zero size = truncated body. Then the format sanity check, then
            // the verdict ONLY from the real decode: an MP4 with an ftyp box or
            // a corrupt PNG under an image/ content-type stay fail, a small
            // but decodable poster is pass. Never ready on bytes alone.
            if (buf.byteLength < MIN_IMAGE_BYTES || !isInstallCheckImagePayload(buf)) {
              setStep("poster", "fail", "ui.installCheckGuidePoster")
            } else {
              let decoded = false
              try {
                decoded = await decodeInstallCheckImage(buf, contentType, signal)
              } catch (e) {
                if (!alive()) return
                if (runController.signal.aborted || isAbortError(e)) {
                  setStep("poster", "fail", "ui.installCheckGuideNetwork")
                  cancel()
                  return
                }
                decoded = false
              }
              if (!alive()) return
              if (decoded) {
                setStep("poster", "pass", null)
              } else {
                setStep("poster", "fail", "ui.installCheckGuidePoster")
              }
            }
          }
        } catch (e) {
          if (!alive()) return
          if (runController.signal.aborted) return
          // Timeout/network → retryable; non-image payload → poster guide.
          setStep(
            "poster",
            "fail",
            isAbortError(e) || e instanceof TypeError
              ? "ui.installCheckGuideNetwork"
              : "ui.installCheckGuidePoster",
          )
        } finally {
          cancel()
        }
        if (!alive()) return
      }

      finish()
    })()
  }, [manifestUrl, setStep])

  const allPass = STEPS.every((s) => states[s] === "pass")
  const anyFail = STEPS.some((s) => states[s] === "fail")
  const completed = allPass || anyFail

  return (
    <section
      data-testid="install-check-section"
      aria-labelledby="install-check-title"
      className="border border-white/10 bg-white/[0.02] rounded-xl overflow-hidden"
    >
      <div className="px-3.5 py-3 space-y-2.5">
        <h3 id="install-check-title" dir="auto" className="text-xs sm:text-sm font-semibold text-zinc-200">
          {t("ui.installCheckTitle")}
        </h3>
        <p dir="auto" className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
          {t("ui.installCheckDesc")}
        </p>
        <button
          type="button"
          data-testid="install-check-run"
          onClick={run}
          disabled={running}
          className="w-full py-2 px-3 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-50 text-xs sm:text-sm font-medium text-zinc-200 hover:text-white flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          {running && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          <ShieldCheck className="w-3.5 h-3.5 text-accent-orange" aria-hidden="true" />
          <span>{t(running ? "ui.installCheckRunning" : completed ? "ui.installCheckRetry" : "ui.installCheckRun")}</span>
        </button>
        <div role="status" aria-live="polite">
          <ol className="space-y-1.5">
            {STEPS.map((id) => {
              const state = states[id]
              return (
                <li
                  key={id}
                  data-testid={`install-check-step-${id}`}
                  data-state={state}
                  className="flex items-start gap-2 text-xs sm:text-sm"
                >
                  <span aria-hidden="true" className="mt-0.5 shrink-0">
                    {state === "running" && <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />}
                    {state === "pass" && <Check className="w-4 h-4 text-emerald-400" />}
                    {state === "fail" && <X className="w-4 h-4 text-red-400" />}
                    {state === "idle" && <Circle className="w-4 h-4 text-zinc-600" />}
                  </span>
                  <span className="min-w-0">
                    <span dir="auto" className="text-zinc-200 font-medium">
                      {t(STEP_LABEL_KEYS[id])}
                      {": "}
                    </span>
                    <span className={state === "pass" ? "text-emerald-300" : state === "fail" ? "text-red-300" : "text-zinc-400"}>
                      {t(
                        state === "running"
                          ? "ui.installCheckRunning"
                          : state === "pass"
                            ? "ui.installCheckPassed"
                            : state === "fail"
                              ? "ui.installCheckFailed"
                              : "ui.installCheckNotChecked",
                      )}
                    </span>
                    {state === "fail" && guides[id] && (
                      <span dir="auto" className="block text-zinc-400 leading-relaxed">
                        {t(guides[id] as string)}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ol>
          {allPass && (
            <p data-testid="install-check-all-passed" dir="auto" className="mt-2 text-xs sm:text-sm text-emerald-300">
              {t("ui.installCheckAllPassed")}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
