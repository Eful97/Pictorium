import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const DIR = join(process.cwd(), "src", "lib", "translations")
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()

// Regression (final gate Group C): 16 dictionaries shipped a lone
// Windows-1252 0x97 byte (cp1252 em-dash) at `ui.familyFixedLayoutNote`
// where UTF-8 E2 80 94 (U+2014) belonged. Read tools displayed U+FFFD —
// the decoder's replacement glyph, which as a real character (EF BF BD)
// is valid JSON and was never the cause. The actual fault was the
// malformed byte sequence, rejected only by Turbopack's strict JSON-module
// parser (Node JSON.parse, tsc and jsdom all accepted it). Strict
// TextDecoder with { fatal: true } reproduces the Turbopack-class failure
// at unit scope: malformed bytes throw instead of being replaced.
describe("translations raw UTF-8 encoding", () => {
  it("ships all 18 dictionaries", () => {
    expect(FILES).toHaveLength(18)
  })

  it.each(FILES)("strict UTF-8 + valid JSON + no lone surrogates: %s", (file) => {
    const buf = readFileSync(join(DIR, file))
    let text: string
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf)
    } catch {
      throw new Error(
        `${file}: malformed UTF-8 byte sequence (strict decode failed; Turbopack rejects it)`,
      )
    }
    expect(
      () => JSON.parse(text),
      `${file}: raw bytes must parse as JSON`,
    ).not.toThrow()
    const lone = text.match(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    )
    expect(lone, `${file}: lone surrogates`).toBeNull()
  })
})
