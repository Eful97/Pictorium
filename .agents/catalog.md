# Posterium - Cataloghi Stremio (architettura & id metadati)

> Le regole qui descritte sono il contratto per chi modifica i cataloghi. Quando
> questo file e il codice discordano, vince il codice (CODE WINS) — aggiorna il file.

## Vista d'insieme

Posterium espone cataloghi Stremio **solo per generare i poster**. La risoluzione dei
**metadati** (nome, trama, locandina originale) avviene tramite il proprio endpoint
`/meta/{type}/{id}` (`src/lib/meta-handler.ts`, dichiarato come risorsa `meta` nel
manifest): alla click su un elemento, Stremio chiede i metadati direttamente a
Posterium, che è 100% standalone e non dipende da addon esterni come AIOMetadata.
Per questo l'`id` esposto nel catalogo DEVE essere un id che il resolver di Posterium
sa risolvere.

### REGOLA D'ORO — id metadati risolvibili

Il resolver `/meta` di Posterium risolve gli id **solo** da `tt...` (IMDb) o
`provider:id` (es. `tmdb:12345`). Un **numero nudo** viene trattato solo come
fallback TMDB ed è un id non portabile → evitare sempre.

Risoluzione dell'id (helper `catalogMetaId` in `catalog-handler.ts`):
oggi sempre `tmdb:<id>` (il resolver `/meta` di Posterium risolve `tmdb:` nativamente;
storicamente `imdbId` → `resolveImdbId` → `tmdb:` — ora il parametro `_imdbId` è
ignorato per mantenere Posterium 100% standalone senza dipendenza da Cinemeta/AIOMetadata).
Mai emettere un id numerico nudo come `id` del meta.

## Cataloghi supportati (`POSTERIUM_CATALOGS` in `catalog-definitions.ts`)

| Prefix catalogo | Fonte | Tipo | Richiede |
|---|---|---|---|
| `posterium-jw-movies` / `posterium-jw-series` | JustWatch StreamingCharts (GraphQL) | movie/series | Chiave TMDB |
| `posterium-netflix/prime/disney/now/apple/hbo/paramount-*` | JustWatch StreamingCharts (pacchetti) + fallback FlixPatrol | movie/series | Chiave TMDB |
| `posterium-anime-movies` / `posterium-anime` | MDBList `mdblistAnimeMovie` / `mdblistAnime` | movie/series | Opzionale (fallback pubblico) |
| `posterium-search-movies` / `posterium-search-series` | TMDB search diretto (`searchMovies`/`searchTV`) | movie/series | Chiave TMDB |

Warmup automatico: `posterium-jw-movies`, `posterium-jw-series`, `posterium-netflix-movies/series`, `posterium-prime-movies/series`, `posterium-anime-movies`, `posterium-anime`
(`WARMUP_CATALOG_IDS` — 8 cataloghi). I restanti 10 platform restano cold ma beneficiano della cache JustWatch 30 min condivisa.

## Flusso per catalogo

### JustWatch (`posterium-jw-*`)
1. `getJWRankings("MOVIE"|"SHOW", region.code, ...)` in `lib/justwatch.ts` — query GraphQL
   a `apis.justwatch.com` (o `JUSTWATCH_API_URL` nei test). Regione da `lib/regions.ts`
   (12 paesi: `?region=` > config-token > default server `POSTERIUM_REGION` > `IT`);
   la lingua query JW e i titoli TMDB seguono la regione. Cache condivisa 30 min
   con `/api/trending/rank` e warmup (cache key include `:r<CODE>`).
   Restituisce `{ tmdbId, imdbId, rank }`:
   **l'`imdbId` arriva già da JustWatch** — non rifare una chiamata TMDB per ottenerlo.
2. Per ogni riga: `getDetails` TMDB (`it-IT`) con la chiave risolta da
   `resolveRequestApiKey(req)`.
3. Id del meta: `row.imdbId` → fallback `resolveImdbId(...)` → fallback `tmdb:<id>`.
4. Poster: `/api/poster/{type}/{tmdbId}?rv=...` (+ `mv` se esiste un mapping salvato).

### Piattaforme Streaming (`posterium-netflix-*`, `posterium-prime-*`, ecc.)
1. `getJustWatchRankings(type, region.code, 10, packages, region.lang)` con i pacchetti della piattaforma
   (`nfx`, `prv`, `dnp`, `ntv`/`skg`, `atp`, `mxx`, `pmp`). Il fast-path JW in
   `getTop10` vale per tutte le 12 regioni supportate (prima solo Italia).
2. Se JustWatch non restituisce righe, fallback trasparente su FlixPatrol `getTop10(slug, region.flixSlug, apiKey)`.
3. Deduplicazione rigorosa per `tmdbId` (nessun doppione nei primi 10).

### Anime (`posterium-anime-movies`, `posterium-anime`)
`fetchMDBList(listKey, key)` — usa `mdblistAnimeMovie` per i film anime e `mdblistAnime`
per le serie. Funziona sia con chiave MDBList sia con endpoint pubblico JSON di fallback.
Risolve i dettagli TMDB e deduplica per `tmdbId`.

## Chiavi API

`resolveRequestApiKey(req)` in `lib/tmdb.ts` — priorità:
1. header `x-api-key`;
2. query `api_key`;
3. env `POSTERIUM_TMDB_KEY` (fallback d'istanza, opt-in).

**Nessuna chiave d'istanza di default** (`TMDB_API_KEY`/`MDBLIST_API_KEY` non
sono lette). La fonte primaria di chiavi è la richiesta (header `x-api-key` >
query `api_key`): senza chiave esplicita la chiamata
TMDB/MDBList fallisce (poster 404, cataloghi vuoti). `resolveImdbId` DEVE
ricevere la chiave della richiesta (è così oggi).

NOTA: il parametro `?u=` (o path `/u/<uuid>`) è solo identità/tracking per
manifest e cache key — **non** fornisce chiavi API. Non esiste alcun profile
store server-side: chiavi "da profilo" non sono mai state implementate.

**Fallback d'istanza (opt-in, per istanze personali)**: `POSTERIUM_TMDB_KEY` e
`POSTERIUM_MDBLIST_KEY` sono lette come FALLBACK quando la richiesta
non porta la chiave. Pensate per deploy personali (es. Vercel con un solo
utente) dove i cataloghi devono funzionare senza che Stremio passi la chiave.
Per istanze multi-utente pubbliche NON configurarle: la policy storica (nessuna
chiave d'istanza condivisa) resta valida per quel caso.

## Caching & risposte

- Cache catalogo (`cacheSet`/`cacheGet` in `lib/cache.ts`): key include tipo,
  `catalogId`, `POSTER_URL_VERSION`, hash `config` e hash `mdblist_key`.
  TTL: refresh schedulato alle 3:00 UTC (tag `catalog`); catalogo **vuoto** → 60 s.
- Cache meta (`meta-handler.ts`): key include `episodeGroupId:updatedAt` del
  mapping (film e serie) così save poster/ordinamento invalidano anche
  cross-instance; TTL 12h.
- Su deploy multi-istanza (Vercel serverless) la `cacheInvalidate("stremio")`
  del save non raggiunge le altre istanze: il cache key catalogo include anche
  epoch globale (`lib/catalog-epoch.ts`, bump su ogni scrittura
  mapping/defaults) e hash dei server defaults — ogni save cambia la chiave su
  tutte le istanze.
- Cache JustWatch (30 min) condivisa anche da `/api/trending/rank` e warmup.
- `metas: []` = catalogo non riconosciuto, chiave mancante o errore. Rate limit →
  429 con `Retry-After`.
- Header risposta: `Cache-Control: no-cache`, CORS `*`.
- Route con `maxDuration = 60` per cataloghi (`catalog/[type]/[id]/route.ts`), `40` per poster (`api/poster/[type]/[id]/route.ts`): un catalogo freddo fa ~20 `getDetails` + ranking.

## Cosa NON fare

- Non emettere mai `id` numerici nudi nel catalogo.
- Non reintrodurre la chiamata TMDB extra per l'`imdbId` nei cataloghi JustWatch:
  la fonte lo fornisce già.
- Non rimuovere il passaggio della chiave della richiesta in `resolveImdbId`.
- Non hardcoddare nuovi cataloghi nel route: aggiungili a `POSTERIUM_CATALOGS` (e a
  `WARMUP_CATALOG_IDS` se devono essere preriscaldati).

## File coinvolti

- `src/lib/catalog-definitions.ts` — elenco cataloghi + warmup
- `src/lib/catalog-handler.ts` — `posteriumCatalog(req, mediaType, rawId, userParam, configParam)` (logica unica). `userParam` (param `u=`/`user`) è il profilo UUID: entra nel cache key come `:u<uuid>` e nei poster URL come `user` (`&u=`). `configParam` è il config token (`config=`).
- `src/lib/justwatch.ts` — `getJWRankings` (GraphQL + cache)
- `src/lib/flixpatrol.ts` — `getTop10` per le piattaforme
- `src/lib/mdblist.ts` — `fetchMDBList`
- `src/lib/tmdb.ts` — `getDetails`, `getExternalIds`, `resolveRequestApiKey`
- `src/lib/store.ts` — mapping salvati (parametro `mv` nel poster URL)
- `src/app/catalog/[type]/[id]/route.ts` — route Stremio
- `src/app/api/trending/rank/route.ts` — rank JustWatch per il badge
- `src/app/api/warmup/route.ts` — preriscaldamento poster (trending + JW + mapping)
