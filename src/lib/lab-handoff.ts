import { isBadgeFamilyId, type BadgeFamilyId, type BadgeTarget } from "./badge-preset"
import { isPresetTargetCompatibleWithFamily } from "./badge-preset-family-transport"

// ---------------------------------------------------------------------------
// Lab ⇄ title handoff (pure, client/server-safe, zero I/O).
//
// The editor deep-links a family into the Lab ("Customize in Lab") with
// `family` + `source=native` + the safe namespace and a validated same-origin
// `return` carrying the title/shape context; the Lab hands the saved binding
// back via `fam` + `preset` + `rev` appended to that return URL. Both sides
// validate fail-closed: no open redirects (relative paths only), no unbounded
// user query (bounded lengths, known families, strict id/rev formats —
// enforced again at each consumer), no mapping writes before the explicit
// Save (the editor stages only; the save merges staged over stored).
// ---------------------------------------------------------------------------

/**
 * Same-origin handoff return validator (fail-closed, no open redirects): only
 * relative configure paths (`/…`, never `//…`, no backslashes, no scheme,
 * bounded length). The title/shape context travels inside the path query.
 */
export function isValidLabHandoffReturn(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return false
  if (!value.startsWith("/") || value.startsWith("//")) return false
  if (value.includes("\\") || /[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return false
  return true
}

/**
 * Family the Lab "Use for title" hands back: the deep-linked family when it
 * is compatible with the saved preset target, else the saved target itself
 * when it is a family (the legacy `top`/`genre` slots keep rendering the
 * singleton, never a family). Anything else = no handoff (null, never a
 * mismatched design).
 */
export function resolveHandoffFamily(
  deepFamily: BadgeFamilyId | null | undefined,
  savedTarget: BadgeTarget | string | null | undefined,
): BadgeFamilyId | null {
  if (
    deepFamily &&
    isBadgeFamilyId(deepFamily) &&
    isPresetTargetCompatibleWithFamily(savedTarget, deepFamily)
  ) {
    return deepFamily
  }
  if (isBadgeFamilyId(savedTarget)) return savedTarget
  return null
}

/**
 * Append the staged binding to a validated return URL (null = no handoff).
 * The return URL is revalidated here: an invalid return never produces a URL.
 */
export function buildHandoffUrl(
  returnUrl: string | null | undefined,
  family: BadgeFamilyId | null | undefined,
  id: string | null | undefined,
  rev: string | null | undefined,
): string | null {
  if (!isValidLabHandoffReturn(returnUrl)) return null
  if (!isBadgeFamilyId(family) || typeof id !== "string" || id.length === 0) return null
  const sep = returnUrl.includes("?") ? "&" : "?"
  const sp = new URLSearchParams({
    fam: family,
    preset: id,
    ...(rev ? { rev } : {}),
  })
  return `${returnUrl}${sep}${sp.toString()}`
}

/**
 * Same-origin Lab return path for the title editor (pure): the pathname
 * carrying the title/shape context plus the current namespace query (`u`)
 * when the pathname itself is not namespaced (`/u/<uuid>/…`). Dropping `u`
 * would return to the global space and lose the mapping/keys.
 */
export function buildLabReturnPath(args: {
  pathname: string
  search?: string | null
  mediaType?: string | null
  tmdbId?: number | null
  shape?: "poster" | "landscape" | null
}): string {
  const { pathname, search, mediaType, tmdbId, shape } = args
  const titlePart = `title=${mediaType && tmdbId ? `${mediaType}:${tmdbId}` : ""}&shape=${shape === "landscape" ? "landscape" : "poster"}`
  let uPart = ""
  try {
    const queryU = search ? new URLSearchParams(search).get("u") : null
    if (!pathname.startsWith("/u/") && queryU) uPart = `&u=${encodeURIComponent(queryU)}`
  } catch {
    /* non-browser: no namespace context */
  }
  return `${pathname}?${titlePart}${uPart}`
}

/**
 * Community library href preserving the current namespace (pure): the owner
 * id wins, else the query `u` when present (query-namespaced spaces), else
 * the bare library path.
 */
export function buildCommunityHref(userId: string | null | undefined, search?: string | null): string {
  if (userId) return `/presets?u=${encodeURIComponent(userId)}`
  try {
    const queryU = search ? new URLSearchParams(search).get("u") : null
    return queryU ? `/presets?u=${encodeURIComponent(queryU)}` : "/presets"
  } catch {
    return "/presets"
  }
}
