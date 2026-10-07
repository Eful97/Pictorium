import { describe, expect, it, vi } from "vitest"
// Exercise the real registry + loader: opt out of the global @/lib/i18n mock
// (it lacks registerDictionary, which the loader needs).
vi.unmock("@/lib/i18n")

import { createT, getDictionary, isDictionaryLoaded } from "@/lib/i18n"
import { loadLanguage } from "@/lib/i18n-loader"
import enDict from "@/lib/translations/en.json"
import frDict from "@/lib/translations/fr.json"
import jaDict from "@/lib/translations/ja.json"
import es419Dict from "@/lib/translations/es-419.json"

// Minimal transport mock: only the vi chunk fails, every other language loads
// the real JSON. A throwing factory makes the dynamic import reject, which is
// exactly the chunk-load failure shape the loader must survive.
vi.mock("@/lib/translations/vi.json", () => {
  throw new Error("mock transport failure")
})

const en = enDict as Record<string, string>
const fr = frDict as Record<string, string>
const ja = jaDict as Record<string, string>
const es419 = es419Dict as Record<string, string>

describe("i18n-loader", () => {
  it("keeps en/it synchronously available without loading", () => {
    expect(isDictionaryLoaded("en")).toBe(true)
    expect(isDictionaryLoaded("it")).toBe(true)
    expect(createT("it")("badge.today")).toBeDefined()
  })

  it("loads a language chunk on demand and resolves its keys", async () => {
    const dict = await loadLanguage("fr")
    expect(dict["badge.today"]).toBe(fr["badge.today"])
    expect(isDictionaryLoaded("fr")).toBe(true)
    expect(createT("fr")("badge.today")).toBe(fr["badge.today"])
  })

  it("falls back to English for unknown languages without fetching", async () => {
    const dict = await loadLanguage("xx")
    expect(dict).toBe(getDictionary("en"))
    expect(createT("xx")("badge.today")).toBe(en["badge.today"])
    expect(isDictionaryLoaded("xx")).toBe(false)
  })

  it("canonicalizes es-MX to the es-419 dictionary", async () => {
    await loadLanguage("es-MX")
    expect(isDictionaryLoaded("es-419")).toBe(true)
    expect(createT("es-MX")("badge.today")).toBe(es419["badge.today"])
    expect(createT("es-419")("badge.today")).toBe(es419["badge.today"])
  })

  it("dedups concurrent loads into a single import", async () => {
    const [a, b] = await Promise.all([loadLanguage("ja"), loadLanguage("ja")])
    expect(a).toBe(b)
    expect(a["badge.today"]).toBe(ja["badge.today"])
    // Sequential call after completion is served from the registry.
    await expect(loadLanguage("ja")).resolves.toBe(a)
    expect(createT("ja")("badge.today")).toBe(ja["badge.today"])
  })

  it("never caches failures: the language stays unloaded and the loader keeps working", async () => {
    // Each attempt rejects with a fresh error (not a cached resolution), the
    // language is never marked loaded, and other languages still load.
    const first = await loadLanguage("vi").then(
      () => null,
      (err: unknown) => err,
    )
    const second = await loadLanguage("vi").then(
      () => null,
      (err: unknown) => err,
    )
    expect(first).toBeInstanceOf(Error)
    expect(second).toBeInstanceOf(Error)
    expect(first).not.toBe(second)
    expect(isDictionaryLoaded("vi")).toBe(false)
    // The failure poisons nothing else: other languages still load.
    await expect(loadLanguage("fr")).resolves.toBe(getDictionary("fr"))
  })
})
