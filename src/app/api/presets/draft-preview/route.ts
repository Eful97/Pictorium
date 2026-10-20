import { NextRequest } from "next/server"
import { z } from "zod"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import {
  checkUserAuth,
  extractUserParam,
  getScopedUserId,
  invalidUserResponse,
  isMultiUserEnabled,
  userAuthResponse,
  userRateLimitKey,
} from "@/lib/user-auth"
import { checkAdminToken, isSameOrigin, originMismatchResponse } from "@/lib/auth"
import { verifySessionFromRequestSync } from "@/lib/pin-auth"
import { isPreviewAuthRequired } from "@/lib/poster-params-hardening"
import { readJsonBody, BodyTooLargeError, InvalidJsonBodyError } from "@/lib/read-body"
import {
  BADGE_TARGETS,
  badgeDesignSchema,
  houseBadgeSchema,
  houseStyleAllowlistForTarget,
  normalizeBadgePreset,
  type BadgePreset,
} from "@/lib/badge-preset"
import { isTechnicalFamilyId } from "@/lib/badge-preset-technical"
import { renderTechnicalPresetPreviewSvg } from "@/lib/badge-preset-technical-preview"
import { resolveBadgeText } from "@/lib/badge-variables"
import { buildCustomBadgeSvg, buildHousePresetSvg, HOUSE_EXTRA_PREVIEW_LABEL } from "@/lib/badge-svg-shared"

/**
 * POST /api/presets/draft-preview — live preview of an UNSAVED Badge Lab
 * draft (technical raster families: network/separateRatings/customRatings
 * have no sync browser builder — the Lab cannot render brand artwork itself).
 *
 * The SAME server renderers as the saved preview (`preview.svg`) and the
 * poster run here, fed with the same deterministic fixtures (zero upstream
 * fetch, zero store reads, zero store writes): the thumbnail reflects the
 * current draft instead of the last saved preset. The request carries only
 * the validated declarative payload (variant/target/design/house — the same
 * schemas the store validates); credentials, user ids and arbitrary SVG are
 * never accepted. Bounded (16KB body, presets rate-limit bucket, same-origin
 * POST, no-store response, fail-closed 400 on any invalid payload).
 *
 * Authorization follows the preview policy (`isPreviewAuthRequired`): on
 * public/multi-user instances anonymous drafts are denied BEFORE any raster
 * work (scoped `?u=` alone never authenticates); local single-user instances
 * stay open so the Lab works without login. The `u` query alone also never
 * selects a rate-limit bucket: only a request authenticated for that
 * namespace earns the scoped bucket, everyone else shares the IP bucket.
 */
const MAX_DRAFT_BODY_BYTES = 16 * 1024

const draftPayloadSchema = z.strictObject({
  variant: z.enum(["custom", "house"]),
  target: z.enum(BADGE_TARGETS),
  design: badgeDesignSchema.optional(),
  house: houseBadgeSchema.optional(),
})

/**
 * Accepted request envelope: either the bare payload or exactly
 * `{ preset: <payload> }`. Both branches are strict, so unknown envelope
 * fields (e.g. `{ preset, junk }`) fail closed instead of being ignored.
 */
const draftEnvelopeSchema = z.strictObject({ preset: draftPayloadSchema })
type DraftPayload = z.infer<typeof draftPayloadSchema>

function parseDraftBody(body: unknown): DraftPayload | null {
  const asEnvelope = draftEnvelopeSchema.safeParse(body)
  if (asEnvelope.success) return asEnvelope.data.preset
  const asBare = draftPayloadSchema.safeParse(body)
  if (asBare.success) return asBare.data
  return null
}

/** Small JSON denial with the same CORS + no-store posture as the renders. */
function draftJsonError(message: string, status: number): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    },
  )
}

/** Shared denial helpers carry no cache headers: pin them to no-store. */
function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store")
  return res
}

/**
 * Unlocked editor session (PIN/admin cookie or admin token). Sync and free
 * of I/O beyond the cached config — same shape as the poster preview gate.
 */
function hasUnlockedDraftSession(req: NextRequest): boolean {
  try {
    return verifySessionFromRequestSync(req) || checkAdminToken(req)
  } catch {
    return false
  }
}

const PREVIEW_CONTEXT = {
  rating: "8.5",
  year: "2024",
  genre: "Drama",
  rank: "3",
  imdb: "tt1234567",
  tmdb: "12345",
} as const

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`

export async function POST(req: NextRequest) {
  const rawUser = extractUserParam(req)
  if (rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)) {
    return noStore(invalidUserResponse())
  }
  // Bucket selection is earned by authentication, never by syntax: a
  // syntactically valid `u` alone keeps the caller on the shared IP bucket,
  // so spoofed namespaces cannot multiply quota or single out a victim's
  // bucket. Only a request authenticated for the claimed namespace earns
  // the scoped (IP+UUID) bucket.
  const claimed = getScopedUserId(rawUser)
  const authed = claimed ? await checkUserAuth(req, claimed) : false
  const scoped = authed && claimed ? claimed : null
  const rl = await rateLimit(scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req), "presets")
  if (!rl.ok) return noStore(rateLimitResponse(rl.retAfter))
  if (!isSameOrigin(req)) return noStore(originMismatchResponse())
  // Public/multi-user instances follow the preview authorization policy:
  // anonymous draft renders are denied BEFORE any raster work (fail-closed,
  // no secrets leak in the denial). Local single-user instances stay open.
  if (isPreviewAuthRequired() && !scoped && !hasUnlockedDraftSession(req)) {
    return noStore(userAuthResponse())
  }
  let body: unknown
  try {
    body = await readJsonBody(req, MAX_DRAFT_BODY_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return draftJsonError("Request body too large", 413)
    if (e instanceof InvalidJsonBodyError) return draftJsonError("Invalid JSON body", 400)
    return draftJsonError("Invalid JSON body", 400)
  }
  const payload = parseDraftBody(body)
  if (!payload) return draftJsonError("Invalid draft payload", 400)
  const { variant, target, design, house } = payload
  if (variant === "house" && !house) return draftJsonError("Invalid draft payload", 400)
  if (variant === "custom" && !design) return draftJsonError("Invalid draft payload", 400)
  // Fail-closed style/target gate (defense in depth next to the store
  // schema): a house style from another family 400s here instead of ever
  // rendering (or placeholdering) a mismatched draft.
  if (variant === "house" && house) {
    const allowed = houseStyleAllowlistForTarget(target)
    if (!allowed || !(allowed as readonly string[]).includes(house.style)) {
      return draftJsonError("Invalid draft payload", 400)
    }
  }
  // Render-only document (never stored): fixed placeholder identity, revision
  // recomputed from the payload so the ETag still pins the exact content.
  let preset: BadgePreset
  try {
    preset = normalizeBadgePreset({
      version: 1,
      id: "draft0001",
      ownerUuid: "00000000-0000-0000-0000-000000000000",
      target,
      visibility: "private",
      metadata: { name: "draft", tags: [] },
      variant,
      ...(variant === "house" ? { house } : { design }),
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      revision: "00000000",
    })
  } catch {
    return draftJsonError("Invalid draft payload", 400)
  }
  if (isTechnicalFamilyId(preset.target)) {
    const svg = await renderTechnicalPresetPreviewSvg(preset).catch(() => null)
    return new Response(svg ?? PLACEHOLDER_SVG, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store",
        ETag: `"draft-${preset.revision}"`,
      },
    })
  }
  const svg =
    preset.variant === "house"
      ? buildHousePresetSvg(preset, PREVIEW_CONTEXT, 380, {
          topLight: false,
          bottomLight: false,
          accentColor: "#555555",
        }, preset.target === "extra" ? "extra" : null, HOUSE_EXTRA_PREVIEW_LABEL)?.svg ?? null
      : (() => {
          const text = resolveBadgeText(preset.design?.text.template ?? "", PREVIEW_CONTEXT)
          return preset.design ? buildCustomBadgeSvg(preset.design, text).svg : null
        })()
  return new Response(svg ?? PLACEHOLDER_SVG, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
      ETag: `"draft-${preset.revision}"`,
    },
  })
}
