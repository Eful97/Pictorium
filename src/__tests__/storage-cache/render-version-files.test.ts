import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * Coerenza RENDER_FILES (scripts/write-render-version.mjs) con l'albero delle
 * dipendenze di rendering: un nuovo file importato da poster-service.ts (o
 * dalla route poster) ma dimenticato in RENDER_FILES non busterebbe `rv` e
 * servirebbe cache stale. Il test fallisce esplicitamente in quel caso.
 */
const ROOT = path.resolve(__dirname, "../../..")

function readRenderFiles(): string[] {
  const script = fs.readFileSync(path.join(ROOT, "scripts/write-render-version.mjs"), "utf-8")
  // Il primo path contiene "[type]/[id]": il terminatore è la `]` a inizio riga.
  const body = script.match(/const RENDER_FILES = \[([\s\S]*?)\n\]/)?.[1] ?? ""
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

function readRenderDirs(): string[] {
  const script = fs.readFileSync(path.join(ROOT, "scripts/write-render-version.mjs"), "utf-8")
  const body = script.match(/const RENDER_DIRS = \[([\s\S]*?)\n\]/)?.[1] ?? ""
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/** File di una RENDER_DIR, repo-relative con "/" (stessa forma dello script). */
function walkRenderDir(rel: string): string[] {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`
    if (entry.isDirectory()) out.push(...walkRenderDir(child))
    else out.push(child)
  }
  return out
}

/** Import locali "./x" / "@/lib/x" risolti a path repo (solo .ts). */
function localImportsOf(relFile: string): string[] {
  const abs = path.join(ROOT, relFile)
  if (!fs.existsSync(abs)) return []
  const src = fs.readFileSync(abs, "utf-8")
  const out: string[] = []
  // `import type` è cancellato a compile-time: nessun effetto sul rendering.
  const code = src.replace(/^\s*import\s+type\s+.*$/gm, "")
  for (const m of code.matchAll(/from\s+["'](\.\/[^"']+|@\/lib\/[^"']+)["']/g)) {
    const spec = m[1]
    const rel = spec.startsWith("@/lib/")
      ? `src/lib/${spec.slice("@/lib/".length)}`
      : path.posix.join(path.posix.dirname(relFile), spec)
    const normalized = rel.endsWith(".ts") ? rel : `${rel}.ts`
    if (normalized.startsWith("src/")) out.push(normalized)
  }
  return [...new Set(out)]
}

describe("RENDER_FILES consistency", () => {
  it("ogni file elencato esiste su disco (RENDER_FILES + RENDER_DIRS)", () => {
    const files = [...readRenderFiles(), ...readRenderDirs().flatMap(walkRenderDir)]
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      // Ogni entry (sorgenti .ts, font, SVG, JSON) deve esistere su disco.
      expect(fs.existsSync(path.join(ROOT, f)), `missing RENDER_FILE: ${f}`).toBe(true)
    }
  })

  it("copre gli import diretti di poster-service.ts (niente stale rv)", () => {
    // poster-service.ts è il compositore visuale: ogni suo import diretto con
    // effetto byte-level deve stare in RENDER_FILES, altrimenti una modifica
    // lì non busterebbe `rv` (è così che si è trovato
    // separate-rating-renderer.ts mancante). La route poster ha decine di
    // import non-visivi (tmdb/store/rate-limit/logger): fuori scope.
    const files = new Set(readRenderFiles())
    const root = "src/lib/poster-service.ts"
    // Intenzionalmente esclusi: storage (cache.ts) e output dello script.
    const excluded = new Set(["src/lib/cache.ts", "src/lib/render-version.ts"])
    for (const dep of localImportsOf(root)) {
      if (dep.endsWith(".tsx") || excluded.has(dep)) continue
      expect(files.has(dep), `${root} importa ${dep} non coperto da RENDER_FILES`).toBe(true)
    }
  })
})
