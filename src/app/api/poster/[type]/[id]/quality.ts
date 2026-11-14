// Qualità e formati A/V del render (fase K della poster route): DB locale AV
// specs > JustWatch live > demo, soglia minima, selezione dei marchi formato
// (query/mapping/defaults) e campioni demo. Corpo spostato da route.ts
// invariato.

import type { NextRequest } from "next/server"
import type { Mapping } from "@/lib/types"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { StreamQualityResult } from "@/lib/stream-quality"
import { applyMinQuality, type StreamQuality } from "@/lib/quality-tiers"
import { lookupAVSpecs } from "@/lib/av-specs"
import { isQualityMarkId } from "@/lib/quality-badge-pack"
import { resolveEffectiveQualityMarks } from "@/lib/quality-marks-selection"
import { DEMO_SAMPLE_QUALITY, sampleDemoVideoFormats } from "@/lib/demo-samples"
import type { PosterTitleMeta } from "./sources"

/** Input della risoluzione qualità/formati. */
export interface RenderQualityContext {
  readonly req: NextRequest
  readonly sd: ServerDefaults
  readonly earlyEffSd: ServerDefaults
  readonly earlyEffMapping: Mapping | null
  readonly qQualityParam: string | null
  readonly liveQuality: StreamQuality | null
  readonly liveQualityResult: StreamQualityResult
  readonly minQuality: StreamQuality
  readonly badgeQuality: boolean
  readonly demoSamples: boolean
}

export interface RenderQuality {
  finalQuality: StreamQuality | null
  finalVideoFormats: string[] | null
}

export function resolveRenderQuality(ctx: RenderQualityContext, titleMeta: PosterTitleMeta): RenderQuality {
  const {
    req, sd, earlyEffSd, earlyEffMapping, qQualityParam, liveQuality, liveQualityResult,
    minQuality, badgeQuality, demoSamples,
  } = ctx
  // Database locale AV specs (prioritario per 4K e formati, zero rete):
  const localSpec = lookupAVSpecs(titleMeta.imdbId)
  // Soglia minima qualità all'uscita: la cache upstream (`resolveStreamQuality`)
  // tiene sempre il raw — qui si sopprime solo il badge sotto soglia.
  // Demo samples (Settings preview only): a demo tier only when no real
  // source resolves one (formats are handled separately below).
  const effectiveRawQuality = qQualityParam || localSpec?.quality || liveQuality || (demoSamples && badgeQuality ? DEMO_SAMPLE_QUALITY : null)
  const finalQuality = applyMinQuality(
    effectiveRawQuality as StreamQuality | null,
    minQuality,
  )

  // Formati A/V built-in (dv, atmos, imax, hdr, hdr10plus): sempre
  // automatici dalle specifiche reali del film (localSpec, poi JW live) — mai un logo che
  // il titolo non possiede. I marchi del pack (`QualityMarkId` non built-in)
  // non hanno dati per-titolo: entrano SOLO quando la selezione esplicita
  // (query/mapping, o defaults non vuoti) li contiene, quindi l'assenza di
  // selezione resta byte-identica allo storico.
  // Precedenza come la qualità: DB locale (curato) > JustWatch live.
  const availableFormats = localSpec?.formats ?? liveQualityResult.formats ?? []
  const qFormatsRaw = req.nextUrl.searchParams.get("formats")
  const qFormats = qFormatsRaw !== null
    ? (qFormatsRaw === "none" || qFormatsRaw === "" ? [] : qFormatsRaw.split(",").map((s) => s.trim().toLowerCase()).filter(isQualityMarkId))
    : null
  const allowedFormats = earlyEffSd.videoFormats ?? sd.videoFormats
  const requestedFormats = qFormats ?? earlyEffMapping?.videoFormats ?? null
  const selectedFormats = requestedFormats ?? (allowedFormats && allowedFormats.length > 0 ? allowedFormats : null)
  const cappedFormats = resolveEffectiveQualityMarks({
    availableFormats,
    requestedFormats,
    allowedFormats,
  })
  // Demo samples (Settings preview only): every ENABLED mark is demoed, so a
  // partial real spec (e.g. DV only) still shows the other enabled styles.
  // The enabled selection is the only gate — `formats=none`/unchecked
  // formats demo nothing, a restricted list demos exactly that list — and it
  // applies to the real specs too. The renderer keeps its own precedence
  // rules (HDR10+ replaces HDR, DV+Atmos merge into one lockup).
  const sampledFormats = demoSamples
    ? sampleDemoVideoFormats(availableFormats, selectedFormats)
    : null
  const finalVideoFormats = sampledFormats && sampledFormats.length > 0
    ? sampledFormats
    : (cappedFormats.length > 0 ? cappedFormats : null)

  return { finalQuality, finalVideoFormats }
}
