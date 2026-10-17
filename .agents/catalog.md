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
(`WARMUP_CATALOG_IDS` — 8 cataloghi). I restanti 10 platform restano cold ma beneficiano della cache JustWatch condivisa (6 ore).

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
    la lingua query JW e i titoli TMDB seguono la regione. Cache condivisa 6 ore
   con `/api/trending/rank` e warmup (cache key include `:r<CODE>`).
   Restituisce `{ tmdbId, imdbId, rank }`:
   **l'`imdbId` arriva già da JustWatch** — non rifare una chiamata TMDB per ottenerlo.
2. Per ogni riga: dettagli TMDB nella lingua effettiva del catalogo, con la
   chiave risolta da `resolveUserApiKeys(req, scopedUser)`.
3. Id del meta: `tmdb:<id>` via `catalogMetaId`; l'IMDb della fonte resta disponibile per gli altri consumer, ma non decide l'id del catalogo.
4. Poster: `/api/poster/{type}/{tmdbId}?rv=...` (+ `mv` se esiste un mapping salvato).

### Piattaforme Streaming (`pictorium-netflix-*`, `pictorium-prime-*`, ecc.)
1. `getJustWatchRankings(type, region.code, 10, packages, region.lang)` con i pacchetti della piattaforma
   (`nfx`, `prv`/`amp`, `dnp`, `ntv`/`skg`/`pct`/`pcp`, `atp`, `mxx`, `pmp`/`sst`). Gli shortName sono
   regionali (Prime: `prv` in IT, `amp` in US/GB/DE/JP; Paramount in ES è SkyShowtime `sst`; NOW negli
   USA mappa Peacock `pct`/`pcp`): si passa sempre l'unione, JW ignora i codici assenti per regione. Il fast-path JW in
   `getTop10` vale per tutte le 18 regioni supportate (prima solo Italia).
2. Se JustWatch non restituisce righe, fallback trasparente su FlixPatrol `getTop10(slug, region.flixSlug, apiKey)` (cache disco+memoria 12 ore).
3. Deduplicazione rigorosa per `tmdbId` (nessun doppione nei primi 10).

### Anime (`pictorium-anime-movies`, `pictorium-anime`)
`fetchMDBList(listKey, key)` — usa `mdblistAnimeMovie` per i film anime e `mdblistAnime`
per le serie (cache sorgente 12 ore, 60 s sui vuoti). Funziona sia con chiave MDBList sia con endpoint pubblico JSON di fallback.
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

`resolveUserApiKeys(req, scopedUser)` in `lib/tmdb.ts` — priorità TMDB:
1. header `x-api-key`, poi query `api_key`;
2. chiave cifrata del namespace utente, quando lo scoping è abilitato;
3. fallback d'istanza consentito: `PICTORIUM_TMDB_KEY` (legacy
   `POSTERIUM_TMDB_KEY`), poi `TMDB_KEY` / `TMDB_API_KEY`.

`?u=` o `/u/<uuid>` seleziona il namespace secondo `user-auth.ts`; chiavi
persistite in `user-keys.ts`, default e mapping sono scoped. Nel catalogo gli
utenti inesistenti vengono declassati al ramo globale. Con multi-user ON il
fallback env è disabilitato per richieste scoped, salvo opt-in
`PICTORIUM_MULTI_USER_ALLOW_ENV_FALLBACK=1`; le richieste globali lo mantengono.
MDBList/TVDB/Simkl/Fanart hanno le proprie precedenze nello stesso resolver.
`resolveImdbId` DEVE ricevere la chiave effettiva del consumer.

Il resolver sincrono legacy `resolveRequestApiKey` risolve solo richiesta >
env: non sostituirlo al resolver scoped nei cataloghi.

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
- Cache JustWatch (6 ore) condivisa anche da `/api/trending/rank` e warmup.
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

## Formato per catalogo (override esplicito, solo catalogo)

Ogni catalogo può forzare il proprio formato card (`catalogShapes` in
`ServerDefaults`, chiave = id manifest/route del catalogo, valori SOLO
`poster`|`landscape`; chiave assente/cancellata = segue il formato globale
`posterShape`). Scelta esplicita dell'utente, non suggerimento:

- `poster` esplicito forza SEMPRE la verticale per quel catalogo
  (globale/mapping ignorati); `landscape` esplicito forza SEMPRE
  l'orizzontale per quel catalogo (globale/mapping ignorati).
- Chiave assente = comportamento storico byte-identico
  (`stremioPosterShape`: il globale orizzontale forza anche i mapping
  portrait, il globale verticale onora un mapping landscape).
- Vale SOLO per le card di quel catalogo: stesso titolo in altro catalogo
  invariato, mapping salvato mai riscritto, `/meta` resta globale (nessun
  contesto catalogo inventato). `banner` resta sempre landscape+hideLogo;
  `landscapePoster`/`logo` seguono la forma card risolta.
- Chiavi legacy `posterium-*` normalizzate, id ignoti preservati senza fetch
  di lista, chiavi `__proto__`/`constructor`/`prototype` rifiutate, enum
  ignoti rifiutati dal server (mai default silenziosi), tetto ragionevole
  come gli altri record catalogo. Nessuna chiave API negli URL.

## Cornici stagionali (Halloween + Natale, automatico dal nome lista)

Riconoscimento AUTOMATICO dal nome visibile effettivo del catalogo/lista:
`halloween` whole-word case-insensitive (`Halloween`, `HALLOWEEN`,
`🎃 Halloween!` sì; `Halloweens`, `HalloweenParty` no) e Natale in tutte le
lingue UI supportate (`Natale`, `Christmas`/`Xmas`, `Weihnachten`,
`Noël`/`Noel`, `Navidad`, `Natal`, `Kerst`/`Kerstmis`,
`Boże Narodzenie`, `Vánoce`, `Crăciun`, `Jul`, `Giáng sinh`,
`クリスマス`, `크리스마스`, `חג המולד`, `عيد الميلاد`/`الكريسماس` —
indipendente dalla lingua UI selezionata; `Natalie`, `July`, `Noelani`,
`ChristmasParty` no; nomi misti → `halloween` per precedenza).
Precedenza del nome come il manifest (rename > ranking override > nome
regionale JW > base; liste custom con split `— Film/Serie TV` per `mixed`):
`resolveCatalogSeasonalTheme` in `catalog-handler.ts`, leaf condiviso
`src/lib/seasonal-theme.ts`.

- `halloween`/`christmas`, su entrambi i canvas col proprio asset utente
  (`poster` → `public/seasonal-frames/<tema>.svg` 500×750,
  `landscape` → `public/seasonal-frames/<tema> landscape.svg` 768×432,
  mai stirati — mappa esplicita `seasonalFrameAssetPath` in
  `seasonal-theme.ts`): il `poster` del catalogo porta `theme=<tema>`
  (stesso renderer condiviso `/api/poster/{type}/{id}`, cornice come strato
  sopra lo sfondo/trattamento ma SOTTO tutto il chrome — logo e badge
  (rank/extra, Coming Soon, network, qualità, genere, separati, età) e gli
  overlay Fresh/Card — in ogni layout (standard, Fresh e Card, portrait e
  landscape senza esclusioni), per richiesta utente esplicita);
  `banner` (pulito: `forceShape` + `hideLogo`, mai alcun `theme=`) resta
  senza tema (byte-identico).
  Stesso titolo in altra lista = invariato; nessun default globale,
  selettore o tema persistito per-titolo; il `/meta` generico resta senza
  contesto (byte-identico): accetta un `theme=` esplicito solo come
  contesto effimero lista/test Stremio («Testa URL Stremio»), su entrambi i
  canvas con isolamento cache (`:th<tema>` in chiave meta; `shape` già in
  chiave poster a sé).
- Isolamento cache: `:th<tema>` nella chiave catalogo/search + `theme`
  in allowlist/poster-key (invalido = assente = unframed; i due temi hanno
  chiavi distinte tra loro).
- Client: il click da lista Halloween/Natale porta il nome effettivo come
  contesto effimero (`navigateToPoster(item, src, listName)` → `theme=` in
  preview, azzerato all'uscita/altra lista); le tile restano TMDB grezze.

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
