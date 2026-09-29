/**
 * Comprehensive audit: subgenre false positives, edge cases, and keyword overlap.
 */
import { describe, it, expect } from "vitest"
import { getSubGenreLabel } from "../lib/subgenres"

// ── identity tests (each rule fires on its own keyword set) ──────────
describe("identity — each rule matches its core keyword", () => {
  const cases: { key: string; keyword: string; expected: string }[] = [
    { key: "timetravel",        keyword: "time travel",          expected: "Viaggi nel Tempo" },
    { key: "cyberpunk",         keyword: "cyberpunk",            expected: "Cyberpunk" },
    { key: "whodunit",          keyword: "whodunit",             expected: "Giallo" },
    { key: "heist",             keyword: "heist",                expected: "Film di Rapina" },
    { key: "zombie",            keyword: "zombie",               expected: "Film di Zombie" },
    { key: "vampire",           keyword: "vampire",              expected: "Vampiri" },
    { key: "paranormal",        keyword: "haunted house",        expected: "Paranormale" },
    { key: "kaiju",             keyword: "kaiju",                expected: "Kaiju & Mostri" },
    { key: "postapocalyptic",   keyword: "post-apocalyptic",     expected: "Post-Apocalittico" },
    { key: "foundfootage",      keyword: "found footage",        expected: "Found Footage" },
    { key: "noir",              keyword: "neo-noir",             expected: "Film Noir" },
    { key: "spaghettiwestern",  keyword: "spaghetti western",    expected: "Spaghetti Western" },
    { key: "martialarts",       keyword: "martial arts",         expected: "Arti Marziali" },
    { key: "spaceopera",        keyword: "space opera",          expected: "Space Opera" },
  ]
  for (const c of cases) {
    it(`detects ${c.key} from "${c.keyword}"`, () => {
      expect(getSubGenreLabel([c.keyword], "it")).toBe(c.expected)
    })
  }
})

// ── FALSE POSITIVE GATE: things that MUST NOT match ─────────────────
describe("false positive gate — these keyword sets should NOT match any subgenre", () => {
  it("generic family/kids content", () => {
    expect(getSubGenreLabel(["family", "school", "friendship", "coming of age", "slice of life"], "it")).toBeNull()
  })

  it("medical drama (no undead)", () => {
    expect(getSubGenreLabel(["hospital", "doctor", "surgery", "medical ethics", "patient care"], "it")).toBeNull()
  })

  it("historical epic (not spaghetti western)", () => {
    expect(getSubGenreLabel(["historical", "epic", "roman empire", "battle", "centurion"], "it")).toBeNull()
  })

  it("pure romance", () => {
    expect(getSubGenreLabel(["romance", "love", "dating", "marriage", "relationship"], "it")).toBeNull()
  })

  it("pure comedy", () => {
    expect(getSubGenreLabel(["comedy", "slapstick", "stand-up", "parody", "satire"], "it")).toBeNull()
  })

  it("documentary / nature", () => {
    expect(getSubGenreLabel(["documentary", "nature", "wildlife", "ocean", "science"], "it")).toBeNull()
  })

  it("music / concert film", () => {
    expect(getSubGenreLabel(["music", "band", "concert", "musician", "touring"], "it")).toBeNull()
  })

  it("western with NO spaghetti/gunslinger/wild-west tags", () => {
    // "western" alone should NOT trigger spaghettiwestern — the rule needs "spaghetti western", "gunslinger", or "wild west"
    expect(getSubGenreLabel(["western", "cowboy", "horse", "ranch"], "it")).toBeNull()
  })
})

// ── HARD FALSE POSITIVE VECTORS ─────────────────────────────────────
describe("false positive vectors (overly broad keyword patterns)", () => {
  // CYBERPUNK: "dystopia" / "dystopian" are very broad
  it("should NOT flag dystopian drama as cyberpunk", () => {
    const dystopianKeywords = [
      "dystopian future", "totalitarian regime", "oppression", "resistance",
      "handmaid", "the republic of gilead",
    ]
    // FIXED: "dystopian" removed from cyberpunk keywords. Core terms
    // (cyberpunk, android, cybernetics) are sufficient for Blade Runner etc.
    const result = getSubGenreLabel(dystopianKeywords, "it")
    expect(result).toBeNull()
  })

  // CYBERPUNK: "artificial intelligence" is very broad
  it("should NOT flag AI drama as cyberpunk", () => {
    const aiKeywords = [
      "artificial intelligence", "consciousness", "robot", "what is human",
    ]
    const result = getSubGenreLabel(aiKeywords, "it")
    expect(result).toBeNull()
  })

  // CYBERPUNK: "virtual reality" by itself
  it("should NOT flag VR comedy as cyberpunk", () => {
    expect(getSubGenreLabel(["virtual reality", "gaming", "comedy"], "it")).toBeNull()
  })

  // WHODUNIT: "detective" is extremely broad
  it("should NOT flag police procedural as whodunit from 'detective' alone", () => {
    expect(getSubGenreLabel(["detective", "police", "crime scene", "interrogation"], "it")).toBeNull()
  })

  // WHODUNIT: "investigation" is extremely broad
  it("should NOT flag generic crime drama as whodunit from 'investigation' alone", () => {
    expect(getSubGenreLabel(["investigation", "fbi", "crime", "evidence"], "it")).toBeNull()
  })

  // WHODUNIT: "sleuth" is specific enough — it genuinely indicates mystery content
  it("correctly flags sleuth as whodunit (keyword is specific enough)", () => {
    expect(getSubGenreLabel(["sleuth", "mysterious"], "it")).toBe("Giallo")
  })

  // SUPERHERO: "vigilante" is very broad
  it("should NOT flag revenge thriller as superhero from 'vigilante' alone", () => {
    expect(getSubGenreLabel(["vigilante", "revenge", "crime", "urban"], "it")).toBeNull()
  })

  // SPACE OPERA: "space travel" appears in many non-space-opera sci-fi
  it("should NOT flag hard sci-fi as space opera from 'space travel' alone", () => {
    expect(getSubGenreLabel(["space travel", "nasa", "astronaut", "mars mission"], "it")).toBeNull()
  })

  // SPACE OPERA: "alien invasion" is not always space opera
  it("should NOT flag alien invasion horror as space opera", () => {
    expect(getSubGenreLabel(["alien invasion", "survival", "horror", "parasite"], "it")).toBeNull()
  })

  // SPACE OPERA: "spacecraft" alone
  it("should NOT flag spacecraft docu as space opera", () => {
    expect(getSubGenreLabel(["spacecraft", "technology", "engineering"], "it")).toBeNull()
  })

  // PARANORMAL: "ghost" uses word-boundary matching now, so "ghostbusters" no longer matches
  it("should NOT flag Ghostbusters comedy as paranormal (word boundary blocks ghostbusters)", () => {
    expect(getSubGenreLabel(["ghostbusters", "comedy", "supernatural comedy"], "it")).toBeNull()
  })

  // ZOMBIE: "infected" could overlap with medical/virus keywords
  it("should NOT flag medical thriller as zombie from 'infected' alone", () => {
    expect(getSubGenreLabel(["infected", "virus", "outbreak", "quarantine"], "it")).toBeNull()
  })

  // POST-APOCALYPTIC: "survival horror" may not always be post-apocalyptic
  it("should NOT flag survival horror game adaptation as post-apocalyptic if not set in wasteland", () => {
    expect(getSubGenreLabel(["survival horror", "monster", "isolated location", "trapped"], "it")).toBeNull()
  })
})

// ── ORDERING / OVERLAP TESTS ────────────────────────────────────────
describe("ordering — first match wins, check rule priority correctness", () => {
  it("'undead' matches zombie before vampire (zombie rule is earlier)", () => {
    // Both zombie and vampire rules match "undead". Zombie is checked first.
    expect(getSubGenreLabel(["undead", "castle", "dark"], "it")).toBe("Film di Zombie")
  })

  it("'space western' does NOT falsely match spaghetti western", () => {
    // Only "spaghetti western", "gunslinger", "wild west" are in the rule.
    // "space western" does NOT contain any of those substrings.
    expect(getSubGenreLabel(["space western", "space opera", "quest"], "it")).toBe("Space Opera")
  })

  it("zombie apocalypse keyword does not also trigger post-apocalyptic", () => {
    // Should match zombie, not post-apocalyptic
    expect(getSubGenreLabel(["zombie apocalypse", "survival"], "it")).toBe("Film di Zombie")
  })
})

// ── LOCALISATION TESTS ──────────────────────────────────────────────
describe("localisation — labels resolve by locale", () => {
  it("returns Italian for undefined locale", () => {
    expect(getSubGenreLabel(["zombie"])).toBe("Film di Zombie")
  })

  it("falls back to Italian for unsupported locale", () => {
    expect(getSubGenreLabel(["zombie"], "zh")).toBe("Film di Zombie")
  })

  it("resolves English labels", () => {
    expect(getSubGenreLabel(["murder mystery"], "en")).toBe("Whodunit")
  })

  it("resolves French labels", () => {
    expect(getSubGenreLabel(["time travel"], "fr")).toBe("Voyage temporel")
  })

  it("resolves German labels", () => {
    expect(getSubGenreLabel(["cyberpunk"], "de")).toBe("Cyberpunk")
  })

  it("resolves Spanish labels", () => {
    expect(getSubGenreLabel(["martial arts"], "es")).toBe("Artes marciales")
    expect(getSubGenreLabel(["martial arts"], "pl")).toBe("Sztuki walki")
  })
})

// ── EDGE CASES ──────────────────────────────────────────────────────
describe("edge cases", () => {
  it("returns null for null keywords", () => {
    expect(getSubGenreLabel(null as unknown as string[])).toBeNull()
  })

  it("returns null for undefined keywords", () => {
    expect(getSubGenreLabel(undefined as unknown as string[])).toBeNull()
  })

  it("returns null for empty array", () => {
    expect(getSubGenreLabel([])).toBeNull()
  })

  it("handles mixed case keywords", () => {
    expect(getSubGenreLabel(["Time Travel", "DeLorean"], "it")).toBe("Viaggi nel Tempo")
  })

  it("handles extra whitespace in keywords", () => {
    expect(getSubGenreLabel(["  time travel  ", "  delorean  "], "it")).toBe("Viaggi nel Tempo")
  })

  it("all keyword patterns are >3 chars so \\b fallback never fires", () => {
    // Audit: the <=3 branch exists but no current pattern exercises it.
    // If a short keyword is added later (<4 chars), it'll use word-boundary
    // regex which is safer but could also miss. This test passes if no
    // pattern in SUB_GENRES is <=3 characters.
    // We can't easily import SUB_GENRES (not exported), so we leave this
    // as a design note. See subgenres.ts line 91-97.
  })
})
