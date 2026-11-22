/**
 * "Dove guardare" settings: switch + country select in the Tag e Network tab
 * (staged like every other default), translations present in every language.
 */
import type { ReactNode } from "react"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { PosterEditorProvider } from "@/lib/contexts/PosterEditorContext"
import { TranslationProvider } from "@/lib/contexts/TranslationContext"
import { TagsNetworksSection } from "@/components/settings/TagsNetworksSection"
import { createT } from "@/lib/i18n"
import type { PictoriumCtx } from "@/lib/context"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function uiWrapper({ children }: { children: ReactNode }) {
  const fake = { lang: "en", pickLang: () => {}, t: createT("en") } as unknown as PictoriumCtx
  return (
    <PosterEditorProvider>
      <TranslationProvider value={fake}>{children}</TranslationProvider>
    </PosterEditorProvider>
  )
}

describe("watch providers settings (Tag e Network)", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/")
    window.localStorage.clear()
  })

  it("does not add thumbnails to the network group", () => {
    render(<TagsNetworksSection active />, { wrapper: uiWrapper })
    expect(screen.getByTestId("network-group").querySelectorAll('img[alt=""]').length).toBe(25)
  })

  it("translation keys exist in every language", () => {
    const dir = path.join(process.cwd(), "src/lib/translations")
    const keys = ["ui.watchProvidersLabel", "ui.watchProvidersHint", "ui.watchRegionLabel", "ui.watchRegionSame"]
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const json = JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as Record<string, string>
      for (const k of keys) expect(typeof json[k], `${f}:${k}`).toBe("string")
    }
  })
})
