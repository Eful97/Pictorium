/**
 * Pure, client-safe builder for the "Suggest filler correction" prototype.
 *
 * The in-app flow never calls GitHub: it only builds a prefilled
 * `issues/new` URL that the USER opens and submits under their own GitHub
 * account. No token, no server fetch, no auto-created issue/PR, no spam
 * vector: the review/submit step is the user's, and the repository audit
 * trail is native.
 *
 * Gate: disabled by default (opt-in). The build must set an explicit
 * `NEXT_PUBLIC_PICTORIUM_FILLER_CORRECTION=1` to show the panel; absent, empty
 * or any other value keeps the prototype hidden.
 *
 * The `body` query parameter reproduces the markdown sections GitHub's
 * `add-series.yml` form generates on submit, so the public validator bot
 * (`validate-issue.mjs`) parses the same body. GitHub issue FORMS do not
 * expose per-field prefill query parameters; the form URL still carries
 * `template`, while `body` is the documented fallback (the user pastes it if
 * GitHub opens the empty form). The user submits; nothing is automated.
 *
 * The single-episode builder and the multi-episode bulk builder share the
 * same origin/attestation contract. The bulk builder auto-compresses filler
 * and mixed ranges by proposed type, prefills the episode titles table and
 * fails closed above 50 episodes or above the GitHub-safe URL length.
 */
import {
  sanitizeEpisodeFillerStatus,
  type EpisodeFillerStatus,
} from "@/lib/episode-stills"

export const FILLER_CORRECTION_REPO = "Eful97/pictorium-anime-filler-data"
export const FILLER_CORRECTION_TEMPLATE = "add-series.yml"
export const FILLER_CORRECTION_ORIGIN = "pictorium-in-app"
export const FILLER_CORRECTION_DIRECT_VIEWING = "Watched it myself (direct viewing)"
/** Same option labels as the public `add-series.yml` Source dropdown. */
export const FILLER_CORRECTION_SOURCES = [
  FILLER_CORRECTION_DIRECT_VIEWING,
  "Fandom XML dump (CC BY-SA; link required)",
  "Crucible Guides (CC BY-SA 4.0; QA)",
  "Other clean source (citation and license required)",
] as const
export type FillerCorrectionSource = (typeof FILLER_CORRECTION_SOURCES)[number]

/**
 * Opt-in gate (build-time public env). Only an explicit `1` enables the
 * in-app panel: absent/empty/other values keep it hidden, so the prototype is
 * never exposed by default.
 */
export function isFillerCorrectionPrototypeEnabled(
  raw: string | undefined = process.env.NEXT_PUBLIC_PICTORIUM_FILLER_CORRECTION,
): boolean {
  return typeof raw === "string" && raw.trim() === "1"
}

export function sanitizeFillerCorrectionSource(raw: unknown): FillerCorrectionSource | null {
  return typeof raw === "string" &&
    (FILLER_CORRECTION_SOURCES as readonly string[]).includes(raw)
    ? (raw as FillerCorrectionSource)
    : null
}

/** Maximum selected episodes per prefilled issue (keeps the URL under the cap). */
export const MAX_BULK_CORRECTION_EPISODES = 50
/** GitHub `issues/new` URLs are unreliable past ~8 KB: fail closed instead. */
export const MAX_FILLER_CORRECTION_URL_LENGTH = 8000

export interface FillerCorrectionIssueInput {
  /** Visible series title (English display title preferred). */
  readonly title: string
  /** TMDB series id (the identity Pictorium already knows). */
  readonly tmdbId: number
  /** MAL id when the loaded title carries one (`anime_ids.mal[0]`). */
  readonly malId?: number | null
  /** Standard TMDB season/episode of the correction. */
  readonly season: number
  readonly episode: number
  /** Absolute episode when known (regular-season offsets), else null. */
  readonly absoluteEpisode?: number | null
  /** Regular-season episode count when known (form field N). */
  readonly totalEpisodes?: number | null
  /** Real current classification (null = unknown/uncovered). */
  readonly currentStatus?: EpisodeFillerStatus | null
  /** Proposed classification. Null is allowed only when current is known. */
  readonly proposedStatus?: EpisodeFillerStatus | null
  /** Free-text "because" (single line, bounded). */
  readonly reason?: string | null
  /** Attestation checkbox. In-app origin defaults it to true (watched). */
  readonly watched: boolean
  /** Required when `watched` is false; ignored for direct viewing. */
  readonly source?: string | null
  /** Optional citation/notes for a non-direct source. */
  readonly sourceNotes?: string | null
}

/** Single-line, bounded user text: cannot inject body section headings. */
export function sanitizeCorrectionText(raw: unknown, maxLength = 600): string {
  if (typeof raw !== "string") return ""
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

function positiveInt(raw: unknown): number | null {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null
}

function section(label: string, value: string): string {
  const text = value.trim()
  return `### ${label}\n\n${text || "_No response_"}\n`
}

/**
 * Markdown body mirroring the issue-form output. Exported so the URL builder
 * and the tests share one representation.
 */
export function buildFillerCorrectionIssueBody(
  input: FillerCorrectionIssueInput,
  resolved?: {
    proposed: EpisodeFillerStatus
    episode: number
    n: number
    source: FillerCorrectionSource | null
  },
): string {
  const proposed = resolved?.proposed ?? sanitizeEpisodeFillerStatus(input.proposedStatus)
  if (!proposed) throw new Error("proposed classification is required")
  const episode = resolved?.episode ?? positiveInt(input.absoluteEpisode) ?? input.episode
  const n = resolved?.n ?? Math.max(positiveInt(input.totalEpisodes) ?? 0, episode)
  const current = sanitizeEpisodeFillerStatus(input.currentStatus)
  const watched = input.watched === true
  const source = watched ? FILLER_CORRECTION_DIRECT_VIEWING : resolved?.source ?? null
  const reason = sanitizeCorrectionText(input.reason)
  const notes = sanitizeCorrectionText(input.sourceNotes)

  // One episode is represented as a single value in the matching list; canon
  // proposals use `none` on both lists (the episode is claimed canon).
  const fillerText = proposed === "filler" ? String(episode) : "none"
  const mixedText = proposed === "mixed" ? String(episode) : "none"

  const attribution = [
    `Origin: ${FILLER_CORRECTION_ORIGIN}`,
    `Watched: ${watched ? "yes" : "no"}`,
    `Method: ${watched ? "direct-viewing" : "external-source"}`,
    `Suggestion for S${input.season}:E${input.episode} (TMDB ${input.tmdbId}).`,
    notes,
  ]
    .filter((line) => line.length > 0)
    .join("\n")

  const maintainerNotes = [
    `Proposed: ${proposed}${reason ? ` because ${reason}` : ""}`,
    `Origin: Pictorium in-app (S${input.season}:E${input.episode}, TMDB ${input.tmdbId}, current fill: ${current ?? "unknown"})`,
    watched ? "I watched this episode (direct viewing attestation)." : "",
    notes,
  ]
    .filter((line) => line.length > 0)
    .join("\n")

  const confirmations = [
    "- [x] This issue covers exactly one series.",
    "- [x] I did not copy from Anime Filler List (AFL) or skipthefiller.com.",
    "- [x] The ranges and N cover the same run (or the declared ongoing window); unlisted episodes are canon according to the source.",
    "- [x] I understand that a maintainer must review the identity, TMDB sum, source and license before publication, and that accepted data is CC BY-SA 4.0.",
  ].join("\n")

  return [
    section("Series title", sanitizeCorrectionText(input.title, 200)),
    section("MyAnimeList ID (optional)", positiveInt(input.malId) ? String(input.malId) : ""),
    section("Total episodes N", String(n)),
    section("Filler ranges", fillerText),
    section("Mixed ranges (optional)", mixedText),
    section("Source", watched ? FILLER_CORRECTION_DIRECT_VIEWING : source ?? ""),
    section("Source / attribution", attribution),
    section("Ongoing or partial?", "No, the run is complete for this list"),
    section("Notes for the maintainer (optional)", maintainerNotes),
    section("Confirmations", confirmations),
  ].join("\n")
}

/**
 * Full prefilled GitHub URL. Returns null when the correction would produce an
 * invalid issue: missing title/identity, unknown episode with no proposed type,
 * or an unchecked attestation without a selected clean source.
 */
export function buildFillerCorrectionIssueUrl(input: FillerCorrectionIssueInput): string | null {
  const title = sanitizeCorrectionText(input.title, 200)
  const tmdbId = positiveInt(input.tmdbId)
  const season = Number.isSafeInteger(input.season) && input.season >= 0 ? input.season : null
  const episode = positiveInt(input.episode)
  if (!title || tmdbId === null || season === null || episode === null) return null

  const current = sanitizeEpisodeFillerStatus(input.currentStatus)
  const proposed = sanitizeEpisodeFillerStatus(input.proposedStatus) ?? current
  // Unknown episode: the user MUST choose the proposed type (never invented).
  if (!proposed) return null

  const watched = input.watched === true
  const source = watched
    ? FILLER_CORRECTION_DIRECT_VIEWING
    : sanitizeFillerCorrectionSource(input.source)
  // Unchecked attestation: a clean source is mandatory (fail-closed).
  if (!source) return null

  const absolute = positiveInt(input.absoluteEpisode)
  const correctionEpisode = absolute ?? episode
  const n = Math.max(positiveInt(input.totalEpisodes) ?? 0, correctionEpisode)

  const body = buildFillerCorrectionIssueBody(
    { ...input, currentStatus: current, proposedStatus: proposed },
    { proposed, episode: correctionEpisode, n, source },
  )

  const params = new URLSearchParams({
    template: FILLER_CORRECTION_TEMPLATE,
    title: `[Add series] ${title}`,
    body,
    origin: FILLER_CORRECTION_ORIGIN,
    method: watched ? "direct-viewing" : "external-source",
    watched: watched ? "yes" : "no",
  })
  return `https://github.com/${FILLER_CORRECTION_REPO}/issues/new?${params.toString()}`
}

/**
 * Compress absolute episode numbers into the public form notation
 * (`26, 97, 101-106`). Returns `none` for an empty list, like the form.
 */
export function compressEpisodeNumbers(numbers: readonly number[]): string {
  const sorted = [
    ...new Set(
      numbers.filter((value) => Number.isSafeInteger(value) && value > 0),
    ),
  ].sort((a, b) => a - b)
  if (sorted.length === 0) return "none"

  const parts: string[] = []
  let start = sorted[0]
  let previous = sorted[0]
  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index]
    if (value === previous + 1) {
      previous = value
      continue
    }
    parts.push(start === previous ? String(start) : `${start}-${previous}`)
    start = value
    previous = value
  }
  parts.push(start === previous ? String(start) : `${start}-${previous}`)
  return parts.join(", ")
}

/** One selected episode of a bulk correction. */
export interface FillerCorrectionEpisodeInput {
  /** Standard TMDB season (specials/season 0 are not representable). */
  readonly season: number
  /** Standard TMDB episode. */
  readonly episode: number
  /** Absolute episode when known (regular-season offsets), else null. */
  readonly absoluteEpisode?: number | null
  /** TMDB episode title when available (blank = the maintainer fills it). */
  readonly title?: string | null
  /** Per-row type; blank/null is invalid (the UI defaults it to the bulk type). */
  readonly proposedStatus?: EpisodeFillerStatus | "" | null
}

/** Bulk correction: several episodes, one prefilled public issue. */
export interface BulkFillerCorrectionIssueInput {
  /** Visible series title (English display title preferred). */
  readonly title: string
  /** TMDB series id (the identity Pictorium already knows). */
  readonly tmdbId: number
  /** MAL id when the loaded title carries one (`anime_ids.mal[0]`). */
  readonly malId?: number | null
  /** Regular-season episode count when known (form field N). */
  readonly totalEpisodes?: number | null
  /** Selected episodes (unique S:E; duplicates are collapsed). */
  readonly episodes: readonly FillerCorrectionEpisodeInput[]
  /** Free-text "because" (single line, bounded). */
  readonly reason?: string | null
  /** Attestation checkbox. In-app origin defaults it to true (watched). */
  readonly watched: boolean
  /** Required when `watched` is false; ignored for direct viewing. */
  readonly source?: string | null
  /** Optional citation/notes for a non-direct source. */
  readonly sourceNotes?: string | null
  /** First issue of a split batch, when this one continues it. */
  readonly continuedFrom?: number | null
}

export type BulkFillerCorrectionFailure =
  | "invalid-input"
  | "too-many-episodes"
  | "url-too-long"

export type BulkFillerCorrectionIssueResult =
  | {
      readonly ok: true
      readonly url: string
      readonly body: string
      readonly episodeCount: number
      readonly fillerText: string
      readonly mixedText: string
      readonly missingTitles: readonly string[]
    }
  | {
      readonly ok: false
      readonly reason: BulkFillerCorrectionFailure
      readonly message: string
      readonly episodeCount: number
    }

interface ResolvedBulkEpisode {
  season: number
  episode: number
  absolute: number
  title: string
  proposed: EpisodeFillerStatus
}

/**
 * Bulk URL builder: one issue for a multi-episode selection.
 *
 * Filler and mixed ranges are auto-compressed per proposed type (manga/anime
 * rows are canon claims and stay out of both lists), titles are prefilled from
 * the episode list (missing ones are flagged, never invented), and the same
 * in-app origin/attestation lines as the single flow are included so the
 * public validator treats it as direct viewing. Partial selections are valid
 * candidate ranges: the body explicitly says unlisted episodes are NOT
 * asserted canon. Fail-closed above 50 episodes or when the URL would exceed
 * the GitHub-safe length.
 */
export function buildBulkFillerCorrectionIssue(
  input: BulkFillerCorrectionIssueInput,
): BulkFillerCorrectionIssueResult {
  const inputEpisodes = Array.isArray(input.episodes) ? input.episodes : []
  const fail = (
    reason: BulkFillerCorrectionFailure,
    message: string,
    episodeCount = inputEpisodes.length,
  ): BulkFillerCorrectionIssueResult => ({ ok: false, reason, message, episodeCount })

  const title = sanitizeCorrectionText(input.title, 200)
  const tmdbId = positiveInt(input.tmdbId)
  if (!title || tmdbId === null) {
    return fail("invalid-input", "Series title and TMDB id are required.")
  }
  if (inputEpisodes.length === 0) {
    return fail("invalid-input", "Select at least one episode.")
  }

  // Collapse duplicate S:E first: the count cap and the ranges must reflect
  // unique episodes, never repeated rows.
  const byKey = new Map<string, FillerCorrectionEpisodeInput>()
  for (const episode of inputEpisodes) {
    if (!Number.isSafeInteger(episode.season) || episode.season <= 0) {
      return fail(
        "invalid-input",
        "Specials (season 0) are outside the absolute episode numbering; remove them from the selection.",
      )
    }
    if (positiveInt(episode.episode) === null) {
      return fail("invalid-input", "Every selected episode needs a positive episode number.")
    }
    byKey.set(`${episode.season}:${episode.episode}`, episode)
  }
  const unique = [...byKey.values()]
  if (unique.length > MAX_BULK_CORRECTION_EPISODES) {
    return fail(
      "too-many-episodes",
      `Select at most ${MAX_BULK_CORRECTION_EPISODES} episodes per issue. Submit this batch, then open a second issue for the rest with "Continued from #<first issue>".`,
      unique.length,
    )
  }

  const resolved: ResolvedBulkEpisode[] = []
  for (const episode of unique) {
    const proposed = sanitizeEpisodeFillerStatus(episode.proposedStatus)
    if (!proposed) {
      return fail(
        "invalid-input",
        `Choose a proposed type for S${episode.season}:E${episode.episode}.`,
        unique.length,
      )
    }
    resolved.push({
      season: episode.season,
      episode: episode.episode,
      absolute: positiveInt(episode.absoluteEpisode) ?? episode.episode,
      title: sanitizeCorrectionText(episode.title, 120),
      proposed,
    })
  }

  // Two different S:E must never claim the same absolute episode with
  // different types: the public ranges would be ambiguous.
  const typeByAbsolute = new Map<number, EpisodeFillerStatus>()
  for (const episode of resolved) {
    const previous = typeByAbsolute.get(episode.absolute)
    if (previous && previous !== episode.proposed) {
      return fail(
        "invalid-input",
        `Two selected episodes map to absolute ${episode.absolute} with different types; fix the selection.`,
        unique.length,
      )
    }
    typeByAbsolute.set(episode.absolute, episode.proposed)
  }

  const watched = input.watched === true
  const source = watched
    ? FILLER_CORRECTION_DIRECT_VIEWING
    : sanitizeFillerCorrectionSource(input.source)
  if (!source) {
    return fail(
      "invalid-input",
      "A clean source is required when the direct-viewing attestation is unchecked.",
      unique.length,
    )
  }

  const maxAbsolute = resolved.reduce((max, episode) => Math.max(max, episode.absolute), 0)
  const n = Math.max(positiveInt(input.totalEpisodes) ?? 0, maxAbsolute)
  if (n > 100000) {
    return fail(
      "invalid-input",
      "The episode count exceeds the supported maximum (100000).",
      unique.length,
    )
  }

  const fillerText = compressEpisodeNumbers(
    resolved.filter((episode) => episode.proposed === "filler").map((episode) => episode.absolute),
  )
  const mixedText = compressEpisodeNumbers(
    resolved.filter((episode) => episode.proposed === "mixed").map((episode) => episode.absolute),
  )

  const ordered = [...resolved].sort(
    (a, b) => a.season - b.season || a.episode - b.episode,
  )
  const titlesText = ordered
    .map((episode) => {
      const label = `S${episode.season}:E${episode.episode}`
      return episode.title ? `- ${label} — ${episode.title}` : `- ${label}`
    })
    .join("\n")
  const missingTitles = ordered
    .filter((episode) => !episode.title)
    .map((episode) => `S${episode.season}:E${episode.episode}`)
  const typeCounts = (["manga", "anime", "filler", "mixed"] as const)
    .map((status) => [status, resolved.filter((episode) => episode.proposed === status).length] as const)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${status} (${count})`)
    .join(", ")
  const reason = sanitizeCorrectionText(input.reason)
  const notes = sanitizeCorrectionText(input.sourceNotes)
  const continuedFrom = positiveInt(input.continuedFrom)

  const attribution = [
    `Origin: ${FILLER_CORRECTION_ORIGIN}`,
    `Watched: ${watched ? "yes" : "no"}`,
    `Method: ${watched ? "direct-viewing" : "external-source"}`,
    `Bulk suggestion: ${resolved.length} episodes (TMDB ${tmdbId}).`,
    continuedFrom ? `Continued from #${continuedFrom}.` : "",
    `Ranges use absolute episode numbers (1..${n}).`,
    missingTitles.length ? `Titles missing for: ${missingTitles.join(", ")}.` : "",
    notes,
  ]
    .filter((line) => line.length > 0)
    .join("\n")

  const maintainerNotes = [
    `Proposed: ${typeCounts}${reason ? ` because ${reason}` : ""}`,
    `Origin: Pictorium in-app bulk (${resolved.length} episodes, TMDB ${tmdbId}, absolute ranges).`,
    continuedFrom ? `Continued from #${continuedFrom}.` : "",
    watched ? "I watched these episodes (direct viewing attestation)." : "",
    missingTitles.length
      ? `Episode titles missing for ${missingTitles.join(", ")}: titles are not part of the range validation, the maintainer may fill them from TMDB.`
      : "",
    notes,
  ]
    .filter((line) => line.length > 0)
    .join("\n")

  // Partial selections are honest candidate ranges: unlike the single flow,
  // the bulk body never claims that unlisted episodes are canon.
  const confirmations = [
    "- [x] This issue covers exactly one series.",
    "- [x] I did not copy from Anime Filler List (AFL) or skipthefiller.com.",
    "- [x] This bulk correction lists only the selected episodes; unlisted episodes are NOT asserted canon.",
    "- [x] I understand that a maintainer must review the identity, TMDB sum, source and license before publication, and that accepted data is CC BY-SA 4.0.",
  ].join("\n")

  const body = [
    section("Series title", title),
    section("MyAnimeList ID (optional)", positiveInt(input.malId) ? String(input.malId) : ""),
    section("Total episodes N", String(n)),
    section("Filler ranges", fillerText),
    section("Mixed ranges (optional)", mixedText),
    section("Episode titles", titlesText),
    section("Source", watched ? FILLER_CORRECTION_DIRECT_VIEWING : source),
    section("Source / attribution", attribution),
    section(
      "Ongoing or partial?",
      "Bulk correction: selected episodes only; the full run was not re-verified.",
    ),
    section("Notes for the maintainer (optional)", maintainerNotes),
    section("Confirmations", confirmations),
  ].join("\n")

  const params = new URLSearchParams({
    template: FILLER_CORRECTION_TEMPLATE,
    title: `[Add series] ${title}`,
    body,
    origin: FILLER_CORRECTION_ORIGIN,
    method: watched ? "direct-viewing" : "external-source",
    watched: watched ? "yes" : "no",
  })
  const url = `https://github.com/${FILLER_CORRECTION_REPO}/issues/new?${params.toString()}`
  if (url.length > MAX_FILLER_CORRECTION_URL_LENGTH) {
    return fail(
      "url-too-long",
      `The prefilled issue is too long (${url.length} chars, max ${MAX_FILLER_CORRECTION_URL_LENGTH}). Shorten the reason/notes or split the selection into smaller batches.`,
      unique.length,
    )
  }

  return {
    ok: true,
    url,
    body,
    episodeCount: resolved.length,
    fillerText,
    mixedText,
    missingTitles,
  }
}

/** Human label for a proposal (prototype copy, English only). */
export const FILLER_CORRECTION_STATUS_LABELS: Record<EpisodeFillerStatus, string> = {
  manga: "Manga canon",
  anime: "Anime canon",
  filler: "Filler",
  mixed: "Mixed",
}
