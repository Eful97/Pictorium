/**
 * Pure contract for the "Suggest filler correction" prototype URL builder.
 *
 * Locked rules:
 * - no token/fetch: only a GitHub `issues/new` URL is produced;
 * - a known episode defaults the proposal to its current classification;
 * - an UNKNOWN episode requires an explicit proposal (never invented);
 * - the in-app origin defaults to the direct-viewing attestation; unchecking
 *   it makes a clean source mandatory (fail-closed);
 * - the body reproduces the public issue-form headings, so the validator bot
 *   parses the same single-episode correction.
 */
import { describe, expect, it } from "vitest"
import {
  FILLER_CORRECTION_DIRECT_VIEWING,
  FILLER_CORRECTION_ORIGIN,
  MAX_BULK_CORRECTION_EPISODES,
  MAX_FILLER_CORRECTION_URL_LENGTH,
  buildBulkFillerCorrectionIssue,
  buildFillerCorrectionIssueBody,
  buildFillerCorrectionIssueUrl,
  compressEpisodeNumbers,
  isFillerCorrectionPrototypeEnabled,
  sanitizeCorrectionText,
  type BulkFillerCorrectionIssueInput,
} from "@/lib/filler-correction-issue"

const BASE = {
  title: "Naruto",
  tmdbId: 46260,
  malId: 20,
  season: 1,
  episode: 26,
  absoluteEpisode: 26,
  totalEpisodes: 220,
} as const

function paramsOf(url: string) {
  return new URL(url).searchParams
}

describe("filler correction gate", () => {
  it("is OFF by default and only an explicit 1 enables it", () => {
    expect(isFillerCorrectionPrototypeEnabled(undefined)).toBe(false)
    expect(isFillerCorrectionPrototypeEnabled("")).toBe(false)
    expect(isFillerCorrectionPrototypeEnabled("0")).toBe(false)
    expect(isFillerCorrectionPrototypeEnabled("true")).toBe(false)
    expect(isFillerCorrectionPrototypeEnabled("1")).toBe(true)
    expect(isFillerCorrectionPrototypeEnabled(" 1 ")).toBe(true)
  })
})

describe("buildFillerCorrectionIssueUrl", () => {
  it("defaults a known episode proposal to its current classification", () => {
    const url = buildFillerCorrectionIssueUrl({
      ...BASE,
      currentStatus: "filler",
      watched: true,
    })
    expect(url).not.toBeNull()
    const params = paramsOf(url!)
    expect(params.get("template")).toBe("add-series.yml")
    expect(params.get("title")).toBe("[Add series] Naruto")
    expect(params.get("origin")).toBe(FILLER_CORRECTION_ORIGIN)
    expect(params.get("method")).toBe("direct-viewing")
    expect(params.get("watched")).toBe("yes")
    const body = params.get("body")!
    expect(body).toContain("### Series title\n\nNaruto")
    expect(body).toContain("### MyAnimeList ID (optional)\n\n20")
    expect(body).toContain("### Total episodes N\n\n220")
    expect(body).toContain("### Filler ranges\n\n26")
    expect(body).toContain("### Mixed ranges (optional)\n\nnone")
    expect(body).toContain("Origin: pictorium-in-app")
    expect(body).toContain("Watched: yes")
    expect(body).toContain(`### Source\n\n${FILLER_CORRECTION_DIRECT_VIEWING}`)
    expect(body).toContain("I watched this episode (direct viewing attestation).")
    // No server call, no token in the URL.
    expect(url).not.toContain("token")
    expect(url).not.toContain("api_key")
  })

  it("requires an explicit proposed type for an unknown episode", () => {
    expect(
      buildFillerCorrectionIssueUrl({ ...BASE, currentStatus: null, watched: true }),
    ).toBeNull()

    const url = buildFillerCorrectionIssueUrl({
      ...BASE,
      currentStatus: null,
      proposedStatus: "mixed",
      watched: true,
    })
    expect(url).not.toBeNull()
    const body = paramsOf(url!).get("body")!
    expect(body).toContain("### Filler ranges\n\nnone")
    expect(body).toContain("### Mixed ranges (optional)\n\n26")
    expect(body).toContain("current fill: unknown")
  })

  it("maps canon proposals to empty filler/mixed lists", () => {
    const body = buildFillerCorrectionIssueBody({
      ...BASE,
      currentStatus: "filler",
      proposedStatus: "manga",
      watched: true,
    })
    expect(body).toContain("### Filler ranges\n\nnone")
    expect(body).toContain("### Mixed ranges (optional)\n\nnone")
    expect(body).toContain("Proposed: manga")
  })

  it("uses the absolute episode and regular-season N when known", () => {
    const url = buildFillerCorrectionIssueUrl({
      title: "Naruto Shippuden",
      tmdbId: 31910,
      malId: 1735,
      season: 2,
      episode: 3,
      absoluteEpisode: 29,
      totalEpisodes: 500,
      currentStatus: null,
      proposedStatus: "filler",
      watched: true,
    })
    const body = paramsOf(url!).get("body")!
    expect(body).toContain("### Total episodes N\n\n500")
    expect(body).toContain("### Filler ranges\n\n29")
  })

  it("falls back to S:E when the absolute number is unknown", () => {
    const url = buildFillerCorrectionIssueUrl({
      ...BASE,
      absoluteEpisode: null,
      totalEpisodes: null,
      currentStatus: null,
      proposedStatus: "filler",
      watched: true,
    })
    const body = paramsOf(url!).get("body")!
    expect(body).toContain("### Total episodes N\n\n26")
    expect(body).toContain("### Filler ranges\n\n26")
  })

  it("fails closed when the attestation is unchecked and no source is given", () => {
    expect(
      buildFillerCorrectionIssueUrl({
        ...BASE,
        currentStatus: "filler",
        watched: false,
        source: null,
      }),
    ).toBeNull()
    expect(
      buildFillerCorrectionIssueUrl({
        ...BASE,
        currentStatus: "filler",
        watched: false,
        source: "Anime Filler List",
      }),
    ).toBeNull()
  })

  it("accepts an unchecked attestation with a clean source", () => {
    const url = buildFillerCorrectionIssueUrl({
      ...BASE,
      currentStatus: "filler",
      watched: false,
      source: "Fandom XML dump (CC BY-SA; link required)",
      sourceNotes: "https://example.org/wiki",
    })
    expect(url).not.toBeNull()
    const body = paramsOf(url!).get("body")!
    expect(body).toContain("Watched: no")
    expect(body).toContain("Method: external-source")
    expect(body).toContain("### Source\n\nFandom XML dump (CC BY-SA; link required)")
    expect(body).toContain("https://example.org/wiki")
    expect(body).not.toContain("I watched this episode")
  })

  it("rejects missing identity fields", () => {
    expect(buildFillerCorrectionIssueUrl({ ...BASE, title: "  ", currentStatus: "filler", watched: true })).toBeNull()
    expect(buildFillerCorrectionIssueUrl({ ...BASE, tmdbId: 0, currentStatus: "filler", watched: true })).toBeNull()
    expect(buildFillerCorrectionIssueUrl({ ...BASE, episode: 0, currentStatus: "filler", watched: true })).toBeNull()
  })

  it("collapses user text so it cannot inject body headings", () => {
    expect(sanitizeCorrectionText("a\n### Filler ranges\n26")).toBe("a ### Filler ranges 26")
  })
})

const BULK: BulkFillerCorrectionIssueInput = {
  title: "Naruto",
  tmdbId: 46260,
  malId: 20,
  totalEpisodes: 220,
  episodes: [
    { season: 1, episode: 1, absoluteEpisode: 1, title: "Enter Naruto", proposedStatus: "filler" },
    { season: 1, episode: 2, absoluteEpisode: 2, title: "My Name is Konohamaru", proposedStatus: "mixed" },
    { season: 1, episode: 3, absoluteEpisode: 3, title: "Sasuke and Sakura", proposedStatus: "filler" },
    { season: 1, episode: 4, absoluteEpisode: 4, title: null, proposedStatus: "filler" },
  ],
  watched: true,
}

function bulkOrThrow(input: BulkFillerCorrectionIssueInput) {
  const result = buildBulkFillerCorrectionIssue(input)
  if (!result.ok) throw new Error(`${result.reason}: ${result.message}`)
  return result
}

describe("compressEpisodeNumbers", () => {
  it("compresses sorted unique runs in the public form notation", () => {
    expect(compressEpisodeNumbers([106, 101, 102, 26, 97, 103, 104, 105])).toBe(
      "26, 97, 101-106",
    )
    expect(compressEpisodeNumbers([3, 1, 2, 2])).toBe("1-3")
    expect(compressEpisodeNumbers([])).toBe("none")
    expect(compressEpisodeNumbers([0, -1, Number.NaN])).toBe("none")
  })
})

describe("buildBulkFillerCorrectionIssue", () => {
  it("splits compressed ranges by proposed type and prefills titles", () => {
    const result = bulkOrThrow(BULK)
    expect(result.episodeCount).toBe(4)
    expect(result.fillerText).toBe("1, 3-4")
    expect(result.mixedText).toBe("2")
    expect(result.missingTitles).toEqual(["S1:E4"])

    const body = result.body
    expect(body).toContain("### Series title\n\nNaruto")
    expect(body).toContain("### MyAnimeList ID (optional)\n\n20")
    expect(body).toContain("### Total episodes N\n\n220")
    expect(body).toContain("### Filler ranges\n\n1, 3-4")
    expect(body).toContain("### Mixed ranges (optional)\n\n2")
    expect(body).toContain("### Episode titles\n\n- S1:E1 — Enter Naruto")
    expect(body).toContain("- S1:E2 — My Name is Konohamaru")
    expect(body).toContain("- S1:E4\n")
    expect(body).not.toContain("- S1:E4 —")
    expect(body).toContain("Origin: pictorium-in-app")
    expect(body).toContain("Watched: yes")
    expect(body).toContain("Bulk suggestion: 4 episodes (TMDB 46260).")
    expect(body).toContain("Titles missing for: S1:E4.")
    expect(body).toContain("Proposed: filler (3), mixed (1)")
    expect(body).toContain("unlisted episodes are NOT asserted canon")
    expect(body).toContain("the maintainer may fill them from TMDB")

    const params = paramsOf(result.url)
    expect(params.get("template")).toBe("add-series.yml")
    expect(params.get("title")).toBe("[Add series] Naruto")
    expect(params.get("origin")).toBe(FILLER_CORRECTION_ORIGIN)
    expect(params.get("method")).toBe("direct-viewing")
    expect(params.get("watched")).toBe("yes")
    expect(result.url.length).toBeLessThanOrEqual(MAX_FILLER_CORRECTION_URL_LENGTH)
    // Still no token/fetch contract.
    expect(result.url).not.toContain("token")
    expect(result.url).not.toContain("api_key")
  })

  it("keeps a full 50-episode correction inside the safe URL length", () => {
    const episodes = Array.from({ length: MAX_BULK_CORRECTION_EPISODES }, (_, index) => ({
      season: 1,
      episode: index + 1,
      absoluteEpisode: index + 1,
      title: `Episode ${index + 1}`,
      proposedStatus: "filler" as const,
    }))
    const result = bulkOrThrow({ ...BULK, episodes })
    expect(result.episodeCount).toBe(MAX_BULK_CORRECTION_EPISODES)
    expect(result.fillerText).toBe(`1-${MAX_BULK_CORRECTION_EPISODES}`)
    expect(result.url.length).toBeLessThan(MAX_FILLER_CORRECTION_URL_LENGTH)
  })

  it("fails closed above the per-issue episode cap", () => {
    const episodes = Array.from({ length: MAX_BULK_CORRECTION_EPISODES + 1 }, (_, index) => ({
      season: 1,
      episode: index + 1,
      absoluteEpisode: index + 1,
      title: `Episode ${index + 1}`,
      proposedStatus: "filler" as const,
    }))
    const result = buildBulkFillerCorrectionIssue({ ...BULK, episodes })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("too-many-episodes")
    expect(result.message).toContain(String(MAX_BULK_CORRECTION_EPISODES))
    expect(result.message).toContain("Continued from #")
  })

  it("fails closed when the prefilled URL would be too long", () => {
    const episodes = Array.from({ length: MAX_BULK_CORRECTION_EPISODES }, (_, index) => ({
      season: 1,
      episode: index + 1,
      absoluteEpisode: index + 1,
      title: `Episode ${index + 1} ${"x".repeat(110)}`,
      proposedStatus: "filler" as const,
    }))
    const result = buildBulkFillerCorrectionIssue({
      ...BULK,
      episodes,
      reason: "y".repeat(600),
      sourceNotes: "z".repeat(600),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("url-too-long")
    expect(result.message).toContain(String(MAX_FILLER_CORRECTION_URL_LENGTH))
  })

  it("collapses duplicate S:E and omits canon rows from both range lists", () => {
    const result = bulkOrThrow({
      ...BULK,
      episodes: [
        { season: 1, episode: 1, absoluteEpisode: 1, title: "A", proposedStatus: "filler" },
        { season: 1, episode: 1, absoluteEpisode: 1, title: "A", proposedStatus: "filler" },
        { season: 1, episode: 2, absoluteEpisode: 2, title: "B", proposedStatus: "manga" },
        { season: 1, episode: 3, absoluteEpisode: 3, title: "C", proposedStatus: "anime" },
      ],
    })
    expect(result.episodeCount).toBe(3)
    expect(result.fillerText).toBe("1")
    expect(result.mixedText).toBe("none")
    expect(result.body).toContain("Proposed: manga (1), anime (1), filler (1)")
  })

  it("emits an all-canon bulk correction as none/none (valid canon claim)", () => {
    const result = bulkOrThrow({
      ...BULK,
      episodes: [
        { season: 1, episode: 1, absoluteEpisode: 1, title: "A", proposedStatus: "manga" },
        { season: 1, episode: 2, absoluteEpisode: 2, title: "B", proposedStatus: "anime" },
      ],
    })
    expect(result.fillerText).toBe("none")
    expect(result.mixedText).toBe("none")
  })

  it("records the first issue of a split batch", () => {
    const result = bulkOrThrow({ ...BULK, continuedFrom: 123 })
    expect(result.body).toContain("Continued from #123.")
  })

  it("fails closed on missing types, sources, identity and specials", () => {
    const noType = buildBulkFillerCorrectionIssue({
      ...BULK,
      episodes: [{ season: 1, episode: 1, title: "A", proposedStatus: "" }],
    })
    expect(noType.ok).toBe(false)
    if (!noType.ok) expect(noType.message).toContain("S1:E1")

    const noSource = buildBulkFillerCorrectionIssue({
      ...BULK,
      watched: false,
      source: null,
    })
    expect(noSource.ok).toBe(false)

    const noIdentity = buildBulkFillerCorrectionIssue({ ...BULK, tmdbId: 0 })
    expect(noIdentity.ok).toBe(false)

    const special = buildBulkFillerCorrectionIssue({
      ...BULK,
      episodes: [{ season: 0, episode: 1, proposedStatus: "filler" }],
    })
    expect(special.ok).toBe(false)

    const empty = buildBulkFillerCorrectionIssue({ ...BULK, episodes: [] })
    expect(empty.ok).toBe(false)

    const conflict = buildBulkFillerCorrectionIssue({
      ...BULK,
      episodes: [
        { season: 1, episode: 1, absoluteEpisode: 7, proposedStatus: "filler" },
        { season: 1, episode: 2, absoluteEpisode: 7, proposedStatus: "mixed" },
      ],
    })
    expect(conflict.ok).toBe(false)
  })

  it("accepts an unchecked attestation with a clean source", () => {
    const result = bulkOrThrow({
      ...BULK,
      watched: false,
      source: "Fandom XML dump (CC BY-SA; link required)",
      sourceNotes: "https://example.org/wiki — dump revision 2026-11-01, license CC BY-SA 4.0",
    })
    expect(result.body).toContain("Watched: no")
    expect(result.body).toContain("Method: external-source")
    expect(result.body).toContain(
      "### Source\n\nFandom XML dump (CC BY-SA; link required)",
    )
    expect(result.body).not.toContain("I watched these episodes")
  })
})
