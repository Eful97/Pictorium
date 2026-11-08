import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  assembleFranchises,
  assertUniqueTmdbTargets,
  findDuplicateTmdbTargets,
  rangeEpisodeCount,
  sourceAirdateKey,
  sumRegularSeasonEpisodes,
  validateTmdbSeasonSum,
} from "../../../scripts/build-anime-filler-map.mjs"

const ROOT = path.resolve(__dirname, "..", "..", "..")
const SCRIPT = path.join(ROOT, "scripts", "build-anime-filler-map.mjs")

type Range = [number, number, string]

interface Page {
  slug: string
  m: number
  tmdbId: number
  n: number
  ranges: Range[]
  partial: boolean
  airdateKey: number | null
  sourceIndex: number
  runCount: number
  hasTvdb: boolean
}

interface SourceEpisode {
  number: number
  type: "Canon" | "Manga Canon" | "Anime Canon" | "Filler" | "Mixed" | "Mixed Canon/Filler"
  airDate: string | null
}

interface SourceAnime {
  slug: string
  totalEpisodes: number
  episodes: SourceEpisode[]
  status?: string
  premiered?: string
}

function episodes(count: number, type: SourceEpisode["type"], airDate: string | null = null): SourceEpisode[] {
  return Array.from({ length: count }, (_, index) => ({ number: index + 1, type, airDate }))
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "filler-generator-"))
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`)
}

function runBuild(
  args: string[],
  extraEnv: Record<string, string> = {},
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    })
    return { ok: true, stdout: String(stdout), stderr: "", status: 0 }
  } catch (e) {
    const err = e as { stdout?: unknown; stderr?: unknown; status?: number | null }
    return { ok: false, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? ""), status: err.status ?? null }
  }
}

function page(overrides: Partial<Page> & Pick<Page, "slug" | "m" | "tmdbId" | "n" | "ranges">): Page {
  return {
    partial: false,
    airdateKey: null,
    sourceIndex: 0,
    runCount: 1,
    hasTvdb: false,
    ...overrides,
  }
}

describe("anime filler generator: TMDB regular-season sum", () => {
  it("sums only regular seasons and ignores specials (season 0)", () => {
    expect(
      sumRegularSeasonEpisodes({
        seasons: [
          { season_number: 0, episode_count: 12 },
          { season_number: 1, episode_count: 24 },
          { season_number: 2, episode_count: 12 },
        ],
      }),
    ).toBe(36)
    expect(sumRegularSeasonEpisodes({ seasons: [{ season_number: 0, episode_count: 5 }] })).toBeNull()
    expect(sumRegularSeasonEpisodes({ seasons: [] })).toBeNull()
    expect(sumRegularSeasonEpisodes({})).toBeNull()
  })

  it("accepts an exact match and skips on a mismatch (fail-closed, n never shifted)", () => {
    const payload = { seasons: [{ season_number: 1, episode_count: 12 }] }
    expect(validateTmdbSeasonSum({ t: 42, n: 12 }, payload)).toEqual({ ok: true, sum: 12 })
    expect(validateTmdbSeasonSum({ t: 42, n: 13 }, payload)).toEqual({
      ok: false,
      reason: "tmdb-episode-count-mismatch",
      detail: "source n=13 vs TMDB regular-season sum=12 (tmdb=42)",
    })
  })

  it("skips when TMDB exposes no usable regular-season counts", () => {
    const result = validateTmdbSeasonSum({ t: 7, n: 10 }, { seasons: [{ season_number: 0, episode_count: 10 }] })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.reason).toBe("tmdb-season-data-missing")
  })
})

describe("anime filler generator: franchise assembly", () => {
  it("orders pages by airdate, concatenates 1..N and merges adjacent statuses", () => {
    const pages: Page[] = [
      page({
        slug: "later-page",
        m: 222,
        tmdbId: 7,
        n: 3,
        ranges: [
          [1, 2, "filler"],
          [3, 3, "manga"],
        ],
        airdateKey: Date.UTC(2014, 0, 1),
        sourceIndex: 0,
      }),
      page({
        slug: "earlier-page",
        m: 111,
        tmdbId: 7,
        n: 2,
        ranges: [[1, 2, "manga"]],
        partial: true,
        airdateKey: Date.UTC(2013, 0, 1),
        sourceIndex: 1,
      }),
    ]

    const assembled = assembleFranchises(pages)
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) throw new Error(assembled.detail)
    expect(assembled.entries).toHaveLength(1)
    const [entry] = assembled.entries
    expect(entry.pages.map((item) => item.slug)).toEqual(["earlier-page", "later-page"])
    expect(entry.record).toEqual({
      m: 111,
      t: 7,
      n: 5,
      ranges: [
        [1, 2, "manga"],
        [3, 4, "filler"],
        [5, 5, "manga"],
      ],
      partial: true,
    })
  })

  it("keeps a single page unchanged (legacy behaviour)", () => {
    const assembled = assembleFranchises([
      page({ slug: "monster", m: 5, tmdbId: 9, n: 3, ranges: [[1, 1, "manga"], [2, 3, "filler"]] }),
    ])
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) throw new Error(assembled.detail)
    expect(assembled.entries[0].record).toEqual({
      m: 5,
      t: 9,
      n: 3,
      ranges: [
        [1, 1, "manga"],
        [2, 3, "filler"],
      ],
      partial: false,
    })
  })

  it("rejects a page whose ranges do not cover exactly 1..n", () => {
    const assembled = assembleFranchises([
      page({ slug: "broken", m: 1, tmdbId: 3, n: 5, ranges: [[1, 2, "manga"]] }),
    ])
    expect(assembled.ok).toBe(false)
    if (assembled.ok) throw new Error("expected failure")
    expect(assembled.reason).toBe("franchise-assembly-invalid")
  })

  it("derives the airdate key from episodes, then premiered, then null", () => {
    expect(sourceAirdateKey({ episodes: [{ airDate: "2014-01-02T00:00:00.000Z" }, { airDate: "2013-04-07T00:00:00.000Z" }] })).toBe(
      Date.parse("2013-04-07T00:00:00.000Z"),
    )
    expect(sourceAirdateKey({ episodes: [], premiered: "Fall 2013" })).toBe(Date.UTC(2013, 9, 1))
    expect(sourceAirdateKey({ episodes: [], premiered: "unknown" })).toBeNull()
  })

  it("counts ranges contiguously and rejects gaps", () => {
    expect(rangeEpisodeCount([[1, 2, "manga"], [3, 3, "filler"]])).toBe(3)
    expect(rangeEpisodeCount([[1, 2, "manga"], [4, 5, "filler"]])).toBeNull()
    expect(rangeEpisodeCount([])).toBeNull()
  })
})

describe("anime filler generator: duplicate TMDB target is fatal", () => {
  it("detects and rejects two records on the same TMDB id", () => {
    const records = [
      { m: 1, t: 7 },
      { m: 2, t: 7 },
      { m: 3, t: 8 },
    ]
    expect(findDuplicateTmdbTargets(records)).toEqual([7])
    expect(() => assertUniqueTmdbTargets(records)).toThrow(/ambiguous TMDB target\(s\) 7/)
    const distinct = [
      { m: 1, t: 7 },
      { m: 2, t: 8 },
    ]
    expect(() => assertUniqueTmdbTargets(distinct)).not.toThrow()
  })
})

describe("anime filler generator: CLI build with cached TMDB/AniZip", () => {
  it("skips a TMDB mismatch and keeps the matching record", () => {
    const dir = tmpDir()
    const input = path.join(dir, "anime.json")
    const anizipCache = path.join(dir, "anizip.json")
    const tmdbCache = path.join(dir, "tmdb.json")
    const out = path.join(dir, "snapshot.json")

    writeJson(input, [
      { slug: "monster", totalEpisodes: 2, episodes: episodes(2, "Canon") },
      { slug: "bobobo-bo-bobo", totalEpisodes: 3, episodes: episodes(3, "Filler") },
    ] satisfies SourceAnime[])
    writeJson(anizipCache, {
      "19": { mappings: { themoviedb_id: 900, thetvdb_id: 1 } },
      "1050": { mappings: { themoviedb_id: 901, thetvdb_id: 2 } },
    })
    writeJson(tmdbCache, {
      "900": { seasons: [{ season_number: 0, episode_count: 99 }, { season_number: 1, episode_count: 2 }] },
      "901": { seasons: [{ season_number: 1, episode_count: 2 }] },
    })

    const res = runBuild([
      "--input", input,
      "--output", out,
      "--revision", "test-rev",
      "--generated-at", "2026-01-01T00:00:00Z",
      "--anizip-cache", anizipCache,
      "--tmdb-cache", tmdbCache,
      "--min-records", "1",
    ])
    expect(res.ok, res.stderr).toBe(true)

    const snapshot = JSON.parse(fs.readFileSync(out, "utf-8"))
    expect(snapshot.records).toHaveLength(1)
    expect(snapshot.records[0]).toMatchObject({ t: 900, n: 2 })
    expect(snapshot.meta.skipped).toEqual([
      expect.objectContaining({ slug: "bobobo-bo-bobo", reason: "tmdb-episode-count-mismatch" }),
    ])
    expect(snapshot.meta.counts.episodes).toBe(2)
    expect(snapshot.meta.counts.filler).toBe(0)
  })

  it("merges two pages of one franchise into a single contiguous record", () => {
    const dir = tmpDir()
    const input = path.join(dir, "anime.json")
    const anizipCache = path.join(dir, "anizip.json")
    const tmdbCache = path.join(dir, "tmdb.json")
    const out = path.join(dir, "snapshot.json")

    writeJson(input, [
      { slug: "bobobo-bo-bobo", totalEpisodes: 2, episodes: episodes(2, "Filler", "2014-04-07T00:00:00.000Z") },
      { slug: "monster", totalEpisodes: 2, episodes: episodes(2, "Canon", "2013-04-07T00:00:00.000Z") },
    ] satisfies SourceAnime[])
    writeJson(anizipCache, {
      "19": { mappings: { themoviedb_id: 950, thetvdb_id: 11 } },
      "1050": { mappings: { themoviedb_id: 950, thetvdb_id: 12 } },
    })
    writeJson(tmdbCache, {
      "950": { seasons: [{ season_number: 1, episode_count: 2 }, { season_number: 2, episode_count: 2 }] },
    })

    const res = runBuild([
      "--input", input,
      "--output", out,
      "--revision", "test-rev",
      "--generated-at", "2026-01-01T00:00:00Z",
      "--anizip-cache", anizipCache,
      "--tmdb-cache", tmdbCache,
      "--min-records", "1",
    ])
    expect(res.ok, res.stderr).toBe(true)

    const snapshot = JSON.parse(fs.readFileSync(out, "utf-8"))
    expect(snapshot.records).toHaveLength(1)
    expect(snapshot.records[0]).toEqual({
      m: 19,
      t: 950,
      n: 4,
      ranges: [
        [1, 2, "manga"],
        [3, 4, "filler"],
      ],
      partial: false,
    })
    expect(snapshot.meta.schemaVersion).toBe(2)
    expect(snapshot.meta.statusCodes).toEqual(["manga", "anime", "filler", "mixed"])
    expect(snapshot.meta.counts.tmdbTargets).toBe(1)
    expect(snapshot.meta.counts.multiRun).toBe(1)
  })

  it("emits the four canonical codes and the v2 schema (legacy Canon maps to manga)", () => {
    const dir = tmpDir()
    const input = path.join(dir, "anime.json")
    const anizipCache = path.join(dir, "anizip.json")
    const tmdbCache = path.join(dir, "tmdb.json")
    const out = path.join(dir, "snapshot.json")

    writeJson(input, [
      {
        slug: "monster",
        totalEpisodes: 4,
        episodes: [
          { number: 1, type: "Manga Canon", airDate: null },
          { number: 2, type: "Anime Canon", airDate: null },
          { number: 3, type: "Filler", airDate: null },
          { number: 4, type: "Mixed Canon/Filler", airDate: null },
        ],
      },
    ] satisfies SourceAnime[])
    writeJson(anizipCache, { "19": { mappings: { themoviedb_id: 970, thetvdb_id: 14 } } })
    writeJson(tmdbCache, { "970": { seasons: [{ season_number: 1, episode_count: 4 }] } })

    const res = runBuild([
      "--input", input,
      "--output", out,
      "--revision", "test-rev",
      "--generated-at", "2026-01-01T00:00:00Z",
      "--anizip-cache", anizipCache,
      "--tmdb-cache", tmdbCache,
      "--min-records", "1",
    ])
    expect(res.ok, res.stderr).toBe(true)

    const snapshot = JSON.parse(fs.readFileSync(out, "utf-8"))
    expect(snapshot.meta.schemaVersion).toBe(2)
    expect(snapshot.meta.statusCodes).toEqual(["manga", "anime", "filler", "mixed"])
    expect(snapshot.records[0].ranges).toEqual([
      [1, 1, "manga"],
      [2, 2, "anime"],
      [3, 3, "filler"],
      [4, 4, "mixed"],
    ])
    expect(snapshot.meta.counts).toMatchObject({ episodes: 4, manga: 1, anime: 1, filler: 1, mixed: 1 })
  })

  it("fail-open: an unreachable TMDB skips only the affected anime", () => {
    const dir = tmpDir()
    const input = path.join(dir, "anime.json")
    const anizipCache = path.join(dir, "anizip.json")
    const tmdbCache = path.join(dir, "tmdb.json")
    const out = path.join(dir, "snapshot.json")

    writeJson(input, [
      { slug: "monster", totalEpisodes: 2, episodes: episodes(2, "Canon") },
      { slug: "bobobo-bo-bobo", totalEpisodes: 2, episodes: episodes(2, "Filler") },
    ] satisfies SourceAnime[])
    writeJson(anizipCache, {
      "19": { mappings: { themoviedb_id: 900, thetvdb_id: 1 } },
      "1050": { mappings: { themoviedb_id: 901, thetvdb_id: 2 } },
    })
    // Only 900 is cached: 901 hits the unreachable base.
    writeJson(tmdbCache, { "900": { seasons: [{ season_number: 1, episode_count: 2 }] } })

    const res = runBuild(
      [
        "--input", input,
        "--output", out,
        "--revision", "test-rev",
        "--generated-at", "2026-01-01T00:00:00Z",
        "--anizip-cache", anizipCache,
        "--tmdb-cache", tmdbCache,
        "--tmdb-api-base", "http://127.0.0.1:1",
        "--min-records", "1",
      ],
      { PICTORIUM_TMDB_KEY: "test-key" },
    )
    expect(res.ok, res.stderr).toBe(true)

    const snapshot = JSON.parse(fs.readFileSync(out, "utf-8"))
    expect(snapshot.records).toHaveLength(1)
    expect(snapshot.records[0]).toMatchObject({ t: 900, n: 2 })
    expect(snapshot.meta.skipped).toEqual([
      expect.objectContaining({ slug: "bobobo-bo-bobo", reason: "tmdb-unavailable" }),
    ])
  })

  it("fails loudly when the build falls below the raised default --min-records", () => {
    const dir = tmpDir()
    const input = path.join(dir, "anime.json")
    const anizipCache = path.join(dir, "anizip.json")
    const tmdbCache = path.join(dir, "tmdb.json")
    const out = path.join(dir, "snapshot.json")

    writeJson(input, [{ slug: "monster", totalEpisodes: 1, episodes: episodes(1, "Canon") }] satisfies SourceAnime[])
    writeJson(anizipCache, { "19": { mappings: { themoviedb_id: 960, thetvdb_id: 13 } } })
    writeJson(tmdbCache, { "960": { seasons: [{ season_number: 1, episode_count: 1 }] } })

    const res = runBuild([
      "--input", input,
      "--output", out,
      "--revision", "test-rev",
      "--generated-at", "2026-01-01T00:00:00Z",
      "--anizip-cache", anizipCache,
      "--tmdb-cache", tmdbCache,
    ])
    expect(res.ok).toBe(false)
    expect(res.stderr).toMatch(/only 1 usable records \(min 100\)/)
    expect(fs.existsSync(out)).toBe(false)
  })

  it("keeps the committed snapshot valid with --check --offline", () => {
    const res = runBuild(["--check", "--offline"])
    expect(res.ok, res.stderr).toBe(true)
    expect(res.stdout).toMatch(/records=42 episodes=9181 ranges=1481/)
  })
})
