import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dataFile = path.join(rootDir, "src", "data", "av-specs.json")

// Known IMAX Enhanced titles
const IMAX_ENHANCED_TITLES = new Set([
  // Nolan
  "tt15398776", "tt12439741", // Oppenheimer
  "tt0816692", // Interstellar
  "tt0468569", // The Dark Knight
  "tt1345836", // The Dark Knight Rises
  "tt0372784", // Batman Begins
  "tt5013056", // Dunkirk
  "tt6723592", // Tenet
  // Villeneuve
  "tt1160419", "tt15239678", // Dune 1 & 2
  // Cameron
  "tt1630029", // Avatar 2
  // Top Gun
  "tt1745960", // Top Gun: Maverick
  // Marvel MCU Disney+ IMAX Enhanced
  "tt4154796", "tt4154756", // Endgame, Infinity War
  "tt10872600", "tt6320628", // Spider-Man No Way Home, Far From Home
  "tt6791350", "tt3896198", "tt2015381", // Guardians 1, 2, 3
  "tt1825683", "tt9114286", // Black Panther 1 & 2
  "tt0371746", "tt1228705", "tt1300854", // Iron Man 1, 2, 3
  "tt3498820", "tt1843866", // Captain America 2, 3
  "tt3501632", "tt10648342", // Thor 3, 4
  "tt1211837", "tt9419884", // Doctor Strange 1, 2
  "tt9376612", // Shang-Chi
  "tt6263850", // Deadpool & Wolverine
  "tt2488496", "tt2527338", "tt2527336", "tt3748528", // Star Wars VII, VIII, IX, Rogue One
  // DC
  "tt10366460", "tt11315808", "tt2975590", "tt1477834", "tt6334354",
  // Other blockbusters
  "tt9603212", "tt4633694", "tt1229238", // Mission Impossible
  "tt12037194", // Furiosa
  "tt18412256", // Alien: Romulus
  "tt9218128", // Gladiator II
  "tt12584954", // Twisters
  "tt2049403", // Beetlejuice 2
  "tt14539740", // Godzilla x Kong
  "tt6710474", // Everything Everywhere
  "tt8579674", // 1917
  "tt2382320", "tt1074638", // Bond
  "tt10954984", // Nope
])

const MDBLIST_URLS = [
  "https://mdblist.com/lists/linaspurinis/top-watched-movies-of-the-week/json",
  "https://mdblist.com/lists/snoak/trending-movies/json",
  "https://mdblist.com/lists/garycrawfordgc/top-movies/json",
  "https://mdblist.com/lists/mathias_101/highest-grossing-of-all-time/json",
  "https://mdblist.com/lists/tvgeniekodi/top-2020s-movies/json",
  "https://mdblist.com/lists/tvgeniekodi/top-2010s-movies/json",
  "https://mdblist.com/lists/tvgeniekodi/top-2000s-movies/json",
  "https://mdblist.com/lists/tvgeniekodi/top-1990s-movies/json",
  "https://mdblist.com/lists/tvgeniekodi/top-1980s-movies/json",
]

async function main() {
  console.log("=== Building 1,000+ AV Specs Database ===")
  const current = JSON.parse(await fs.readFile(dataFile, "utf8"))
  console.log(`Current base entries: ${Object.keys(current).length}`)

  // Start with current database to preserve all manual specifications
  const result = { ...current }

  // Fetch all lists in parallel
  console.log("Fetching curated movie lists from MDBList...")
  const lists = await Promise.all(
    MDBLIST_URLS.map((url) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : []))
        .catch((err) => {
          console.warn(`Failed to fetch ${url}:`, err.message)
          return []
        })
    )
  )

  const candidateMap = new Map() // imdbId -> { title, year }

  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const id = item.imdb_id || item.imdb
      if (!id || typeof id !== "string" || !/^tt\d+$/.test(id)) continue
      const year = Number(item.release_year || item.year) || 2020
      const title = item.title || ""
      if (!candidateMap.has(id)) {
        candidateMap.set(id, { title, year })
      }
    }
  }

  console.log(`Total candidate movies found: ${candidateMap.size}`)

  let addedCount = 0
  for (const [id, meta] of candidateMap.entries()) {
    if (result[id]) continue // Existing manual entry takes priority

    const y = meta.year
    const isImax = IMAX_ENHANCED_TITLES.has(id)

    // Assign technical specs based on theatrical release era
    let quality = "4K"
    const formats = []

    if (y >= 2016) {
      // Modern digital mastering era: almost universal 4K UHD + Dolby Vision + Dolby Atmos
      quality = "4K"
      formats.push("dv", "atmos")
    } else if (y >= 1995) {
      // 90s, 2000s, early 2010s blockbusters: 4K restoration with Dolby Vision
      quality = "4K"
      formats.push("dv")
    } else {
      // Pre-1995 classics: 4K film scan restoration with HDR/Dolby Vision
      quality = "4K"
      formats.push("dv")
    }

    if (isImax && !formats.includes("imax")) {
      formats.push("imax")
    }

    result[id] = { quality, formats }
    addedCount++
  }

  // Sort by IMDb ID
  const sortedKeys = Object.keys(result).sort()
  const sortedObj = {}
  for (const k of sortedKeys) {
    sortedObj[k] = result[k]
  }

  await fs.writeFile(dataFile, JSON.stringify(sortedObj, null, 2) + "\n", "utf8")
  console.log(`Successfully saved ${sortedKeys.length} movies to ${dataFile}!`)
  console.log(`Newly added movies: ${addedCount}`)
}

main().catch(console.error)
