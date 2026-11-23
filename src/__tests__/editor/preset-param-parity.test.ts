import fs from "node:fs"
import { describe, expect, it } from "vitest"
import { visualPresetValuesSchema } from "@/lib/visual-presets"

/**
 * Guard against the "preset saves field A but forgets field B" bug class:
 * every key a visual preset carries must have a counterpart field on the
 * Stremio poster URL builder input (`StremioPosterParamsInput`), otherwise
 * the value can be saved and applied in the editor but never reach the poster.
 *
 * Naming rule: preset flat key `defaultFooBar` <-> builder field `fooBar`;
 * keys of the nested `landscape` profile already use the builder names.
 * Keys that intentionally never travel in the poster URL are listed in
 * EDITOR_ONLY with the reason.
 */
const EDITOR_ONLY: Readonly<Record<string, string>> = {
  defaultPortraitFitEnabled: "toggles the auto-fit poster search; resolved from saved defaults by best-fit-config, not a poster URL query param",
  defaultLandscapeFitEnabled: "same as defaultPortraitFitEnabled, for the landscape canvas",
}

function interfaceFields(file: string, name: string): Set<string> {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")
  const start = text.indexOf(`export interface ${name}`)
  expect(start, `${name} not found in ${file}`).toBeGreaterThanOrEqual(0)
  const open = text.indexOf("{", start)
  let depth = 0
  let end = open
  for (; end < text.length; end++) {
    if (text[end] === "{") depth++
    if (text[end] === "}" && --depth === 0) break
  }
  const fields = new Set<string>()
  for (const m of text.slice(open + 1, end).matchAll(/^ {0,2}(?:readonly )?([A-Za-z0-9_]+)\??:/gm)) fields.add(m[1])
  return fields
}

const builderFields = interfaceFields("src/lib/stremio-poster-params.ts", "StremioPosterParamsInput")
const builderNameOf = (presetKey: string): string =>
  presetKey.startsWith("default") ? presetKey[7].toLowerCase() + presetKey.slice(8) : presetKey

function shapeKeys(schema: unknown): string[] {
  let s = schema as { shape?: Record<string, unknown>; unwrap?: () => unknown }
  while (!s.shape && typeof s.unwrap === "function") s = s.unwrap() as typeof s
  return Object.keys(s.shape ?? {})
}

describe("visual preset <-> poster URL builder parity", () => {
  const flat = shapeKeys(visualPresetValuesSchema).filter((k) => k !== "landscape")
  const landscape = shapeKeys(visualPresetValuesSchema.shape.landscape)

  it("reads a non-trivial number of keys (guards against a broken parser)", () => {
    expect(builderFields.size).toBeGreaterThan(50)
    expect(flat.length).toBeGreaterThan(50)
    expect(landscape.length).toBeGreaterThan(20)
  })

  it("every flat preset key maps to a URL builder field or is documented editor-only", () => {
    const missing = flat.filter((k) => !builderFields.has(builderNameOf(k)) && !(k in EDITOR_ONLY))
    expect(missing).toEqual([])
  })

  it("every landscape profile key maps to a URL builder field or is documented editor-only", () => {
    const missing = landscape.filter((k) => !builderFields.has(k) && !(k in EDITOR_ONLY))
    expect(missing).toEqual([])
  })

  it("EDITOR_ONLY has no stale entries", () => {
    const all = new Set([...flat, ...landscape])
    expect(Object.keys(EDITOR_ONLY).filter((k) => !all.has(k))).toEqual([])
  })
})
