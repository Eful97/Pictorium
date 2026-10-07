/**
 * Real loader integration in the provider: the dictionary loads BEFORE the
 * language commit (never optimistic fallback labels), with server parity.
 */
import { render, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
// Opt out of the global @/lib/i18n mock: this file asserts real translated
// labels, which the mock's fake synchronous resolver cannot provide.
vi.unmock("@/lib/i18n")

import { StrictMode, useEffect } from "react"
import { PictoriumRoot, useP, type PictoriumCtx } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { createT, getLang, resolveLabelFor, setLang } from "@/lib/i18n"
import frDict from "@/lib/translations/fr.json"
import deDict from "@/lib/translations/de.json"
import ptDict from "@/lib/translations/pt.json"

let ctx: PictoriumCtx | null = null
let editorRegion: string | null = null

function Probe() {
  const v = useP()
  const ed = usePosterEditor()
  useEffect(() => {
    ctx = v
    editorRegion = ed.defaultRegion
  })
  return null
}

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(data),
    json: async () => data,
  }
}

async function flush(rounds = 15) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {})
  }
}

const fr = frDict as Record<string, string>
const de = deDict as Record<string, string>
const pt = ptDict as Record<string, string>

describe("context i18n loader integration (real dictionaries)", () => {
  beforeEach(() => {
    ctx = null
    editorRegion = null
    localStorage.clear()
    // The i18n registry is shared across this file's tests: keep a baseline.
    setLang("it")
    document.documentElement.lang = "it"
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => okJson({})) as unknown as typeof fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("saved non-default language commits after load with correct badge labels", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ region: "IT" }))
    localStorage.setItem("preferred_lang", "fr")
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    expect(ctx!.lang).toBe("fr")
    expect(getLang()).toBe("fr")
    expect(document.documentElement.lang).toBe("fr")
    // Reactive context t: no English fallback.
    expect(ctx!.t("badge.today")).toBe(fr["badge.today"])
    // Server parity: same badge key resolves as on the server.
    expect(resolveLabelFor("__badge.today", "fr")).toBe(fr["badge.today"])
    expect(createT("fr")("badge.today")).toBe(fr["badge.today"])
  })

  it("pickLang non-default loads first, then applies lang/global/region together", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ region: "IT" }))
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    expect(ctx!.lang).toBe("it")

    await act(async () => {
      ctx!.pickLang("de")
    })
    // The lazy chunk resolves outside microtasks: poll for it.
    await vi.waitFor(() => expect(ctx!.lang).toBe("de"))
    await flush()
    expect(ctx!.t("badge.today")).toBe(de["badge.today"])
    expect(getLang()).toBe("de")
    expect(document.documentElement.lang).toBe("de")
    expect(localStorage.getItem("preferred_lang")).toBe("de")
    // The region follows the language only once the dict is ready.
    expect(editorRegion).toBe("DE")
  })

  it("StrictMode remount still commits a saved non-default language", async () => {
    // StrictMode runs setup -> cleanup -> setup: the init load started by the
    // first setup must not be dropped by the interim cleanup. "pt" is unused
    // by the other tests in this file, so its chunk is genuinely unloaded and
    // the async init path is exercised (fr/de would commit synchronously).
    localStorage.setItem("badgeDefaults", JSON.stringify({ region: "IT" }))
    localStorage.setItem("preferred_lang", "pt")
    render(
      <StrictMode>
        <PictoriumRoot>
          <Probe />
        </PictoriumRoot>
      </StrictMode>,
    )
    await vi.waitFor(() => expect(ctx!.lang).toBe("pt"))
    await flush()
    expect(getLang()).toBe("pt")
    expect(document.documentElement.lang).toBe("pt")
    expect(ctx!.t("badge.today")).toBe(pt["badge.today"])
  })

  it("it/en stay synchronous", async () => {
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    await act(async () => {
      ctx!.pickLang("en")
    })
    expect(ctx!.lang).toBe("en")
    expect(ctx!.t("badge.today")).toBe("Today")
    await act(async () => {
      ctx!.pickLang("it")
    })
    expect(ctx!.lang).toBe("it")
  })
})
