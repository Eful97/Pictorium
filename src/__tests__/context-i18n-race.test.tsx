/**
 * Language commit race/failure with a mocked loader transport (deferred
 * promises): init vs picker, double click, rejection/retry, unmount.
 * The i18n registry stays real: the mock registers marked fake dictionaries,
 * so label assertions prove "load before commit".
 */
import { render, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
vi.unmock("@/lib/i18n")

import { useEffect } from "react"
import { PictoriumRoot, useP, type PictoriumCtx } from "@/lib/context"
import { getLang, registerDictionary, setLang } from "@/lib/i18n"
import { loadLanguage } from "@/lib/i18n-loader"

vi.mock("@/lib/i18n-loader", () => ({
  loadLanguage: vi.fn(),
}))

const mockedLoad = vi.mocked(loadLanguage)

let ctx: PictoriumCtx | null = null

function Probe() {
  const v = useP()
  useEffect(() => {
    ctx = v
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

async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {})
  }
}

interface Deferred {
  promise: Promise<Record<string, string>>
  resolve: (d: Record<string, string>) => void
  reject: (e: unknown) => void
}

function deferred(): Deferred {
  let resolve!: (d: Record<string, string>) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<Record<string, string>>((res, rej) => {
    resolve = res
    reject = rej
  })
  // Avoid unhandled rejection while the test holds the promise.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

const FR_MARK = "FR-MARQUEUR"
const DE_MARK = "DE-MARKIERER"
const PL_MARK = "PL-ZNACZNIK"
const CS_MARK = "CS-ZNACKA"
const PT_MARK = "PT-MARCADOR"
const NL_MARK = "NL-MARKEERDER"
const RO_MARK = "RO-MARCAJ"
const SV_MARK = "SV-MARKOR"

describe("context language race/failure (mocked loader transport)", () => {
  const pending = new Map<string, Deferred[]>()

  beforeEach(() => {
    ctx = null
    pending.clear()
    localStorage.clear()
    setLang("it")
    document.documentElement.lang = "it"
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => okJson({})) as unknown as typeof fetch)
    mockedLoad.mockImplementation((lang: string) => {
      const code = lang.toLowerCase()
      const d = deferred()
      const list = pending.get(code) ?? []
      list.push(d)
      pending.set(code, list)
      return d.promise
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function resolveLang(code: string, marker: string) {
    const list = pending.get(code)
    expect(list?.length, `pending load for ${code}`).toBeGreaterThan(0)
    const d = list!.shift()!
    registerDictionary(code, { "badge.today": marker })
    d.resolve({ "badge.today": marker })
  }

  it("init vs picker race: only the last request commits", async () => {
    localStorage.setItem("preferred_lang", "fr")
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush(3)
    // Pending fr init: no optimistic commit.
    expect(ctx!.lang).toBe("it")
    expect(localStorage.getItem("preferred_lang")).toBe("fr")

    await act(async () => {
      ctx!.pickLang("de")
    })
    await flush(2)
    expect(ctx!.lang).toBe("it")

    // The stale init resolving first must be ignored.
    await act(async () => {
      resolveLang("fr", FR_MARK)
    })
    await flush()
    expect(ctx!.lang).toBe("it")
    expect(getLang()).toBe("it")

    await act(async () => {
      resolveLang("de", DE_MARK)
    })
    await flush()
    expect(ctx!.lang).toBe("de")
    expect(ctx!.t("badge.today")).toBe(DE_MARK)
    expect(getLang()).toBe("de")
    expect(document.documentElement.lang).toBe("de")
    expect(localStorage.getItem("preferred_lang")).toBe("de")
  })

  it("two rapid picks: the second commit wins regardless of resolve order", async () => {
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    await act(async () => {
      ctx!.pickLang("pl")
      ctx!.pickLang("cs")
    })
    await flush(2)
    expect(ctx!.lang).toBe("it")

    await act(async () => {
      resolveLang("pl", PL_MARK)
    })
    await flush()
    expect(ctx!.lang).toBe("it")

    await act(async () => {
      resolveLang("cs", CS_MARK)
    })
    await flush()
    expect(ctx!.lang).toBe("cs")
    expect(ctx!.t("badge.today")).toBe(CS_MARK)
  })

  it("failure keeps the active language and retry commits", async () => {
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    await act(async () => {
      ctx!.pickLang("pt")
    })
    await flush(2)
    expect(ctx!.lang).toBe("it")

    await act(async () => {
      pending.get("pt")!.shift()!.reject(new Error("chunk failed"))
    })
    await flush()
    expect(ctx!.lang).toBe("it")
    expect(getLang()).toBe("it")
    expect(document.documentElement.lang).toBe("it")
    expect(localStorage.getItem("preferred_lang")).toBeNull()

    await act(async () => {
      ctx!.pickLang("pt")
    })
    await flush(2)
    await act(async () => {
      resolveLang("pt", PT_MARK)
    })
    await flush()
    expect(ctx!.lang).toBe("pt")
    expect(ctx!.t("badge.today")).toBe(PT_MARK)
    expect(localStorage.getItem("preferred_lang")).toBe("pt")
  })

  it("init failure keeps the active language, re-shows the picker, and user retry commits", async () => {
    // Saved "ro" chunk fails on init: no silent stale language claimed
    // active — the picker comes back so the user can choose/retry.
    localStorage.setItem("preferred_lang", "ro")
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush(3)
    expect(ctx!.lang).toBe("it")
    expect(ctx!.showLangPicker).toBe(false)

    await act(async () => {
      pending.get("ro")!.shift()!.reject(new Error("init chunk failed"))
    })
    await flush()
    expect(ctx!.lang).toBe("it")
    expect(getLang()).toBe("it")
    expect(document.documentElement.lang).toBe("it")
    // The saved preference is left untouched (no rollback, no clearing).
    expect(localStorage.getItem("preferred_lang")).toBe("ro")
    expect(ctx!.showLangPicker).toBe(true)

    // User retry through the picker commits lang/global/storage together.
    await act(async () => {
      ctx!.pickLang("ro")
    })
    await flush(2)
    await act(async () => {
      resolveLang("ro", RO_MARK)
    })
    await flush()
    expect(ctx!.lang).toBe("ro")
    expect(ctx!.t("badge.today")).toBe(RO_MARK)
    expect(getLang()).toBe("ro")
    expect(document.documentElement.lang).toBe("ro")
    expect(localStorage.getItem("preferred_lang")).toBe("ro")
  })

  it("init unmount never commits global or storage", async () => {
    localStorage.setItem("preferred_lang", "sv")
    const view = render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush(3)
    expect(ctx!.lang).toBe("it")
    const langBefore = document.documentElement.lang
    expect(getLang()).toBe("it")
    view.unmount()
    await act(async () => {
      resolveLang("sv", SV_MARK)
    })
    await flush()
    // Late init resolution after unmount commits nothing: global lang stays,
    // document lang stays, and storage keeps the untouched saved value.
    expect(getLang()).toBe("it")
    expect(document.documentElement.lang).toBe(langBefore)
    expect(localStorage.getItem("preferred_lang")).toBe("sv")
  })

  it("unmount invalidates a pending commit", async () => {
    const view = render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    await act(async () => {
      ctx!.pickLang("nl")
    })
    await flush(2)
    view.unmount()
    const langBefore = document.documentElement.lang
    await act(async () => {
      resolveLang("nl", NL_MARK)
    })
    await flush()
    expect(document.documentElement.lang).toBe(langBefore)
  })
})
