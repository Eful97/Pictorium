import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

const SCRIPT = path.resolve(process.cwd(), "scripts/build-anime-id-map.mjs")
const FIXTURE = path.resolve(process.cwd(), "src/__tests__/fixtures/anime-id-map-fixture.json")

function build(args: string[], cwd: string): { ok: boolean; stderr: string } {
  try {
    execFileSync("node", [SCRIPT, ...args], { cwd, stdio: ["ignore", "ignore", "pipe"] })
    return { ok: true, stderr: "" }
  } catch (e) {
    const err = e as { stderr?: Buffer | string }
    return { ok: false, stderr: String(err.stderr ?? e) }
  }
}

describe("build-anime-id-map generator", () => {
  it("builds a compact snapshot from the pinned fixture (7 records)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anime-map-"))
    const out = path.join(dir, "anime-id-map.json")
    const res = build(
      ["--input", FIXTURE, "--revision", "abc123", "--output", out, "--generated-at", "2026-01-01T00:00:00Z", "--min-records", "1"],
      process.cwd(),
    )
    expect(res.ok).toBe(true)
    const snap = JSON.parse(fs.readFileSync(out, "utf-8"))
    expect(snap.meta.schemaVersion).toBe(1)
    expect(snap.meta.sourceRevision).toBe("abc123")
    expect(snap.meta.generatedAt).toBe("2026-01-01T00:00:00.000Z")
    // 10 righe input: 1 senza TMDB, 1 senza anime-id, 1 tutta invalida, 2 non-oggetti
    // → scartate; la riga multi-film produce 2 record.
    expect(snap.records).toHaveLength(7)
    expect(snap.meta.counts.skipped).toEqual({ noTmdbTarget: 2, noAnimeId: 1, invalidRow: 2 })
    expect(snap.meta.counts.multiMovieRow).toBe(1)
    // Stagione preservata, episode_offset ignorato (non stabilisce ordinamento).
    const s1 = snap.records.find((r: { a?: number }) => r.a === 290)
    expect(s1.s).toBe(1)
    expect(s1).not.toHaveProperty("episode_offset")
    // Chiavi compatte, niente nulli espliciti.
    expect(JSON.stringify(snap)).not.toContain("null")
  })

  it("is reproducible from the same input (byte-identical with fixed generated-at)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anime-map-"))
    const out1 = path.join(dir, "a.json")
    const out2 = path.join(dir, "b.json")
    const common = ["--input", FIXTURE, "--revision", "abc123", "--generated-at", "2026-01-01T00:00:00Z", "--min-records", "1"]
    expect(build([...common, "--output", out1], process.cwd()).ok).toBe(true)
    expect(build([...common, "--output", out2], process.cwd()).ok).toBe(true)
    expect(fs.readFileSync(out1, "utf-8")).toBe(fs.readFileSync(out2, "utf-8"))
  })

  it("rejects partial-numeric and fractional ids (P2: no parseInt coercion)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anime-map-"))
    const input = path.join(dir, "edge.json")
    fs.writeFileSync(
      input,
      JSON.stringify([
        // anilist "164junk" / kitsu 142.5: righe senza id validi → scartate.
        { anilist_id: "164junk", kitsu_id: 142.5, themoviedb_id: { movie: [9001] } },
        // tmdb "128junk" scartato, 129 valido; anilist frazionario scartato ma kitsu valido.
        { anilist_id: 16.5, kitsu_id: 900, themoviedb_id: { movie: ["128junk", 129] } },
        // Controllo: interi come stringa restano validi.
        { anilist_id: "164", themoviedb_id: { movie: [128] } },
      ]),
    )
    const out = path.join(dir, "anime-id-map.json")
    const res = build(
      ["--input", input, "--revision", "edge", "--output", out, "--generated-at", "2026-01-01T00:00:00Z", "--min-records", "1"],
      process.cwd(),
    )
    expect(res.ok).toBe(true)
    const snap = JSON.parse(fs.readFileSync(out, "utf-8"))
    // Solo 2 record: {k:900,t:129} e {a:164,t:128}. Niente 9001, niente "128junk"→128.
    expect(snap.records).toHaveLength(2)
    expect(snap.records).toContainEqual({ k: 900, t: 129, y: "movie" })
    expect(snap.records).toContainEqual({ a: 164, t: 128, y: "movie" })
    expect(JSON.stringify(snap.records)).not.toContain("9001")
    expect(snap.meta.counts.skipped).toEqual({ noTmdbTarget: 0, noAnimeId: 1, invalidRow: 0 })
  })

  it("rejects malformed replacement data and keeps the valid snapshot", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anime-map-"))
    const out = path.join(dir, "anime-id-map.json")
    fs.writeFileSync(out, `{"meta":{},"records":[]}`)
    const before = fs.readFileSync(out, "utf-8")

    const badJson = path.join(dir, "bad.json")
    fs.writeFileSync(badJson, "{not valid json")
    expect(build(["--input", badJson, "--revision", "x", "--output", out, "--min-records", "1"], process.cwd()).ok).toBe(false)

    const notArray = path.join(dir, "obj.json")
    fs.writeFileSync(notArray, `{"records":[]}`)
    expect(build(["--input", notArray, "--revision", "x", "--output", out, "--min-records", "1"], process.cwd()).ok).toBe(false)

    const empty = path.join(dir, "empty.json")
    fs.writeFileSync(empty, `[]`)
    expect(build(["--input", empty, "--revision", "x", "--output", out, "--min-records", "1"], process.cwd()).ok).toBe(false)

    // Sotto --min-records (dataset troncato) → rifiutato.
    expect(
      build(["--input", FIXTURE, "--revision", "x", "--output", out, "--min-records", "99999"], process.cwd()).ok,
    ).toBe(false)

    expect(fs.readFileSync(out, "utf-8")).toBe(before)
  })
})
