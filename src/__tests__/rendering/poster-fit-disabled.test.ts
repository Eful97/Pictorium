import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// Override globale disabilitato: simula POSTERIUM_BEST_FIT_ENABLED=0 (hoisted,
// applicato a TUTTO il file). File dedicato per non interferire con i test che
// si aspettano il best-fit attivo in poster-fit-api.test.ts.
vi.mock("@/lib/best-fit-config", () => ({ BEST_FIT_GLOBAL: "off" }))

import { POST } from "@/app/api/poster-fit/route"

const TEST_ADMIN_TOKEN = "poster-fit-off-token"

function mockNextRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/poster-fit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": TEST_ADMIN_TOKEN },
    body: JSON.stringify(body),
  })
}

describe("POST /api/poster-fit — POSTERIUM_BEST_FIT_ENABLED=off", () => {
  beforeEach(() => {
    process.env.POSTERIUM_ADMIN_TOKEN = TEST_ADMIN_TOKEN
  })

  afterEach(() => {
    delete process.env.POSTERIUM_ADMIN_TOKEN
    vi.restoreAllMocks()
  })

  it("risponde with disabled=true senza calcolare lo scoring né fetchare immagini", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const req = mockNextRequest({ posterPaths: ["/test.jpg", "/other.jpg"], logoPath: "/logo.png" })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.disabled).toBe(true)
    expect(body.ranked).toEqual([])
    expect(body.bestPosterPath).toBeNull()
    // Con best-fit disabilitato globalmente non si deve nemmeno fetchare: un
    // attaccante non può usare l'endpoint come amplificatore di richieste.
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
