import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { renderSeparateRatingStack, SEPARATE_STACK_GAP } from "@/lib/separate-rating-renderer"

describe("renderSeparateRatingStack (colonna uniforme: logo sopra, punteggio sotto)", () => {
  it("rende lo stack con pill a larghezza uniforme e gap costante", async () => {
    const stack = await renderSeparateRatingStack(
      [
        { id: "imdb", value: 8.4 },
        { id: "tmdb", value: 8.0 },
        { id: "tomatoes", value: 9.2 },
      ],
      380,
      true,
    )
    expect(stack).not.toBeNull()
    const metadata = await sharp(stack!.png).metadata()
    expect(metadata.width).toBe(stack!.w)
    expect(metadata.height).toBe(stack!.h)
    // Colonna dritta e compatta: più stretta di 140px, gap incluso nell'altezza
    expect(stack!.w).toBeLessThan(140)
    expect(stack!.h).toBeGreaterThan(0)
    expect(SEPARATE_STACK_GAP).toBe(5)
  })

  it("skippate le fonti senza asset; nessuna restante → null (mai 500)", async () => {
    const partial = await renderSeparateRatingStack(
      [
        { id: "nope", value: 7.0 },
        { id: "imdb", value: 8.4 },
      ],
      380,
      true,
    )
    expect(partial).not.toBeNull()
    const single = await renderSeparateRatingStack([{ id: "imdb", value: 8.4 }], 380, true)
    expect(single).not.toBeNull()
    // Stessa pill, con o senza vicini skippati la larghezza coincide
    expect(partial!.w).toBe(single!.w)
    expect(await renderSeparateRatingStack([{ id: "nope", value: 7.0 }], 380, true)).toBeNull()
    expect(await renderSeparateRatingStack([], 380, true)).toBeNull()
  })

  it("cap condiviso a 5: 1-5 invariati per conteggio, 6+ clampati in ordine", async () => {
    const five = [
      { id: "imdb", value: 8.4 },
      { id: "tmdb", value: 8.0 },
      { id: "tomatoes", value: 9.2 },
      { id: "letterboxd", value: 4.1 },
      { id: "trakt", value: 7.5 },
    ]
    const three = await renderSeparateRatingStack(five.slice(0, 3), 380, true)
    const fiveRow = await renderSeparateRatingStack(five, 380, true)
    const sixRow = await renderSeparateRatingStack([...five, { id: "simkl", value: 8.1 }], 380, true)
    expect(three).not.toBeNull()
    expect(fiveRow).not.toBeNull()
    expect(sixRow).not.toBeNull()
    // Più provider = colonna più alta, stessa larghezza di colonna dritta.
    expect(fiveRow!.h).toBeGreaterThan(three!.h)
    // Il sesto non cambia un pixel (ordine preservato, clamp a 5).
    expect(sixRow!.w).toBe(fiveRow!.w)
    expect(sixRow!.h).toBe(fiveRow!.h)
    expect(sixRow!.png.equals(fiveRow!.png)).toBe(true)
  })
})
