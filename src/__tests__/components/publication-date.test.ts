import { describe, expect, it, vi } from "vitest"
import { formatPublicationDate, parsePublicationStamp } from "@/lib/publication-date"

const t = (key: string) => key

describe("parsePublicationStamp", () => {
  it("accepts finite positive ms epochs and numeric strings (headers arrive as strings)", () => {
    expect(parsePublicationStamp(1761331200000)).toBe(1761331200000)
    expect(parsePublicationStamp("1761331200000")).toBe(1761331200000)
    expect(parsePublicationStamp(946684800000)).toBe(946684800000)
  })

  it("rejects null, non-numeric, non-positive, non-integer and unbounded values", () => {
    expect(parsePublicationStamp(null)).toBeNull()
    expect(parsePublicationStamp(undefined)).toBeNull()
    expect(parsePublicationStamp("yesterday")).toBeNull()
    expect(parsePublicationStamp("")).toBeNull()
    expect(parsePublicationStamp("   ")).toBeNull()
    expect(parsePublicationStamp(0)).toBeNull()
    expect(parsePublicationStamp(-5)).toBeNull()
    expect(parsePublicationStamp(1761331200.5)).toBeNull()
    expect(parsePublicationStamp(NaN)).toBeNull()
    expect(parsePublicationStamp(Infinity)).toBeNull()
    expect(parsePublicationStamp(946684799999)).toBeNull()
    expect(parsePublicationStamp(4102444800000)).toBeNull()
  })
})

describe("formatPublicationDate", () => {
  it("formats a valid stamp with ISO dateTime and locale date text", () => {
    const out = formatPublicationDate(1761331200000, "it", t)
    expect(out).not.toBeNull()
    expect(out!.iso).toBe(new Date(1761331200000).toISOString())
    // Europe/Rome rendering, Italian locale, short zone name.
    expect(out!.dateText).toContain("2025")
    expect(out!.label).toBe("ui.publicationLabel")
  })

  it("renders English locale labels", () => {
    const out = formatPublicationDate(1761331200000, "en", t)
    expect(out).not.toBeNull()
    expect(out!.iso).toBe(new Date(1761331200000).toISOString())
  })

  it("supports RTL locales without throwing and keeps a valid ISO", () => {
    for (const lang of ["ar", "he"]) {
      const out = formatPublicationDate(1761331200000, lang, t)
      expect(out, lang).not.toBeNull()
      expect(out!.iso).toBe(new Date(1761331200000).toISOString())
      expect(out!.dateText.length).toBeGreaterThan(0)
      expect(out!.dateText).not.toBe(out!.iso)
    }
  })

  it("returns null for invalid input without calling t", () => {
    const tt = vi.fn((key: string) => key)
    for (const bad of [null, undefined, 0, -1, "x", NaN, 946684799999, 4102444800000]) {
      expect(formatPublicationDate(bad, "it", tt)).toBeNull()
    }
    expect(tt).not.toHaveBeenCalled()
  })

  it("returns null for an invalid locale instead of throwing", () => {
    expect(formatPublicationDate(1761331200000, "xx-invalid-!!", t)).toBeNull()
  })
})
