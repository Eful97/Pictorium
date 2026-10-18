// Mock server per i test E2E di Pictorium.
//
// Sostituisce le API esterne (TMDB, JustWatch, Wikidata, IMDb) con risposte
// statiche deterministiche, così i test girano senza TMDB_API_KEY e senza
// dipendere dalla rete. L'app viene avviata da playwright.config.ts con
// variabili d'ambiente che puntano i client HTTP a questo server.
//
// Come aggiungere un nuovo mock:
//   1. Aggiungi un handler nel router qui sotto (pattern `if (method === ...)`).
//   2. Se l'app legge una nuova base URL esterna, aggiungi l'override env in
//      playwright.config.ts (es. FOO_API_URL) e la route corrispondente qui.
//
// Le rotte NON mockate rispondono 501 con un errore esplicito, per far
// emergere subito chiamate esterne non previste dai test.

import http from "node:http"
import sharp from "sharp"

const PORT = Number(process.env.MOCK_PORT) || 8790
const MOCKED_POSTER_PATH = "/mocked/avatar.jpg"

// ---- Dati fittizi deterministi ----

const MOVIE = {
  id: 19995,
  title: "Avatar",
  name: "Avatar",
  original_language: "en",
  genres: [{ id: 28, name: "Azione" }],
  vote_average: 7.9,
  vote_count: 32000,
  status: "Released",
  release_date: "2009-12-10",
  first_air_date: null,
  networks: [],
  production_companies: [{ id: 777, name: "20th Century Studios", logo_path: null, origin_country: "US" }],
}

const LIST_ITEMS = [
  MOVIE,
  { id: 157336, title: "Interstellar", name: "Interstellar", original_language: "en", genres: [{ id: 12, name: "Avventura" }], vote_average: 8.4, vote_count: 38000, status: "Released", release_date: "2014-11-05", first_air_date: null, networks: [], production_companies: [] },
  { id: 603, title: "Matrix", name: "Matrix", original_language: "en", genres: [{ id: 28, name: "Azione" }], vote_average: 8.2, vote_count: 22000, status: "Released", release_date: "1999-03-30", first_air_date: null, networks: [], production_companies: [] },
  { id: 27205, title: "Inception", name: "Inception", original_language: "en", genres: [{ id: 28, name: "Azione" }], vote_average: 8.4, vote_count: 36000, status: "Released", release_date: "2010-07-15", first_air_date: null, networks: [], production_companies: [] },
  { id: 680, title: "Pulp Fiction", name: "Pulp Fiction", original_language: "en", genres: [{ id: 53, name: "Thriller" }], vote_average: 8.5, vote_count: 28000, status: "Released", release_date: "1994-10-14", first_air_date: null, networks: [], production_companies: [] },
].map((item) => ({ ...item, poster_path: MOCKED_POSTER_PATH }))

function posterItem() {
  return { aspect_ratio: 0.667, file_path: MOCKED_POSTER_PATH, height: 1500, iso_639_1: null, vote_average: 7.9, width: 1000 }
}

function detailFor(type, tmdbId) {
  // Per-title IMDb id (IMDb-first catalogs desde v-identità: ogni item del
  // catalogo deve risolvere a un tt distinto — un costante condiviso
  // colliderebbe su tutti gli id del catalogo). Zero-padded a 7 cifre:
  // sempre valido (^tt\d{7,10}$) e round-trip via /find/ numerico sotto.
  const numericId = Number(tmdbId) || 0
  const imdbId = numericId > 0 ? `tt${String(numericId).padStart(7, "0")}` : "tt1234567"
  const base = {
    credits: { cast: [{ id: 1, name: "Actor One" }], crew: [{ id: 2, name: "Director One", job: "Director" }] },
    videos: { results: [{ id: "v1", key: "abc123", site: "YouTube", type: "Trailer", name: "Trailer" }] },
    external_ids: { imdb_id: imdbId, wikidata_id: "Q12345" },
  }
  if (type === "tv") {
    return {
      ...MOVIE,
      ...base,
      name: "Avatar",
      title: undefined,
      first_air_date: "2009-12-10",
      release_date: null,
      number_of_seasons: 2,
      number_of_episodes: 4,
      seasons: [
        { id: 1, season_number: 0, name: "Specials", episode_count: 1, air_date: "2009-12-01", poster_path: null },
        { id: 2, season_number: 1, name: "Stagione 1", episode_count: 2, air_date: "2009-12-10", poster_path: null },
        { id: 3, season_number: 2, name: "Stagione 2", episode_count: 2, air_date: "2010-01-10", poster_path: null },
      ],
    }
  }
  return { ...MOVIE, ...base, title: "Avatar", name: "Avatar", release_date: "2009-12-10", first_air_date: null }
}

// ---- Poster di esempio: gradiente verticale deterministico ----
let cachedPoster = null
async function getPosterBuffer() {
  if (cachedPoster) return cachedPoster
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3a3f55"/>
      <stop offset="100%" stop-color="#141827"/>
    </linearGradient>
  </defs>
  <rect width="400" height="600" fill="url(#g)"/>
</svg>`
  cachedPoster = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer()
  return cachedPoster
}

// ---- Helpers di risposta ----

function respond(res, status, body, contentType) {
  const buf = typeof body === "string" ? Buffer.from(body, "utf8") : body
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": buf.length,
    "Access-Control-Allow-Origin": "*",
  })
  res.end(buf)
}

function json(res, status, body) {
  respond(res, status, JSON.stringify(body), "application/json")
}

/** Legge il body di una richiesta (usato dalle POST con payload JSON). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (chunk) => { data += chunk })
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

// ---- Router ----

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`)
  const { pathname } = url
  const method = req.method || "GET"

  try {
    // Readiness per playwright webServer
    if (method === "GET" && pathname === "/healthz") {
      return json(res, 200, { ok: true })
    }

    // Immagini poster (image.tmdb.org/t/p/... → mock)
    if (method === "GET" && pathname.startsWith("/t/p/")) {
      return respond(res, 200, await getPosterBuffer(), "image/jpeg")
    }

    // TMDB API — search person
    if (pathname === "/3/search/person") {
      const q = (url.searchParams.get("query") || "").toLowerCase()
      // Only exact "brad pitt" (normalized) returns a match — mirrors person-search thresholds
      if (q.includes("brad pitt")) {
        return json(res, 200, {
          page: 1,
          total_pages: 1,
          total_results: 1,
          results: [
            {
              id: 287,
              name: "Brad Pitt",
              popularity: 35,
              profile_path: "/mocked/brad.jpg",
              known_for: [
                { id: 603, media_type: "movie", vote_count: 9000 },
                { id: 27205, media_type: "movie", vote_count: 8000 },
              ],
            },
          ],
        })
      }
      return json(res, 200, { page: 1, total_pages: 1, total_results: 0, results: [] })
    }
    const personCreditsMatch = pathname.match(/^\/3\/person\/(\d+)\/(movie_credits|tv_credits)$/)
    if (personCreditsMatch) {
      const kind = personCreditsMatch[2]
      const isMovie = kind === "movie_credits"
      const makeCredit = (id, title, date) => ({
        id,
        title: isMovie ? title : undefined,
        name: isMovie ? undefined : title,
        media_type: isMovie ? "movie" : "tv",
        poster_path: MOCKED_POSTER_PATH,
        release_date: isMovie ? date : undefined,
        first_air_date: isMovie ? undefined : date,
        popularity: 50,
      })
      const cast = isMovie
        ? [makeCredit(603, "Fight Club", "1999-10-15"), makeCredit(27205, "Inception", "2010-07-15")]
        : [makeCredit(1396, "Breaking Bad", "2008-01-20")]
      const crew = isMovie
        ? [makeCredit(680, "Pulp Fiction", "1994-10-14")]
        : []
      return json(res, 200, { id: Number(personCreditsMatch[1]), cast, crew })
    }
    // TMDB API
    if (pathname === "/3/discover/tv") {
      const shows = [
        { id: 37854, name: "One Piece", genre_ids: [16], original_language: "ja", poster_path: MOCKED_POSTER_PATH },
        { id: 999, name: "Japanese Drama", genre_ids: [18], original_language: "ja", poster_path: MOCKED_POSTER_PATH },
      ]
      const results = shows.filter(item => !url.searchParams.get("with_genres") || item.genre_ids.includes(Number(url.searchParams.get("with_genres"))))
      return json(res, 200, { page: 1, total_pages: 1, total_results: results.length, results })
    }
    if (pathname === "/3/search/multi" || pathname === "/3/search/movie" || pathname === "/3/search/tv") {
      const isTV = pathname === "/3/search/tv"
      return json(res, 200, {
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [{ ...MOVIE, media_type: isTV ? "tv" : "movie", poster_path: MOCKED_POSTER_PATH, backdrop_path: MOCKED_POSTER_PATH, overview: "Trama fittizia deterministica", genre_ids: [28], popularity: 100 }],
      })
    }
    if (pathname === "/3/genre/movie/list" || pathname === "/3/genre/tv/list") {
      return json(res, 200, { genres: [{ id: 28, name: "Azione" }, { id: 12, name: "Avventura" }] })
    }
    if (pathname === "/3/find/tt1234567" || pathname.startsWith("/3/find/")) {
      // Legacy tt1234567 → fixture Avatar; i tt per-id (detailFor sopra)
      // risolvono numericamente (tt0019995 → 19995) per il round-trip
      // catalogo → /meta.
      const m = pathname.match(/^\/3\/find\/(tt\d+)$/)
      const tt = m ? m[1] : ""
      const id = tt === "tt1234567" ? 19995 : (tt ? Number(tt.slice(2)) || 19995 : 19995)
      return json(res, 200, { movie_results: [{ id }], tv_results: [{ id }] })
    }
    if (
      pathname === "/3/movie/popular" ||
      pathname === "/3/tv/popular" ||
      pathname.startsWith("/3/trending/")
    ) {
      return json(res, 200, { page: 1, total_pages: 1, total_results: LIST_ITEMS.length, results: LIST_ITEMS })
    }
    const detailsMatch = pathname.match(/^\/3\/(movie|tv)\/(\d+)$/)
    if (detailsMatch) {
      return json(res, 200, detailFor(detailsMatch[1], detailsMatch[2]))
    }
    const imagesMatch = pathname.match(/^\/3\/(movie|tv)\/(\d+)\/images$/)
    if (imagesMatch) {
      return json(res, 200, { id: Number(imagesMatch[2]), backdrops: [], posters: [posterItem()], logos: [] })
    }
    const extIdsMatch = pathname.match(/^\/3\/(movie|tv)\/(\d+)\/external_ids$/)
    if (extIdsMatch) {
      // imdb_id volutamente NON in IMDb Top 250, per poster deterministici.
      // Per-id come in detailFor: i cataloghi IMDb-first emettono un tt per
      // item e un costante condiviso produrrebbe id duplicati.
      const numericId = Number(extIdsMatch[2]) || 0
      return json(res, 200, {
        id: numericId,
        imdb_id: numericId > 0 ? `tt${String(numericId).padStart(7, "0")}` : "tt1234567",
        wikidata_id: "Q12345",
      })
    }
    const kwMatch = pathname.match(/^\/3\/(movie|tv)\/(\d+)\/keywords$/)
    if (kwMatch) {
      return json(res, 200, { id: Number(kwMatch[2]), keywords: [] })
    }
    // TMDB age certifications (deterministiche, verifica pre-integrazione):
    // movie release_dates → IT VM14 theatrical + US PG-13; tv content_ratings
    // → US TV-MA + IT VM14. Nessun fallback cross-country lato mock: entrambe
    // le entry presenti così gli spec asseriscono il match stesso-paese.
    const relMatch = pathname.match(/^\/3\/movie\/(\d+)\/release_dates$/)
    if (relMatch) {
      return json(res, 200, {
        id: Number(relMatch[1]),
        results: [
          {
            iso_3166_1: "IT",
            release_dates: [
              { certification: "VM14", release_date: "2024-01-10T00:00:00.000Z", type: 3 },
            ],
          },
          {
            iso_3166_1: "US",
            release_dates: [
              { certification: "PG-13", release_date: "2024-01-10T00:00:00.000Z", type: 3 },
            ],
          },
        ],
      })
    }
    const crMatch = pathname.match(/^\/3\/tv\/(\d+)\/content_ratings$/)
    if (crMatch) {
      return json(res, 200, {
        id: Number(crMatch[1]),
        results: [
          { iso_3166_1: "US", rating: "TV-MA", descriptors: [] },
          { iso_3166_1: "IT", rating: "VM14", descriptors: [] },
        ],
      })
    }
    // Trakt anticipated movies (shape ufficiale v2: [{ list_count, movie }]):
    // 2 voci deterministiche, page>1 vuota (fine paginazione).
    if (method === "GET" && pathname === "/trakt/movies/anticipated") {
      const page = Number(url.searchParams.get("page") || "1")
      if (!Number.isInteger(page) || page < 1) return json(res, 400, { error: "bad page" })
      if (page > 1) return json(res, 200, [])
      return json(res, 200, [
        { list_count: 42, movie: { title: "Avatar", year: 2009, ids: { trakt: 1, slug: "avatar-2009", imdb: "tt0499549", tmdb: 19995 } } },
        { list_count: 37, movie: { title: "Interstellar", year: 2014, ids: { trakt: 2, slug: "interstellar-2014", imdb: "tt0816692", tmdb: 157336 } } },
      ])
    }
    // TV seasons
    const seasonMatch = pathname.match(/^\/3\/tv\/(\d+)\/season\/(\d+)$/)
    if (seasonMatch) {
      const seasonNum = Number(seasonMatch[2])
      const episodesBySeason = {
        0: [{ id: 900, season_number: 0, episode_number: 1, name: "Speciale Pilota", overview: "Episodio speciale", still_path: MOCKED_POSTER_PATH, air_date: "2009-12-01", vote_average: 7.5 }],
        1: [
          { id: 901, season_number: 1, episode_number: 1, name: "Episodio 1 — L'inizio", overview: "Inizio della storia", still_path: MOCKED_POSTER_PATH, air_date: "2009-12-10", vote_average: 8.1 },
          { id: 902, season_number: 1, episode_number: 2, name: "Episodio 2 — Il ritorno", overview: "Continuazione", still_path: MOCKED_POSTER_PATH, air_date: "2009-12-17", vote_average: 8.3 },
        ],
        2: [
          { id: 903, season_number: 2, episode_number: 1, name: "Episodio 1 — Nuova stagione", overview: "Nuovi personaggi", still_path: MOCKED_POSTER_PATH, air_date: "2010-01-10", vote_average: 8.0 },
          { id: 904, season_number: 2, episode_number: 2, name: "Episodio 2 — Finale", overview: "Chiusura", still_path: MOCKED_POSTER_PATH, air_date: "2010-01-17", vote_average: 8.5 },
        ],
      }
      const eps = episodesBySeason[seasonNum] || []
      return json(res, 200, { id: Number(seasonMatch[1]) * 100 + seasonNum, season_number: seasonNum, name: seasonNum === 0 ? "Specials" : `Stagione ${seasonNum}`, episodes: eps })
    }
    // TMDB Episode Groups
    const epGroupsMatch = pathname.match(/^\/3\/tv\/(\d+)\/episode_groups$/)
    if (epGroupsMatch) {
      return json(res, 200, {
        results: [
          { id: "mock_group_italian", name: "Italian Order", type: 6, group_count: 2, episode_count: 4, order: 0 },
          { id: "mock_group_netflix", name: "Netflix Order", type: 1, group_count: 2, episode_count: 4, order: 1 },
        ],
      })
    }
    const epGroupMatch = pathname.match(/^\/3\/tv\/episode_group\/([^/]+)$/)
    if (epGroupMatch) {
      const groupId = decodeURIComponent(epGroupMatch[1])
      const name = groupId.includes("netflix") ? "Netflix Order" : "Italian Order"
      return json(res, 200, {
        id: groupId,
        name,
        description: `Mock ${name}`,
        group_count: 2,
        groups: [
          {
            id: `${groupId}_g1`,
            name: "Parte 1",
            order: groupId.includes("netflix") ? 1 : 0,
            episodes: [
              { id: 901, episode_number: 1, name: "Episodio 1 — L'inizio", overview: "Inizio", still_path: MOCKED_POSTER_PATH, air_date: "2009-12-10", vote_average: 8.1, order: 0 },
              { id: 902, episode_number: 2, name: "Episodio 2 — Il ritorno", overview: "Continuazione", still_path: MOCKED_POSTER_PATH, air_date: "2009-12-17", vote_average: 8.3, order: 1 },
            ],
          },
          {
            id: `${groupId}_g2`,
            name: "Parte 2",
            order: groupId.includes("netflix") ? 2 : 1,
            episodes: [
              { id: 903, episode_number: 1, name: "Episodio 1 — Nuova stagione", overview: "Nuovi", still_path: MOCKED_POSTER_PATH, air_date: "2010-01-10", vote_average: 8.0, order: 0 },
              { id: 904, episode_number: 2, name: "Episodio 2 — Finale", overview: "Chiusura", still_path: MOCKED_POSTER_PATH, air_date: "2010-01-17", vote_average: 8.5, order: 1 },
            ],
          },
        ],
      })
    }

    // Torrentio / Stream scraper: streams per movie e series
    const streamMatch = pathname.match(/^\/stream\/(movie|series)\/([^/]+)\.json$/)
    if (streamMatch) {
      return json(res, 200, {
        streams: [
          {
            name: "Torrentio\n4k",
            title: "Mock.Movie.2160p.UHD.BluRay.x265",
            behaviorHints: { filename: "Mock.Movie.2160p.UHD.mkv", bingeGroup: "torrentio|4k|BluRay" },
          },
          {
            name: "Torrentio\n1080p",
            title: "Mock.Movie.1080p.BluRay.x264",
            behaviorHints: { filename: "Mock.Movie.1080p.BluRay.mkv", bingeGroup: "torrentio|1080p|BluRay" },
          },
        ],
      })
    }

    // JustWatch GraphQL: classifiche giornaliere deterministiche + offerte qualità.
    if (pathname === "/graphql" && method === "POST") {
      let opName = ""
      let objectType = "SHOW"
      let parsedBody = null
      try {
        parsedBody = JSON.parse(await readBody(req))
        opName = parsedBody?.operationName || ""
        objectType = parsedBody?.variables?.filter?.objectType || parsedBody?.variables?.filter?.objectTypes?.[0] || "SHOW"
      } catch {}

      if (opName === "GetTitleOffers") {
        return json(res, 200, {
          data: {
            popularTitles: {
              edges: [
                {
                  node: {
                    content: { title: "Avatar", externalIds: { tmdbId: 19995 } },
                    offers: [{ presentationType: "4K" }, { presentationType: "HD" }],
                  },
                },
                {
                  node: {
                    content: { title: "Interstellar", externalIds: { tmdbId: 157336 } },
                    offers: [{ presentationType: "4K" }],
                  },
                },
              ],
            },
          },
        })
      }

      if (opName === "GetPopularTitles") {
        const sortBy = parsedBody?.variables?.sortBy || "POPULAR"
        const items = sortBy === "TRENDING" ? [...LIST_ITEMS].reverse() : LIST_ITEMS
        return json(res, 200, {
          data: {
            popularTitles: {
              edges: items.map((item) => ({
                node: {
                  content: {
                    title: item.title,
                    originalReleaseDate: item.release_date || "2020-01-01",
                    // Per-id valido (^tt\d{7,10}$): "tt" + id nudo non
                    // passerebbe la validazione fail-closed dei cataloghi.
                    externalIds: { tmdbId: item.id, imdbId: "tt" + String(item.id).padStart(7, "0") },
                  },
                },
              })),
            },
          },
        })
      }

      const movieEdges = [
        { streamingChartInfo: { rank: 1 }, node: { content: { externalIds: { tmdbId: 19995 } } } },
        { streamingChartInfo: { rank: 2 }, node: { content: { externalIds: { tmdbId: 157336 } } } },
      ]
      const showEdges = [
        { streamingChartInfo: { rank: 1 }, node: { content: { externalIds: { tmdbId: 19995 } } } },
      ]
      return json(res, 200, {
        data: { streamingCharts: { edges: objectType === "MOVIE" ? movieEdges : showEdges } },
      })
    }

    // Wikidata SPARQL: bindings vuoti → nessun award
    if (pathname === "/sparql") {
      return json(res, 200, { head: { vars: [] }, results: { bindings: [] } })
    }

    // Wikidata Action API (fast-path REST): payload deterministico per Q12345.
    // claims → QID finti; labels → label inglesi che matchano le RULES
    // (Academy Award → Oscar) così il fast-path produce badge in E2E.
    if (pathname === "/w/api.php") {
      const ids = (url.searchParams.get("ids") || "").split("|").filter(Boolean)
      const props = url.searchParams.get("props") || ""
      if (props.includes("claims")) {
        const qid = ids[0] || "Q12345"
        return json(res, 200, {
          entities: {
            [qid]: {
              claims: {
                P166: [{ mainsnak: { datavalue: { value: { id: "Q109487" } } } }],
                P1411: [{ mainsnak: { datavalue: { value: { id: "Q109488" } } } }],
                P57: [{ mainsnak: { datavalue: { value: { id: "Q25191" } } } }],
              },
            },
          },
        })
      }
      const entities = {}
      for (const id of ids) {
        // Label distinte per ramo: wins → Oscar, nominations → BAFTA,
        // regista → allowlist DIRECTORS. Così i test distinguono i rami.
        const label = id === "Q25191" ? "Christopher Nolan" : id === "Q109488" ? "British Academy Film Award" : "Academy Award"
        entities[id] = { labels: { en: { value: label } } }
      }
      return json(res, 200, { entities })
    }

    // IMDb chart minimale: nessun tt-id → fallback al dataset statico
    if (pathname === "/chart/top/") {
      return respond(res, 200, "<!doctype html><html><body></body></html>", "text/html")
    }

    // MDBList (ranking anime): Avatar in posizione #1 → animeRankResult = 1
    if (method === "GET" && pathname.startsWith("/mdblist/api/lists/snoak/")) {
      return json(res, 200, {
        items: [
          { imdb: "tt0499549", title: "Avatar: The Last Airbender", year: 2024, tmdb: 19995 },
          { imdb: "tt1740057", title: "Anime Fake #2", year: 2020, tmdb: 88888 },
        ],
      })
    }

    // MDBList aggregated ratings — NEW media API (lib/ratings.ts →
    // `${MDBLIST_API_URL}/imdb/{movie|show|any}/{imdbId}/?apikey=`): voti
    // deterministici per la colonna rating separati (sep=1). I votes stanno
    // sopra il default min-votes (10) così l'harness resta verde.
    if (method === "GET" && pathname.startsWith("/mdblist/api/imdb/")) {
      const segs = pathname.split("/").filter(Boolean)
      const imdbId = segs[4] || ""
      // tt0000001: MDBList senza imdb (per il test fallback Cinemeta).
      if (imdbId === "tt0000001") {
        return json(res, 200, {
          type: "movie",
          title: "Mock",
          year: 2020,
          score: 79,
          ratings: [{ source: "tmdb", value: 7.9, score: 79, votes: 1200 }],
        })
      }
      return json(res, 200, {
        type: "movie",
        title: "Mock",
        year: 2020,
        score: 80,
        ratings: [
          { source: "imdb", value: 8.7, score: 87, votes: 5000 },
          { source: "tmdb", value: 7.9, score: 79, votes: 3000 },
          { source: "tomatoes", value: 88, score: 88, votes: 900 },
          { source: "popcorntime", value: 9.2, score: 92, votes: 1500 },
          { source: "metacritic", value: 75, score: 75, votes: 800 },
        ],
      })
    }

    // MDBList aggregated ratings — NEW typed TMDB API (task C →
    // `${MDBLIST_API_URL}/tmdb/{movie|show}/{id}/?apikey=`): copre i titoli
    // senza IMDb senza richiederlo. Corpi identici ai gemelli /imdb (verifica
    // anonima 2026-10-15: tt0111161 ≡ tmdb movie 278, tt0944947 ≡ tmdb show
    // 1399). Solo gli id noti rispondono 200; tipo sbagliato o id ignoto →
    // 404 come il reale (mai retry automatico sull'altro tipo).
    if (method === "GET" && pathname.startsWith("/mdblist/api/tmdb/")) {
      const segs = pathname.split("/").filter(Boolean)
      const seg = segs[3] || ""
      const id = segs[4] || ""
      if (seg === "movie" && id === "278") {
        return json(res, 200, {
          type: "movie",
          title: "Mock",
          year: 2020,
          score: 80,
          ratings: [
            { source: "imdb", value: 8.7, score: 87, votes: 5000 },
            { source: "tmdb", value: 7.9, score: 79, votes: 3000 },
            { source: "tomatoes", value: 88, score: 88, votes: 900 },
            { source: "popcorntime", value: 9.2, score: 92, votes: 1500 },
            { source: "metacritic", value: 75, score: 75, votes: 800 },
          ],
        })
      }
      if (seg === "show" && id === "1399") {
        return json(res, 200, {
          type: "show",
          title: "Mock Show",
          year: 2008,
          score: 87,
          ratings: [
            { source: "imdb", value: 9.5, score: 95, votes: 2100000 },
            { source: "popcorn", value: 85, score: 85, votes: null },
            { source: "tmdb", value: 8.9, score: 89, votes: 15000 },
          ],
        })
      }
      return json(res, 404, { error: "Item not found" })
    }

    // Legacy MDBList aggregated ratings (`${MDBLIST_API_URL}/?i=tt...`):
    // non più chiamato dall'app (task B), tenuto per compatibilità harness.
    // Nota: l'app chiama `${MDBLIST_API_URL}/?i=...` (slash prima del ?),
    // quindi il pathname arriva con trailing slash.
    if (method === "GET" && (pathname === "/mdblist/api" || pathname === "/mdblist/api/")) {
      // tt0000001: MDBList senza imdb (per il test fallback Cinemeta).
      if (url.searchParams.get("i") === "tt0000001") {
        return json(res, 200, { ratings: [{ source: "tmdb", score: 79 }] })
      }
      return json(res, 200, {
        ratings: [
          { source: "imdb", score: 87 },
          { source: "tmdb", score: 79 },
          { source: "tomatoes", score: 88 },
          { source: "popcorntime", score: 92 },
          { source: "metacritic", score: 75 },
        ],
      })
    }

    // Simkl redirect (stop-at-301): risolve IMDb/TMDB ID nel canonical path Simkl
    if (method === "GET" && pathname.startsWith("/simkl/redirect")) {
      res.writeHead(301, {
        Location: "https://simkl.com/movies/472214/inception",
        "Content-Length": "0",
      })
      return res.end()
    }

    // Simkl details endpoint: restituisce i ratings con rating.simkl.rating
    if (method === "GET" && pathname.match(/^\/simkl\/(movies|tv|anime)\/\d+/)) {
      return json(res, 200, {
        ratings: {
          simkl: { rating: 8.6, votes: 14000 },
          imdb: { rating: 8.8, votes: 2000000 },
        },
      })
    }

    // AniZip mappings (lib/anime-ratings.ts → ${ANIZIP_API_URL}/mappings?...):
    // solo tt0388629/tmdb 37854 (One Piece) è un anime; resto → 404.
    if (method === "GET" && pathname === "/anizip/mappings") {
      const tmdb = url.searchParams.get("themoviedb_id")
      const imdb = url.searchParams.get("imdb_id")
      if (tmdb === "37854" || imdb === "tt0388629") {
        return json(res, 200, {
          mappings: { anilist_id: 21, kitsu_id: 12, type: "TV" },
          episodes: { 1: { seasonNumber: 1, episodeNumber: 1 } },
        })
      }
      return json(res, 404, { error: "not found" })
    }

    // AniList GraphQL (POST ${ANILIST_API_URL}): voto medio 0-100.
    if (method === "POST" && pathname === "/anilist") {
      return json(res, 200, { data: { Media: { id: 21, averageScore: 87 } } })
    }

    // Kitsu REST (${KITSU_API_URL}/anime/:id): averageRating stringa 0-100.
    if (method === "GET" && pathname.match(/^\/kitsu\/anime\/\d+/)) {
      return json(res, 200, { data: { id: "12", type: "anime", attributes: { averageRating: "84.01" } } })
    }

    // Cinemeta meta (${CINEMETA_API_URL}/meta/:type/:id.json): imdbRating gratis.
    // tt0133093, tt0388629 e tt0000001 risolvono; il resto ha meta vuoto (come il reale).
    if (method === "GET" && pathname.match(/^\/cinemeta\/meta\/(movie|series)\/tt\d+\.json$/)) {
      const hit = pathname.includes("tt0133093") || pathname.includes("tt0388629") || pathname.includes("tt0000001")
      return json(res, 200, hit ? { meta: { id: "tt0133093", type: "movie", name: "Mock", imdbRating: "8.4" } } : { meta: {} })
    }

    // Fallback esplicito per chiamate non mockate
    return json(res, 501, { error: `Mock server: endpoint non mockato (${method} ${pathname})` })
  } catch (err) {
    console.error("[mock-server] Errore:", err)
    if (!res.headersSent) {
      return json(res, 500, { error: `Mock server: errore interno (${String(err)})` })
    }
    res.end()
  }
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-server] in ascolto su http://127.0.0.1:${PORT}`)
})
