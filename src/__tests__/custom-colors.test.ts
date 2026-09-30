import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import sharp from "sharp"
import { sampleCustomImageColors } from "@/lib/custom-colors"
import { __resetCustomImageStateForTests } from "@/lib/custom-poster-base"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"

async function solidPng(): Promise<Buffer> {
  return sharp({
    create: { width: 200, height: 300, channels: 3, background: { r: 200, g: 100, b: 20 } },
  }).png().toBuffer()
}

function imageResponse(body: Buffer | string, contentType: string, status = 200): Response {
  return new Response(body as unknown as BodyInit, {
    status,
    headers: { "content-type": contentType },
  })
}

const HEX_RE = /^#[0-9a-f]{6}$/
let signal: AbortSignal

beforeEach(() => {
  signal = AbortSignal.timeout(60_000)
  __resetImageBytesForTest()
  __resetCustomImageStateForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
  __resetCustomImageStateForTests()
})

describe("sampleCustomImageColors", () => {
  it("campiona accent/top/bottom esadecimali da un host allowlisted", async () => {
    const png = await solidPng()
    const colors = await sampleCustomImageColors("https://assets.fanart.tv/fanart/movies/1/movieposter/a.jpg", "Dramma", signal, {
      checkBlocked: async () => false,
      fetchRemote: async () => imageResponse(png, "image/png"),
    })
    expect(colors).not.toBeNull()
    expect(colors?.accent).toMatch(HEX_RE)
    expect(colors?.topEdge).toMatch(HEX_RE)
    expect(colors?.bottomEdge).toMatch(HEX_RE)
  })

  it("null su host fuori allowlist, byte corrotti e target bloccati", async () => {
    const noBlock = { checkBlocked: async () => false }
    expect(await sampleCustomImageColors("https://evil.com/x.jpg", "", signal, noBlock)).toBeNull()
    expect(
      await sampleCustomImageColors("https://assets.fanart.tv/x.jpg", "", signal, {
        ...noBlock,
        fetchRemote: async () => imageResponse("corrupt", "image/jpeg"),
      }),
    ).toBeNull()
    expect(
      await sampleCustomImageColors("https://assets.fanart.tv/x.jpg", "", signal, {
        checkBlocked: async () => true,
      }),
    ).toBeNull()
  })

  it("null su scheme non-HTTP", async () => {
    expect(
      await sampleCustomImageColors("ftp://assets.fanart.tv/x.jpg", "", signal, { checkBlocked: async () => false }),
    ).toBeNull()
  })
})
