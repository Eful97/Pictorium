import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { renderWithCtx } from "@/__tests__/test-utils"
import { CataloghiView } from "@/components/CataloghiView"
import { StreamingCatalogDialog } from "@/components/StreamingCatalogDialog"
import { StreamingCatalogCard } from "@/components/StreamingCatalogCard"
import { CatalogSourceBadge } from "@/components/CatalogSourceBadge"
import { userFetch } from "@/lib/http"
import type { BatchAddResult, GenericAddEntry } from "@/lib/streaming-catalog-client"

vi.mock("@/lib/http", () => ({ userFetch: vi.fn() }))
vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contexts/TranslationContext")>()),
  useT: () => ({ t: (key: string) => key, lang: "it" }),
}))
vi.mock("@/components/CustomCatalogModal", () => ({ CustomCatalogModal: () => null }))
vi.mock("@/components/AddonCatalogModal", () => ({ AddonCatalogModal: () => null }))
vi.mock("@/components/CatalogManagerModal", () => ({ CatalogManagerModal: () => null }))

const fetchMock = vi.spyOn(globalThis, "fetch")
const mockedUserFetch = vi.mocked(userFetch)

function choice(
  service: string,
  serviceName: string,
  code: string,
  slug: string,
  flag: string,
  label: string,
  section: "movies" | "series" | "all",
  extra: Record<string, unknown> = {},
) {
  const kind = section === "movies" ? "Film" : section === "series" ? "Serie TV" : "Film & Serie TV"
  const source = (extra["source"] as string | undefined) ?? "auto"
  const variant = (extra["variant"] as string | null | undefined) ?? null
  const suffix = variant ? `--${variant}` : ""
  return {
    service, serviceName, country: code, countryFlag: flag, countryLabel: label,
    countryFlixSlug: slug, chartSlug: slug, section, source, variant, variants: [],
    catalogId: `pictorium-stream2-${service}--${slug}--${section}--${source}${suffix}`,
    fpChart: true, jwFallback: false, potential: "flixpatrol",
    displayFp: `Top 10 · FlixPatrol — ${kind}`,
    displayJw: `Top 10 · JustWatch — ${kind}`,
    overallOnly: false, note: null, ...extra,
  }
}

const availabilityChoices = [
  choice("netflix", "Netflix", "IT", "italy", "🇮🇹", "Italia", "movies", { fpChart: true, potential: "flixpatrol", jwFallback: true }),
  choice("netflix", "Netflix", "IT", "italy", "🇮🇹", "Italia", "series", { fpChart: true, potential: "flixpatrol", jwFallback: true }),
  choice("netflix", "Netflix", "US", "united-states", "🇺🇸", "USA", "movies", { fpChart: true, potential: "flixpatrol", jwFallback: true }),
  choice("hulu", "Hulu", "US", "united-states", "🇺🇸", "USA", "series", { fpChart: true, potential: "flixpatrol", jwFallback: false }),
  choice("prime", "Prime Video", "US", "united-states", "🇺🇸", "USA", "movies", { fpChart: false, potential: "justwatch", jwFallback: true, source: "justwatch" }),
  choice("prime", "Prime Video", "US", "united-states", "🇺🇸", "USA", "series", { fpChart: false, potential: "justwatch", jwFallback: true, source: "justwatch" }),
  choice("now", "NOW/Sky", "US", "united-states", "🇺🇸", "USA", "movies", { fpChart: false, jwFallback: false, potential: "unavailable", note: "No coverage." }),
  choice("now", "NOW/Sky", "US", "united-states", "🇺🇸", "USA", "series", { fpChart: false, jwFallback: false, potential: "unavailable", note: "No coverage." }),
  choice("now", "NOW/Sky", "IT", "italy", "🇮🇹", "Italia", "movies", { fpChart: true, potential: "flixpatrol", jwFallback: true }),
  choice("now", "NOW/Sky", "IT", "italy", "🇮🇹", "Italia", "series", { fpChart: true, potential: "flixpatrol", jwFallback: true }),
  // Overall-only pair: only the mixed list is offered (never a split).
  choice("crave", "Crave", "CA", "canada", "🇨🇦", "Canada", "all", { fpChart: true, potential: "flixpatrol", jwFallback: false, overallOnly: true, variants: ["amazon-channels"] }),
  // Variant-only section: no fake base, only the variant choice.
  choice("rai", "Rai", "IT", "italy", "🇮🇹", "Italia", "series", { fpChart: true, potential: "flixpatrol", jwFallback: false, variant: "it", variants: ["it"], catalogId: "pictorium-stream2-rai--italy--series--auto--it" }),
]

const availabilityBody = { indexStatus: "ok", generatedAt: "2026-10-23T00:00:00Z", choices: availabilityChoices }

function browseResponse(
  catalogId: string,
  service: string,
  chartSlug: string,
  section: "movies" | "series" | "all",
  source: string,
  items: Array<{ tmdbId: number; mediaType: "movie" | "tv"; title: string; rank: number; posterPath: string | null; year: number | null }>,
  updatedAt?: number | null,
) {
  return new Response(JSON.stringify({ catalogId, service, chartSlug, section, source, region: "IT", items, updatedAt: updatedAt ?? null }), {
    status: 200,
    headers: { "X-Pictorium-Source": source, "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, "scrollTo").mockImplementation(() => {})
  fetchMock.mockReset()
  // Scoped API reads (defaults/keys) resolve empty by default: real hooks
  // call `.then` on the result, so the mock must never return undefined.
  mockedUserFetch.mockResolvedValue(new Response(JSON.stringify({})))
})

describe("CatalogSourceBadge", () => {
  it("renders provider logos + text for actual sources, honest text without logo for unknown", () => {
    const { rerender } = renderWithCtx(<CatalogSourceBadge actual="flixpatrol" />)
    const fpImg = document.querySelector('img[src="/catalogs/idB7ODvhZ1_logos.svg"]')
    expect(fpImg).not.toBeNull()
    expect(fpImg?.getAttribute("alt")).toBe("")
    expect(screen.getByText("ui.streamSourceFp")).toBeTruthy()
    rerender(<CatalogSourceBadge actual="justwatch" />)
    expect(document.querySelector('img[src="/catalogs/JW_Logo_color.svg"]')).not.toBeNull()
    rerender(<CatalogSourceBadge actual="unknown" />)
    expect(document.querySelector('img[src="/catalogs/idB7ODvhZ1_logos.svg"]')).toBeNull()
    expect(document.querySelector('img[src="/catalogs/JW_Logo_color.svg"]')).toBeNull()
    expect(screen.getByText("ui.streamSourceUnknown")).toBeTruthy()
  })
})

describe("StreamingCatalogDialog", () => {
  function openDialog(props: Partial<React.ComponentProps<typeof StreamingCatalogDialog>> = {}) {
    const onAddBatch = vi.fn((_entries: GenericAddEntry[]): BatchAddResult => ({ status: "added", added: 1, merged: 0, duplicates: 0, selections: [] }))
    const onClose = vi.fn()
    renderWithCtx(
      <StreamingCatalogDialog
        isOpen
        onClose={onClose}
        existing={[]}
        isLegacy={false}
        onAddBatch={onAddBatch}
        {...props}
      />,
    )
    return { onAddBatch, onClose }
  }

  it("source → country (real coverage only) → multiselect providers → Add batch", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(availabilityBody)))
    const { onAddBatch, onClose } = openDialog()
    // Source step (automatic by default): pick the country covered by the index.
    fireEvent.click(await screen.findByRole("button", { name: /Italia/ }))
    // Providers for Italy: Netflix + NOW offered; the variant-only Rai row too.
    fireEvent.click(await screen.findByRole("checkbox", { name: /Netflix/ }))
    // Add carries one grouped entry (movies+series sections merged, auto source).
    fireEvent.click(screen.getByRole("button", { name: /ui\.streamAddCount/ }))
    await waitFor(() => expect(onAddBatch).toHaveBeenCalledTimes(1))
    expect(onAddBatch.mock.calls[0][0]).toEqual([
      { service: "netflix", country: "italy", sections: ["movies", "series"], source: "auto", variant: null },
    ])
    expect(onClose).toHaveBeenCalled()
  })

  it("selects all / deselects all and counts what the batch actually adds", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(availabilityBody)))
    openDialog()
    fireEvent.click(await screen.findByRole("button", { name: /Italia/ }))
    fireEvent.click(screen.getByRole("button", { name: "ui.selectAll" }))
    // 3 offered rows for Italy (Netflix, NOW, Rai) × their sections.
    expect(await screen.findByText("ui.streamSelectedCount")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "ui.deselect" }))
    const add = screen.getByRole("button", { name: /ui\.streamAddCount/ })
    expect(add).toBeDisabled()
  })

  it("never offers unavailable pairs and surfaces overall-only as Mista", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(availabilityBody)))
    openDialog()
    fireEvent.click(await screen.findByRole("button", { name: /Stati Uniti/ }))
    // NOW+US is unavailable in every section: NOW is not offered for the USA.
    expect(screen.queryByRole("checkbox", { name: /NOW/ })).toBeNull()
    // Hulu USA series is offered with the honest FP label.
    expect(await screen.findByText("Top 10 · FlixPatrol — Serie TV")).toBeTruthy()
  })

  it("overall-only pairs stay selectable as Mista with an honest capability note", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(availabilityBody)))
    openDialog()
    fireEvent.click(await screen.findByRole("button", { name: /Canada/ }))
    // Mixed list offered (never a movies/series split)…
    expect(await screen.findByRole("checkbox", { name: /Crave/ })).toBeTruthy()
    // …and the Mista section filter keeps it eligible.
    fireEvent.click(screen.getByLabelText("ui.streamSectionMixed"))
    fireEvent.click(screen.getByLabelText("ui.streamSectionMixed"))
    expect(screen.getByRole("checkbox", { name: /Crave/ })).toBeTruthy()
  })

  it("strict JustWatch source carries only JW-eligible IDS (no FP auto promises)", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(availabilityBody)))
    openDialog()
    fireEvent.click(await screen.findByRole("button", { name: "ui.streamSourceOnlyJw" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("source=justwatch"), expect.anything()))
    fireEvent.click(await screen.findByRole("button", { name: /Stati Uniti/ }))
    // Prime USA rows are JW-eligible; the FP-only Hulu row keeps its FP label
    // (strict modes never substitute silently).
    expect(await screen.findByText("Top 10 · JustWatch — Film")).toBeTruthy()
  })

  it("legacy spaces require explicit curated-mode consent before Add", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(availabilityBody)))
    const onAddBatch = vi.fn((_entries: GenericAddEntry[]): BatchAddResult => ({ status: "added", added: 1, merged: 0, duplicates: 0, selections: [] }))
    const onClose = vi.fn()
    renderWithCtx(
      <StreamingCatalogDialog isOpen onClose={onClose} existing={[]} isLegacy onAddBatch={onAddBatch} />,
    )
    fireEvent.click(await screen.findByRole("button", { name: /Italia/ }))
    fireEvent.click(await screen.findByRole("checkbox", { name: /Netflix/ }))
    const add = screen.getByRole("button", { name: /ui\.streamAddCount/ })
    expect(add).toBeDisabled()
    expect(screen.getByText("ui.streamLegacyTitle")).toBeTruthy()
    fireEvent.click(screen.getByRole("checkbox", { name: /ui.streamLegacyConfirm/ }))
    expect(screen.getByRole("button", { name: /ui\.streamAddCount/ })).not.toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: /ui\.streamAddCount/ }))
    await waitFor(() => expect(onAddBatch).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalled()
  })

  it("duplicate feedback keeps the dialog open (no silent loss)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(availabilityBody)))
    const onAddBatch = vi.fn((_entries: GenericAddEntry[]): BatchAddResult => ({ status: "duplicate", added: 0, merged: 0, duplicates: 2, selections: [] }))
    const onClose = vi.fn()
    renderWithCtx(
      <StreamingCatalogDialog isOpen onClose={onClose} existing={[]} isLegacy={false} onAddBatch={onAddBatch} />,
    )
    fireEvent.click(await screen.findByRole("button", { name: /Italia/ }))
    fireEvent.click(await screen.findByRole("checkbox", { name: /Netflix/ }))
    fireEvent.click(screen.getByRole("button", { name: /ui\.streamAddCount/ }))
    await waitFor(() => expect(onAddBatch).toHaveBeenCalled())
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("index errors show an honest state with retry (never silently empty)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("down"))
    openDialog()
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.getByText("ui.streamCoverageError")).toBeTruthy()
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(availabilityBody)))
    fireEvent.click(screen.getByRole("button", { name: "ui.retry" }))
    expect(await screen.findByRole("button", { name: "ui.streamSourceAuto" })).toBeTruthy()
  })

  describe("per-provider independent section choice", () => {
    function perProviderBody() {
      const pick = (service: string, serviceName: string, section: "movies" | "series" | "all") =>
        choice(service, serviceName, "IT", "italy", "🇮🇹", "Italia", section, {
          fpChart: true, potential: "flixpatrol", jwFallback: true,
        })
      return {
        indexStatus: "ok",
        generatedAt: "2026-10-23T00:00:00Z",
        choices: [
          pick("netflix", "Netflix", "movies"),
          pick("netflix", "Netflix", "series"),
          pick("paramount", "Paramount+", "all"),
          pick("crunchyroll", "Crunchyroll", "series"),
        ],
      }
    }

    async function openItaly(body = perProviderBody()) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)))
      const onAddBatch = vi.fn((_entries: GenericAddEntry[]): BatchAddResult => ({ status: "added", added: 1, merged: 0, duplicates: 0, selections: [] }))
      const onClose = vi.fn()
      renderWithCtx(
        <StreamingCatalogDialog isOpen onClose={onClose} existing={[]} isLegacy={false} onAddBatch={onAddBatch} />,
      )
      fireEvent.click(await screen.findByRole("button", { name: /Italia/ }))
      return { onAddBatch, onClose }
    }

    it("Paramount mixed-only + Netflix Film+Serie in one batch submits 3 lists", async () => {
      const { onAddBatch, onClose } = await openItaly()
      const netflix = screen.getByRole("group", { name: "Netflix" })
      const paramount = screen.getByRole("group", { name: "Paramount+" })
      fireEvent.click(within(netflix).getByRole("checkbox", { name: /Film/ }))
      fireEvent.click(
        within(netflix).getByRole("checkbox", { name: /Serie/ }),
      )
      fireEvent.click(
        within(paramount).getByRole("checkbox", { name: /Film|Serie|Mista/ }),
      )
      fireEvent.click(screen.getByRole("button", { name: /ui\.streamAddCount/ }))
      await waitFor(() => expect(onAddBatch).toHaveBeenCalledTimes(1))
      expect(onAddBatch.mock.calls[0][0]).toEqual([
        { service: "netflix", country: "italy", sections: ["movies", "series"], source: "auto", variant: null },
        { service: "paramount", country: "italy", sections: ["all"], source: "auto", variant: null },
      ])
      expect(onClose).toHaveBeenCalled()
    })

    it("unchecking one provider section never affects other providers", async () => {
      const { onAddBatch } = await openItaly()
      const netflix = screen.getByRole("group", { name: "Netflix" })
      fireEvent.click(within(netflix).getByRole("checkbox", { name: /Film/ }))
      const paramountBox = within(screen.getByRole("group", { name: "Paramount+" })).getByRole("checkbox", { name: /Film|Serie|Mista/ })
      fireEvent.click(paramountBox)
      // Uncheck the Netflix Film again: Paramount stays selected.
      fireEvent.click(within(netflix).getByRole("checkbox", { name: /Film/ }))
      expect(paramountBox).toBeChecked()
      expect(within(netflix).getByRole("checkbox", { name: /Film/ })).not.toBeChecked()
      fireEvent.click(screen.getByRole("button", { name: /ui\.streamAddCount/ }))
      await waitFor(() => expect(onAddBatch).toHaveBeenCalledTimes(1))
      expect(onAddBatch.mock.calls[0][0]).toEqual([
        { service: "paramount", country: "italy", sections: ["all"], source: "auto", variant: null },
      ])
    })

    it("provider toggle selects only its own visible choices; already-imported lists are not re-added", async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(perProviderBody())))
      const onAddBatch = vi.fn((_entries: GenericAddEntry[]): BatchAddResult => ({ status: "added", added: 1, merged: 0, duplicates: 0, selections: [] }))
      renderWithCtx(
        <StreamingCatalogDialog
          isOpen
          onClose={vi.fn()}
          existing={[{ service: "paramount", chartSlug: "italy", country: "IT", sections: ["all"], enabled: true, source: "auto", variant: null, legacy: false }]}
          isLegacy={false}
          onAddBatch={onAddBatch}
        />,
      )
      fireEvent.click(await screen.findByRole("button", { name: /Italia/ }))
      // Provider toggle checks both Netflix sections, nothing else.
      fireEvent.click(screen.getByRole("checkbox", { name: /Netflix/ }))
      const netflix = screen.getByRole("group", { name: "Netflix" })
      expect(within(netflix).getByRole("checkbox", { name: /Film/ })).toBeChecked()
      expect(within(netflix).getByRole("checkbox", { name: /Serie/ })).toBeChecked()
      expect(within(screen.getByRole("group", { name: "Paramount+" })).getByRole("checkbox", { name: /Film|Serie|Mista/ })).not.toBeChecked()
      // Selecting ONLY the already-imported Paramount mixed disables Add.
      fireEvent.click(screen.getByRole("checkbox", { name: /Netflix/ }))
      fireEvent.click(within(screen.getByRole("group", { name: "Paramount+" })).getByRole("checkbox", { name: /Film|Serie|Mista/ }))
      expect(screen.getByRole("button", { name: /ui\.streamAddCount/ })).toBeDisabled()
    })
  })
})

describe("StreamingCatalogCard", () => {
  const cardProps = {
    catalogId: "pictorium-stream2-netflix--italy--movies--auto",
    title: "Netflix Movies",
    section: "movies" as const,
    apiKey: "k",
    userId: null as string | null,
    hasKey: true,
    savedKeys: new Set<string>(),
    navigateToPoster: vi.fn(),
    seasonalKeywords: null as { halloween?: readonly string[]; christmas?: readonly string[] } | null,
    registerRefresh: vi.fn(),
    onRemove: vi.fn(),
  }

  function browseOk(source = "flixpatrol") {
    mockedUserFetch.mockImplementation(async (url: unknown) => {
      const s = String(url)
      if (s.includes("/api/streaming-catalog?")) {
        return browseResponse(
          "pictorium-stream2-netflix--italy--movies--auto",
          "netflix",
          "italy",
          "movies",
          source,
          [
            { tmdbId: 11, mediaType: "movie", title: "Film Uno", rank: 1, posterPath: "/a.jpg", year: 2024 },
            { tmdbId: 12, mediaType: "movie", title: "Film Due", rank: 2, posterPath: "/b.jpg", year: 2023 },
          ],
        )
      }
      return new Response(JSON.stringify({}))
    })
  }

  it("renders ORIGINAL TMDB thumbs (never /api/poster) with SVG-only actual source + per-list trash", async () => {
    browseOk("flixpatrol")
    const onRemove = vi.fn()
    const navigateToPoster = vi.fn()
    renderWithCtx(<StreamingCatalogCard {...cardProps} navigateToPoster={navigateToPoster} onRemove={onRemove} />)
    // Original TMDB miniatures, never rendered Pictorium posters.
    const thumb = await screen.findByAltText("Film Uno")
    expect((thumb as HTMLImageElement).src).toContain("https://image.tmdb.org/t/p/w185/a.jpg")
    for (const img of Array.from(document.querySelectorAll("img"))) {
      expect((img as HTMLImageElement).src).not.toContain("/api/poster")
    }
    // Footer: SVG-only actual source beside the counter, section badge,
    // trash on the right. The badge follows the stored section (movies).
    expect(document.querySelector('img[src="/catalogs/idB7ODvhZ1_logos.svg"]')).not.toBeNull()
    expect(screen.getByText("2 ui.itemMany")).toBeTruthy()
    expect(screen.getByText("ui.movie", { exact: true })).toBeTruthy()
    const trash = screen.getByRole("button", { name: "ui.deleteCatalog" })
    fireEvent.click(trash)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(navigateToPoster).not.toHaveBeenCalled()
    // The tmdbId travels from the browse row (never a TMDB inference).
    fireEvent.click(screen.getByAltText("Film Due"))
    expect(navigateToPoster).toHaveBeenCalledWith(
      expect.objectContaining({ id: 12, media_type: "movie" }),
      "cataloghi",
      "Netflix Movies",
      null,
    )
  })

  it("section badge follows the stored section, never the row media types", async () => {
    browseOk("flixpatrol")
    // Same movie rows, but the stored section is series: the badge says Serie.
    renderWithCtx(<StreamingCatalogCard {...cardProps} section="series" />)
    await screen.findByAltText("Film Uno")
    expect(screen.getByText("ui.tvSeries", { exact: true })).toBeTruthy()
    expect(screen.queryByText("ui.movie", { exact: true })).toBeNull()
  })

  it("mixed lists wear the Mista badge with the variant pill kept distinct", async () => {
    mockedUserFetch.mockImplementation(async (url: unknown) => {
      if (String(url).includes("/api/streaming-catalog?")) {
        return browseResponse("pictorium-stream2-rai--italy--all--auto", "rai", "italy", "all", "flixpatrol", [
          { tmdbId: 31, mediaType: "movie", title: "Misto Film", rank: 1, posterPath: "/c.jpg", year: 2024 },
        ])
      }
      return new Response(JSON.stringify({}))
    })
    renderWithCtx(<StreamingCatalogCard {...cardProps} section="all" variantLabel="Italian" />)
    await screen.findByAltText("Misto Film")
    expect(screen.getByText("ui.streamSectionMixed", { exact: true })).toBeTruthy()
    // Variant pill stays a separate badge (never merged into the section).
    expect(screen.getByText("Italian", { exact: true })).toBeTruthy()
  })

  it("unknown source renders honestly without a logo; errors retry", async () => {
    mockedUserFetch.mockImplementation(async (url: unknown) => {
      if (String(url).includes("/api/streaming-catalog?")) {
        return browseResponse("pictorium-stream2-x--italy--movies--auto", "x", "italy", "movies", "unknown", [])
      }
      return new Response(JSON.stringify({}))
    })
    renderWithCtx(<StreamingCatalogCard {...cardProps} />)
    // Empty pinned rows render the honest pending text, no guessed logo.
    expect(await screen.findByText("ui.streamSourceUnknown")).toBeTruthy()
    expect(document.querySelector('img[src="/catalogs/idB7ODvhZ1_logos.svg"]')).toBeNull()
    expect(document.querySelector('img[src="/catalogs/JW_Logo_color.svg"]')).toBeNull()
  })

  it("missing key shows the honest notice instead of fake posters", async () => {
    browseOk()
    renderWithCtx(<StreamingCatalogCard {...cardProps} hasKey={false} />)
    expect(await screen.findByText("ui.streamNoKeyNotice")).toBeTruthy()
    expect(document.querySelector('img[src*="image.tmdb.org"]')).toBeNull()
  })

  it("empty genuine snapshot renders the honest empty text with its stamp (never a blank rail)", async () => {
    mockedUserFetch.mockImplementation(async (url: unknown) => {
      if (String(url).includes("/api/streaming-catalog?")) {
        return browseResponse(
          "pictorium-stream2-paramount--italy--all--auto",
          "paramount",
          "italy",
          "all",
          "unknown",
          [],
          1761331200000,
        )
      }
      return new Response(JSON.stringify({}))
    })
    renderWithCtx(<StreamingCatalogCard {...cardProps} section="all" />)
    // Honest empty state instead of a blank rail; the served stamp stays.
    expect(await screen.findByText("ui.customNoTitles")).toBeTruthy()
    const iso = new Date(1761331200000).toISOString()
    expect(document.querySelector(`time[datetime="${iso}"]`)).not.toBeNull()
    // No counter, no guessed logo, no thumbnails.
    expect(document.querySelector(".counter-badge")).toBeNull()
    expect(document.querySelector('img[src="/catalogs/idB7ODvhZ1_logos.svg"]')).toBeNull()
    expect(document.querySelector('img[src="/catalogs/JW_Logo_color.svg"]')).toBeNull()
    expect(document.querySelector('img[src*="image.tmdb.org"]')).toBeNull()
  })

  it("renders the Pictorium publication line from the browse stamp (no extra fetch)", async () => {
    mockedUserFetch.mockImplementation(async (url: unknown) => {
      if (String(url).includes("/api/streaming-catalog?")) {
        return browseResponse(
          "pictorium-stream2-netflix--italy--movies--auto",
          "netflix",
          "italy",
          "movies",
          "flixpatrol",
          [{ tmdbId: 11, mediaType: "movie", title: "Film Uno", rank: 1, posterPath: "/a.jpg", year: 2024 }],
          1761331200000,
        )
      }
      return new Response(JSON.stringify({}))
    })
    renderWithCtx(<StreamingCatalogCard {...cardProps} />)
    await screen.findByAltText("Film Uno")
    // <time dateTime> carries the exact served instant (never the page clock).
    const iso = new Date(1761331200000).toISOString()
    const timeEl = document.querySelector(`time[datetime="${iso}"]`)
    expect(timeEl).not.toBeNull()
    expect(timeEl?.textContent?.length).toBeGreaterThan(0)
    // The stamp rides the same browse response: no second request.
    expect(
      mockedUserFetch.mock.calls.filter(([u]) => String(u).includes("/api/streaming-catalog")).length,
    ).toBe(1)
  })

  it("shows the honest unknown line when the browse carries no stamp", async () => {
    browseOk("flixpatrol")
    renderWithCtx(<StreamingCatalogCard {...cardProps} />)
    await screen.findByAltText("Film Uno")
    expect(screen.getByText("ui.publicationUnknown")).toBeTruthy()
    expect(document.querySelector("time")).toBeNull()
  })
})

describe("CataloghiView streaming integration", () => {
  function mockBrowse() {
    mockedUserFetch.mockImplementation(async (url: unknown) => {
      const s = String(url)
      if (s.includes("catalog=pictorium-stream-netflix-it-movies")) {
        return browseResponse("pictorium-stream-netflix-it-movies", "netflix", "italy", "movies", "flixpatrol", [
          { tmdbId: 11, mediaType: "movie", title: "Film Uno", rank: 1, posterPath: "/a.jpg", year: 2024 },
        ])
      }
      if (s.includes("catalog=pictorium-stream-netflix-it-series")) {
        return browseResponse("pictorium-stream-netflix-it-series", "netflix", "italy", "series", "justwatch", [
          { tmdbId: 22, mediaType: "tv", title: "Serie Uno", rank: 2, posterPath: "/b.jpg", year: 2023 },
        ])
      }
      return new Response(JSON.stringify({}))
    })
  }

  it("opt-in mode shows ONLY the chosen lists (no legacy platforms, no all-platform loading)", async () => {
    mockBrowse()
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: [{ service: "netflix", country: "IT" }],
      mdblistAnimeList: [],
    })
    expect(await screen.findByText("ui.streamCuratedTitle")).toBeTruthy()
    expect(await screen.findByAltText("Film Uno")).toBeTruthy()
    // Legacy platform section is neither rendered nor loaded.
    expect(screen.queryByText("ui.streamingPlatforms")).toBeNull()
    for (const call of mockedUserFetch.mock.calls) {
      expect(String(call[0])).not.toContain("/api/tmdb/trending")
    }
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("flixpatrol")
    }
  })

  it("legacy mode keeps the historical platforms byte-identical (no curated section)", async () => {
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: undefined,
      mdblistAnimeList: [],
      streamingCharts: {},
      trending: [],
    })
    expect(screen.queryByText("ui.streamCuratedTitle")).toBeNull()
    expect(screen.getByText("ui.streamingPlatforms")).toBeTruthy()
  })

  it("genuine-new spaces (anime disabled) show no anime rows; enabled anime still renders", async () => {
    const animeItem = { id: 5, media_type: "tv", title: "Anime Show", poster_path: "/a.jpg", rank: 1 }
    const { unmount } = renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: [],
      disabledCatalogIds: ["pictorium-anime-movies", "pictorium-anime"],
      mdblistAnimeList: [animeItem],
    })
    expect(screen.queryByText("ui.trendingAnime")).toBeNull()
    unmount()
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: [],
      disabledCatalogIds: [],
      mdblistAnimeList: [animeItem],
    })
    expect(await screen.findByText("ui.trendingAnime")).toBeTruthy()
  })

  it("general JW boxes wear the JW logo per slot (icon-only footers, no wordmark text)", async () => {
    const trendingItems = [
      { id: 1, media_type: "movie" as const, title: "T", poster_path: "/t.jpg", rank: 1 },
      { id: 2, media_type: "tv" as const, title: "S", poster_path: "/s.jpg", rank: 2 },
    ]
    const { unmount } = renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      trending: trendingItems,
      rankingSourceMovie: "",
      rankingSourceSeries: "",
    })
    expect(await screen.findByText(/ui\.justwatchTop20/)).toBeTruthy()
    // One SVG-only icon per box footer (Film + Serie), never a text pill.
    expect(document.querySelectorAll('img[src="/catalogs/JW_Logo_color.svg"]')).toHaveLength(2)
    expect(screen.queryByText("ui.streamSourceJw")).toBeNull()
    // Factory slots are toggle-only (explicit user decision: rankings can
    // be disabled but never deleted): no per-box trash anywhere. Toggle
    // lives in the manager (Power); the factory reset restores defaults.
    expect(screen.queryByRole("button", { name: "ui.deleteCatalog" })).toBeNull()
    unmount()
    // Custom ranking override on the movies slot only: the movies box loses
    // the JW mark (never false-brand custom), the actual JW series slot keeps
    // its own icon — still with no trash on either box.
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      trending: trendingItems,
      customCatalogs: [{ id: "c1", name: "Mine", type: "movie", url: "https://lists.example.com/x" }],
      rankingSourceMovie: "c1",
      rankingSourceSeries: "",
    })
    const headings = await screen.findAllByText(/ui\.rankingSourceTitle/)
    expect(
      headings.some(
        (el) => el.closest("h2") !== null && (el.textContent ?? "").includes("🇮🇹"),
      ),
    ).toBe(true)
    expect(document.querySelectorAll('img[src="/catalogs/JW_Logo_color.svg"]')).toHaveLength(1)
    // Still no trash on either JW box (the custom list keeps its own).
    for (const icon of Array.from(document.querySelectorAll('img[src="/catalogs/JW_Logo_color.svg"]'))) {
      const card = icon.closest(".simkl-list-card")
      if (!(card instanceof HTMLElement)) throw new Error("JW card not found")
      expect(within(card).queryByRole("button", { name: "ui.deleteCatalog" })).toBeNull()
    }
  })

  it("JW boxes carry per-slot publication stamps (unknown slots stay honest)", async () => {
    const trendingItems = [
      { id: 1, media_type: "movie" as const, title: "T", poster_path: "/t.jpg", rank: 1 },
      { id: 2, media_type: "tv" as const, title: "S", poster_path: "/s.jpg", rank: 2 },
    ]
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      trending: trendingItems,
      rankingSourceMovie: "",
      rankingSourceSeries: "",
      trendingUpdatedAt: { movie: 1761331200000, series: null },
    })
    await screen.findByText(/ui\.justwatchTop20/)
    // Movies slot: exact served instant in an accessible <time>.
    const iso = new Date(1761331200000).toISOString()
    const timeEl = document.querySelector(`time[datetime="${iso}"]`)
    expect(timeEl).not.toBeNull()
    expect(timeEl?.textContent?.length).toBeGreaterThan(0)
    // Series slot: no stamp, so the honest unknown line (never invented).
    expect(screen.getByText("ui.publicationUnknown")).toBeTruthy()
  })

  it("anime slots carry their own stamps (movie vs series)", async () => {
    const animeItems = [
      { id: 5, media_type: "movie", title: "Anime Film", poster_path: "/a.jpg", rank: 1 },
      { id: 6, media_type: "tv", title: "Anime Show", poster_path: "/b.jpg", rank: 1 },
    ]
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: [],
      mdblistAnimeList: animeItems,
      disabledCatalogIds: [],
      animeUpdatedAt: { movie: 1761331200000, series: null },
    })
    await screen.findByText(/ui\.trendingAnime/)
    const iso = new Date(1761331200000).toISOString()
    expect(document.querySelector(`time[datetime="${iso}"]`)).not.toBeNull()
    expect(screen.getByText("ui.publicationUnknown")).toBeTruthy()
  })

  it("custom lists show the honest unknown line (no invented date)", async () => {
    mockedUserFetch.mockImplementation(async (url: unknown) => {
      if (String(url).includes("/api/mdblist/custom")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 41, media_type: "movie", title: "C Film", poster_path: "/c.jpg", rank: 1 }],
            total: 1,
          }),
        } as unknown as Response
      }
      return new Response(JSON.stringify({}))
    })
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      customCatalogs: [{ id: "c1", name: "Mine", type: "movie", url: "https://lists.example.com/x" }],
    })
    const tile = await screen.findByAltText("C Film")
    const card = tile.closest(".simkl-list-card")
    expect(card).not.toBeNull()
    expect(within(card as HTMLElement).getByText("ui.publicationUnknown")).toBeTruthy()
    expect((card as HTMLElement).querySelector("time")).toBeNull()
  })
})

describe("StreamingCatalogDialog country picker (localized, global first)", () => {
  function globalChoice() {
    return {
      service: "netflix", serviceName: "Netflix", country: "GLOBAL", countryFlag: "🌐", countryLabel: "Global",
      countryFlixSlug: "global", chartSlug: "global", section: "movies",
      source: "justwatch", variant: null, variants: [],
      catalogId: "pictorium-stream2-netflix--global--movies--justwatch",
      fpChart: false, jwFallback: true, potential: "justwatch",
      displayFp: "Top 10 · FlixPatrol — Film", displayJw: "Top 10 · JustWatch — Film",
      overallOnly: false, note: null,
    }
  }

  it("renders GLOBAL first, then alphabetical in the current UI language, flags from the ISO map", async () => {
    // Backend ships empty flags for non-RegionDef rows and English labels:
    // the picker must still show every flag (ISO-mapped) with localized names.
    const noFlag = (c: Record<string, unknown>) => ({ ...c, countryFlag: "" })
    const body = {
      indexStatus: "ok",
      generatedAt: "2026-10-23T00:00:00Z",
      choices: [...availabilityChoices.map(noFlag), globalChoice()],
    }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)))
    renderWithCtx(
      <StreamingCatalogDialog isOpen onClose={vi.fn()} existing={[]} isLegacy={false} onAddBatch={vi.fn()} />,
    )
    const group = await screen.findByRole("group", { name: "ui.streamPickCountry" })
    const buttons = Array.from(group.querySelectorAll("button"))
    expect(buttons.length).toBeGreaterThanOrEqual(4)
    const names = buttons.map((b) => b.textContent ?? "")
    // 🌐 Global first (translated caller label), then Italian alphabetical.
    expect(names[0]).toContain("🌐")
    expect(names.slice(1)).toEqual([...names.slice(1)].sort((a, b) => a.localeCompare(b, "it")))
    expect(names).toEqual(expect.arrayContaining([
      expect.stringContaining("Italia"),
      expect.stringContaining("Stati Uniti"),
      expect.stringContaining("Canada"),
    ]))
    // Flags come from the factual ISO map even though the server sent none.
    for (const want of ["🇮🇹", "🇺🇸", "🇨🇦", "🌐"]) {
      expect(names.some((n) => n.includes(want)), `missing flag ${want}`).toBe(true)
    }
  })
})

describe("CataloghiView curated pairing (Film LEFT + Serie RIGHT, mixed fullwidth)", () => {
  function mockPairBrowse() {
    mockedUserFetch.mockImplementation(async (url: unknown) => {
      const s = String(url)
      if (s.includes("catalog=pictorium-stream-netflix-it-movies")) {
        return browseResponse("pictorium-stream-netflix-it-movies", "netflix", "italy", "movies", "flixpatrol", [
          { tmdbId: 11, mediaType: "movie", title: "Film Uno", rank: 1, posterPath: "/a.jpg", year: 2024 },
        ])
      }
      if (s.includes("catalog=pictorium-stream-netflix-it-series")) {
        return browseResponse("pictorium-stream-netflix-it-series", "netflix", "italy", "series", "justwatch", [
          { tmdbId: 22, mediaType: "tv", title: "Serie Uno", rank: 2, posterPath: "/b.jpg", year: 2023 },
        ])
      }
      return new Response(JSON.stringify({}))
    })
  }

  it("pairs matching descriptors side by side with per-section actual source + per-section remove", async () => {
    mockPairBrowse()
    const onRemove = vi.fn()
    const navigateToPoster = vi.fn()
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: [{ service: "netflix", country: "IT" }],
      mdblistAnimeList: [],
      trending: [],
      removeStreamingSelection: onRemove,
      navigateToPoster,
    })
    const film = await screen.findByAltText("Film Uno")
    const serie = await screen.findByAltText("Serie Uno")
    // Same pair grid (desktop 2-col, stacked mobile), Film before Serie.
    const grid = film.closest(".grid")
    expect(grid).not.toBeNull()
    expect(grid!.className).toContain("lg:grid-cols-2")
    expect(grid).toBe(serie.closest(".grid"))
    expect(grid!.compareDocumentPosition(serie) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Each section keeps its OWN winning source (FP vs JW may differ).
    expect(grid!.querySelector('img[src="/catalogs/idB7ODvhZ1_logos.svg"]')).not.toBeNull()
    expect(grid!.querySelector('img[src="/catalogs/JW_Logo_color.svg"]')).not.toBeNull()
    // Per-section trash removes only that section (sibling stays).
    const trashes = screen.getAllByRole("button", { name: "ui.deleteCatalog" })
    expect(trashes).toHaveLength(2)
    fireEvent.click(trashes[0])
    expect(onRemove).toHaveBeenCalledWith("netflix", "IT", "auto", null, "movies")
    fireEvent.click(trashes[1])
    expect(onRemove).toHaveBeenCalledWith("netflix", "IT", "auto", null, "series")
  })

  it("card body opens the list grid (real media types); trash never opens; poster opens the editor", async () => {
    mockPairBrowse()
    const onRemove = vi.fn()
    const navigateToPoster = vi.fn()
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: [{ service: "netflix", country: "IT" }],
      mdblistAnimeList: [],
      trending: [],
      removeStreamingSelection: onRemove,
      navigateToPoster,
    })
    await screen.findByAltText("Film Uno")
    // Trash removes without opening the grid.
    fireEvent.click(screen.getAllByRole("button", { name: "ui.deleteCatalog" })[0])
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(document.querySelector("#catalog-grid-title")).toBeNull()
    // Card body (counter) opens the grid with the pinned rows.
    fireEvent.click(screen.getAllByText("1 ui.itemOne")[0])
    expect(await screen.findByRole("dialog")).toBeTruthy()
    expect(document.querySelector("#catalog-grid-title")).not.toBeNull()
    // Poster tile opens the editor with the row media type + list context.
    // (The open grid duplicates the tile: index 0 is the card tile.)
    fireEvent.click(screen.getAllByAltText("Film Uno")[0])
    expect(navigateToPoster).toHaveBeenCalledWith(
      expect.objectContaining({ id: 11, media_type: "movie" }),
      "cataloghi",
      expect.any(String),
      expect.anything(),
    )
  })

  it("curated cards show up to 10 thumbs like JustWatch (responsive rail, full payload)", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({
      tmdbId: 100 + i, mediaType: "movie" as const, title: `Film ${i + 1}`, rank: i + 1, posterPath: `/p${i + 1}.jpg`, year: 2024,
    }))
    mockedUserFetch.mockImplementation(async () => browseResponse(
      "pictorium-stream2-netflix--italy--movies--auto", "netflix", "italy", "movies", "flixpatrol", ten,
    ))
    const onOpenList = vi.fn()
    const navigateToPoster = vi.fn()
    renderWithCtx(
      <StreamingCatalogCard
        catalogId="pictorium-stream2-netflix--italy--movies--auto"
        title="Netflix Film"
        section="movies"
        apiKey="k"
        userId={null}
        hasKey
        savedKeys={new Set()}
        navigateToPoster={navigateToPoster}
        seasonalKeywords={null}
        registerRefresh={vi.fn()}
        onRemove={vi.fn()}
        onOpenList={onOpenList}
      />,
    )
    await screen.findByAltText("Film 1")
    // SAME responsive presentation as JustWatch: all pinned rows (up to the
    // shared SimklCard 10-cap) are eligible preview thumbs — narrow paired
    // width shows ~6 in the contained rail, fullwidth shows all 10.
    const thumbs = Array.from(document.querySelectorAll(".posters img"))
    expect(thumbs).toHaveLength(10)
    expect(thumbs.map((img) => (img as HTMLImageElement).alt)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Film ${i + 1}`),
    )
    for (const img of thumbs) {
      expect((img as HTMLImageElement).src).toContain("https://image.tmdb.org/t/p/w185/")
      expect((img as HTMLImageElement).src).not.toContain("/api/poster")
    }
    // Footer counter keeps the REAL total (10, not a visible subset).
    expect(screen.getByText("10 ui.itemMany")).toBeTruthy()
    // The box is fluid (--fill, not the fixed 980px base) with min-w-0
    // containment: the rail scrolls inside instead of painting over siblings.
    expect(document.querySelector(".simkl-list-card")!.className).toContain("simkl-list-card--fill")
    // Grid open receives ALL 10 rows in original order (no truncation).
    fireEvent.click(screen.getByText("10 ui.itemMany"))
    expect(onOpenList).toHaveBeenCalledTimes(1)
    expect(onOpenList.mock.calls[0][1]).toBe("Netflix Film")
    expect(onOpenList.mock.calls[0][0].map((it: { id: number }) => it.id)).toEqual(
      [100, 101, 102, 103, 104, 105, 106, 107, 108, 109],
    )
    // Tiles still open the editor with the row media type.
    fireEvent.click(screen.getByAltText("Film 3"))
    expect(navigateToPoster).toHaveBeenCalledWith(
      expect.objectContaining({ id: 102, media_type: "movie" }),
      "cataloghi",
      "Netflix Film",
      null,
    )
  })

  it("same descriptor with movies+series+all renders all three (mixed never drops siblings)", async () => {
    mockedUserFetch.mockImplementation(async (url: unknown) => {
      const s = String(url)
      const id = (section: string) => `pictorium-stream2-paramount--italy--${section}--auto`
      if (s.includes(`catalog=${id("movies")}`)) {
        return browseResponse(id("movies"), "paramount", "italy", "movies", "flixpatrol", [
          { tmdbId: 41, mediaType: "movie", title: "P Film", rank: 1, posterPath: "/e.jpg", year: 2024 },
        ])
      }
      if (s.includes(`catalog=${id("series")}`)) {
        return browseResponse(id("series"), "paramount", "italy", "series", "flixpatrol", [
          { tmdbId: 42, mediaType: "tv", title: "P Serie", rank: 2, posterPath: "/f.jpg", year: 2023 },
        ])
      }
      if (s.includes(`catalog=${id("all")}`)) {
        return browseResponse(id("all"), "paramount", "italy", "all", "flixpatrol", [
          { tmdbId: 43, mediaType: "movie", title: "P Misto", rank: 3, posterPath: "/g.jpg", year: 2022 },
        ])
      }
      return new Response(JSON.stringify({}))
    })
    const onRemove = vi.fn()
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: [{ service: "paramount", country: "italy", sections: ["movies", "series", "all"] }],
      mdblistAnimeList: [],
      trending: [],
      removeStreamingSelection: onRemove,
    })
    // All three siblings render: the split pair side by side + the mixed
    // fullwidth card. The mixed list must NEVER swallow Film/Serie.
    await screen.findByAltText("P Film")
    await screen.findByAltText("P Serie")
    await screen.findByAltText("P Misto")
    expect(document.querySelectorAll(".simkl-list-card")).toHaveLength(3)
    // Removing the mixed list narrows the entry (both splits stay); removing
    // one split keeps the mixed card and the other split (narrow, never wipe).
    const trashes = screen.getAllByRole("button", { name: "ui.deleteCatalog" })
    expect(trashes).toHaveLength(3)
    fireEvent.click(trashes[2])
    expect(onRemove).toHaveBeenCalledWith("paramount", "IT", "auto", null, "all")
    fireEvent.click(trashes[0])
    expect(onRemove).toHaveBeenCalledWith("paramount", "IT", "auto", null, "movies")
  })

  it("Rai IT base Film + variant-it Serie pair side by side (complementary singles)", async () => {
    // Real offline shape (italy.rai: base movies, variant-only series-it):
    // different variants must still pair when they are the single unmatched
    // Film + single unmatched Serie of the same service+country+source.
    mockedUserFetch.mockImplementation(async (url: unknown) => {
      const s = String(url)
      if (s.includes("catalog=pictorium-stream2-rai--italy--movies--auto")) {
        return browseResponse("pictorium-stream2-rai--italy--movies--auto", "rai", "italy", "movies", "flixpatrol", [
          { tmdbId: 51, mediaType: "movie", title: "Rai Film", rank: 1, posterPath: "/h.jpg", year: 2024 },
        ])
      }
      if (s.includes("catalog=pictorium-stream2-rai--italy--series--auto--it")) {
        return browseResponse("pictorium-stream2-rai--italy--series--auto--it", "rai", "italy", "series", "flixpatrol", [
          { tmdbId: 52, mediaType: "tv", title: "Rai Serie", rank: 2, posterPath: "/i.jpg", year: 2023 },
        ])
      }
      if (s.includes("catalog=pictorium-stream2-rai--italy--all--auto")) {
        return browseResponse("pictorium-stream2-rai--italy--all--auto", "rai", "italy", "all", "flixpatrol", [
          { tmdbId: 53, mediaType: "movie", title: "Rai Misto", rank: 3, posterPath: "/j.jpg", year: 2022 },
        ])
      }
      return new Response(JSON.stringify({}))
    })
    const onRemove = vi.fn()
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: [
        { service: "rai", country: "italy", sections: ["movies"], source: "auto" },
        { service: "rai", country: "italy", sections: ["series"], source: "auto", variant: "it" },
        { service: "rai", country: "italy", sections: ["all"], source: "auto" },
      ],
      mdblistAnimeList: [],
      trending: [],
      removeStreamingSelection: onRemove,
    })
    const film = await screen.findByAltText("Rai Film")
    await screen.findByAltText("Rai Serie")
    await screen.findByAltText("Rai Misto")
    // One Film LEFT / Serie RIGHT pair row (same grid) + the mixed fullwidth row.
    const pairGrid = film.closest(".grid")
    expect(pairGrid).not.toBeNull()
    expect(pairGrid!.className).toContain("lg:grid-cols-2")
    expect(document.querySelectorAll(".simkl-list-card")).toHaveLength(3)
    // Distinct ids/policy preserved per card: variant pill only on the variant card.
    expect(screen.getByText("Italian")).toBeTruthy()
    // Deleting the variant series leaves the base Film and the mixed list,
    // with the exact variant identity (never the base policy).
    const seriesTile = screen.getByAltText("Rai Serie")
    const seriesCard = seriesTile.closest(".simkl-list-card")
    if (!(seriesCard instanceof HTMLElement)) throw new Error("Rai series card not found")
    fireEvent.click(within(seriesCard).getByRole("button", { name: "ui.deleteCatalog" }))
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith("rai", "IT", "auto", "it", "series")
  })

  it("mixed 'all' renders fullwidth (never faked Film/Serie) with mixed media types preserved", async () => {
    mockedUserFetch.mockImplementation(async (url: unknown) => {
      const s = String(url)
      if (s.includes("catalog=pictorium-stream2-crave--canada--all--auto")) {
        return browseResponse("pictorium-stream2-crave--canada--all--auto", "crave", "canada", "all", "flixpatrol", [
          { tmdbId: 31, mediaType: "movie", title: "Misto Film", rank: 1, posterPath: "/c.jpg", year: 2024 },
          { tmdbId: 32, mediaType: "tv", title: "Misto Serie", rank: 2, posterPath: "/d.jpg", year: 2023 },
        ])
      }
      return new Response(JSON.stringify({}))
    })
    const navigateToPoster = vi.fn()
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: [{ service: "crave", country: "canada", sections: ["all"] }],
      mdblistAnimeList: [],
      trending: [],
      navigateToPoster,
    })
    const film = await screen.findByAltText("Misto Film")
    await screen.findByAltText("Misto Serie")
    const grid = film.closest(".grid")
    expect(grid).not.toBeNull()
    expect(grid!.className).toContain("grid-cols-1")
    expect(grid!.className).not.toContain("lg:grid-cols-2")
    // Grid keeps both media types; the tv tile opens the editor as tv.
    fireEvent.click(screen.getByText("2 ui.itemMany"))
    expect(await screen.findByRole("dialog")).toBeTruthy()
    fireEvent.click(screen.getAllByAltText("Misto Serie")[1])
    expect(navigateToPoster).toHaveBeenCalledWith(
      expect.objectContaining({ id: 32, media_type: "tv" }),
      "cataloghi",
      expect.any(String),
      expect.anything(),
    )
  })

  it("single (unpaired) lists span the full section width; pairs stay capped", async () => {
    const singleBrowse = (id: string, service: string, section: "movies" | "series" | "all", title: string, tmdbId: number, mediaType: "movie" | "tv") =>
      browseResponse(id, service, "italy", section, "flixpatrol", [
        { tmdbId, mediaType, title, rank: 1, posterPath: "/s.jpg", year: 2024 },
      ])
    mockedUserFetch.mockImplementation(async (url: unknown) => {
      const s = String(url)
      // Movies-only paramount/italy is a legacy-curated entry (sections are
      // movies/series only): the derived id is the legacy byte-identical one.
      if (s.includes("catalog=pictorium-stream-paramount-it-movies")) {
        return singleBrowse("pictorium-stream-paramount-it-movies", "paramount", "movies", "P Film", 41, "movie")
      }
      if (s.includes("catalog=pictorium-stream2-crave--canada--all--auto")) {
        return browseResponse("pictorium-stream2-crave--canada--all--auto", "crave", "canada", "all", "flixpatrol", [
          { tmdbId: 43, mediaType: "movie", title: "P Misto", rank: 3, posterPath: "/g.jpg", year: 2022 },
        ])
      }
      if (s.includes("catalog=pictorium-stream-netflix-it-movies")) {
        return singleBrowse("pictorium-stream-netflix-it-movies", "netflix", "movies", "Film Uno", 11, "movie")
      }
      if (s.includes("catalog=pictorium-stream-netflix-it-series")) {
        return singleBrowse("pictorium-stream-netflix-it-series", "netflix", "series", "Serie Uno", 12, "tv")
      }
      return new Response(JSON.stringify({}))
    })

    // Movie-only single: full-width block, fluid fill WITHOUT the 980px cap.
    const solo = renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: [{ service: "paramount", country: "italy", sections: ["movies"] }],
      mdblistAnimeList: [],
      trending: [],
    })
    const film = await screen.findByAltText("P Film")
    const soloCard = film.closest(".simkl-list-card")
    expect(soloCard).not.toBeNull()
    expect(soloCard!.className).toContain("simkl-list-card--fill")
    expect(soloCard!.className).toContain("simkl-list-card--single-full")
    const soloGrid = film.closest(".grid")
    expect(soloGrid).not.toBeNull()
    expect(soloGrid!.className).toContain("grid-cols-1")
    expect(soloGrid!.className).not.toContain("lg:grid-cols-2")
    expect(soloGrid!.className).toContain("min-w-0")
    solo.unmount()

    // Mixed-only single: same full-width treatment (never a faked split).
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: [{ service: "crave", country: "canada", sections: ["all"] }],
      mdblistAnimeList: [],
      trending: [],
    })
    const misto = await screen.findByAltText("P Misto")
    const mixedCard = misto.closest(".simkl-list-card")
    expect(mixedCard).not.toBeNull()
    expect(mixedCard!.className).toContain("simkl-list-card--fill")
    expect(mixedCard!.className).toContain("simkl-list-card--single-full")
  })

  it("paired Film+Serie cards keep the capped fill (no single-full bleed)", async () => {
    mockedUserFetch.mockImplementation(async (url: unknown) => {
      const s = String(url)
      if (s.includes("catalog=pictorium-stream-netflix-it-movies")) {
        return browseResponse("pictorium-stream-netflix-it-movies", "netflix", "italy", "movies", "flixpatrol", [
          { tmdbId: 11, mediaType: "movie", title: "Film Uno", rank: 1, posterPath: "/a.jpg", year: 2024 },
        ])
      }
      if (s.includes("catalog=pictorium-stream-netflix-it-series")) {
        return browseResponse("pictorium-stream-netflix-it-series", "netflix", "italy", "series", "justwatch", [
          { tmdbId: 22, mediaType: "tv", title: "Serie Uno", rank: 2, posterPath: "/b.jpg", year: 2023 },
        ])
      }
      return new Response(JSON.stringify({}))
    })
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: [{ service: "netflix", country: "IT" }],
      mdblistAnimeList: [],
      trending: [],
    })
    await screen.findByAltText("Film Uno")
    await screen.findByAltText("Serie Uno")
    for (const card of Array.from(document.querySelectorAll(".simkl-list-card"))) {
      expect((card as HTMLElement).className).toContain("simkl-list-card--fill")
      expect((card as HTMLElement).className).not.toContain("simkl-list-card--single-full")
    }
  })
})
