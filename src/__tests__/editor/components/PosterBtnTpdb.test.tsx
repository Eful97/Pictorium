import { describe, it, expect } from "vitest"
import { PosterBtn } from "@/components/PosterBtn"
import { PosterOptions } from "@/components/PosterOptions"
import { renderWithCtx } from "@/__tests__/test-utils"
import type { TMDBImage } from "@/lib/types"

const TPDB_BARE = "https://theposterdb.com/api/assets/670524"
const TPDB_VIEW = "https://theposterdb.com/api/assets/670524/view"
const IMGUR = "https://i.imgur.com/session.jpg"
const TMDB_PATH = "/clean1.jpg"

function tile(filePath: string): TMDBImage {
  return { file_path: filePath, iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }
}

function referrerOfImg(img: Element | null | undefined): string | null {
  if (!img) return null
  return img.getAttribute("referrerpolicy") ?? img.getAttribute("referrerPolicy")
}

describe("PosterBtn TPDb thumbnail referrer policy", () => {
  it("TPDb bare direct asset tile omits Referer (no-referrer)", () => {
    const { container } = renderWithCtx(
      <PosterBtn img={tile(TPDB_BARE)} active={false} onSelect={() => {}} />,
    )
    const img = container.querySelector("img")
    expect(img?.getAttribute("src")).toBe(TPDB_BARE)
    expect(referrerOfImg(img)).toBe("no-referrer")
  })

  it("TPDb /view direct asset tile omits Referer (no-referrer)", () => {
    const { container } = renderWithCtx(
      <PosterBtn img={tile(TPDB_VIEW)} active={false} onSelect={() => {}} />,
    )
    expect(referrerOfImg(container.querySelector("img"))).toBe("no-referrer")
  })

  it("non-TPDb custom thumbnail keeps existing behavior (no referrerPolicy)", () => {
    const { container } = renderWithCtx(
      <PosterBtn img={tile(IMGUR)} active={false} onSelect={() => {}} />,
    )
    const img = container.querySelector("img")
    expect(img?.getAttribute("src")).toBe(IMGUR)
    expect(referrerOfImg(img)).toBeNull()
  })

  it("TMDB path tile keeps existing behavior (no referrerPolicy)", () => {
    const { container } = renderWithCtx(
      <PosterBtn img={tile(TMDB_PATH)} active={false} onSelect={() => {}} />,
    )
    expect(referrerOfImg(container.querySelector("img"))).toBeNull()
  })

  it("TPDb lookalike hosts keep existing behavior (no referrerPolicy)", () => {
    for (const url of [
      "https://www.theposterdb.com/api/assets/670524",
      "https://theposterdb.com.evil.com/api/assets/670524",
      "https://theposterdb.com/poster/670524",
    ]) {
      const { container, unmount } = renderWithCtx(
        <PosterBtn img={tile(url)} active={false} onSelect={() => {}} />,
      )
      expect(referrerOfImg(container.querySelector("img"))).toBeNull()
      unmount()
    }
  })

  it("PosterOptions: session (after Add) and saved (reopened) TPDb tiles both omit Referer", () => {
    const posters: TMDBImage[] = [tile(TMDB_PATH)]
    const { container } = renderWithCtx(
      <PosterOptions
        posters={posters}
        posterActivePath={null}
        lang="it"
        selectPoster={() => {}}
        customPosters={[tile(TPDB_BARE)]}
        savedCustomPoster={tile(TPDB_VIEW)}
      />,
    )
    const imgs = Array.from(container.querySelectorAll("img"))
    const bySrc = new Map(imgs.map((img) => [img.getAttribute("src"), img]))
    // Entrambi i data path passano dallo stesso consumer (PosterBtn)
    expect(referrerOfImg(bySrc.get(TPDB_BARE))).toBe("no-referrer")
    expect(referrerOfImg(bySrc.get(TPDB_VIEW))).toBe("no-referrer")
    // Il tile TMDB resta invariato
    expect(referrerOfImg(bySrc.get("https://image.tmdb.org/t/p/w154/clean1.jpg"))).toBeNull()
  })
})
