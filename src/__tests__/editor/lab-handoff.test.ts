/**
 * Task B — Lab ⇄ title handoff (pure): same-origin return validation (no open
 * redirects), family derivation (compatible deep-link else own family target,
 * legacy top/genre never hand off), and staged handoff URL building.
 */
import { describe, expect, it } from "vitest"
import {
  buildCommunityHref,
  buildHandoffUrl,
  buildLabReturnPath,
  isValidLabHandoffReturn,
  resolveHandoffFamily,
} from "@/lib/lab-handoff"

describe("isValidLabHandoffReturn", () => {
  it("accepts relative configure paths with title/shape context", () => {
    expect(isValidLabHandoffReturn("/u/abc/configure?title=movie:1&shape=poster")).toBe(true)
    expect(isValidLabHandoffReturn("/?title=tv:2")).toBe(true)
  })

  it("rejects absolute URLs, protocol-relative, backslashes and junk", () => {
    for (const bad of [
      "https://evil.com/?title=movie:1",
      "http://evil.com/x",
      "//evil.com/x",
      "/\\evil",
      "javascript:alert(1)",
      "",
      null,
      undefined,
      42,
      "/ok",
    ]) {
      if (bad === "/ok") {
        expect(isValidLabHandoffReturn(bad)).toBe(true)
      } else {
        expect(isValidLabHandoffReturn(bad)).toBe(false)
      }
    }
    expect(isValidLabHandoffReturn(`/${"x".repeat(600)}`)).toBe(false)
  })
})

describe("resolveHandoffFamily", () => {
  it("prefers the compatible deep-linked family", () => {
    expect(resolveHandoffFamily("quality", "quality")).toBe("quality")
    // Legacy top fans out to rank/extra: a top preset hands off the deep family.
    expect(resolveHandoffFamily("rank", "top")).toBe("rank")
  })

  it("falls back to the saved target when it is a family", () => {
    expect(resolveHandoffFamily(null, "comingSoon")).toBe("comingSoon")
    expect(resolveHandoffFamily("quality", "age")).toBe("age")
  })

  it("never hands off the legacy top slot", () => {
    expect(resolveHandoffFamily(null, "top")).toBeNull()
    // `genre` IS a real family (own badge builders), so it hands off.
    expect(resolveHandoffFamily(null, "genre")).toBe("genre")
    // An incompatible deep-link falls back to the saved family target.
    expect(resolveHandoffFamily("rank", "genre")).toBe("genre")
    expect(resolveHandoffFamily("quality", "top")).toBeNull()
    expect(resolveHandoffFamily(null, null)).toBeNull()
  })
})

describe("buildLabReturnPath", () => {
  it("carries title/shape context on the pathname", () => {
    expect(
      buildLabReturnPath({ pathname: "/configure", mediaType: "movie", tmdbId: 1, shape: "poster" }),
    ).toBe("/configure?title=movie:1&shape=poster")
    expect(
      buildLabReturnPath({ pathname: "/configure", mediaType: "tv", tmdbId: 2, shape: "landscape" }),
    ).toBe("/configure?title=tv:2&shape=landscape")
  })

  it("preserves the query namespace unless the pathname is already namespaced", () => {
    expect(
      buildLabReturnPath({ pathname: "/configure", search: "?u=abc-123", mediaType: "movie", tmdbId: 1, shape: "poster" }),
    ).toBe("/configure?title=movie:1&shape=poster&u=abc-123")
    // Path-namespace needs no query duplicate.
    expect(
      buildLabReturnPath({ pathname: "/u/abc-123/configure", search: "?u=abc-123", mediaType: "movie", tmdbId: 1, shape: "poster" }),
    ).toBe("/u/abc-123/configure?title=movie:1&shape=poster")
    // No namespace anywhere = bare return.
    expect(
      buildLabReturnPath({ pathname: "/configure", search: "", mediaType: "movie", tmdbId: 1, shape: "poster" }),
    ).toBe("/configure?title=movie:1&shape=poster")
  })
})

describe("buildCommunityHref", () => {
  it("keeps the current namespace (owner, else query-u, else bare)", () => {
    expect(buildCommunityHref("owner-1", "?u=other")).toBe("/presets?u=owner-1")
    expect(buildCommunityHref(null, "?u=query-9")).toBe("/presets?u=query-9")
    expect(buildCommunityHref(null, "")).toBe("/presets")
    expect(buildCommunityHref(undefined, null)).toBe("/presets")
  })
})

describe("buildHandoffUrl", () => {
  it("appends the staged binding to a validated return", () => {
    expect(buildHandoffUrl("/c?title=movie:1", "quality", "Abc123-_XyZ", "deadbeef")).toBe(
      "/c?title=movie:1&fam=quality&preset=Abc123-_XyZ&rev=deadbeef",
    )
    expect(buildHandoffUrl("/c", "rank", "Abc123-_XyZ", null)).toBe(
      "/c?fam=rank&preset=Abc123-_XyZ",
    )
  })

  it("returns null for invalid returns or missing identity", () => {
    expect(buildHandoffUrl("https://evil.com/", "quality", "Abc123-_XyZ", "deadbeef")).toBeNull()
    expect(buildHandoffUrl("/c", null, "Abc123-_XyZ", "deadbeef")).toBeNull()
    expect(buildHandoffUrl("/c", "quality", "", "deadbeef")).toBeNull()
    expect(buildHandoffUrl(null, "quality", "Abc123-_XyZ", "deadbeef")).toBeNull()
  })
})
