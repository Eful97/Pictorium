import type { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/custom-rating/test/route"
import { diagnoseCustomRatings } from "@/lib/custom-rating"

vi.mock("@/lib/custom-rating", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/custom-rating")>(),
  diagnoseCustomRatings: vi.fn(),
}))

const mockedDiagnose = vi.mocked(diagnoseCustomRatings)

const TEST_ADMIN_TOKEN = "custom-rating-admin-token"

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.ADMIN_TOKEN
})

function post() {
  return new Request("http://localhost:3000/api/custom-rating/test", {
    method: "POST",
    headers: { "x-admin-token": TEST_ADMIN_TOKEN },
  })
}

describe("POST /api/custom-rating/test", () => {
  beforeEach(() => {
    // Le route admin sono fail-closed: il test presenta un ADMIN_TOKEN reale.
    process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN
  })

  it("returns the diagnosis and never leaks the API key", async () => {
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "true")
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENDPOINT", "https://example.com/{imdbId}")
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_API_KEY", "super-secret")
    const ratings = [{ id: "s", name: "Source", value: 8.8, format: "decimal" as const }]
    mockedDiagnose.mockResolvedValue({ status: 200, ms: 142, ratings, error: null })
    const res = await POST(post() as unknown as NextRequest)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, status: 200, ms: 142, ratings })
    expect(JSON.stringify(body)).not.toContain("super-secret")
    // Il sample è fisso server-side: nessun input client raggiunge la diagnose.
    expect(mockedDiagnose).toHaveBeenCalledWith("tt1375666", expect.objectContaining({ enabled: true }))
  })

  it("passes diagnosis failures through with codes", async () => {
    mockedDiagnose.mockResolvedValue({ status: 401, ms: 30, ratings: [], error: "http-error" })
    const res = await POST(post() as unknown as NextRequest)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, error: "http-error", status: 401, ms: 30 })
  })

  it("returns 401 when ADMIN_TOKEN is set and header is missing", async () => {
    mockedDiagnose.mockClear()
    process.env.ADMIN_TOKEN = "secret-token"
    const res = await POST(post() as unknown as NextRequest)
    expect(res.status).toBe(401)
    expect(mockedDiagnose).not.toHaveBeenCalled()
  })
})
