import { describe, it, expect } from "vitest"
import { getSubGenreLabel } from "../lib/subgenres"

describe("subgenres detection", () => {
  it("labels every rule for Hebrew", () => {
    // getSubGenreLabel ripiega sull'italiano per le lingue senza label: senza
    // una voce `he` su ogni regola il badge sottogenere di un utente ebraico
    // uscirebbe in italiano.
    const HEBREW = /[\u0590-\u05FF]/
    // "Found Footage" e "Film Noir" restano in latino anche in ebraico: sono
    // nomi propri di genere, traslitterarli li renderebbe meno riconoscibili.
    const LATIN_BY_DESIGN = new Set(["found footage", "film noir"])
    for (const kw of ["time travel", "cyberpunk", "whodunit", "heist", "zombie", "vampire", "paranormal", "kaiju", "post-apocalyptic", "found footage", "film noir", "spaghetti western", "martial arts", "space opera"]) {
      const he = getSubGenreLabel([kw], "he")
      expect(he, kw).toBeTruthy()
      if (!LATIN_BY_DESIGN.has(kw)) {
        expect(HEBREW.test(he!), kw).toBe(true)
        expect(he, kw).not.toBe(getSubGenreLabel([kw], "it"))
      }
    }
    expect(getSubGenreLabel(["cyberpunk"], "he")).toBe("סייברפאנק")
    expect(getSubGenreLabel(["time travel"], "he")).toBe("מסע בזמן")
  })

  it("labels every rule for Polish", () => {
    // Stessa garanzia di `he`: senza una voce `pl` su ogni regola il badge
    // sottogenere di un utente polacco ripiegherebbe sull'italiano.
    // "Found Footage", "Film noir", "Cyberpunk" e "Spaghetti Western" restano
    // invariati: sono nomi di genere usati anche in polacco.
    const LATIN_BY_DESIGN = new Set(["found footage", "film noir", "cyberpunk", "spaghetti western"])
    for (const kw of ["time travel", "cyberpunk", "whodunit", "heist", "zombie", "vampire", "paranormal", "kaiju", "post-apocalyptic", "found footage", "film noir", "spaghetti western", "martial arts", "space opera"]) {
      const pl = getSubGenreLabel([kw], "pl")
      expect(pl, kw).toBeTruthy()
      if (LATIN_BY_DESIGN.has(kw)) continue
      expect(pl, kw).not.toBe(getSubGenreLabel([kw], "it"))
      // Le label polacche non devono contenere glifi fuori dal latin-extended:
      // coperti da Inter, quindi nessun tofu sui poster (vedi
      // polish-font-coverage.test.ts).
      expect(/^[\u0000-\u024f ]+$/u.test(pl!), `${kw} -> ${pl}`).toBe(true)
    }
    expect(getSubGenreLabel(["time travel"], "pl")).toBe("Podróż w czasie")
    expect(getSubGenreLabel(["martial arts"], "pl")).toBe("Sztuki walki")
  })

  it("detects cyberpunk for Blade Runner keywords", () => {
    const keywords = ["cyberpunk", "android", "futuristic city"]
    expect(getSubGenreLabel(keywords, "it")).toBe("Cyberpunk")
    expect(getSubGenreLabel(keywords, "en")).toBe("Cyberpunk")
  })



  it("detects time travel for Back to the Future keywords without false cyberpunk match", () => {
    const keywords = ["time travel", "delorean", "time machine", "future"]
    expect(getSubGenreLabel(keywords, "it")).toBe("Viaggi nel Tempo")
  })

  it("detects whodunit for Knives Out keywords with Italian label", () => {
    const keywords = ["murder mystery", "whodunit", "inheritance"]
    expect(getSubGenreLabel(keywords, "it")).toBe("Giallo")
    expect(getSubGenreLabel(keywords, "en")).toBe("Whodunit")
  })

  it("detects zombie for The Walking Dead keywords", () => {
    const keywords = ["zombie apocalypse", "undead"]
    expect(getSubGenreLabel(keywords, "it")).toBe("Film di Zombie")
  })

  it("returns null when no matching subgenre keywords exist", () => {
    const keywords = ["family", "school", "friendship"]
    expect(getSubGenreLabel(keywords, "it")).toBeNull()
  })

  it("detects space opera for The Mandalorian, not spaghetti western", () => {
    const keywords = ["bounty hunter", "affectation", "space western", "space opera", "space exploration", "quest"]
    expect(getSubGenreLabel(keywords, "it")).toBe("Space Opera")
  })

  it("detects spaghetti western for a real western with gunslinger", () => {
    const keywords = ["gunslinger", "wild west", "saloon"]
    expect(getSubGenreLabel(keywords, "it")).toBe("Spaghetti Western")
  })

  it("does not trigger spaghetti western from generic bounty hunter alone", () => {
    const keywords = ["bounty hunter", "action", "crime"]
    expect(getSubGenreLabel(keywords, "it")).toBeNull()
  })
})
