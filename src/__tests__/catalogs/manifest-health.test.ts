import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { buildManifestResponse } from "@/lib/build-manifest"
import { encodeConfig } from "@/lib/config-token"

// Stremio clients accept manifests up to 8 KB (the addon SDK / community
// tooling treats anything larger as a health problem). Measured on the real
// response body, not estimated from a subset.
const MANIFEST_BYTE_CAP = 8192

type ManifestExtra = {
  name: string
  isRequired?: boolean
  options?: string[]
}

type ManifestCatalog = {
  id: string
  type: string
  name: string
  extra?: ManifestExtra[]
}

type Manifest = {
  id: string
  name: string
  description?: string
  version: string
  resources: Array<string | { name: string; types?: string[]; idPrefixes?: string[] }>
  types: string[]
  idPrefixes?: string[]
  catalogs: ManifestCatalog[]
  background?: string
  contactEmail?: string
  behaviorHints?: Record<string, unknown>
}

async function loadManifest(url = "http://localhost:3000/manifest.json") {
  const res = await buildManifestResponse(new NextRequest(url))
  const text = await res.text()
  return { res, text, manifest: JSON.parse(text) as Manifest }
}

describe("manifest health (Stremio addon contract)", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("keeps the default-space manifest below the 8 KB cap", async () => {
    // Deterministic base measurement: the optional contact email is covered
    // by its own test and must not inflate the ambient default-space size.
    vi.stubEnv("PICTORIUM_CONTACT_EMAIL", "")
    const { text, manifest } = await loadManifest()
    const bytes = Buffer.byteLength(text, "utf8")
    const largest = manifest.catalogs
      .map((catalog) => ({ id: catalog.id, bytes: Buffer.byteLength(JSON.stringify(catalog), "utf8") }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8)
      .map((catalog) => `${catalog.id}=${catalog.bytes}B`)
      .join(", ")
    expect(
      bytes,
      `manifest is ${bytes} bytes (cap ${MANIFEST_BYTE_CAP}); largest catalogs: ${largest}`,
    ).toBeLessThan(MANIFEST_BYTE_CAP)
  })

  it("passes the stremio-addon-linter manifest checks (inline, no extra dependency)", async () => {
    const { manifest } = await loadManifest()

    // Basic information (linter: id/name strings, version valid semver).
    expect(typeof manifest.id).toBe("string")
    expect(manifest.id).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(typeof manifest.name).toBe("string")
    expect(manifest.name.trim().length).toBeGreaterThan(0)
    expect(typeof manifest.description).toBe("string")
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)

    // Resources: string or { name, types, idPrefixes } and known names only.
    expect(Array.isArray(manifest.resources)).toBe(true)
    const knownResources = new Set(["catalog", "meta", "stream", "subtitles", "player", "library"])
    for (const [index, resource] of manifest.resources.entries()) {
      if (typeof resource === "string") {
        expect(knownResources.has(resource), `manifest.resources[${index}] unknown value ${resource}`).toBe(true)
        continue
      }
      expect(typeof resource, `manifest.resources[${index}]`).toBe("object")
      expect(typeof resource.name, `manifest.resources[${index}].name`).toBe("string")
      expect(knownResources.has(resource.name), `manifest.resources[${index}] unknown value ${resource.name}`).toBe(true)
      expect(Array.isArray(resource.types), `manifest.resources[${index}].types`).toBe(true)
      if (resource.idPrefixes !== undefined) {
        expect(Array.isArray(resource.idPrefixes), `manifest.resources[${index}].idPrefixes`).toBe(true)
      }
    }

    expect(Array.isArray(manifest.types)).toBe(true)
    expect(manifest.types.every((type) => typeof type === "string")).toBe(true)
    if (manifest.idPrefixes !== undefined) expect(Array.isArray(manifest.idPrefixes)).toBe(true)

    // Catalogs: id/type/name strings, unique ids, extra array shape.
    expect(Array.isArray(manifest.catalogs)).toBe(true)
    const ids = new Set<string>()
    for (const [index, catalog] of manifest.catalogs.entries()) {
      expect(typeof catalog.id, `catalogs[${index}].id`).toBe("string")
      expect(typeof catalog.type, `catalogs[${index}].type`).toBe("string")
      expect(typeof catalog.name, `catalogs[${index}].name`).toBe("string")
      expect(ids.has(catalog.id), `duplicate catalog id ${catalog.id}`).toBe(false)
      ids.add(catalog.id)
      if (catalog.extra === undefined) continue
      expect(Array.isArray(catalog.extra), `catalogs[${index}].extra`).toBe(true)
      for (const [extraIndex, extra] of catalog.extra.entries()) {
        expect(typeof extra.name, `catalogs[${index}].extra[${extraIndex}].name`).toBe("string")
        if (extra.isRequired !== undefined) {
          expect(typeof extra.isRequired, `catalogs[${index}].extra[${extraIndex}].isRequired`).toBe("boolean")
        }
        if (extra.options !== undefined) {
          expect(Array.isArray(extra.options), `catalogs[${index}].extra[${extraIndex}].options`).toBe(true)
          expect(extra.options.every((option) => typeof option === "string")).toBe(true)
        }
      }
    }

    // behaviorHints is an object and its boolean flags stay booleans.
    expect(typeof manifest.behaviorHints).toBe("object")
    for (const flag of ["adult", "configurable", "configurationRequired"] as const) {
      const value = manifest.behaviorHints?.[flag]
      if (value !== undefined) expect(typeof value, `behaviorHints.${flag}`).toBe("boolean")
    }
  })

  it("advertises skip only where a second page is possible", async () => {
    const { manifest } = await loadManifest()
    const byId = new Map(manifest.catalogs.map((catalog) => [catalog.id, catalog]))
    const extraNames = (id: string) => byId.get(id)?.extra?.map((extra) => extra.name)

    // Bounded built-ins (Top 10 / Top 20) never return 100 items: no skip.
    expect(extraNames("pictorium-jw-movies")).toEqual(["genre"])
    expect(extraNames("pictorium-netflix-movies")).toEqual(["genre"])
    expect(extraNames("pictorium-anime-movies")).toEqual(["genre"])
    // Search catalogs paginate: skip stays.
    expect(extraNames("pictorium-search-movies")).toEqual(["search", "skip"])
    expect(extraNames("pictorium-search-people-movies")).toEqual(["search", "skip"])
  })

  it("keeps skip on custom catalogs (never trims user catalogs)", async () => {
    const token = encodeConfig({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "pill",
      rankingBadgeStyle: "default",
      blurEnabled: true,
      blurIntensity: 50,
      blurFade: 30,
      blurDarkness: 40,
      gradientHeight: 35,
      networkLogo: true,
      autoRotateClean: true,
      customCatalogs: [
        {
          id: "manifest-health-list",
          name: "Manifest health list",
          type: "movie",
          url: "https://mdblist.com/lists/example/manifest-health",
          enabled: true,
        },
      ],
    })
    const req = new NextRequest(`https://pictorium.test/manifest.json?config=${token}`)
    const res = await buildManifestResponse(req, null, token)
    const manifest = (await res.json()) as Manifest
    const custom = manifest.catalogs.find((catalog) => catalog.id === "pictorium-custom-movie-manifest-health-list")
    expect(custom?.extra?.map((extra) => extra.name)).toEqual(["genre", "skip"])
  })

  it("exposes an absolute background URL and the configured contact email", async () => {
    vi.stubEnv("PICTORIUM_CONTACT_EMAIL", "ops@example.com")
    const { manifest } = await loadManifest()

    expect(manifest.background).toBe("http://localhost:3000/Screen/home.png")
    // Stremio docs: background must be a png/jpg at least 1024x786. The
    // shipped home screenshot is 2559x1439.
    expect(new URL(manifest.background!).protocol).toBe("http:")
    expect(manifest.contactEmail).toBe("ops@example.com")
  })

  it("omits contactEmail when the configured value is not an address", async () => {
    vi.stubEnv("PICTORIUM_CONTACT_EMAIL", "not-an-email")
    const { manifest } = await loadManifest()
    expect(manifest.contactEmail).toBeUndefined()
  })
})
