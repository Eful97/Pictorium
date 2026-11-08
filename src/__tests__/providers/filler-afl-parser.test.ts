import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  AFL_MAX_PAGE_BYTES,
  AFL_REQUEST_TIMEOUT_MS,
  AFL_ROBOTS_CRAWL_DELAY_SECONDS,
  AFL_USER_AGENT,
  detectExclusion,
  parseAflShowHtml,
} from "../../../scripts/parse-afl-fixture.mjs"

const ROOT = path.resolve(__dirname, "..", "..", "..")
const SCRIPT = path.join(ROOT, "scripts", "parse-afl-fixture.mjs")

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "afl-fixture-"))
}

function runCli(args: string[]): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { ok: true, stdout: String(stdout), stderr: "", status: 0 }
  } catch (error) {
    const failure = error as { stdout?: unknown; stderr?: unknown; status?: number | null }
    return {
      ok: false,
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? ""),
      status: failure.status ?? null,
    }
  }
}

function row(number: number, type: string, airDate = "2024-01-01"): string {
  return (
    `<tr class="episode odd" id="eps-${number}">` +
    `<td class="Number">${number}</td>` +
    `<td class="Title"><a href="/shows/demo/episode-${number}">Episode ${number}</a></td>` +
    `<td class="Type"><span>${type}</span></td>` +
    `<td class="Date">${airDate}</td>` +
    `</tr>`
  )
}

function page(options: {
  title: string
  slug: string
  rows: string[]
  declaredTotal?: number
  declaredFiller?: number
  description?: string
}): string {
  const { title, slug, rows, declaredTotal = rows.length, declaredFiller = 0 } = options
  const description = options.description ?? `${title} is a Japanese anime television series.`
  return `<!DOCTYPE html>
<html>
<head>
  <title>${title} Filler List | The Ultimate Anime Filler Guide</title>
  <meta name="description" content="${description}" />
  <link rel="canonical" href="https://www.animefillerlist.com/shows/${slug}" />
</head>
<body>
  <div id="node-1" class="node node-anime" about="/shows/${slug}">
    <span property="dc:title" content="${title}" class="rdf-meta element-hidden"></span>
    <h1>${title} Filler List</h1>
    <p>${title} was an anime series. In total ${declaredTotal} episodes were aired. With a total of ${declaredFiller} reported filler episodes, ${title} has a filler percentage of 25%.</p>
    <table class="episodes">
      <tbody>${rows.join("\n")}</tbody>
    </table>
  </div>
</body>
</html>`
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function parse(title: string, rows: string[], options: { slug?: string; declaredTotal?: number; declaredFiller?: number; description?: string } = {}) {
  const slug = options.slug ?? "demo-show"
  return parseAflShowHtml(
    page({
      title,
      slug,
      rows,
      declaredTotal: options.declaredTotal,
      declaredFiller: options.declaredFiller,
      description: options.description,
    }),
    { slug, sourceUrl: `https://www.animefillerlist.com/shows/${slug}` },
  )
}

function thrownBy(fn: () => unknown): { code?: string; message?: string } {
  try {
    fn()
  } catch (error) {
    return error as { code?: string; message?: string }
  }
  throw new Error("expected the parser to throw")
}

describe("AFL fixture parser: type mapping and ranges", () => {
  it("maps Manga Canon to manga, Anime Canon to anime, Filler to filler and Mixed Canon/Filler to mixed", () => {
    const parsed = parse("Demo Show", [
      row(1, "Manga Canon"),
      row(2, "Anime Canon"),
      row(3, "Filler"),
      row(4, "Mixed Canon/Filler"),
      row(5, "Filler"),
    ])
    expect(parsed.episodes.map((episode: { status: string }) => episode.status)).toEqual([
      "manga",
      "anime",
      "filler",
      "mixed",
      "filler",
    ])
    expect(parsed.classification?.counts).toEqual({ manga: 1, anime: 1, filler: 2, mixed: 1 })
    expect(parsed.ranges).toEqual([
      [1, 1, "manga"],
      [2, 2, "anime"],
      [3, 3, "filler"],
      [4, 4, "mixed"],
      [5, 5, "filler"],
    ])
    expect(parsed.meta.bundleable).toBe(false)
    expect(parsed.meta.permission).toBe("pending-written-permission")
    expect(parsed.validation.contiguous).toBe(true)
    expect(parsed.validation.episodeCount).toBe(5)
  })

  it("parses the two canon families as distinct adjacent ranges", () => {
    const parsed = parse("Canon Show", [row(1, "Manga Canon"), row(2, "Anime Canon"), row(3, "Manga Canon")])
    expect(parsed.ranges).toEqual([
      [1, 1, "manga"],
      [2, 2, "anime"],
      [3, 3, "manga"],
    ])
    expect(parsed.classification?.counts).toEqual({ manga: 2, anime: 1, filler: 0, mixed: 0 })
  })

  it("sorts out-of-order rows and reports a DOM-order warning", () => {
    const parsed = parse("Shuffled Show", [row(2, "Filler"), row(1, "Manga Canon")])
    expect(parsed.ranges).toEqual([
      [1, 1, "manga"],
      [2, 2, "filler"],
    ])
    expect(parsed.validation.domOrderMatches).toBe(false)
    expect(parsed.warnings).toContainEqual(expect.objectContaining({ code: "dom-order" }))
  })
})

describe("AFL fixture parser: contiguity and validation", () => {
  it("rejects a gap in the 1..N numbering", () => {
    expect(thrownBy(() => parse("Gap Show", [row(1, "Manga Canon"), row(3, "Filler")])).code).toBe(
      "non-contiguous-episodes",
    )
  })

  it("rejects duplicate episode numbers", () => {
    expect(
      thrownBy(() => parse("Duplicate Show", [row(1, "Manga Canon"), row(1, "Filler"), row(2, "Manga Canon")])).code,
    ).toBe("duplicate-episode-number")
  })

  it("rejects an empty page", () => {
    expect(thrownBy(() => parse("Empty Show", [])).code).toBe("no-episodes")
    expect(thrownBy(() => parseAflShowHtml("", {})).code).toBe("empty-page")
  })

  it("rejects an unknown AFL episode type instead of guessing", () => {
    expect(thrownBy(() => parse("Unknown Show", [row(1, "Manga Canon"), row(2, "Recap Episode")])).code).toBe(
      "unknown-episode-type",
    )
  })

  it("rejects a page whose canonical slug disagrees with the requested slug", () => {
    const html = page({ title: "Demo Show", slug: "actual-show", rows: [row(1, "Manga Canon")] })
    expect(thrownBy(() => parseAflShowHtml(html, { slug: "requested-show" })).code).toBe("slug-mismatch")
  })

  it("excludes embedded episode 0 specials and keeps 1..N contiguous", () => {
    const parsed = parse("Bonus Show", [row(0, "Anime Canon"), row(1, "Manga Canon"), row(2, "Filler")])
    expect(parsed.validation.episodeCount).toBe(2)
    expect(parsed.validation.embeddedSpecialsExcluded).toEqual([
      expect.objectContaining({ number: 0, sourceType: "Anime Canon" }),
    ])
    expect(parsed.ranges).toEqual([
      [1, 1, "manga"],
      [2, 2, "filler"],
    ])
    expect(parsed.warnings).toContainEqual(expect.objectContaining({ code: "embedded-specials-excluded" }))
    expect(parsed.usableForBundle).toBe(true)
  })

  it("warns when the declared totals disagree with the table", () => {
    const parsed = parse("Declared Show", [row(1, "Manga Canon"), row(2, "Filler")], {
      declaredTotal: 3,
      declaredFiller: 2,
    })
    expect(parsed.validation.declaredCountMatches).toBe(false)
    expect(parsed.warnings).toContainEqual(expect.objectContaining({ code: "declared-total-mismatch" }))
    expect(parsed.warnings).toContainEqual(expect.objectContaining({ code: "declared-filler-mismatch" }))
  })

  it("exposes the crawler policy constants", () => {
    expect(AFL_ROBOTS_CRAWL_DELAY_SECONDS).toBe(10)
    expect(AFL_REQUEST_TIMEOUT_MS).toBe(10000)
    expect(AFL_MAX_PAGE_BYTES).toBeGreaterThan(0)
    expect(AFL_USER_AGENT).toContain("Pictorium")
  })
})

describe("AFL fixture parser: exclusions", () => {
  it("excludes known fan edits by slug or title", () => {
    for (const [slug, title] of [
      ["one-pace", "One Pace"],
      ["the-one-piece", "The One Piece"],
      ["boruto-naruto-next-generations-definitive-filler-list", "Boruto: Naruto Next Generations (Definitive)"],
      ["attack-on-titan-junior-high", "Attack on Titan: Junior High"],
      ["some-show", "Some Show (Abridged)"],
    ]) {
      const exclusion = detectExclusion({ slug, title })
      expect(exclusion, `${slug}/${title}`).toEqual(expect.objectContaining({ code: "fan-edit" }))
    }
  })

  it("excludes films, OVAs, OADs and specials by title", () => {
    for (const title of ["Naruto Films", "Bleach OVAs", "Attack on Titan OADs", "One Piece Specials", "Demo Movie"]) {
      expect(detectExclusion({ slug: "demo", title }), title).toEqual(
        expect.objectContaining({ code: "non-tv-media" }),
      )
    }
  })

  it("excludes films signalled only by the meta description", () => {
    const parsed = parse("Berserk: The Golden Age Arc", [row(1, "Manga Canon"), row(2, "Filler")], {
      slug: "berserk-golden-age-arc",
      description:
        "Berserk: The Golden Age Arc is a trilogy of anime films adapted from Kentarou Miura's Berserk manga.",
    })
    expect(parsed.excluded).toEqual(expect.objectContaining({ code: "non-tv-media" }))
    expect(parsed.excluded?.matched).toContain("trilogy of anime films")
    expect(parsed.usableForBundle).toBe(false)
    expect(parsed.ranges).toEqual([])
  })

  it("does not exclude a TV series whose description mentions a television series", () => {
    const parsed = parse("Demo Show", [row(1, "Manga Canon")], {
      description: "Demo Show is a Japanese anime television series produced by Studio Demo.",
    })
    expect(parsed.excluded).toBeNull()
    expect(parsed.usableForBundle).toBe(true)
  })

  it("does not exclude an ordinary TV show", () => {
    expect(detectExclusion({ slug: "naruto", title: "Naruto" })).toBeNull()
    expect(detectExclusion({ slug: "one-piece", title: "One Piece" })).toBeNull()
    expect(detectExclusion({ slug: "fullmetal-alchemist-brotherhood", title: "Fullmetal Alchemist: Brotherhood" })).toBeNull()
  })

  it("emits no ranges for excluded pages and marks the fixture unusable", () => {
    const parsed = parse("One Pace", [row(1, "Manga Canon"), row(2, "Filler")], { slug: "one-pace" })
    expect(parsed.excluded).toEqual(expect.objectContaining({ code: "fan-edit" }))
    expect(parsed.usableForBundle).toBe(false)
    expect(parsed.episodes).toEqual([])
    expect(parsed.ranges).toEqual([])
    expect(parsed.classification).toBeNull()

    const film = parse("Demo Films", [row(1, "Filler")], { slug: "demo-films" })
    expect(film.excluded).toEqual(expect.objectContaining({ code: "non-tv-media" }))
    expect(film.ranges).toEqual([])
  })
})

describe("AFL fixture parser: CLI", () => {
  it("prints help without any network request", () => {
    const result = runCli(["--help"])
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain("AFL fixture parser")
    expect(result.stdout).toContain("Crawl-delay: 10 seconds")
    expect(result.stdout).toContain("refuses to write inside the repository")
    expect(result.stdout).toContain("Exit codes:")
  })

  it("parses a local fixture and writes only to a temp path", () => {
    const dir = tmpDir()
    const fixture = path.join(dir, "demo.html")
    const out = path.join(dir, "demo.json")
    write(fixture, page({ title: "Demo Show", slug: "demo-show", rows: [row(1, "Manga Canon"), row(2, "Filler")] }))

    const result = runCli([
      "--fixture", fixture,
      "--slug", "demo-show",
      "--out", out,
      "--fetched-at", "2026-11-07T00:00:00.000Z",
    ])
    expect(result.ok, result.stderr).toBe(true)
    expect(result.stdout).toContain("episodes=2")
    expect(result.stdout).toContain("requests=0")

    const payload = JSON.parse(fs.readFileSync(out, "utf-8"))
    expect(payload.meta.fetchedAt).toBe("2026-11-07T00:00:00.000Z")
    expect(payload.meta.crawler).toEqual(
      expect.objectContaining({
        crawlDelaySeconds: 10,
        singlePagePerRun: true,
        requestsThisRun: 0,
      }),
    )
    expect(payload.meta.bundleable).toBe(false)
    expect(payload.meta.snapshotWritten).toBe(false)
    expect(payload.meta.permission).toBe("pending-written-permission")
    expect(payload.usableForBundle).toBe(true)
    expect(payload.ranges).toEqual([
      [1, 1, "manga"],
      [2, 2, "filler"],
    ])
  })

  it("writes excluded pages but keeps them non-bundleable", () => {
    const dir = tmpDir()
    const fixture = path.join(dir, "one-pace.html")
    const out = path.join(dir, "one-pace.json")
    write(fixture, page({ title: "One Pace", slug: "one-pace", rows: [row(1, "Manga Canon")] }))

    const result = runCli(["--fixture", fixture, "--slug", "one-pace", "--out", out])
    expect(result.ok, result.stderr).toBe(true)
    expect(result.stdout).toContain("excluded=fan-edit")
    const payload = JSON.parse(fs.readFileSync(out, "utf-8"))
    expect(payload.excluded.code).toBe("fan-edit")
    expect(payload.usableForBundle).toBe(false)
    expect(payload.ranges).toEqual([])
  })

  it("refuses to write inside the repository and never touches the snapshot", () => {
    const dir = tmpDir()
    const fixture = path.join(dir, "demo.html")
    write(fixture, page({ title: "Demo Show", slug: "demo-show", rows: [row(1, "Manga Canon")] }))
    const snapshot = path.join(ROOT, "src", "generated", "anime-filler-map.json")
    const before = createHash("sha256").update(fs.readFileSync(snapshot)).digest("hex")

    const result = runCli(["--fixture", fixture, "--slug", "demo-show", "--out", snapshot])
    expect(result.ok).toBe(false)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("refusing to write inside the repository")

    const after = createHash("sha256").update(fs.readFileSync(snapshot)).digest("hex")
    expect(after).toBe(before)
  })

  it("reports validation failures with exit code 2", () => {
    const dir = tmpDir()
    const fixture = path.join(dir, "gap.html")
    const out = path.join(dir, "gap.json")
    write(fixture, page({ title: "Gap Show", slug: "gap-show", rows: [row(1, "Manga Canon"), row(3, "Filler")] }))

    const result = runCli(["--fixture", fixture, "--slug", "gap-show", "--out", out])
    expect(result.ok).toBe(false)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("non-contiguous-episodes")
    expect(fs.existsSync(out)).toBe(false)
  })

  it("requires exactly one page per run and rejects unknown arguments", () => {
    expect(runCli(["--slug", "a", "--slug", "b"]).stderr).toContain("exactly one page per run")
    expect(runCli(["--nope"]).stderr).toContain("unknown argument")
    expect(runCli([]).stderr).toContain("provide --slug")
  })
})
