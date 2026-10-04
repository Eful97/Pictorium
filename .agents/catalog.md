# Pictorium - Cataloghi Stremio (architettura & id metadati)

> Le regole qui descritte sono il contratto per chi modifica i cataloghi. Quando
> questo file e il codice discordano, vince il codice (CODE WINS) — aggiorna il file.

## Vista d'insieme

Pictorium espone cataloghi Stremio **solo per generare i poster**. La risoluzione dei
**metadati** (nome, trama, locandina originale) avviene tramite il proprio endpoint
`/meta/{type}/{id}` (`src/lib/meta-handler.ts`, dichiarato come risorsa `meta` nel
manifest): alla click su un elemento, Stremio chiede i metadati direttamente a
Pictorium, che è 100% standalone e non dipende da addon esterni come AIOMetadata.
Per questo l'`id` esposto nel catalogo DEVE essere un id che il resolver di Pictorium
sa risolvere.

### REGOLA D'ORO — id metadati risolvibili

Il resolver `/meta` di Pictorium risolve gli id **solo** da `tt...` (IMDb) o
`provider:id` (es. `tmdb:12345`). Un **numero nudo** viene trattato solo come
fallback TMDB ed è un id non portabile → evitare sempre.

Risoluzione dell'id (helper `catalogMetaId` in `catalog-handler.ts`):
oggi sempre `tmdb:<id>` (il resolver `/meta` di Pictorium risolve `tmdb:` nativamente;
storicamente `imdbId` → `resolveImdbId` → `tmdb:` — ora il parametro `_imdbId` è
ignorato per mantenere Pictorium 100% standalone senza dipendenza da Cinemeta/AIOMetadata).
Mai emettere un id numerico nudo come `id` del meta.

## Cataloghi supportati (`PICTORIUM_CATALOGS` in `catalog-definitions.ts`)

Gli ID canonici usano il prefisso `pictorium-`. Gli ID legacy `posterium-*`
(addon installati prima del rename) restano accettati in ingresso come alias:
`normalizeCatalogId()` in `catalog-handler.ts`/`build-manifest.ts` li mappa al
canonico, e anche le config salvate (`disabledCatalogIds`, `catalogOrder`,
`catalogRenames`) con ID legacy vengono normalizzate in lettura. Il manifest
emette solo ID `pictorium-*`.

| Prefix catalogo | Fonte | Tipo | Richiede |
|---|---|---|---|
| `pictorium-jw-movies` / `pictorium-jw-series` | JustWatch StreamingCharts (GraphQL) | movie/series | Chiave TMDB |
| `pictorium-netflix/prime/disney/now/apple/hbo/paramount-*` | JustWatch StreamingCharts (pacchetti) + fallback FlixPatrol | movie/series | Chiave TMDB |
| `pictorium-anime-movies` / `pictorium-anime` | MDBList `mdblistAnimeMovie` / `mdblistAnime` | movie/series | Opzionale (fallback pubblico) |
| `pictorium-search-movies` / `pictorium-search-series` | TMDB search diretto (`searchMovies`/`searchTV`) | movie/series | Chiave TMDB |

Warmup automatico: `pictorium-jw-movies`, `pictorium-jw-series`, `pictorium-netflix-movies/series`, `pictorium-prime-movies/series`, `pictorium-anime-movies`, `pictorium-anime`
(`WARMUP_CATALOG_IDS` — 8 cataloghi). I restanti 10 platform restano cold ma beneficiano della cache JustWatch 30 min condivisa.

## Flusso per catalogo

### JustWatch (`pictorium-jw-*`)
`GLOBAL` è selezionabile prima dei paesi in impostazioni e onboarding. La
query usa `streamingCharts(country: null)`; il paese `US` serve solo alla
localizzazione dei metadati. Le lingue UI senza paese chart, come `vi`,
selezionano automaticamente `GLOBAL` al cambio lingua. Una scelta globale
resta globale quando cambia la lingua e viene conservata al reload.
Anche le piattaforme applicano i propri pacchetti al ranking globale: senza
righe mondiali non vengono aggiunti titoli nazionali da popularTitles o
FlixPatrol. I filtri genere globali si applicano dopo l'arricchimento TMDB.

1. `getJWRankings("MOVIE"|"SHOW", region.code, ...)` in `lib/justwatch.ts` — query GraphQL
   a `apis.justwatch.com` (o `JUSTWATCH_API_URL` nei test). Regione da `lib/regions.ts`
   (18 paesi: `?region=` > config-token > default server `PICTORIUM_REGION` > `IT`);
   la lingua query JW e i titoli TMDB seguono la regione. Cache condivisa 30 min
   con `/api/trending/rank` e warmup (cache key include `:r<CODE>`).
   Restituisce `{ tmdbId, imdbId, rank }`:
   **l'`imdbId` arriva già da JustWatch** — non rifare una chiamata TMDB per ottenerlo.
2. Per ogni riga: `getDetails` TMDB (`it-IT`) con la chiave risolta da
   `resolveRequestApiKey(req)`.
3. Id del meta: `row.imdbId` → fallback `resolveImdbId(...)` → fallback `tmdb:<id>`.
4. Poster: `/api/poster/{type}/{tmdbId}?rv=...` (+ `mv` se esiste un mapping salvato).

### Piattaforme Streaming (`pictorium-netflix-*`, `pictorium-prime-*`, ecc.)
1. `getJustWatchRankings(type, region.code, 10, packages, region.lang)` con i pacchetti della piattaforma
   (`nfx`, `prv`/`amp`, `dnp`, `ntv`/`skg`/`pct`/`pcp`, `atp`, `mxx`, `pmp`/`sst`). Gli shortName sono
   regionali (Prime: `prv` in IT, `amp` in US/GB/DE/JP; Paramount in ES è SkyShowtime `sst`; NOW negli
   USA mappa Peacock `pct`/`pcp`): si passa sempre l'unione, JW ignora i codici assenti per regione. Il fast-path JW in
   `getTop10` vale per tutte le 18 regioni supportate (prima solo Italia).
2. Se JustWatch non restituisce righe, fallback trasparente su FlixPatrol `getTop10(slug, region.flixSlug, apiKey)`.
3. Deduplicazione rigorosa per `tmdbId` (nessun doppione nei primi 10).

### Anime (`pictorium-anime-movies`, `pictorium-anime`)
`fetchMDBList(listKey, key)` — usa `mdblistAnimeMovie` per i film anime e `mdblistAnime`
per le serie. Funziona sia con chiave MDBList sia con endpoint pubblico JSON di fallback.
Risolve i dettagli TMDB e deduplica per `tmdbId`.

## Fonte ranking Top 20 (`rankingSourceMovie` / `rankingSourceSeries`)

I cataloghi globali `pictorium-jw-movies` / `pictorium-jw-series` e i badge
classifica (poster, preview, `/api/trending/rank`) possono usare JustWatch
(default retrocompatibile) oppure un catalogo custom già importato come fonte
ranking. La selezione vive in `ServerDefaults` + config token (stringa vuota =
override JW esplicito); il manifest mostra il nome della lista custom al posto
di "JustWatch" e la UI la configura in CataloghiView accanto ai cataloghi
importati (due dropdown Film/Serie, solo custom abilitati e compatibili per
tipo; `mixed` vale per entrambi).

- Puro: `resolveRankingSource()` in `lib/ranking-source.ts` (foglia
  client-safe, riusata da UI e server) — id eliminato, spento
  (`enabled === false`) o incompatibile → JustWatch, mai errori.
- Recupero: `fetchCustomRankingTop20()` in `lib/custom-ranking.ts`, unica
  funzione per cataloghi/badge/poster — filtro per tipo, risoluzione
  IMDb/TVDB→TMDB, dedup, STOP alle prime 20 posizioni valide (niente filler
  JW, pagine oltre la Top 20 vuote). Errori provider → stato esplicito, mai
  fallback silenzioso; solo `ok` con item va in cache (30 min, tag
  `custom_catalogs`, chiave con hash di selezione/credenziali/namespace).
- Badge: il rank custom viaggia sul canale `trendRank` (label Film/Serie);
  fuori Top 20 o in errore nessun badge, mai rank JW. Piattaforme e anime
  invariati. Le chiavi API non entrano mai nei poster URL (solo server-side).
- Spazi senza namespace (local-only/profileless): la selezione viaggia in un
  token firmato `?config=` coniato da `POST /api/config-token` (payload anche
  solo cataloghi: il server completa i visual dai defaults). Preview, rank e
  template/poster di install lo includono solo lì (altrove URL identici).
  L'install Stremio da link con token serve cataloghi/poster custom omonimi.
- Cache chiavi catalogo: frammento `:rs<hash>` SOLO sui globali JW così il
  cambio selezione non invalida piattaforme/anime; poster ed ETag seguono già
  via `sdHash`/`configHash`. `/api/trending/rank` custom risponde
  `private, no-cache` (l'URL non cambia con la selezione), JW resta `public`.

## Chiavi API

`resolveRequestApiKey(req)` in `lib/tmdb.ts` — priorità:
1. header `x-api-key`;
2. query `api_key`;
3. env `PICTORIUM_TMDB_KEY` (fallback d'istanza, opt-in; legacy `POSTERIUM_TMDB_KEY` ancora accettata).

**Nessuna chiave d'istanza di default** (`TMDB_API_KEY`/`MDBLIST_API_KEY` non
sono lette). La fonte primaria di chiavi è la richiesta (header `x-api-key` >
query `api_key`): senza chiave esplicita la chiamata
TMDB/MDBList fallisce (poster 404, cataloghi vuoti). `resolveImdbId` DEVE
ricevere la chiave della richiesta (è così oggi).

NOTA: il parametro `?u=` (o path `/u/<uuid>`) è solo identità/tracking per
manifest e cache key — **non** fornisce chiavi API. Non esiste alcun profile
store server-side: chiavi "da profilo" non sono mai state implementate.

**Fallback d'istanza (opt-in, per istanze personali)**: `PICTORIUM_TMDB_KEY` e
`PICTORIUM_MDBLIST_KEY` sono lette come FALLBACK quando la richiesta
non porta la chiave (legacy `POSTERIUM_*` ancora accettate con warning di
deprecazione, vedi `src/lib/env-compat.ts`). Pensate per deploy personali (es. Vercel con un solo
utente) dove i cataloghi devono funzionare senza che Stremio passi la chiave.
Per istanze multi-utente pubbliche NON configurarle: la policy storica (nessuna
chiave d'istanza condivisa) resta valida per quel caso.

## Caching & risposte

- Campi immagine per item: `poster` = rendering Pictorium (formato da
  mapping/defaults, col logo baked-in anche in landscape), `landscapePoster` =
  rendering Pictorium in canvas 16:9 con logo — SOLO per i titoli landscape
  (NuvioTV lo legge e NON deve ricevere il `logo` separato, altrimenti lo
  sovrappone al nostro: per quei titoli `logo` è omesso in catalogo e /meta),
  `banner` = SEMPRE rendering Pictorium in canvas landscape SENZA logo
  (`forceShape` + `hideLogo` in `stremio-poster-url.ts`, profilo landscape del
  mapping) per i client che leggono `banner`, `background` = backdrop TMDB
  grezzo per l'hero dettaglio. I titoli portrait non emettono `landscapePoster`
  e mantengono il `logo` separato (comportamento invariato).

- Cache catalogo (`cacheSet`/`cacheGet` in `lib/cache.ts`): key include tipo,
  `catalogId`, `POSTER_URL_VERSION`, hash `config` e hash `mdblist_key`.
  TTL: 1h dalla generazione per il catalogo **non vuoto** (TTL esplicito, vince
  sul refresh schedulato del tag `catalog`); catalogo **vuoto** → 60 s.
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

## Proxy addon: mapping anime locale (`anime-id-map`)

Il proxy (`/api/proxy`, rewrite in `lib/addon-proxy.ts`) riscrive SOLO la
poster URL degli item esterni con id anime-native **risolvibili in modo
sicuro**, senza toccare id/tipo/ordine/paginazione/videos:

- Solo `anilist:`/`kitsu:` + tipo item esplicito (`movie`/`anime.movie` →
  movie, `series`/`anime.series`/`tv`/`show` → tv). Snapshot versionato in
  `src/generated/anime-id-map.json` (derivato compatto di
  Fribb/anime-lists, vedi `docs/anime-id-mapping.md`), indici in-memory,
  lookup sincrono a zero rete.
- Match unico lato-compatibile → `/api/poster/{movie|series}/{tmdbId}` con la
  stessa propagazione `rv`/`u`/`dv`. Miss, ambiguità, mismatch di media type,
  tipo `anime` nudo, `mal:`/`anidb:`, id malformati → artwork originale.
- Un match unico stagione→show riusa l'artwork della SERIE (mai artwork
  stagione-specifico, mai merge di stagioni).
- Le risposte proxy non sono cachate server-side: un refresh dello snapshot
  produce URL nuove al successivo fetch, nessuna chiave cache da versionare.
- Il manifest NON dichiara i prefissi `kitsu:`/`anilist:`/`mal:`/`anidb:`
  (il resolver `/meta` non li risolve: restano agli addon dedicati).

## Cosa NON fare

- Non emettere mai `id` numerici nudi nel catalogo.
- Non reintrodurre la chiamata TMDB extra per l'`imdbId` nei cataloghi JustWatch:
  la fonte lo fornisce già.
- Non rimuovere il passaggio della chiave della richiesta in `resolveImdbId`.
- Non hardcoddare nuovi cataloghi nel route: aggiungili a `PICTORIUM_CATALOGS` (e a
  `WARMUP_CATALOG_IDS` se devono essere preriscaldati).

## File coinvolti

- `src/lib/catalog-definitions.ts` — elenco cataloghi + warmup
- `src/lib/catalog-handler.ts` — `pictoriumCatalog(req, mediaType, rawId, userParam, configParam)` (logica unica). `userParam` (param `u=`/`user`) è il profilo UUID: entra nel cache key come `:u<uuid>` e nei poster URL come `user` (`&u=`). `configParam` è il config token (`config=`).
- `src/lib/ranking-source.ts` — selezione fonte Top 20 (pura, client-safe)
- `src/lib/custom-ranking.ts` — Top 20 da lista custom (unica funzione condivisa)
- `src/lib/useRankingSources.ts` — stato client, persistenza e nonce di refresh
- `src/components/RankingSourceSection.tsx` — dropdown Film/Serie in CataloghiView
- `src/lib/justwatch.ts` — `getJWRankings` (GraphQL + cache)
- `src/lib/flixpatrol.ts` — `getTop10` per le piattaforme
- `src/lib/mdblist.ts` — `fetchMDBList`
- `src/lib/tmdb.ts` — `getDetails`, `getExternalIds`, `resolveRequestApiKey`
- `src/lib/store.ts` — mapping salvati (parametro `mv` nel poster URL)
- `src/app/catalog/[type]/[id]/route.ts` — route Stremio
- `src/app/api/trending/rank/route.ts` — rank JustWatch per il badge
- `src/app/api/warmup/route.ts` — preriscaldamento poster (trending + JW + mapping)
