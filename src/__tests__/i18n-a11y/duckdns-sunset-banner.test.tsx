import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
// The global test setup mocks @/lib/i18n with a small fixed Italian dictionary
// (unknown keys echo the raw key). This component is verified against the real
// shipped dictionary, so opt out of the global mock for this file only.
vi.unmock("@/lib/i18n")

import { act, render, screen } from "@testing-library/react"
import { DuckDnsSunsetBanner } from "@/components/DuckDnsSunsetBanner"

// Legacy key from the removed persistence: it must be neither written nor read
// any more (dismissal is per-view only and disappears on reload).
const DISMISS_KEY = "pictorium_duckdns_sunset_dismissed"
const IT_TITLE = "Questa istanza DuckDNS chiuderà a fine mese 💛"
const IT_VERCEL_LABEL = "creare gratuitamente una tua istanza privata su Vercel"
const IT_ELFHOSTED_LABEL = "utilizzare direttamente quella pubblica di ElfHosted"

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("DuckDnsSunsetBanner", () => {
  it("ignores the old persisted dismissal key and still shows the notice", async () => {
    window.localStorage.setItem(DISMISS_KEY, "1")
    const { container } = render(<DuckDnsSunsetBanner />)

    expect(await screen.findByText(IT_TITLE)).toBeTruthy()
    const marker = container.querySelector("[data-pictorium-duckdns-sunset]")
    expect(marker).not.toBeNull()
    expect(marker?.textContent).not.toBe("")
  })

  it("renders the localized notice with exactly two action links, then closes for this view only", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem")
    render(<DuckDnsSunsetBanner />)

    expect(await screen.findByText(IT_TITLE)).toBeTruthy()
    expect(
      screen.getByText(
        "Purtroppo, non riuscendo più a sostenerne i costi, sarò costretto a sospendere il servizio per mancanza di budget.",
      ),
    ).toBeTruthy()
    expect(
      screen.getByText("Grazie di cuore a tutti quelli che l'hanno utilizzata finora! ❤️"),
    ).toBeTruthy()

    const vercel = screen.getByRole("link", { name: IT_VERCEL_LABEL })
    expect(vercel.getAttribute("href")).toBe(
      "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FEful97%2FPictorium",
    )
    expect(vercel.getAttribute("target")).toBe("_blank")
    expect(vercel.getAttribute("rel")).toBe("noopener noreferrer")

    const elfhostedAction = screen.getByRole("link", { name: IT_ELFHOSTED_LABEL })
    expect(elfhostedAction.getAttribute("href")).toBe("https://pictorium.elfhosted.com/")
    expect(elfhostedAction.getAttribute("target")).toBe("_blank")
    expect(elfhostedAction.getAttribute("rel")).toBe("noopener noreferrer")

    // Paragraph 3 carries exactly the two action links: no third anchor with the
    // raw ElfHosted URL (the literal URL was redundant next to the labelled one).
    const body3Paragraph = vercel.closest("p")
    expect(body3Paragraph).not.toBeNull()
    expect(body3Paragraph).toBe(elfhostedAction.closest("p"))
    expect(body3Paragraph?.querySelectorAll("a")).toHaveLength(2)
    expect(screen.getAllByRole("link")).toHaveLength(2)
    expect(
      screen.queryByRole("link", { name: "https://pictorium.elfhosted.com/" }),
    ).toBeNull()

    const dismiss = screen.getByRole("button", { name: "Chiudi avviso" })
    await act(async () => {
      dismiss.click()
    })

    expect(window.localStorage.getItem(DISMISS_KEY)).toBeNull()
    expect(setItemSpy.mock.calls.some(([key]) => key === DISMISS_KEY)).toBe(false)
    expect(screen.queryByText(IT_TITLE)).toBeNull()
  })

  it("shows the notice again after a fresh mount (page reload)", async () => {
    const first = render(<DuckDnsSunsetBanner />)
    expect(await screen.findByText(IT_TITLE)).toBeTruthy()

    await act(async () => {
      screen.getByRole("button", { name: "Chiudi avviso" }).click()
    })
    expect(screen.queryByText(IT_TITLE)).toBeNull()
    first.unmount()

    render(<DuckDnsSunsetBanner />)
    expect(await screen.findByText(IT_TITLE)).toBeTruthy()
  })
})
