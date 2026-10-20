/**
 * F5 regression: filesystem-backend resilience of badge-preset-store.
 *
 * 1. Concurrent create x2 + delete + list never loses an index entry: the
 *    per-module write mutex serializes read-modify-write, so concurrent
 *    mutations converge on the full document (no lost updates, which a
 *    backoff-only fix would mask but not cure).
 * 2. A transient Windows share-lock (EPERM on rename, proven by the F5 raw-OS
 *    probe: 200/200 renames over an open reader fail, 300/300 sequential
 *    succeed) is absorbed by the bounded same-tmp retry: the save succeeds
 *    and the document on disk is whole JSON.
 * 3. Exhaustion stays fail-closed: the error surfaces, the last-good target
 *    is intact, no .tmp residue.
 *
 * Fault injection via spied `fsp.rename` (controllable, no wall clock).
 * Transient/exhaustion cases are win32-gated because the production retry is
 * deliberately Windows-only; the retry mechanics themselves are covered
 * cross-platform in atomic-write-transient-retry.test.ts via __testForce.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  __resetPresetStoreForTests,
  deletePreset,
  getPreset,
  listUserPresets,
  savePreset,
  type PresetCreateInput,
} from "@/lib/badge-preset-store"

const design = {
  shape: "pill" as const,
  padding: { x: 12, y: 6 },
  background: { type: "solid" as const, color: "#123456", opacity: 90 },
  text: {
    template: "F5 {{rating}}",
    color: "#ffffff",
    opacity: 100,
    fontSize: 20,
    fontWeight: 700 as const,
    uppercase: false,
    letterSpacing: 0,
    align: "center" as const,
  },
  scale: 100,
}

function makeInput(name: string): PresetCreateInput {
  return {
    target: "genre",
    visibility: "private",
    metadata: { name, tags: [] },
    design: structuredClone(design),
  }
}

function errWithCode(code: string): NodeJS.ErrnoException {
  const e = new Error(`${code} simulated`) as NodeJS.ErrnoException
  e.code = code
  return e
}

const dirs: string[] = []

beforeEach(async () => {
  vi.stubEnv("PICTORIUM_REDIS_URL", "")
  vi.stubEnv("KV_REST_API_URL", "")
  vi.stubEnv("KV_REST_API_TOKEN", "")
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-presets-f5-"))
  dirs.push(dir)
  vi.stubEnv("PICTORIUM_DATA_DIR", dir)
  __resetPresetStoreForTests()
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const d of dirs.splice(0)) await fsp.rm(d, { recursive: true, force: true })
})

describe("preset file store resilience (F5)", () => {
  it("concurrent creates + delete + list lose no index entry", async () => {
    const owner = randomUUID()
    const [a, b, listed] = await Promise.all([
      savePreset(owner, makeInput("F5-Concurrent-A")),
      savePreset(owner, makeInput("F5-Concurrent-B")),
      listUserPresets(owner),
    ])
    void listed
    const afterSaves = await listUserPresets(owner)
    const ids = new Set(afterSaves.map((s) => s.preset.id))
    expect(ids.has(a.preset.id)).toBe(true)
    expect(ids.has(b.preset.id)).toBe(true)

    expect(await deletePreset(owner, a.preset.id)).toBe(true)
    const afterDelete = await listUserPresets(owner)
    expect(afterDelete.map((s) => s.preset.id)).toEqual([b.preset.id])
    expect((await getPreset(a.preset.id))).toBeNull()
    expect((await getPreset(b.preset.id))?.preset.metadata.name).toBe("F5-Concurrent-B")
  })

  it.runIf(process.platform === "win32")(
    "transient EPERM on rename is absorbed, document whole",
    async () => {
      const owner = randomUUID()
      const realRename = fsp.rename.bind(fsp)
      let calls = 0
      vi.spyOn(fsp, "rename").mockImplementation(async (src, dest) => {
        calls++
        if (calls === 1) throw errWithCode("EPERM")
        return realRename(src as string, dest as string)
      })
      const stored = await savePreset(owner, makeInput("F5-Transient"))
      expect(calls).toBeGreaterThanOrEqual(2)
      const dir = process.env.PICTORIUM_DATA_DIR as string
      const raw = await fsp.readFile(path.join(dir, "presets-store.json"), "utf-8")
      const doc = JSON.parse(raw) as { presets: Record<string, { metadata: { name: string } }> }
      expect(doc.presets[stored.preset.id].metadata.name).toBe("F5-Transient")
      expect((await getPreset(stored.preset.id))?.preset.id).toBe(stored.preset.id)
      expect((await fsp.readdir(dir)).filter((f) => f.includes(".tmp"))).toEqual([])
    },
  )

  it.runIf(process.platform === "win32")(
    "persistent EPERM fails closed with the last-good target intact",
    async () => {
      const owner = randomUUID()
      const before = await savePreset(owner, makeInput("F5-Before"))
      vi.spyOn(fsp, "rename").mockRejectedValue(errWithCode("EPERM"))
      await expect(savePreset(owner, makeInput("F5-Lost"))).rejects.toMatchObject({ code: "EPERM" })
      const dir = process.env.PICTORIUM_DATA_DIR as string
      const raw = await fsp.readFile(path.join(dir, "presets-store.json"), "utf-8")
      const doc = JSON.parse(raw) as { presets: Record<string, unknown> }
      expect(Object.keys(doc.presets)).toEqual([before.preset.id])
      expect((await fsp.readdir(dir)).filter((f) => f.includes(".tmp"))).toEqual([])
    },
  )
})
