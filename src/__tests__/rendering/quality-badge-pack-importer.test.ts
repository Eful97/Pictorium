import { execFile } from "node:child_process"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)

/**
 * `scripts/import-quality-badge-pack.mjs` is an operator CLI (top-level await +
 * network). These tests run it as a child process against a local mock server:
 * no remote source, deterministic bytes, the same path an operator uses.
 */
const ROOT = path.resolve(__dirname, "../../..")
const SCRIPT = path.join(ROOT, "scripts", "import-quality-badge-pack.mjs")
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30"><rect width="100" height="30" fill="#fff"/></svg>'

async function withServer(
  files: Record<string, string>,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((req, res) => {
    const body = files[req.url ?? ""]
    if (!body) {
      res.statusCode = 404
      res.end("not found")
      return
    }
    res.setHeader("content-type", "image/svg+xml")
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const port = (server.address() as AddressInfo).port
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function runImporter(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  // Async on purpose: the mock server lives in this process, so a sync child
  // would block the event loop and deadlock the importer's fetch.
  return execFileAsync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  }).then(
    ({ stdout, stderr }) => ({ ok: true, stdout, stderr }),
    (error: { stdout?: string; stderr?: string }) => ({
      ok: false,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? error),
    }),
  )
}

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

describe("quality badge pack importer", () => {
  it("skips built-in ids before reserving/renaming them (no dv-2 slip-through)", async () => {
    await withServer({ "/mark.svg": SVG }, async (base) => {
      const dir = tempDir("quality-pack-builtin-")
      const source = path.join(dir, "source.json")
      const out = path.join(dir, "pack.json")
      const assets = path.join(dir, "assets")
      fs.writeFileSync(
        source,
        JSON.stringify({
          filters: [
            { id: "DV", name: "DV", imageURL: `${base}/mark.svg`, isEnabled: true },
            { id: "DV", name: "Dolby Vision", imageURL: `${base}/mark.svg`, isEnabled: true },
          ],
        }),
      )

      const result = await runImporter([source, "--out", out, "--assets-dir", assets])

      expect(result.ok, result.stderr).toBe(true)
      const manifest = JSON.parse(fs.readFileSync(out, "utf8")) as { marks: unknown[] }
      // Before the fix the second entry was renamed to `dv-2` and imported.
      expect(manifest.marks).toEqual([])
      expect(result.stdout).toContain("dv: id già coperto")
      expect(fs.readdirSync(assets)).toEqual([])
    })
  }, 30_000)

  it("removes previous-manifest assets the new pack no longer uses, never unrelated fixtures", async () => {
    await withServer({ "/new.svg": SVG }, async (base) => {
      const dir = tempDir("quality-pack-replace-")
      const assets = path.join(dir, "assets")
      fs.mkdirSync(assets, { recursive: true })
      fs.writeFileSync(path.join(assets, "stale.svg"), SVG)
      fs.writeFileSync(path.join(assets, "fixture.svg"), SVG)

      const out = path.join(dir, "pack.json")
      fs.writeFileSync(
        out,
        JSON.stringify({
          version: "1",
          source: "previous",
          marks: [
            {
              id: "stale",
              label: "STALE",
              icon: "quality-badges/pack/stale.svg",
              mode: "tintable",
              inkBox: { x: 0, y: 0, w: 100, h: 30 },
            },
          ],
        }),
      )
      const source = path.join(dir, "source.json")
      fs.writeFileSync(
        source,
        JSON.stringify({
          filters: [{ id: "new", name: "NEW", imageURL: `${base}/new.svg`, isEnabled: true }],
        }),
      )

      const result = await runImporter([source, "--out", out, "--assets-dir", assets])

      expect(result.ok, result.stderr).toBe(true)
      const manifest = JSON.parse(fs.readFileSync(out, "utf8")) as { marks: Array<{ id: string }> }
      expect(manifest.marks.map((mark) => mark.id)).toEqual(["new"])
      expect(fs.existsSync(path.join(assets, "stale.svg"))).toBe(false)
      // Not referenced by the previous manifest: a repo fixture must survive.
      expect(fs.existsSync(path.join(assets, "fixture.svg"))).toBe(true)
      expect(fs.existsSync(path.join(assets, "new.svg"))).toBe(true)
      expect(result.stdout).toContain("stale.svg")
    })
  }, 30_000)
})
