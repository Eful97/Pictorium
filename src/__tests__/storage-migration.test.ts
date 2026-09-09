import { beforeEach, describe, expect, it } from "vitest"
import { migrateLegacyStorage } from "@/lib/storage-migration"

beforeEach(() => {
  localStorage.clear()
})

describe("migrateLegacyStorage", () => {
  it("copies legacy posterium_* keys to pictorium_* and removes the old ones", () => {
    localStorage.setItem("posterium_theme", "light")
    localStorage.setItem("posterium_onboarding_done", "true")

    migrateLegacyStorage()

    expect(localStorage.getItem("pictorium_theme")).toBe("light")
    expect(localStorage.getItem("pictorium_onboarding_done")).toBe("true")
    expect(localStorage.getItem("posterium_theme")).toBeNull()
    expect(localStorage.getItem("posterium_onboarding_done")).toBeNull()
  })

  it("does not overwrite existing pictorium_* values", () => {
    localStorage.setItem("posterium_theme", "light")
    localStorage.setItem("pictorium_theme", "dark")

    migrateLegacyStorage()

    expect(localStorage.getItem("pictorium_theme")).toBe("dark")
    expect(localStorage.getItem("posterium_theme")).toBeNull()
  })

  it("normalizes legacy posterium-* catalog IDs inside saved lists", () => {
    localStorage.setItem("posterium_disabled_catalogs", JSON.stringify(["posterium-jw-movies", "pictorium-anime"]))
    localStorage.setItem("posterium_catalog_renames", JSON.stringify({ "posterium-anime": "Anime" }))

    migrateLegacyStorage()

    expect(JSON.parse(localStorage.getItem("pictorium_disabled_catalogs")!)).toEqual([
      "pictorium-jw-movies",
      "pictorium-anime",
    ])
    expect(JSON.parse(localStorage.getItem("pictorium_catalog_renames")!)).toEqual({
      "pictorium-anime": "Anime",
    })
  })

  it("is idempotent and leaves neutral keys untouched", () => {
    localStorage.setItem("posterium_theme", "light")
    localStorage.setItem("tmdb_key", "k")
    localStorage.setItem("preferred_lang", "it")

    migrateLegacyStorage()
    migrateLegacyStorage()

    expect(localStorage.getItem("pictorium_theme")).toBe("light")
    expect(localStorage.getItem("tmdb_key")).toBe("k")
    expect(localStorage.getItem("preferred_lang")).toBe("it")
  })
})
