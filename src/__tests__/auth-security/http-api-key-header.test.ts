import { describe, expect, it } from "vitest"
import { moveKeysToHeaders } from "@/lib/http"

const key = (h: HeadersInit | undefined) => new Headers(h).get("x-api-key")

describe("moveKeysToHeaders", () => {
  it("moves api_key to x-api-key and keeps other params untouched", () => {
    const r = moveKeysToHeaders("/api/tmdb/search?q=a%20b&api_key=K%2Bey&page=1", undefined)
    expect(r.path).toBe("/api/tmdb/search?q=a%20b&page=1")
    expect(key(r.headers)).toBe("K+ey")
  })
  it.each([
    ["/api/x?api_key=K", "/api/x"],
    ["/api/x?a=1&api_key=K", "/api/x?a=1"],
    ["/api/x?api_key=K&b=2", "/api/x?b=2"],
  ])("strips %s", (p, out) => {
    expect(moveKeysToHeaders(p, undefined).path).toBe(out)
  })
  it("empty key: strip only, no header", () => {
    const r = moveKeysToHeaders("/api/x?api_key=&a=1", undefined)
    expect(r.path).toBe("/api/x?a=1")
    expect(key(r.headers)).toBeNull()
  })
  it("explicit x-api-key wins", () => {
    expect(key(moveKeysToHeaders("/api/x?api_key=K", { "x-api-key": "H" }).headers)).toBe("H")
  })
  it("ignores non-/api paths, other params and non header-safe values", () => {
    expect(moveKeysToHeaders("https://x.test/a?api_key=K", undefined).path).toBe("https://x.test/a?api_key=K")
    expect(moveKeysToHeaders("/api/x?mdblist_api_key=K", undefined).path).toBe("/api/x?mdblist_api_key=K")
    expect(moveKeysToHeaders("/api/x?api_key=%C3%A8", undefined).path).toBe("/api/x?api_key=%C3%A8")
  })

  it("moves tvdb_key and mdblist_key to their own headers", () => {
    const r = moveKeysToHeaders("/api/mdblist/anime?mdblist_key=M&api_key=T&tvdb_key=V%2F&x=1", undefined)
    expect(r.path).toBe("/api/mdblist/anime?x=1")
    const h = new Headers(r.headers)
    expect(h.get("x-mdblist-key")).toBe("M")
    expect(h.get("x-api-key")).toBe("T")
    expect(h.get("x-tvdb-key")).toBe("V/")
  })
  it("strips an empty mdblist_key without adding a header", () => {
    const r = moveKeysToHeaders("/api/mdblist/anime?mdblist_key=&api_key=T", undefined)
    expect(r.path).toBe("/api/mdblist/anime")
    expect(new Headers(r.headers).get("x-mdblist-key")).toBeNull()
    expect(new Headers(r.headers).get("x-api-key")).toBe("T")
  })
})
