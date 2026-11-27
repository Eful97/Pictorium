import { describe, expect, it } from "vitest"
import { abbreviateGenreName } from "@/lib/genre-abbrev"

describe("abbreviateGenreName", () => {
  it("abbrevia i generi noti in inglese", () => {
    expect(abbreviateGenreName("Science Fiction")).toBe("Sci-Fi")
    expect(abbreviateGenreName("Documentary")).toBe("Docu")
    expect(abbreviateGenreName("History")).toBe("Hist")
    expect(abbreviateGenreName("Biography")).toBe("Bio")
  })

  it("abbrevia i generi noti in italiano", () => {
    expect(abbreviateGenreName("Fantascienza")).toBe("Sci-Fi")
    expect(abbreviateGenreName("Documentario")).toBe("Docu")
  })

  it("lascia invariati i generi sconosciuti", () => {
    expect(abbreviateGenreName("Comedy")).toBe("Comedy")
  })

  it("ignora gli spazi attorno al nome nella ricerca", () => {
    expect(abbreviateGenreName("  Science Fiction  ")).toBe("Sci-Fi")
  })
})
