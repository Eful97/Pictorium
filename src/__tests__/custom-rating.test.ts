// @vitest-environment node
import { Readable } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"
import { request } from "undici"
import { fetchCustomRatings, formatRating, resolveCustomRatingConfig } from "@/lib/custom-rating"
import { renderMultiRatings } from "@/lib/multi-rating-renderer"
import sharp from "sharp"
import type { LookupFunction } from "node:net"
import { lookup } from "node:dns"

const connection = vi.hoisted(() => ({ lookup: undefined as LookupFunction | undefined }))
vi.mock("node:dns", () => ({ lookup: vi.fn() }))
vi.mock("undici", () => ({ Agent: class {
  constructor(options: { connect: { lookup: LookupFunction } }) { connection.lookup = options.connect.lookup }
}, request: vi.fn() }))
const config = { enabled: true, endpoint: "https://example.com/ratings/{imdbId}" }
const sample = { id: "source1", name: "Source 1", value: 8.8, format: "decimal" }
const mockedRequest = vi.mocked(request)
function respond(body: string, statusCode = 200) {
  mockedRequest.mockResolvedValue({ statusCode, body: Readable.from([Buffer.from(body)]) } as unknown as Awaited<ReturnType<typeof request>>)
}
afterEach(() => vi.clearAllMocks())

describe("custom rating", () => {
  it("validates the response and sends the secret only in the configured header", async () => {
    respond(JSON.stringify({ ratings: [sample] }))
    expect(await fetchCustomRatings("tt1375666", { ...config, apiKey: "test-secret" })).toEqual([sample])
    const [url, options] = mockedRequest.mock.calls[0]
    expect(String(url)).toBe("https://example.com/ratings/tt1375666")
    expect(options?.headers).toMatchObject({ "X-API-Key": "test-secret" })
  })
  it("formats without changing the scale", () => {
    expect(formatRating(87, "percent")).toBe("87%")
    expect(formatRating(8.7, "decimal")).toBe("8.7")
  })
  it.each(['bad json', '{"invalid":87}', '{"ratings":null}', '{"ratings":{}}', '{}', '{"ratings":[{"id":"a","name":"A","value":1e999,"format":"decimal"}]}', '[]', 'x'.repeat(16385)])("ignores invalid or oversized data %#", async body => {
    respond(body)
    expect(await fetchCustomRatings("tt123", config)).toEqual([])
  })
  it.each([0, 1, 2, 5])("accepts %i ratings without a fixed item count", async count => {
    const ratings = Array.from({ length: count }, (_, index) => ({ ...sample, id: `source${index}`, name: `Source ${index}` }))
    respond(JSON.stringify({ ratings }))
    expect(await fetchCustomRatings("tt123", config)).toEqual(ratings)
  })
  it("ignores invalid items individually", async () => {
    const other = { id: "source2", name: "Source 2", value: 87, format: "percent" }
    respond(JSON.stringify({ ratings: [null, [], "bad", {}, sample,
      { ...sample, id: " " }, { ...sample, id: 1 }, { ...sample, name: "" },
      { ...sample, name: false }, { ...sample, value: "87" }, { ...sample, value: null },
      { ...sample, format: "stars" }, other] }))
    expect(await fetchCustomRatings("tt123", config)).toEqual([sample, other])
  })
  it("returns an empty array for invalid formats", async () => {
    respond(JSON.stringify({ ratings: [{ ...sample, format: "stars" }, { ...sample, format: null }] }))
    expect(await fetchCustomRatings("tt123", config)).toEqual([])
  })
  it("keeps the last valid duplicate at the first position after trimming IDs", async () => {
    const replacement = { ...sample, name: "Updated", value: 9 }
    const other = { ...sample, id: "source2" }
    respond(JSON.stringify({ ratings: [sample, other, { ...replacement, id: " source1 " }, { ...sample, format: "invalid" }] }))
    expect(await fetchCustomRatings("tt123", config)).toEqual([replacement, other])
  })
  it("ignores API errors", async () => {
    respond('{"invalid":87}', 503)
    expect(await fetchCustomRatings("tt123", config)).toEqual([])
    mockedRequest.mockRejectedValueOnce(new Error("network"))
    expect(await fetchCustomRatings("tt123", config)).toEqual([])
  })
  it("times out and respects caller cancellation", async () => {
    mockedRequest.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      ;(options?.signal as AbortSignal)?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
    }))
    expect(await fetchCustomRatings("tt123", config)).toEqual([])
    const controller = new AbortController()
    const pending = fetchCustomRatings("tt123", config, controller.signal)
    controller.abort()
    expect(await pending).toEqual([])
  })
  it("does not request disabled, missing ID or unsafe endpoints", async () => {
    expect(await fetchCustomRatings("tt123", { ...config, enabled: false })).toEqual([])
    expect(await fetchCustomRatings(null, config)).toEqual([])
    for (const endpoint of ["file:///{imdbId}", "https://example.com/no-placeholder", "http://127.0.0.1/{imdbId}", "http://[::1]/{imdbId}", "http://[::ffff:127.0.0.1]/{imdbId}", "http://169.254.169.254/{imdbId}"]) {
      expect(await fetchCustomRatings("tt123", { ...config, endpoint })).toEqual([])
    }
    expect(mockedRequest).not.toHaveBeenCalled()
  })
  it("resolves env with future explicit overrides", () => {
    vi.stubEnv("CUSTOM_RATING_ENABLED", "true")
    expect(resolveCustomRatingConfig({ endpoint: "https://other.example/{imdbId}" })).toMatchObject({ enabled: true, endpoint: "https://other.example/{imdbId}", apiKeyHeader: "X-API-Key" })
  })
  it.each(["::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:93.184.216.34"])("blocks IPv4-mapped IPv6 endpoint %s before requesting", async address => {
    respond('{"invalid":87}')
    expect(await fetchCustomRatings("tt123", { ...config, endpoint: `http://[${address}]/{imdbId}` })).toEqual([])
    expect(mockedRequest).not.toHaveBeenCalled()
  })
  it("rejects DNS answers containing internal addresses at connection time", async () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:93.184.216.34", "fc00::1", "fe80::1"]) {
      vi.mocked(lookup).mockImplementationOnce(((_host: string, _options: unknown, callback: (error: null, addresses: { address: string; family: number }[]) => void) => {
        callback(null, [{ address: "93.184.216.34", family: 4 }, { address, family: address.includes(":") ? 6 : 4 }])
      }) as typeof lookup)
      await new Promise<void>(resolve => {
        connection.lookup!("example.com", { all: true }, error => {
          expect(error).toBeInstanceOf(Error)
          resolve()
        })
      })
    }
  })
  it("renders more than two pills within the canvas, including escaped names", async () => {
    const row = await renderMultiRatings([1, 2, 3].map(value => ({ id: String(value), name: "A & <B>", value, format: "decimal" })), 460)
    expect(row).not.toBeNull()
    const metadata = await sharp(row!.png).metadata()
    expect(metadata.width).toBeLessThanOrEqual(460)
    expect(metadata.height).toBe(row!.h)
    expect(await renderMultiRatings([], 460)).toBeNull()
  })
})
