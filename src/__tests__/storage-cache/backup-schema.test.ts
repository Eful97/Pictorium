import { describe, expect, it } from "vitest"
import {
  BACKUP_SCHEMA_VERSION,
  parseBackupBody,
  stripBackupSecrets,
} from "@/lib/backup-schema"

describe("parseBackupBody", () => {
  it("tratta un array grezzo come v1 (solo poster)", () => {
    const body = [{ tmdbId: 1 }]
    expect(parseBackupBody(body)).toEqual({ kind: "v1", mappings: body })
  })

  it("tratta { mappings } senza schemaVersion come v1", () => {
    const mappings = [{ tmdbId: 1 }]
    expect(parseBackupBody({ mappings })).toEqual({ kind: "v1", mappings })
  })

  it("tratta { schemaVersion: 1, mappings } come v1", () => {
    const mappings = [{ tmdbId: 1 }]
    expect(parseBackupBody({ schemaVersion: 1, mappings })).toEqual({ kind: "v1", mappings })
  })

  it("classifica il backup completo come v2 con sole sezioni presenti", () => {
    const parsed = parseBackupBody({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      mappings: [],
      presets: [],
      local: { lang: "it" },
    })
    expect(parsed).toEqual({
      kind: "v2",
      sections: { mappings: [], presets: [] },
    })
  })

  it("un v2 con solo `local` è local-only (niente lavoro server)", () => {
    expect(parseBackupBody({ schemaVersion: 2, local: { lang: "it" } })).toEqual({ kind: "local-only" })
  })

  it("un v2 senza sezioni né `local` è invalid", () => {
    expect(parseBackupBody({ schemaVersion: 2 }).kind).toBe("invalid")
  })

  it("rifiuta body senza sezioni note", () => {
    expect(parseBackupBody({ foo: 1 }).kind).toBe("invalid")
    expect(parseBackupBody(null).kind).toBe("invalid")
    expect(parseBackupBody("x").kind).toBe("invalid")
  })
})

describe("stripBackupSecrets", () => {
  it("rimuove serverKeys, flag istanza e chiavi/token/secret", () => {
    const out = stripBackupSecrets({
      badgeStyle: "shadow",
      customRatingEndpoint: "https://x/?imdb={imdbId}",
      customRatingApiKeyHeader: "X-Key",
      serverKeys: { tmdbKey: "SECRET" },
      hasInstanceKeys: { tmdbKey: true },
      tmdbKey: "SECRET",
      mdblistApiKey: "SECRET",
      someToken: "SECRET",
      apiSecret: "SECRET",
      password: "SECRET",
    })
    expect(out).toEqual({
      badgeStyle: "shadow",
      customRatingEndpoint: "https://x/?imdb={imdbId}",
      customRatingApiKeyHeader: "X-Key",
    })
  })

  it("torna {} su input non-oggetto", () => {
    expect(stripBackupSecrets(null)).toEqual({})
    expect(stripBackupSecrets([1])).toEqual({})
  })
})

describe("retired Badge Lab backup section", () => {
  it("parseBackupBody keeps a legacy `presets` section for the import route to ignore", () => {
    expect(parseBackupBody({ schemaVersion: 2, presets: [{ id: "Abc12345" }] })).toEqual({
      kind: "v2",
      sections: { presets: [{ id: "Abc12345" }] },
    })
  })
})
