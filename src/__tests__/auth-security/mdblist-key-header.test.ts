import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { resolveUserApiKeys } from "@/lib/tmdb"

describe("resolveUserApiKeys: x-mdblist-key header", () => {
  it("reads the MDBList key from the header", async () => {
    const req = new NextRequest("http://localhost/api/mdblist/anime", { headers: { "x-mdblist-key": "hdr-key" } })
    const r = await resolveUserApiKeys(req, null)
    expect(r.mdblist).toEqual({ key: "hdr-key", source: "header" })
  })
  it("query wins over header", async () => {
    const req = new NextRequest("http://localhost/api/mdblist/anime?mdblist_key=q-key", { headers: { "x-mdblist-key": "hdr-key" } })
    expect((await resolveUserApiKeys(req, null)).mdblist.key).toBe("q-key")
  })
})
