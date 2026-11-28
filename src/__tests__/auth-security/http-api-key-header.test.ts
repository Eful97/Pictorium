import { describe, expect, it } from "vitest"
import { moveApiKeyToHeader } from "@/lib/http"

const key = (h: HeadersInit | undefined) => new Headers(h).get("x-api-key")

describe("moveApiKeyToHeader", () => {
  it("moves api_key to x-api-key and keeps other params untouched", () => {
    const r = moveApiKeyToHeader("/api/tmdb/search?q=a%20b&api_key=K%2Bey&page=1", undefined)
    expect(r.path).toBe("/api/tmdb/search?q=a%20b&page=1")
    expect(key(r.headers)).toBe("K+ey")
  })
  it.each([
    ["/api/x?api_key=K", "/api/x"],
    ["/api/x?a=1&api_key=K", "/api/x?a=1"],
    ["/api/x?api_key=K&b=2", "/api/x?b=2"],
  ])("strips %s", (p, out) => {
    expect(moveApiKeyToHeader(p, undefined).path).toBe(out)
  })
  it("empty key: strip only, no header", () => {
    const r = moveApiKeyToHeader("/api/x?api_key=&a=1", undefined)
    expect(r.path).toBe("/api/x?a=1")
    expect(key(r.headers)).toBeNull()
  })
  it("explicit x-api-key wins", () => {
    expect(key(moveApiKeyToHeader("/api/x?api_key=K", { "x-api-key": "H" }).headers)).toBe("H")
  })
  it("ignores non-/api paths, other params and non header-safe values", () => {
    expect(moveApiKeyToHeader("https://x.test/a?api_key=K", undefined).path).toBe("https://x.test/a?api_key=K")
    expect(moveApiKeyToHeader("/api/x?mdblist_api_key=K", undefined).path).toBe("/api/x?mdblist_api_key=K")
    expect(moveApiKeyToHeader("/api/x?api_key=%C3%A8", undefined).path).toBe("/api/x?api_key=%C3%A8")
  })
})
