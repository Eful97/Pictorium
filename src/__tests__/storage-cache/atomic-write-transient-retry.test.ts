/**
 * F5 regression: bounded transient-rename retry in atomicWriteFile.
 *
 * Proven root cause (F5 probe `rename-stress-probe.mjs`): on Windows,
 * `rename(tmp, target)` fails with EPERM/EBUSY/EACCES whenever ANY handle on
 * the target is open at that instant (200/200 failures renaming over an open
 * reader; 300/300 sequential renames succeed, so dir/permissions are fine).
 * A concurrent reader (store loadFileDoc outside the write mutex, AV/indexer,
 * dev watcher) can therefore 500 a preset save. The retry below keeps the
 * SAME completed tmp and the atomic replace; exhaustion stays fail-closed.
 *
 * Determinism: fault injection via spied `fsp.rename` (no wall clock, no
 * HTTP). `__testForce` engages the Windows-only gate cross-platform; the
 * production path is win32-gated inside atomicWriteFile.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { promises as fsp } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { atomicWriteFile } from "@/lib/atomic-write"

const dirs: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const d of dirs.splice(0)) await fsp.rm(d, { recursive: true, force: true })
})

async function freshDir(): Promise<string> {
  const d = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-atomic-f5-"))
  dirs.push(d)
  return d
}

function errWithCode(code: string): NodeJS.ErrnoException {
  const e = new Error(`${code} simulated`) as NodeJS.ErrnoException
  e.code = code
  return e
}

async function tmpResidue(dir: string): Promise<string[]> {
  return (await fsp.readdir(dir)).filter((f) => f.includes(".tmp"))
}

describe("atomicWriteFile transient-rename retry (F5)", () => {
  it("first attempt succeeds with a single rename and whole content", async () => {
    const dir = await freshDir()
    const file = path.join(dir, "data.json")
    const renameSpy = vi.spyOn(fsp, "rename")
    await atomicWriteFile(file, JSON.stringify({ a: 1 }), {
      renameRetry: { attempts: 5, delayMs: 0, __testForce: true },
    })
    expect(renameSpy).toHaveBeenCalledTimes(1)
    expect(await fsp.readFile(file, "utf-8")).toBe(JSON.stringify({ a: 1 }))
    expect(await tmpResidue(dir)).toEqual([])
  })

  it("recovers from transient EPERM reusing the SAME tmp, content whole", async () => {
    const dir = await freshDir()
    const file = path.join(dir, "data.json")
    const realRename = fsp.rename.bind(fsp)
    const seenTmps: string[] = []
    let calls = 0
    vi.spyOn(fsp, "rename").mockImplementation(async (src, dest) => {
      calls++
      seenTmps.push(String(src))
      if (calls <= 2) throw errWithCode("EPERM")
      return realRename(src as string, dest as string)
    })
    await atomicWriteFile(file, JSON.stringify({ v: "recovered" }), {
      renameRetry: { attempts: 5, delayMs: 0, __testForce: true },
    })
    expect(calls).toBe(3)
    // Same completed tmp retried: atomic replace preserved, no rewrite.
    expect(new Set(seenTmps).size).toBe(1)
    expect(await fsp.readFile(file, "utf-8")).toBe(JSON.stringify({ v: "recovered" }))
    expect(await tmpResidue(dir)).toEqual([])
  })

  it("retries EBUSY/EACCES too, but never an unrelated error", async () => {
    const dir = await freshDir()
    const file = path.join(dir, "data.json")
    const realRename = fsp.rename.bind(fsp)
    let calls = 0
    vi.spyOn(fsp, "rename").mockImplementation(async (src, dest) => {
      calls++
      if (calls === 1) throw errWithCode("EBUSY")
      if (calls === 2) throw errWithCode("EACCES")
      return realRename(src as string, dest as string)
    })
    await atomicWriteFile(file, "{}", { renameRetry: { attempts: 5, delayMs: 0, __testForce: true } })
    expect(calls).toBe(3)

    // Unrelated error: single attempt, tmp cleaned, same error surfaces.
    const dir2 = await freshDir()
    const file2 = path.join(dir2, "data.json")
    let calls2 = 0
    vi.spyOn(fsp, "rename").mockImplementation(async () => {
      calls2++
      throw errWithCode("ENOSPC")
    })
    await expect(
      atomicWriteFile(file2, "{}", { renameRetry: { attempts: 5, delayMs: 0, __testForce: true } }),
    ).rejects.toMatchObject({ code: "ENOSPC" })
    expect(calls2).toBe(1)
    expect(await tmpResidue(dir2)).toEqual([])
  })

  it("exhaustion throws the last error and keeps the old target intact", async () => {
    const dir = await freshDir()
    const file = path.join(dir, "data.json")
    await atomicWriteFile(file, JSON.stringify({ old: true }))
    vi.spyOn(fsp, "rename").mockRejectedValue(errWithCode("EPERM"))
    await expect(
      atomicWriteFile(file, JSON.stringify({ new: true }), {
        renameRetry: { attempts: 3, delayMs: 0, __testForce: true },
      }),
    ).rejects.toMatchObject({ code: "EPERM" })
    expect(fsp.rename).toHaveBeenCalledTimes(3)
    // Fail-closed: last-good target untouched, tmp cleaned, no partial write.
    expect(await fsp.readFile(file, "utf-8")).toBe(JSON.stringify({ old: true }))
    expect(await tmpResidue(dir)).toEqual([])
  })

  it("default callers are unchanged: EPERM throws after one attempt", async () => {
    const dir = await freshDir()
    const file = path.join(dir, "data.json")
    vi.spyOn(fsp, "rename").mockRejectedValue(errWithCode("EPERM"))
    await expect(atomicWriteFile(file, "{}")).rejects.toMatchObject({ code: "EPERM" })
    expect(fsp.rename).toHaveBeenCalledTimes(1)
    expect(await tmpResidue(dir)).toEqual([])
  })

  it("EXDEV still takes the copy+unlink fallback without retry", async () => {
    const dir = await freshDir()
    const file = path.join(dir, "data.json")
    const realRename = fsp.rename.bind(fsp)
    const realCopy = fsp.copyFile.bind(fsp)
    let renames = 0
    let copies = 0
    vi.spyOn(fsp, "rename").mockImplementation(async (src, dest) => {
      renames++
      if (renames === 1) throw errWithCode("EXDEV")
      return realRename(src as string, dest as string)
    })
    vi.spyOn(fsp, "copyFile").mockImplementation(async (...args) => {
      copies++
      return realCopy(...args)
    })
    await atomicWriteFile(file, JSON.stringify({ x: 1 }), {
      renameRetry: { attempts: 5, delayMs: 0, __testForce: true },
    })
    expect(renames).toBe(1)
    expect(copies).toBe(1)
    expect(await fsp.readFile(file, "utf-8")).toBe(JSON.stringify({ x: 1 }))
    expect(await tmpResidue(dir)).toEqual([])
  })

  it("preserves mode 0o600 on secrets with retry enabled", async () => {
    if (process.platform === "win32") return // mode POSIX non verificabile
    const dir = await freshDir()
    const file = path.join(dir, "keys.json")
    await atomicWriteFile(file, "{}", {
      mode: 0o600,
      renameRetry: { attempts: 5, delayMs: 0, __testForce: true },
    })
    const st = await fsp.stat(file)
    expect(st.mode & 0o777).toBe(0o600)
  })
})
