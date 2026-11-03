// Step 3 — persisted MDBList raw rows carry `whatson_features` alongside the
// numeric sources (envelope v2), stay fail-closed on legacy v1 rows and never
// lose the features on a raw-cache roundtrip.
import fsp from "node:fs/promises"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const DAY = 24 * 60 * 60 * 1000

const tmpDirs: string[] = []
let dataDir = ""

function approvedBase(): string {
  const approved = "C:\\Users\\lucaf\\AppData\\Local\\Temp\\opencode"
  try {
    if (existsSync(approved)) return approved
  } catch {
    // platform default
  }
  return os.tmpdir()
}

async function stubFileMode(): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(approvedBase(), "pictorium-mdblist-raw-features-"))
  tmpDirs.push(dir)
  dataDir = dir
  vi.stubEnv("PICTORIUM_DATA_DIR", dir)
  vi.stubEnv("PICTORIUM_REDIS_URL", "")
  vi.stubEnv("POSTERIUM_REDIS_URL", "")
  vi.stubEnv("REDIS_URL", "")
  vi.stubEnv("KV_REST_API_URL", "")
  vi.stubEnv("KV_REST_API_TOKEN", "")
}

function rawDir(): string {
  return path.join(dataDir, "mdblist-raw")
}

const FEATURES = {
  imdbTopRanking: 42,
  metacriticMustSee: true,
  rottenTomatoesCriticsCertified: true,
  rottenTomatoesUsersCertified: false,
}

async function freshPersist() {
  vi.resetModules()
  return import("@/lib/mdblist-raw-cache")
}

beforeEach(async () => {
  await stubFileMode()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

afterAll(async () => {
  for (const dir of tmpDirs) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe("mdblist raw persisted features (envelope v2)", () => {
  it("roundtrips sources + whatsonFeatures with the original absolute TTL", async () => {
    const persist = await freshPersist()
    const key = "mdb:raw:v3:movie:tt_feat_round:a1b2c3d4:mv10"
    expect(await persist.setPersistedMdbRaw(key, { imdb: 8.4 }, DAY, FEATURES)).toBe(true)

    const hit = await persist.getPersistedMdbRaw(key)
    expect(hit?.sources).toEqual({ imdb: 8.4 })
    expect(hit?.whatsonFeatures).toEqual(FEATURES)
    expect(hit?.remainingTtlMs).toBeGreaterThan(DAY - 60_000)
    expect(hit?.remainingTtlMs).toBeLessThanOrEqual(DAY)

    // Payload shape: v2 envelope, features under `f`, no secret/key plaintext.
    const files = await fsp.readdir(rawDir())
    expect(files).toHaveLength(1)
    const raw = await fsp.readFile(path.join(rawDir(), files[0]), "utf-8")
    const envelope = JSON.parse(raw) as Record<string, unknown>
    expect(envelope.v).toBe(2)
    expect(envelope.d).toEqual({ imdb: 8.4 })
    expect(envelope.f).toEqual(FEATURES)
    // Filename is the hash of the full identity, never the raw key plaintext.
    expect(files[0]).not.toContain("tt_feat_round")
  })

  it("reads legacy v1 rows fail-closed: sources served, features omitted", async () => {
    const persist = await freshPersist()
    const key = "mdb:raw:v3:movie:tt_feat_legacy:a1b2c3d4:mv10"
    const filename = persist.mdbRawPersistFilename(key)
    expect(filename).toBeTruthy()
    await fsp.mkdir(rawDir(), { recursive: true })
    await fsp.writeFile(
      path.join(rawDir(), filename!),
      JSON.stringify({ v: 1, key, d: { imdb: 7.1 }, t: Date.now(), ttl: DAY }),
    )

    const hit = await persist.getPersistedMdbRaw(key)
    expect(hit?.sources).toEqual({ imdb: 7.1 })
    expect(hit?.whatsonFeatures).toBeUndefined()
  })

  it("drops an invalid v2 feature payload without losing the sources", async () => {
    const persist = await freshPersist()
    const key = "mdb:raw:v3:movie:tt_feat_bad:a1b2c3d4:mv10"
    const filename = persist.mdbRawPersistFilename(key)
    await fsp.mkdir(rawDir(), { recursive: true })
    await fsp.writeFile(
      path.join(rawDir(), filename!),
      JSON.stringify({
        v: 2,
        key,
        d: { imdb: 6.6 },
        f: { imdbTopRanking: 999, metacriticMustSee: "true" },
        t: Date.now(),
        ttl: DAY,
      }),
    )

    const hit = await persist.getPersistedMdbRaw(key)
    expect(hit?.sources).toEqual({ imdb: 6.6 })
    // No invented certification and no out-of-window rank.
    expect(hit?.whatsonFeatures).toBeUndefined()
  })

  it("omits an empty feature payload (no false certification on disk)", async () => {
    const persist = await freshPersist()
    const key = "mdb:raw:v3:movie:tt_feat_empty:a1b2c3d4:mv10"
    expect(await persist.setPersistedMdbRaw(key, { imdb: 8.0 }, DAY, {
      imdbTopRanking: null,
      metacriticMustSee: false,
      rottenTomatoesCriticsCertified: false,
      rottenTomatoesUsersCertified: false,
    })).toBe(true)

    const files = await fsp.readdir(rawDir())
    const envelope = JSON.parse(await fsp.readFile(path.join(rawDir(), files[0]), "utf-8")) as Record<string, unknown>
    expect(envelope.f).toBeUndefined()
    expect((await persist.getPersistedMdbRaw(key))?.whatsonFeatures).toBeUndefined()
  })
})
