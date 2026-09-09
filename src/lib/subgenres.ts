/**
 * Sub-genre badge detection from TMDB keywords and tags.
 * Labels use clean typography (no emoji glyphs) to ensure 100% vector-crisp Resvg rendering.
 */

export interface SubGenreRule {
  key: string
  keywords: string[]
  labels: Record<string, string>
}

const SUB_GENRES: SubGenreRule[] = [
  {
    key: "timetravel",
    keywords: ["time travel", "time loop", "time machine", "wormhole", "time manipulation"],
    labels: { it: "Viaggi nel Tempo", en: "Time Travel", fr: "Voyage temporel", de: "Zeitreise", es: "Viajes en el tiempo", he: "מסע בזמן" },
  },
  {
    key: "cyberpunk",
    // NOTE: "dystopia/dystopian/virtual reality/artificial intelligence
    // they caused false positives on non-cyberpunk movies (e.g. The Handmaid's Tale,
    // Her, Ready Player One). Cyberpunk is distinctive enough from its core terms.
    keywords: ["cyberpunk", "android", "cybernetics"],
    labels: { it: "Cyberpunk", en: "Cyberpunk", fr: "Cyberpunk", de: "Cyberpunk", es: "Cyberpunk", he: "סייברפאנק" },
  },

  {
    key: "whodunit",
    // NOTE: "detective" and "investigation" removed — they are too broad and
    // triggered false positives on generic police procedurals.
    keywords: ["whodunit", "murder mystery", "private investigator", "sleuth"],
    labels: { it: "Giallo", en: "Whodunit", fr: "Whodunit", de: "Whodunit", es: "Whodunit", he: "מי הרוצח" },
  },
  {
    key: "heist",
    keywords: ["heist", "bank robbery", "caper", "robbery", "master thief"],
    labels: { it: "Film di Rapina", en: "Heist", fr: "Film de braquage", de: "Heist", es: "Robos", he: "סרט שוד" },
  },
  {
    key: "zombie",
    // NOTE: "infected" removed — medical/virus outbreak keywords would falsely
    // trigger the zombie badge on non-zombie contagion thrillers.
    keywords: ["zombie", "zombies", "undead", "apocalypse zombie"],
    labels: { it: "Film di Zombie", en: "Zombie", fr: "Film de zombies", de: "Zombie", es: "Zombis", he: "זומבים" },
  },
  {
    key: "vampire",
    keywords: ["vampire", "vampires", "dracula", "blood drinker"],
    labels: { it: "Vampiri", en: "Vampires", fr: "Vampires", de: "Vampire", es: "Vampiros", he: "ערפדים" },
  },
  {
    key: "paranormal",
    keywords: ["haunted house", "ghost", "demonic possession", "exorcism", "poltergeist", "supernatural horror", "paranormal"],
    labels: { it: "Paranormale", en: "Paranormal", fr: "Paranormal", de: "Paranormal", es: "Paranormal", he: "על-טבעי" },
  },
  {
    key: "kaiju",
    keywords: ["kaiju", "giant monster", "godzilla", "king kong"],
    labels: { it: "Kaiju & Mostri", en: "Kaiju & Monsters", fr: "Kaiju", de: "Kaiju", es: "Kaiju", he: "קאיג'ו ומפלצות" },
  },
  {
    key: "postapocalyptic",
    // NOTE: "survival horror" removed — it is a video-game genre tag that appears
    // on non-post-apocalyptic survival horror games/movies (e.g. The Descent).
    keywords: ["post-apocalyptic", "wasteland", "nuclear winter"],
    labels: { it: "Post-Apocalittico", en: "Post-Apocalyptic", fr: "Post-apocalyptique", de: "Postapokalyptisch", es: "Postapocalíptico", he: "פוסט-אפוקליפטי" },
  },
  {
    key: "foundfootage",
    keywords: ["found footage", "mockumentary", "handheld camera"],
    // NOTE: "mockumentary" can appear on comedy mockumentaries (This Is Spinal Tap),
    // but these rarely overlap with TMDB horror keywords. Acceptable low risk.
    labels: { it: "Found Footage", en: "Found Footage", fr: "Found Footage", de: "Found Footage", es: "Metraje encontrado", he: "Found Footage" },
  },
  {
    key: "noir",
    keywords: ["neo-noir", "film noir", "hardboiled", "femme fatale"],
    labels: { it: "Film Noir", en: "Film Noir", fr: "Film Noir", de: "Film Noir", es: "Cine Negro", he: "Film Noir" },
  },
  {
    key: "spaghettiwestern",
    keywords: ["spaghetti western", "gunslinger", "wild west"],
    labels: { it: "Spaghetti Western", en: "Western", fr: "Western", de: "Western", es: "Western", he: "מערבון" },
  },
  {
    key: "martialarts",
    keywords: ["martial arts", "kung fu", "karate", "samurai", "ninja"],
    labels: { it: "Arti Marziali", en: "Martial Arts", fr: "Arts martiaux", de: "Kampfsport", es: "Artes marciales", he: "אומנויות לחימה" },
  },
  {
    key: "spaceopera",
    // NOTE: "space travel", "alien invasion", and "spacecraft" removed — they
    // flagged hard sci-fi (The Martian, Interstellar) and alien-invasion action
    // as space opera. Core terms are sufficient for Star Wars / Mandalorian / Trek.
    keywords: ["space opera", "space western", "intergalactic"],
    labels: { it: "Space Opera", en: "Space Opera", fr: "Space Opera", de: "Space Opera", es: "Space Opera", he: "אופרת חלל" },
  },
]

function matchKeywordPattern(keyword: string, kwPattern: string): boolean {
  // Word-boundary matching for all patterns prevents substring false
  // positives (e.g. "ghost" matching "ghostbusters").
  const escaped = kwPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`\\b${escaped}\\b`, "i")
  return regex.test(keyword)
}

export function getSubGenreLabel(keywords: string[], locale = "it"): string | null {
  if (!keywords || !keywords.length) return null
  const normalized = keywords.map((k) => k.toLowerCase().trim())
  for (const sub of SUB_GENRES) {
    if (sub.keywords.some((kwPattern) => normalized.some((nk) => matchKeywordPattern(nk, kwPattern)))) {
      const lang = (locale || "it").slice(0, 2)
      // it/en/fr/de/es/he hanno tutti i 14 label; ja/ko/pt ripiegano
      // ancora sull'italiano (bug preesistente, fuori dallo scope qui).
      return sub.labels[lang] || sub.labels.it
    }
  }
  return null
}
