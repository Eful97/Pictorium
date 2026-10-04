import { execFile } from "node:child_process"
import path from "node:path"
import { describe, expect, it } from "vitest"

const rootDir = path.resolve(__dirname, "..", "..")
const script = path.join(rootDir, "scripts", "tune-env.mjs")

interface TuneJson {
  host: { cpus: number; limitedBy: string }
  candidates: number[]
  recommendation: {
    tier: string
    maxConcurrentRenders: number
    sharpConcurrency: number
    nodeOldSpaceMb: number
  }
  envBlock: string
}

function runJson(args: string[]): Promise<{ code: number; json: TuneJson; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [script, "--json", ...args], { cwd: rootDir, timeout: 60000 }, (err, stdout, stderr) => {
      // execFile err non-nullo su exit != 0: riporta comunque stdout per il debug.
      if (err && !stdout) {
        reject(new Error(`tune-env exit ${err.code}: ${stderr.slice(0, 500)}`))
        return
      }
      try {
        const code = err && typeof err === "object" && "code" in err ? Number(err.code) || 1 : 0
        resolve({ code, json: JSON.parse(stdout) as TuneJson, stderr: String(stderr) })
      } catch {
        reject(new Error(`output non-JSON: ${String(stdout).slice(0, 500)}`))
      }
    })
  })
}

describe("tune-env.mjs (black-box, senza bench)", () => {
  it("profilo tiny su macchina piccola", async () => {
    const { json } = await runJson(["--mem-mb", "512", "--cpus", "1"])
    expect(json.recommendation.tier).toBe("tiny")
    expect(json.recommendation.maxConcurrentRenders).toBe(2)
    expect(json.recommendation.sharpConcurrency).toBe(1)
    expect(json.recommendation.nodeOldSpaceMb).toBeLessThanOrEqual(256)
    expect(json.envBlock).toContain("PICTORIUM_MAX_CONCURRENT_RENDERS=2")
  })

  it("profilo large su macchina grossa", async () => {
    const { json } = await runJson(["--mem-mb", "16384", "--cpus", "8"])
    expect(json.recommendation.tier).toBe("large")
    expect(json.recommendation.maxConcurrentRenders).toBe(4)
    expect(json.recommendation.sharpConcurrency).toBe(4)
    expect(json.recommendation.nodeOldSpaceMb).toBe(2048)
  })

  it("rispetta --candidates e --cpus", async () => {
    const { json } = await runJson(["--mem-mb", "4096", "--cpus", "4", "--candidates", "2,4,6"])
    expect(json.candidates).toEqual([2, 4, 6])
    expect(json.host.cpus).toBe(4)
    expect(json.host.limitedBy).toBe("override")
  })

  it("rifiuta candidates invalidi", async () => {
    await expect(runJson(["--candidates", "xx"])).rejects.toThrow()
  })
})
