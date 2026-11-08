import { describe, expect, it, vi } from "vitest"
import snapshotData from "@/generated/anime-filler-map.json"
import ownSnapshotData from "@/generated/anime-filler-own-map.json"
import {
  ANIME_FILLER_STATUS_CODES,
  fillerMapInfo,
  ownFillerMapInfo,
  resolveFillerStatus,
  resolveFillerStatusByMal,
} from "@/lib/anime-filler"

interface SnapshotRecord {
  m?: number
  t: number
  n: number
  ranges: Array<[number, number, string]>
  partial?: boolean
}

interface SnapshotMeta {
  sourceRevision: string
  sourceSnapshotDate: string
  generatedAt: string
  counts: { records: number; episodes: number; canon: number; filler: number; mixed: number; partial: number; ranges: number }
}

const RECORDS = (snapshotData as unknown as { records: SnapshotRecord[] }).records
const META = (snapshotData as unknown as { meta: SnapshotMeta }).meta
const OWN_RECORDS = (ownSnapshotData as unknown as { records: SnapshotRecord[] }).records
const OWN_META = (ownSnapshotData as unknown as {
  meta: {
    counts: {
      records: number
      episodes: number
      manga: number
      anime: number
      filler: number
      mixed: number
      ranges: number
      partial: number
    }
    sourceLicense: string
    sourceUrl: string
  }
}).meta
const PRIMARY_TMDB = new Set(RECORDS.map((record) => record.t))
const VALID_CODES: ReadonlySet<string> = new Set(ANIME_FILLER_STATUS_CODES)

describe("anime-filler resolver", () => {
  it("exposes the four canonical codes (legacy canon is an alias of manga)", () => {
    expect(ANIME_FILLER_STATUS_CODES).toEqual(["manga", "anime", "filler", "mixed"])
  })

  it("returns language-neutral codes for manga, filler and mixed edges", () => {
    // Single-range record: 1..74 legacy canon (MAL 19 / TMDB 30981); a v1
    // `canon` range resolves to the explicit manga-canon code.
    expect(resolveFillerStatus(30981, 1)).toBe("manga")
    expect(resolveFillerStatus(30981, 74)).toBe("manga")
    expect(resolveFillerStatus(30981, 75)).toBeNull()

    // Mixed/filler/canon adjacency (MAL 20 / TMDB 46260).
    expect(resolveFillerStatus(46260, 26)).toBe("filler")
    expect(resolveFillerStatus(46260, 27)).toBe("mixed")
    expect(resolveFillerStatus(46260, 74)).toBe("mixed")
    expect(resolveFillerStatus(46260, 75)).toBe("manga")
    expect(resolveFillerStatus(46260, 220)).toBe("mixed")

    // Leading mixed, canon after it, long filler run (MAL 45 / TMDB 28136).
    expect(resolveFillerStatus(28136, 1)).toBe("mixed")
    expect(resolveFillerStatus(28136, 2)).toBe("manga")
    expect(resolveFillerStatus(28136, 13)).toBe("filler")
    expect(resolveFillerStatus(28136, 18)).toBe("filler")
    expect(resolveFillerStatus(28136, 19)).toBe("manga")
    expect(resolveFillerStatus(28136, 95)).toBe("filler")
    expect(resolveFillerStatus(28136, 96)).toBeNull()
  })

  it("resolves every snapshot range at its start, midpoint and end", () => {
    for (const record of RECORDS) {
      for (const [start, end, status] of record.ranges) {
        const mid = Math.floor((start + end) / 2)
        for (const episode of [start, mid, end]) {
          const resolved = resolveFillerStatus(record.t, episode)
          // Legacy snapshot ranges store `canon`; the resolver exposes it as
          // the explicit `manga` code.
          expect(resolved, `tmdb ${record.t} episode ${episode}`).toBe(status === "canon" ? "manga" : status)
          expect(VALID_CODES.has(resolved as string)).toBe(true)
        }
      }
    }
  })

  it("returns null outside the classified window, partial records included", () => {
    for (const record of RECORDS) {
      expect(resolveFillerStatus(record.t, 0), `tmdb ${record.t} ep 0`).toBeNull()
      expect(resolveFillerStatus(record.t, -1), `tmdb ${record.t} ep -1`).toBeNull()
      expect(resolveFillerStatus(record.t, record.n + 1), `tmdb ${record.t} ep > n`).toBeNull()
      expect(resolveFillerStatus(record.t, record.n + 1000), `tmdb ${record.t} ep >> n`).toBeNull()
    }

    // Explicit partial ("Ongoing" in the source) anchors: the snapshot stops at
    // n, so episodes beyond it are unknown and must never be guessed.
    const partials = RECORDS.filter((record) => record.partial === true)
    expect(partials.length).toBeGreaterThan(0)
    for (const record of partials) {
      expect(resolveFillerStatus(record.t, record.n)).not.toBeNull()
      expect(resolveFillerStatus(record.t, record.n + 1)).toBeNull()
    }
    expect(partials.some((record) => record.t === 37854)).toBe(true)
    expect(resolveFillerStatus(37854, 1173)).toBe("manga")
    expect(resolveFillerStatus(37854, 1174)).toBeNull()
  })

  it("returns null for unknown or malformed ids and episodes", () => {
    expect(resolveFillerStatus(999999999, 1)).toBeNull()
    expect(resolveFillerStatus(0, 1)).toBeNull()
    expect(resolveFillerStatus(-42, 1)).toBeNull()

    const badValues: unknown[] = [
      NaN,
      Infinity,
      -Infinity,
      1.5,
      -1,
      0,
      "12ab",
      "1e3",
      "0x10",
      "",
      "   ",
      null,
      undefined,
      {},
      [],
      [30981],
      true,
      Number.MAX_SAFE_INTEGER + 1,
      "9007199254740992",
    ]
    for (const bad of badValues) {
      expect(resolveFillerStatus(bad, 5), `tmdb ${String(bad)}`).toBeNull()
      expect(resolveFillerStatus(30981, bad), `episode ${String(bad)}`).toBeNull()
    }
  })

  it("accepts numeric strings (route parameters) without loosening parsing", () => {
    expect(resolveFillerStatus("30981", "74")).toBe("manga")
    expect(resolveFillerStatus(" 30981 ", " 1 ")).toBe("manga")
  })

  it("keeps TMDB ids unique in the snapshot (no ambiguous lookup masking)", () => {
    const seen = new Set<number>()
    for (const record of RECORDS) {
      expect(seen.has(record.t), `duplicate tmdb ${record.t}`).toBe(false)
      seen.add(record.t)
    }
  })

  it("exposes provenance and coverage counters without records", () => {
    const info = fillerMapInfo()
    expect(info.available).toBe(true)
    expect(info.schemaVersion).toBe(1)
    expect(info.revision).toBe(META.sourceRevision)
    expect(info.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(info.snapshotDate).toBe(META.sourceSnapshotDate)
    expect(info.generatedAt).toBe(META.generatedAt)
    expect(info.recordCount).toBe(RECORDS.length)

    const counts = info.counts
    expect(counts).not.toBeNull()
    expect(counts!.episodes).toBe(RECORDS.reduce((sum, record) => sum + record.n, 0))
    expect(counts!.ranges).toBe(RECORDS.reduce((sum, record) => sum + record.ranges.length, 0))
    expect(counts!.partial).toBe(RECORDS.filter((record) => record.partial === true).length)
    expect(counts!.manga + counts!.anime + counts!.filler + counts!.mixed).toBe(counts!.episodes)
    expect(counts!.episodes).toBe(META.counts.episodes)
    // Legacy v1 snapshot: its `canon` count lands in the manga slot and the
    // anime split is an explicit 0 (not missing, not guessed).
    expect(counts!.manga).toBe(META.counts.canon)
    expect(counts!.anime).toBe(0)
    expect(counts!.filler).toBe(META.counts.filler)
    expect(counts!.mixed).toBe(META.counts.mixed)
    expect(counts!.ranges).toBe(META.counts.ranges)
    expect(info).not.toHaveProperty("records")
  })

  it("snapshot ranges are sorted, contiguous and cover exactly 1..n", () => {
    for (const record of RECORDS) {
      let expectedStart = 1
      for (const [start, end, status] of record.ranges) {
        expect(start, `tmdb ${record.t} range start`).toBe(expectedStart)
        expect(end, `tmdb ${record.t} range end`).toBeGreaterThanOrEqual(start)
        // Legacy v1 ranges store `canon` (alias of manga); v2 stores the four
        // explicit codes.
        expect(VALID_CODES.has(status) || status === "canon", `tmdb ${record.t} status ${status}`).toBe(true)
        expectedStart = end + 1
      }
      expect(expectedStart - 1, `tmdb ${record.t} coverage`).toBe(record.n)
    }
  })

  it("resolves MAL ids to the same classification as the TMDB id", () => {
    for (const record of RECORDS) {
      if (typeof record.m !== "number") continue
      expect(resolveFillerStatusByMal(record.m, 1)).toBe(resolveFillerStatus(record.t, 1))
      expect(resolveFillerStatusByMal(record.m, record.n)).toBe(resolveFillerStatus(record.t, record.n))
      expect(resolveFillerStatusByMal(record.m, record.n + 1)).toBeNull()
    }
    expect(resolveFillerStatusByMal(999999999, 1)).toBeNull()
    expect(resolveFillerStatusByMal(NaN, 1)).toBeNull()
    expect(resolveFillerStatusByMal("19", "74")).toBe("manga")
  })

  it("is deterministic, returns fresh info copies and performs no I/O", () => {
    const fetchSpy = typeof globalThis.fetch === "function" ? vi.spyOn(globalThis, "fetch") : null
    try {
      const first = resolveFillerStatus(30981, 74)
      const second = resolveFillerStatus(30981, 74)
      expect(first).toBe(second)

      const a = fillerMapInfo()
      const manga = a.counts!.manga
      a.counts!.manga = -1
      expect(fillerMapInfo().counts!.manga).toBe(manga)
      expect(fetchSpy?.mock.calls.length ?? 0).toBe(0)
    } finally {
      fetchSpy?.mockRestore()
    }
  })

  it("falls back to the separate own DB only for series absent from the primary snapshot", () => {
    // High-value titles that the 42-record CC BY 4.0 snapshot does not cover
    // resolve from the CC BY-SA 4.0 own DB.
    expect(PRIMARY_TMDB.has(85937)).toBe(false)
    expect(resolveFillerStatus(85937, 1)).toBe("manga")
    expect(resolveFillerStatus(95479, 1)).toBe("manga")
    expect(resolveFillerStatusByMal(38000, 1)).toBe("manga")

    // Generic invariant: any own record missing from the primary resolves its
    // first range through the fallback.
    const netNew = OWN_RECORDS.find((record) => !PRIMARY_TMDB.has(record.t))
    expect(netNew).toBeDefined()
    const [start, , status] = netNew!.ranges[0]
    expect(resolveFillerStatus(netNew!.t, start)).toBe(status === "canon" ? "manga" : status)
  })

  it("keeps the primary snapshot authoritative for an overlapping series (no per-episode merge)", () => {
    const own = OWN_RECORDS.find((record) => record.t === 37854)
    expect(own).toBeDefined()
    const ownStatus = own!.ranges.find(([start, end]) => 50 >= start && 50 <= end)?.[2]
    expect(ownStatus).toBe("anime")
    // The CC BY 4.0 snapshot classifies the same episode as manga; it wins.
    expect(resolveFillerStatus(37854, 50)).toBe("manga")
  })

  it("does not fall back for an episode outside the primary series window", () => {
    const own = OWN_RECORDS.find((record) => record.t === 65930)
    expect(own?.n).toBe(170)
    const ownStatus = own!.ranges.find(([start, end]) => 139 >= start && 139 <= end)?.[2]
    expect(ownStatus).toBe("manga")
    // The primary covers only 1..138 and owns the series, so 139 is unknown
    // even though the own DB would classify it. Never mix sources per series.
    expect(resolveFillerStatus(65930, 138)).toBe("manga")
    expect(resolveFillerStatus(65930, 139)).toBeNull()
  })

  it("exposes the own DB as a separate provenance record (never merged)", () => {
    const info = ownFillerMapInfo()
    expect(info.available).toBe(true)
    expect(info.schemaVersion).toBe(2)
    expect(info.recordCount).toBe(OWN_RECORDS.length)
    expect(info.sourceLicense).toBe("CC BY-SA 4.0")
    expect(info.sourceUrl).toContain("pictorium-anime-filler")
    const counts = info.counts!
    expect(counts.episodes).toBe(OWN_META.counts.episodes)
    expect(counts.episodes).toBe(OWN_RECORDS.reduce((sum, record) => sum + record.n, 0))
    expect(counts.manga + counts.anime + counts.filler + counts.mixed).toBe(counts.episodes)
    expect(info).not.toHaveProperty("records")
    // Distinct artifacts: the primary info still reports its own file.
    expect(fillerMapInfo().recordCount).toBe(RECORDS.length)
    expect(fillerMapInfo().recordCount).not.toBe(info.recordCount)
  })
})
