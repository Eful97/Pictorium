#!/usr/bin/env node
// Pregenera le immagini statiche del poster wall della home
// (public/poster-wall/*.webp + src/data/poster-wall.json).
//
// Il wall usava render live di /api/poster: a cache fredda decine di render in
// parallelo rallentavano ~4× i poster Stremio concorrenti. Ora sono file
// statici: rigenerali quando cambia la resa (RENDER_VERSION) o la lista.
//
// Uso: avvia un server Pictorium con una chiave TMDB lato server, poi
//   node scripts/generate-poster-wall.mjs [baseUrl]   (default http://localhost:3000)
import { mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import sharp from "sharp"

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "")
const ROOT = join(import.meta.dirname, "..")
const OUT_DIR = join(ROOT, "public", "poster-wall")
const MANIFEST = join(ROOT, "src", "data", "poster-wall.json")
/** 2× la colonna del wall (170px desktop). */
const WIDTH = 340

// Titoli più popolari 2015–2025. Resa in inglese (`lang=en`: logo, genere,
// etichette) così l'immagine statica non dipende dalla lingua del profilo del
// server e vale per tutte le lingue del sito.
const TITLES = [
  ["movie", 693134, "Dune: Part Two"],
  ["tv", 66732, "Stranger Things"],
  ["movie", 872585, "Oppenheimer"],
  ["tv", 100088, "The Last of Us"],
  ["movie", 299534, "Avengers: Endgame"],
  ["tv", 94997, "House of the Dragon"],
  ["movie", 634649, "Spider-Man: No Way Home"],
  ["tv", 76479, "The Boys"],
  ["movie", 361743, "Top Gun: Maverick"],
  ["tv", 93405, "Squid Game"],
  ["movie", 475557, "Joker"],
  ["tv", 119051, "Wednesday"],
  ["tv", 106379, "Fallout"],
  ["movie", 438631, "Dune"],
  ["movie", 346698, "Barbie"],
  ["tv", 126308, "Shōgun"],
  ["movie", 496243, "Parasite"],
  ["tv", 94605, "Arcane"],
  ["movie", 414906, "The Batman"],
  ["tv", 76331, "Succession"],
  ["movie", 324857, "Spider-Man: Into the Spider-Verse"],
  ["tv", 136315, "The Bear"],
  ["movie", 76341, "Mad Max: Fury Road"],
  ["tv", 82856, "The Mandalorian"],
  ["movie", 533535, "Deadpool & Wolverine"],
  ["tv", 70523, "Dark"],
  ["movie", 545611, "Everything Everywhere All at Once"],
  ["tv", 71912, "The Witcher"],
  ["movie", 76600, "Avatar: The Way of Water"],
  ["movie", 284054, "Black Panther"],
]

// Varietà di stili mostrata nel wall (ciclica sui titoli).
const STYLES = [
  "bs=vetro&gradHeight=25&blur=30&bf=50&bd=40&tl=0",
  "bs=bordo&gradHeight=20&blur=20&bf=55&bd=35&tl=1",
  "bs=bar&tl=0&ac=%23f39c12&gradHeight=30&blur=35&bf=50&bd=45",
  "ranking=&rs=netflix&tl=0&gradHeight=25&blur=30&bf=50&bd=40",
  "bs=shadow&gradHeight=40&blur=50&bf=70&bd=50&tl=0",
  "bs=colored&tl=1&gradHeight=25&blur=25&bf=45&bd=30",
  "bs=pill&tl=0&ac=%23e74c3c&gradHeight=15&blur=15&bf=40&bd=25",
  "ranking=&rs=bordo&tl=1&gradHeight=20&blur=25&bf=50&bd=30",
]

const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

async function render([type, id, title], i) {
  const landscape = i % 3 === 1
  let params = `${STYLES[i % STYLES.length]}&lang=en&logoFit=0&fmt=webp`
  if (params.startsWith("ranking=")) params += `&rank=${(i % 10) + 1}`
  if (landscape) params += "&shape=landscape"
  const url = `${BASE}/api/poster/${type}/${id}?${params}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${title}: HTTP ${res.status} (${url})`)
  const file = `${slug(title)}.webp`
  const buf = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: WIDTH }).webp({ quality: 78 }).toBuffer()
  await writeFile(join(OUT_DIR, file), buf)
  console.log(`${String(i + 1).padStart(2)} ${title.padEnd(36)} ${landscape ? "16:9" : "2:3 "} ${(buf.length / 1024).toFixed(0)} KB`)
  return { src: `/poster-wall/${file}`, landscape }
}

await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })
// Pochi alla volta: è un render completo per titolo.
const entries = new Array(TITLES.length)
let next = 0
await Promise.all(Array.from({ length: 3 }, async () => {
  while (next < TITLES.length) {
    const i = next++
    entries[i] = await render(TITLES[i], i)
  }
}))
await writeFile(MANIFEST, JSON.stringify(entries, null, 2) + "\n")
console.log(`\n${entries.length} poster → public/poster-wall/, manifest → src/data/poster-wall.json`)
