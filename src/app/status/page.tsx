"use client"

import React, { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { RefreshCw } from "lucide-react"
import { t, getLang, setLang } from "@/lib/i18n"
import { APP_COMMIT, APP_VERSION } from "@/generated/app-version"

interface CheckResult {
  ok: boolean
  status: number
  time: number
  reason?: string
}

interface HealthData {
  status: string
  timestamp: string
  tmdb: {
    apiKey: boolean
    apiKeyLength: number
    trending: CheckResult
    search: CheckResult
    popular: CheckResult
    externalIds: CheckResult
  }
  streaming: {
    justwatch: CheckResult
    flixpatrol: CheckResult
  }
  storage: {
    mode: "kv" | "file"
    mappingsCount: number
    dataFileExists: boolean | null
  }
}

interface CacheTagEntry {
  tag: string
  count: number
}

interface CacheStatusData {
  totalEntries: number
  taggedEntries: CacheTagEntry[]
  untaggedEntries: number
  poster?: {
    requests: number
    hits: number
    renders: number
    errors: number
    hitRate: string
    hitRateNum: number
    formats: {
      jpeg: number
      webp: number
      avif: number
    }
    activeRenders: number
    queuedRenders: number
    maxConcurrent: number
  }
  tmdb?: {
    totalCalls: number
    cacheHits: number
    networkCalls: number
    cacheHitRate: string
    lastCallTime: string | null
  }
  system?: {
    sharp: {
      memory: {
        current: number
        high: number
        max: number
      }
      counters: {
        queue: number
        process: number
      }
      concurrency: number
      simd: boolean
    }
    memory: {
      rssMb: number
      heapUsedMb: number
      heapTotalMb: number
      externalMb: number
    }
    uptimeSeconds: number
  }
}

function StatusBadge({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-zinc-500 shadow-[0_0_6px_rgba(113,113,122,0.5)] mr-2 shrink-0" />
  }
  return ok
    ? <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)] mr-2 shrink-0" />
    : <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)] mr-2 shrink-0" />
}

function StatusRow({ label, ok, extra }: { label: string; ok: boolean | null; extra?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2 py-2 px-3 even:bg-white/[0.03] rounded-lg text-sm">
      <span className="flex items-center gap-2 text-zinc-300 min-w-0">
        <StatusBadge ok={ok} />
        <span className="truncate">{label}</span>
      </span>
      {extra && <span className="text-xs text-zinc-400 font-mono tabular-nums text-right">{extra}</span>}
    </div>
  )
}

export default function StatusPage() {
  const [data, setData] = useState<HealthData | null>(null)
  const [cacheStatus, setCacheStatus] = useState<CacheStatusData | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  // Fuori dal provider di traduzione: sincronizza la lingua salvata al mount
  // così la pagina non resta mai in italiano dopo un cambio lingua + refresh.
  const [, setLangTick] = useState(0)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("preferred_lang")
      if (saved && saved !== getLang()) {
        setLang(saved)
        setLangTick((n) => n + 1)
      }
    } catch {}
  }, [])

  async function loadCacheStatus() {
    try {
      const res = await fetch("/api/cache/status")
      if (!res.ok) { setCacheStatus(null); return }
      const body = await res.json()
      setCacheStatus(body)
    } catch {
      setCacheStatus(null)
    }
  }

  const loadHealth = useCallback(async () => {
    // La chiave TMDB è personale (localStorage) e la route /api/health la
    // accetta SOLO via header x-api-key: senza, tutti i check rispondono 401
    // e la pagina mostrerebbe punti rossi anche a servizi sani.
    const key = typeof window !== "undefined" ? (localStorage.getItem("tmdb_key") || "") : ""
    setLoading(true)
    setError("")
    try {
      const r = await fetch("/api/health", { headers: key ? { "x-api-key": key } : undefined })
      if (!r.ok && r.status !== 503) throw new Error("Errore " + r.status)
      const d = await r.json()
      setData(d)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
      setLastRefresh(new Date())
    }
  }, [])

  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [keyInput, setKeyInput] = useState("")

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await loadHealth()
      await loadCacheStatus()
    } finally {
      setRefreshing(false)
    }
  }, [loadHealth])

  useEffect(() => {
    void loadHealth()
    void loadCacheStatus()
  }, [loadHealth])

  // Auto-refresh SOLO metriche locali (/api/cache/status, zero upstream):
  // il full-check TMDB resta manuale (quota burn + 429). Default off.
  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => {
      void loadCacheStatus()
      setLastRefresh(new Date())
    }, 10000)
    return () => clearInterval(timer)
  }, [autoRefresh])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-accent transition-colors mb-6">{t("ui.statusBack")}</Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold mb-1">{t("ui.statusTitle")}</h1>
            <p className="text-xs text-zinc-500 font-mono" data-testid="status-build">
              v{APP_VERSION} · {APP_COMMIT}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            aria-label={t("ui.statusRefresh")}
            title={t("ui.statusRefresh")}
            className="shrink-0 w-9 h-9 rounded-xl bg-surface/80 border border-white/10 text-zinc-300 hover:text-white hover:border-accent-orange/40 flex items-center justify-center active:scale-95 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
          {lastRefresh && (
            <p className="text-[11px] text-zinc-500">
              {t("ui.statusUpdated", { time: lastRefresh.toLocaleTimeString(getLang()) })}
              <span className="ml-1.5 px-1.5 py-px rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                LIVE
              </span>
            </p>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={autoRefresh}
            onClick={() => setAutoRefresh((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <span aria-hidden="true" className={`relative w-8 h-[18px] rounded-full transition-colors ${autoRefresh ? "bg-accent-orange" : "bg-zinc-700"}`}>
              <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all ${autoRefresh ? "left-[16px]" : "left-[2px]"}`} />
            </span>
            {t("ui.statusAutoRefresh")}
          </button>
        </div>
        {data && !data.tmdb.apiKey && (
          <form
            className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              const v = keyInput.trim()
              if (!v) return
              try { localStorage.setItem("tmdb_key", v) } catch {}
              setKeyInput("")
              void handleRefresh()
            }}
          >
            <label htmlFor="status-tmdb-key" className="block text-[11px] font-semibold text-zinc-300">
              {t("ui.tmdbKey")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="status-tmdb-key"
                type="password"
                autoComplete="off"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={t("ui.tmdbKeyPlaceholder")}
                className="flex-1 min-w-0 bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-accent-orange/50"
              />
              <button
                type="submit"
                disabled={!keyInput.trim()}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-accent-orange text-white text-xs font-semibold hover:bg-accent-orange/90 active:scale-95 transition-all disabled:opacity-50"
              >
                {t("ui.save")}
              </button>
            </div>
            <p className="text-[10px] text-zinc-500">{t("ui.statusKeyShared")}</p>
          </form>
        )}
        {loading && <p className="text-zinc-400 mt-4">{t("ui.statusLoading")}</p>}
        {error && <p className="text-red-400 mt-4">{t("ui.statusError", { msg: error })}</p>}
        {data && (
          <div className="mt-6 space-y-6">
            <div className="surface-card border-white/10 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center gap-2 mb-3">
                <StatusBadge ok={data.tmdb.apiKey} />
                <h2 className="text-base font-semibold">{t("ui.statusTmdb")}</h2>
                {data.tmdb.apiKey && <span className="text-xs text-zinc-400">{t("ui.statusApiKeyLength", { count: data.tmdb.apiKeyLength })}</span>}
              </div>
              {data.tmdb.apiKey ? (
                <div className="space-y-1">
                  <StatusRow label={t("ui.statusTrending")} ok={data.tmdb.trending.ok} extra={<>{data.tmdb.trending.status} — {data.tmdb.trending.time}ms</>} />
                  <StatusRow label={t("ui.statusSearch")} ok={data.tmdb.search.ok} extra={<>{data.tmdb.search.status} — {data.tmdb.search.time}ms</>} />
                  <StatusRow label={t("ui.statusPopular")} ok={data.tmdb.popular.ok} extra={<>{data.tmdb.popular.status} — {data.tmdb.popular.time}ms</>} />
                  <StatusRow label={t("ui.statusExternalIds")} ok={data.tmdb.externalIds.ok} extra={<>{data.tmdb.externalIds.status} — {data.tmdb.externalIds.time}ms</>} />
                </div>
              ) : (
                <div className="space-y-1">
                  <StatusRow label={t("ui.statusTmdbKeyMissing")} ok={null} />
                </div>
              )}
            </div>

            <div className="surface-card border-white/10 rounded-2xl p-5 shadow-xl">
              <h2 className="text-base font-semibold mb-3">{t("ui.statusStreaming")}</h2>
              <div className="space-y-1">
                <StatusRow label={t("ui.statusJustwatch")} ok={data.tmdb.apiKey ? data.streaming.justwatch.ok : null} extra={data.tmdb.apiKey ? <>{data.streaming.justwatch.status} — {data.streaming.justwatch.time}ms</> : t("ui.statusTmdbKeyMissing")} />
                <StatusRow label={t("ui.statusFlixpatrol")} ok={data.tmdb.apiKey ? data.streaming.flixpatrol.ok : null} extra={data.tmdb.apiKey ? <>{data.streaming.flixpatrol.status} — {data.streaming.flixpatrol.time}ms</> : t("ui.statusTmdbKeyMissing")} />
              </div>
            </div>

            <div className="surface-card border-white/10 rounded-2xl p-5 shadow-xl">
              <h2 className="text-base font-semibold mb-3">{t("ui.statusStorage")}</h2>
              <div className="space-y-1">
                {data.storage.mode === "kv"
                  ? <StatusRow label={t("ui.statusStorageMode")} ok extra={t("ui.statusStorageKv")} />
                  : <>
                      <StatusRow label={t("ui.statusStorageMode")} ok={!!data.storage.dataFileExists} extra={t("ui.statusStorageFile")} />
                      <StatusRow label={t("ui.statusDataFile")} ok={!!data.storage.dataFileExists} extra={data.storage.dataFileExists ? t("ui.statusDataFileName") : t("ui.statusNotFound")} />
                    </>
                }
                <StatusRow label={t("ui.statusSavedPosters")} ok={data.storage.mappingsCount > 0 || data.storage.mode === "kv" || !data.storage.dataFileExists} extra={<>{t("ui.statusPosterCount", { count: data.storage.mappingsCount })}</>} />
              </div>
            </div>

            <div className="surface-card border-white/10 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold">{t("ui.statusSystem")}</h2>
                {data.tmdb.apiKey && (
                  <span className={`text-xs px-2 py-0.5 rounded-md border font-semibold ${
                    data.status === "healthy"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25 shadow-[0_0_12px_rgba(52,211,153,0.25)]"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/25 shadow-[0_0_12px_rgba(251,191,36,0.25)]"
                  }`}>
                    {data.status === "healthy" ? t("ui.statusHealthy") : t("ui.statusDegraded")}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                <StatusRow label={t("ui.statusOverall")} ok={data.tmdb.apiKey ? data.status === "healthy" : null} extra={data.tmdb.apiKey ? (data.status === "healthy" ? t("ui.statusHealthy") : t("ui.statusDegraded")) : t("ui.statusTmdbKeyMissing")} />
              </div>
            </div>

            {/* TMDB Quota & Telemetria */}
            {cacheStatus?.tmdb && (
              <div className="surface-card border-white/10 rounded-2xl p-5 shadow-xl">
                <h2 className="text-base font-semibold mb-3 flex items-center justify-between">
                  <span>{t("ui.statusTmdbTelemetry")}</span>
                  <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                    {t("ui.statusHitRate", { rate: cacheStatus.tmdb.cacheHitRate })}
                  </span>
                </h2>
                <div className="space-y-1">
                  <StatusRow label={t("ui.statusTmdbTotalCalls")} ok extra={cacheStatus.tmdb.totalCalls} />
                  <StatusRow label={t("ui.statusTmdbCacheHits")} ok extra={<>{cacheStatus.tmdb.cacheHits} ({cacheStatus.tmdb.cacheHitRate})</>} />
                  <StatusRow label={t("ui.statusTmdbNetworkCalls")} ok extra={cacheStatus.tmdb.networkCalls} />
                  {cacheStatus.tmdb.lastCallTime && (
                    <StatusRow label={t("ui.statusTmdbLastCall")} ok extra={new Date(cacheStatus.tmdb.lastCallTime).toLocaleTimeString(getLang())} />
                  )}
                </div>
              </div>
            )}

            {/* Poster Cache Hit Rate & Pipeline */}
            {cacheStatus?.poster && (
              <div className="surface-card border-white/10 rounded-2xl p-5 shadow-xl">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold">{t("ui.statusPosterHitRateTitle")}</h2>
                  <span className="text-xs px-2 py-0.5 rounded-md bg-accent-orange/15 text-accent-orange border border-accent-orange/30 font-semibold">
                    {t("ui.statusHitRate", { rate: cacheStatus.poster.hitRate })}
                  </span>
                </div>
                <div className="space-y-1">
                  <StatusRow label={t("ui.statusPosterRequests")} ok extra={cacheStatus.poster.requests} />
                  <StatusRow label={t("ui.statusPosterServedCache")} ok extra={<>{cacheStatus.poster.hits} ({cacheStatus.poster.hitRate})</>} />
                  <StatusRow label={t("ui.statusPosterRendersZero")} ok extra={cacheStatus.poster.renders} />
                  <StatusRow label={t("ui.statusPosterActiveSlots")} ok extra={<>{cacheStatus.poster.activeRenders} / {cacheStatus.poster.maxConcurrent} {t("ui.statusPosterQueued", { count: cacheStatus.poster.queuedRenders })}</>} />
                  
                  {/* Formati erogati: barra di distribuzione + conteggi */}
                  <div className="pt-2">
                    <span className="text-xs text-zinc-400 block mb-1.5">{t("ui.statusPosterFormatDist")}</span>
                    {(() => {
                      const f = cacheStatus.poster.formats
                      const total = f.webp + f.avif + f.jpeg
                      const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
                      return (
                        <>
                          <div className="flex h-2 rounded-full overflow-hidden bg-white/[0.06] mb-2" aria-hidden="true">
                            <div className="bg-accent-orange" style={{ width: `${pct(f.webp)}%` }} />
                            <div className="bg-emerald-500" style={{ width: `${pct(f.avif)}%` }} />
                            <div className="bg-zinc-500" style={{ width: `${pct(f.jpeg)}%` }} />
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400 font-mono tabular-nums">
                            <span>WebP <span className="text-accent-orange font-semibold">{f.webp} ({pct(f.webp)}%)</span></span>
                            <span>AVIF <span className="text-emerald-400 font-semibold">{f.avif} ({pct(f.avif)}%)</span></span>
                            <span>JPEG <span className="text-zinc-300 font-semibold">{f.jpeg} ({pct(f.jpeg)}%)</span></span>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* Memoria & Sharp Engine */}
            {cacheStatus?.system && (
              <div className="surface-card border-white/10 rounded-2xl p-5 shadow-xl">
                <h2 className="text-base font-semibold mb-3">{t("ui.statusMemoryTitle")}</h2>
                <div className="space-y-1">
                  <StatusRow label={t("ui.statusMemoryRss")} ok extra={`${cacheStatus.system.memory.rssMb} MB`} />
                  <StatusRow label={t("ui.statusMemoryHeap")} ok extra={`${cacheStatus.system.memory.heapUsedMb} / ${cacheStatus.system.memory.heapTotalMb} MB`} />
                  <StatusRow label={t("ui.statusMemoryBuffer")} ok extra={`${(cacheStatus.system.sharp.memory.current / 1024 / 1024).toFixed(1)} MB (${t("ui.statusMemoryBufferMax", { max: `${(cacheStatus.system.sharp.memory.max / 1024 / 1024).toFixed(0)} MB` })})`} />
                  <StatusRow label={t("ui.statusMemorySharpSimd")} ok extra={t("ui.statusSharpSimdThreads", { concurrency: cacheStatus.system.sharp.concurrency, simd: cacheStatus.system.sharp.simd ? t("ui.statusSimdActive") : t("ui.statusSimdInactive") })} />
                  <StatusRow label={t("ui.statusMemoryUptime")} ok extra={t("ui.statusUptimeValue", { min: Math.floor(cacheStatus.system.uptimeSeconds / 60), sec: cacheStatus.system.uptimeSeconds })} />
                </div>
              </div>
            )}

            <div className="surface-card border-white/10 rounded-2xl p-5 shadow-xl">
              <h2 className="text-base font-semibold mb-3">{t("ui.statusCache")}</h2>
              {cacheStatus ? (
                <div className="space-y-1">
                  <StatusRow label={t("ui.statusCacheTotal")} ok extra={cacheStatus.totalEntries} />
                  <StatusRow label={t("ui.statusCacheUntagged")} ok extra={cacheStatus.untaggedEntries} />
                  {cacheStatus.taggedEntries.length > 0 ? (
                    <div className="pt-2 flex flex-wrap gap-2">
                      {cacheStatus.taggedEntries.map((entry) => (
                        <span key={entry.tag} className="px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
                          {entry.tag}: <span className="text-white font-semibold">{entry.count}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500">{t("ui.statusCacheEmpty")}</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-zinc-500">{t("ui.statusCacheUnavailable")}</p>
              )}
            </div>

            <p className="text-xs text-zinc-500 text-center">{t("ui.statusUpdated", { time: new Date(data.timestamp).toLocaleString(getLang()) })}</p>
          </div>
        )}
      </div>
    </div>
  )
}
