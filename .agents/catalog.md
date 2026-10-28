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
IMDb-first — se la fonte fornisce un `imdbId` valido (`tt` + 7-10 cifre,
fail-closed come `isValidImdbId` in `imdb-csv.ts`; normalizzato in minuscolo
perché il resolver `/meta` matcha il prefisso `tt` minuscolo) l'id del meta
è l'imdbId stesso; altrimenti fallback `tmdb:<id>` (il resolver `/meta` di
Pictorium risolve entrambi nativamente). Mai emettere un id numerico nudo
come `id` del meta. Dedup, mapping e poster URL restano sul tmdbId numerico:
l'id emesso non si usa mai come chiave di selezione (i `tt` possono essere
condivisi tra entry split della stessa franchise — vedi escape hatch
alias/mapping `imdbId` nel contratto poster).

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
3. Id del meta: `catalogMetaId` — l'`imdbId` valido della fonte (JustWatch lo
   fornisce già: nessuna chiamata TMDB extra per ottenerlo) oppure
   `tmdb:<id>` in fallback quando assente/invalido.
4. Poster: `/api/poster/{type}/{tmdbId}?rv=...` (+ `mv` se esiste un mapping salvato).

### Ricerca (`pictorium-search-movies` / `pictorium-search-series`, `pictorium-search-people-*`)
Ricerca TMDB diretta (`searchMovies`/`searchTV`, max 20 risultati, pagine via
`skip`); persone via `searchPerson` → `pickTopPerson` → crediti film/serie
(dedup per `tmdbId` numerico, ordine per popolarità). Id del meta
IMDb-first come gli altri cataloghi: `catalogMetaId` sull'`imdb_id`
risolto via `resolveImdbId` (`external_ids` leggero e cachato in
`imdb-cache`, con la chiave della richiesta e tetto fail-open —
assente/invalido/errore ricade su `tmdb:<id>` e la riga resta servita),
senza secondo `getDetails` per riga (full-text/crediti bastano). Dedup,
mapping e poster URL restano sul tmdbId numerico. L'id `tt` esatto resta
risolto via `/find` senza full-text (invariato).

### Piattaforme Streaming (`pictorium-netflix-*`, `pictorium-prime-*`, ecc.)
FP-first con fallback JustWatch per media type (mai blendati nella stessa
chart: ogni lista film/serie è interamente FP o interamente JW):
1. `resolveFlixPlatformSides(slug, region.flixSlug)` — UN solo fetch del
   catalogo fp-crawler del paese; ogni lato (film/serie) con chart fresca e
   valida vince con ZERO traffico JW. Freschezza bounded e deterministica
   (vedi sotto): chart-level `date` (fallback al `date` top-level di documento
   solo se la chart non ne porta uno), formato inglese `October 22, 2026`
   (più fallback ISO), valida SOLO se pari al giorno corrente o precedente di
   Europe/Rome (il crawler pubblica una volta al giorno; oltre ieri = stantia,
   futuro/invalida = rifiutata). `scraped_at_utc` e timestamp di fetch/cache
   non contano mai (niente laundering del fetched-at: una cache TTL-fresh con
   date stantie è rifiutata come un payload di rete). Un documento paese interamente vuoto (`charts: []`)
    non è mai un dato valido: viene messo in quarantena come integrity
    failure (mai servito, mai sovrascritto sopra un cache buono; retry dopo
    cooldown 60s con retention del last-good). L'assenza dello split
   (piattaforme overall-only come Crunchyroll/hayu, senza chart film/serie) è
   fallback, mai un vuoto FP genuino (che richiede chart presente + fresca +
   `entries: []`).
2. Lato senza chart FP fresca e usabile → fallback JustWatch
   `getJustWatchRankings(type, region.code, 10, packages, region.lang)` con i
   pacchetti della piattaforma (`nfx`, `prv`/`amp`, `dnp`, `ntv`/`skg`/`pct`/`pcp`,
   `atp`, `mxx`, `pmp`/`sst`) — solo per quel lato (una chart FP film fresca
   non sopprime mai il fallback serie e viceversa; un guasto al lato opposto
   non blocca mai il lato richiesto). Miss per questo passo = split assente,
   data stantia/invalida, errore di trasporto, documento/chart malformati o
   chart senza alcun `tmdbId` usabile. Gli shortName sono
   regionali (Prime: `prv` in IT, `amp` in US/GB/DE/JP; Paramount in ES è
   SkyShowtime `sst`; NOW negli USA mappa Peacock `pct`/`pcp`): si passa
   sempre l'unione, JW ignora i codici assenti per regione. Vale per tutte le
   18 regioni supportate (GLOBAL escluso: FP globale deliberatamente fuori
   scope — il path GLOBAL resta JW-only invariato).
3. Entrambe le sorgenti giù (FP miss + fallimento JW) = retention: ultimo
   snapshot buono + gate 60s, mai un vuoto fasullo. Un JW `[]` riuscito dopo
   FP miss pubblica invece un vuoto genuino. Deduplicazione rigorosa per
   `tmdbId` (nessun doppione nei primi 10).
La provenance interna dello snapshot pubblicato (`justwatch`/`flixpatrol`)
riflette sempre la sorgente effettiva del lato — è diagnostica interna, NON
l'etichetta pubblica del fallback: per i platform built-in storici
l'etichettatura pubblica resta QUEUED; per le selezioni streaming opt-in la
disclosure pubblica esiste (nomi manifest neutrali + header `X-Pictorium-Source`
per risposta + `GET /api/streaming-availability`), vedi sezione sotto.

### Cataloghi streaming opt-in per servizio+paese (`pictorium-stream-<service>-<cc>-<movies|series>`)

Selezioni persistite per spazio (`streamingSelections` in `ServerDefaults` +
config token, una entry per coppia servizio+paese, entrambe le sezioni salvo
restrizione; ID catalogo derivati deterministicamente, mai salvati). La stessa
coppia in paesi diversi coesiste (es. Netflix IT + Hulu USA concettualmente —
vedi sotto per Hulu/Peacock): paese+servizio+sezione sono tutti nell'identità
e nelle chiavi cache. Contratti in `src/lib/streaming-catalogs.ts` (foglia
client-safe, riuso UI nel follow-up) + `src/lib/streaming-availability.ts`
(server-only).

- **Boundary assente-vs-esplicito (task 3 possiede i default dei nuovi
  spazi):** `streamingSelections` assente (`undefined`) = legacy byte-identico
  (i platform built-in storici restano come sono: gli spazi esistenti non
  cambiano). Esplicito (`[]` o lista) = opt-in: i platform built-in storici
  sono nascosti e restano solo i Top 20 JW generali + gli Anime Top 20 (non
  service-based, invariati in entrambe le modalità) + le selezioni abilitate.
  `[]` esplicito NON è come assente — mai migrato, mai backfillato.
- **Paesi supportati (legacy):** solo le regioni con `RegionDef`
  (`parseRegion` + escluso `GLOBAL`): il paese della selezione governa chart
  country, lingua metadati e regione poster. Paesi sconosciuti NON ripiegano
  mai sull'Italia — la entry è scartata alla sanitize (fail-closed, niente
  fetch arbitrari). L'universo generico (Task F, sotto) accetta invece tutti
  gli chart-country slug dell'indice (119 totali, global incluso); le entry legacy restano
  invariate.
- **FP-first + fallback JW onesto per lato** (stesso motore dei platform
  storici MA su famiglie isolate `stream:<service>:<movie|series>` — mai i pin
  condivisi `platform:` legacy; coordinate = paese della selezione, mai la
  regione globale): una chart FP fresca vince con zero traffico JW; il
  fallback JW vale solo per coppie servizio-paese own-brand con copertura
  JustWatch osservata (`STREAMING_JW_PACKAGES`, nessun alias sibling: NOW solo
  `ntv`/`skg`, mai `pct`/`pcp` Peacock; Paramount solo `pmp`, mai `sst`
  SkyShowtime). La matrice è probe-backed, non esaustiva (JustWatch
  `streamingCharts first:3` per coppia servizio-paese, 2026-10-23; un `rows=0`
  con controllo unfiltered non-vuoto per lo stesso paese vale unsupported):
  NOW solo IT/GB (la DE restituisce righe `ntv`/`skg` ma il brand DE è WOW/Sky,
  non NOW — servirle come NOW sarebbe mislabeling), Paramount solo
  US/GB/CA/AU/FR/DE/IT/MX/BR, HBO solo nei 15 paesi con righe `mxx`
  (JP/KR/IN/CA/SA/IL/PT esclusi), Disney ovunque tranne IL/IN/SA, Apple ovunque
  tranne IL/RO/TR, Netflix/Prime/Crunchyroll ovunque tranne IL (JustWatch non
  pubblica chart IL); fuori matrice la coppia è unavailable (vuoto onesto), mai
  un guess JW. Il follow-up UI/task3 possiede refresh e discovery più ampia. **NOW+USA non risolve mai via Peacock**: JW skippato sia in
  renewal (snapshot empty senza provenance, famiglia `stream:`) che in serving
  (probe FP-only via `resolveFlixPlatformSides`; snapshot JW pre-migrazione
  ignorati via gate) — con FP assente la coppia è unavailable (vuoto), mai
  Peacock sotto il nome NOW. I cataloghi legacy `pictorium-now-*` restano
  byte-identici (unioni storiche `pct`/`pcp`/`sst` preservate su famiglie
  `platform:`). Hulu/Peacock/WOW/Rai e gli altri service id sono mappati come
  servizi generici FP (Task F, sotto) — mai come alias di altri servizi.
  L'indice availability (`schema_version: 1`, presenza sezione anche con array
  varianti vuoto = base chart esistente) indica copertura chart, MAI
  disponibilità commerciale né ascolti ufficiali, e MAI una garanzia di
  freschezza chart (vale la chart-date per-lato a serving).
- **Overall-only mai splittato (legacy):** le chart `overall` dell'indice non generano
  sezioni film/serie (dividere inventerebbe i rank); la coppia legacy risulta
  unavailable con capability spiegata. L'universo generico (Task F) espone in
  più le overall come cataloghi misti `all` (mai split, vedi sotto).
- **Nomi manifest neutrali:** `Top 10` senza claim di sorgente (il manifest fa
  zero I/O chart) — `FlixPatrol`/`JustWatch` non compaiono mai nei nomi. La
  sorgente effettiva viaggia per risposta nell'header `X-Pictorium-Source`
  (`flixpatrol`/`justwatch`/`unknown`, dal pin già risolto — zero I/O extra;
  `unknown` = finestra live non pinnata, mai un guess; diagnostica per client
  che ispezionano le risposte, NON visibile dentro Stremio) e in anticipo via
  endpoint read-only `GET /api/streaming-availability` (filtri
  `?service=&country=&section=`, copertura FP dall'indice cachato 12h fetch /
  24h source-age — UNICO fetch — + eleggibilità JW, label oneste
  `Top 10 · FlixPatrol` vs `Top 10 · JustWatch` (entrambe daily chart, mai un
  generico `Popolari`); l'indice indica copertura chart, MAI disponibilità
  commerciale né ascolti ufficiali né freschezza garantita). Nessuna
  completezza di label pubblica è pretesa finché la UI non esiste (follow-up);
  la disclosure architetturale backend (nomi neutrali + header + endpoint) è
  consentita, la pretesa UI no. Gli Anime Top 20 restano in entrambe le
  modalità (task3 disabilita esplicitamente gli anime solo per i NUOVI spazi:
  qui nessun cambio legacy/anime).
- **Coerenza rank/poster (Top-20-only):** NESSUN catalogo emette un `rk=`
  automatico e nessuna card/tile passa un rank di lista alla preview: i badge
  numerici automatici provengono SOLO dalla Top 20 generale JW (posizioni
  ufficiali 1..20; oltre la finestra nessun badge, mai clamp/remap), dalla
  Top 20 Anime (posizioni 1..20) o dalla Top 20 custom ESPLICITAMENTE
  selezionata come fonte ranking (posizioni 1..20). Le righe portano solo
  `region=` = paese della selezione; liste platform/FP/stream e custom
  ordinarie (non selezionate) non forniscono alcun rank: lo stesso titolo in
  una lista platform e nella Top 20 JW mostra il rank JW. `rk=` resta un
  parametro diagnostico/manuale valido (0..100, 0 = unranked esplicito;
  `rank=` esplicito manuale vince sempre su tutto; ranking OFF = nessun
  numero automatico). `rk=` valido, quando presente, salta i fetch live
  trend/anime; entra nella chiave cache/ETag (stesso titolo rank N vs M =
  byte distinti).

### Cataloghi streaming generici (Task F: `pictorium-stream2-*`, universo completo)

Estensione backend dell'opt-in a TUTTE le coppie Top 10 dell'indice
fp-crawler (82 service id dinamici x 119 chart-country slug totali, global
incluso, base + variant chart, `all`/mixed per le overall). Additiva: le entry legacy
(curated 8 servizi x RegionDef, `auto`, senza variant) emettono gli stessi
`pictorium-stream-*` id byte-identici; tutto il resto ottiene id
`pictorium-stream2-<service>--<slug>--<movies|series|all>--<auto|flixpatrol|justwatch>[--<variant>]`
(token `--`-delimited, mai `--` dentro i token, strict parsing, cap 160).

- **Selezione e sanitize (`streaming-catalogs.ts`, foglia client-safe):**
  `StreamingSelection` guadagna `source?` (`auto`/`flixpatrol`/`justwatch`,
  assente = `auto`, mai migrato) e `variant?` (assente/null = base chart).
  `sanitizeGenericStreamingSelections` normalizza legacy + generici
  (fail-closed: slug fuori allowlist (119 totali, global incluso) e service malformati vengono
  scartati, mai Italia; `MAX_STREAMING_SELECTIONS = 200`, bound del token);
  `legacy: true` = identico al legacy (stessi id/nomi). `parseAnyStreamingCatalogId`
  accetta entrambi; `genericStreamFamily` isola le famiglie
  `stream2:<source>:<service>:<slug>:<section>:<variant|->` (gruppo con
  hash del descrittore: source diverse non condividono mai pin/cache).
- **Paesi non-RegionDef:** chart-country slug = identità di fetch (mai
  sostituito); metadati TMDB in en-US (RegionDef invariati); JW mai tentato
  fuori RegionDef (FP-only di fatto, senza guess). Global esplicito solo per
  i nuovi opt-in (i GLOBAL legacy restano JW-only invariati).
- **Policy sorgente stretta (`chart-renewal.ts` + `flixpatrol.ts`
  `resolveGenericFlixCharts`):** match esatto `catalog_id`
  (`<service>.<cat>` base / `-<variant>`), piattaforma normalizzata
  alnum-only, categoria `movies`/`tv shows`/`overall`, stessa freschezza
  bounded per-lato. `auto` = FP hit vince con zero traffico JW, altrimenti
  JW solo se coppia own-brand verificata (servizi legacy-8 x matrice
  RegionDef, mai `all` — il mixed non mescola mai due chart JW);
  `flixpatrol` = solo chart FP reali (assente/stale = unavailable onesto,
  outage/integrità = throw → retention + gate 60s, mai fake empty);
  `justwatch` = solo JW verificato (non supportato = omesso/vuoto onesto,
  outage = throw → retention). Provenance sul pin come i legacy.
- **Righe miste:** gli snapshot `stream2:` portano `mediaType` reale per riga
  (`tmdb.media_type`); il serving (`catalog-handler.ts`, ramo dedicato PRIMA
  dell'else platform, tipo route `all` ammesso solo per id `all`) preserva
  ordine/rank/tipo senza duplicare/splittare/rinumerare; gli item film
  portano gli hint video Easy come i movie, le serie restano byte-identiche.
  Header `X-Pictorium-Source` con la stessa regola canonical-window dei
  legacy (skip/genre/live = `unknown`).
- **Discovery (`GET /api/streaming-availability` + `?source=`):** unione
  dinamica dall'indice (unico fetch, varianti raccolte per sezione, sparse);
  i duplicati legacy-identici sono soppressi (coperti dalla entry legacy);
  `flixpatrol` non emette mai potenziale `justwatch` (e viceversa),
  `justwatch` omette le coppie non supportate; le overall generano `all`
  (base + una choice per variant id) e le sezioni film/serie di coppie
  overall-only restano unavailable con `overallOnly` (mai split). Campi
  legacy invariati + additivi (`chartSlug`, `source`, `variant`,
  `variants[]`). Nomi manifest neutrali (mai claim di sorgente, zero I/O).
- **Browse read-only (`GET /api/streaming-catalog?catalog=<id>`):** proiezione
  `{ tmdbId, mediaType, title, rank, posterPath, year }` + `source` dalle
  stesse righe pinnate Stremio, arricchite via `getDetails` cachato
  (concorrenza 5, 2500ms fail-open per titolo). MAI `/api/poster`,
  mai `images`/`external_ids`/logo per titolo; chiavi con hash (mai segreti
  in chiave/risposte/log); header `X-Pictorium-Source` come i cataloghi.
- **Contratti invariati:** `streamingSelections` assente vs `[]`,
  manifest legacy, `/meta` id (`tt`/`tmdb:`), chiavi API per namespace (BYOK),
  TTL/fence di generazione, failure retention. Nessun pixel del renderer
  toccato.

### UI opt-in Top 10 (CataloghiView + CatalogManagerModal)

- **Bottone «Aggiungi Top 10»** (sezione Cataloghi, dialogo accessibile in
  3 passi): sorgente (`Automatica` / `Solo FlixPatrol` / `Solo JustWatch`,
  label visibili; la fetch va a `/api/streaming-availability?source=<...>`
  così le modalità strette portano solo id della policy richiesta, mai
  auto-id FP) → paese (solo copertura reale PER sorgente: FP reale in
  only-FP con zero fallback JW, solo-JW eleggibile con matrix verificata
  anche a indice guasto; coppie unavailable mai offerte) → multiselect
  provider per lo stesso paese (tutti i servizi disponibili dal feed
  dinamico, mai solo i curated 8; ogni riga mostra Film/Serie/Mista +
  label variant, niente split inventati delle overall, niente
  pseudo-scelte unavailable) con Seleziona/Deseleziona tutto + conteggio
  di ciò che l'Add aggiunge davvero (preview anti-duplicati verso il cap
  200) + filtri sezione opzionali (Film/Serie dove entrambe, Mista
  eleggibile quando solo overall) → Aggiungi batch (niente
  one-provider-at-a-time). Il picker paese mostra TUTTI gli slug coperti PER
  sorgente con bandiera ISO fattuale + nome localizzato nella lingua UI
  corrente (`streaming-country-display.ts`: `Intl.DisplayNames` live al cambio
  lingua, `Intl.Collator` alfabetico, GLOBAL 🌐 sempre primo col nome tradotto
  dal caller; bandiere identiche in ogni lingua, mai fallback Italia; slug
  futuri ignoti = label onesta senza bandiera). Solo display: identità fetch,
  valori API e codici persistiti restano gli slug. Scelta sezioni PER
  PROVIDER: ogni riga servizio è un gruppo accessibile (nome servizio) con
  toggle on/off del provider + UNA checkbox per ogni scelta effettiva
  (Film/Serie/Mista con label variant e disclosure sorgente); solo le scelte
  spuntate vengono inviate (mai l'intero provider, mai split inventati
  delle overall, mai unavailable). Toggle globale Seleziona/Deseleziona +
  filtri sezione restano convenienza display (i filtri nascondono senza
  mai resettare la bozza né gli altri provider; cambio paese/sorgente
  azzera solo la bozza corrente perché gli id la codificano). Conteggio
  Add = liste reali aggiungibili (duplicati/cap 200 esclusi). Errori indice
  = stato onesto + retry; `stale` = nota di best-effort. Niente prefetch:
  solo le liste scelte vengono caricate. Stessa coppia in
  paesi/sorgenti/variant diverse = identità distinte, mai merge.
- **Primo Add da spazio legacy** (selections assente): consenso esplicito —
  passare a curated nasconde le platform storiche dal manifest; senza consenso
  nessun cambio. Mai migrazione silenziosa al mount, mai auto-PUT che
  persiste valori derivati sopra l'assente.
- **Card curated** (solo selezioni abilitate): UNA SimklCard per lista
  derivata effettiva (mai group render che un trash spazza via tutto) via
  `GET /api/streaming-catalog?catalog=<id>` (stesse righe pinnate di
  Stremio: ordine + rank + media type reali) con miniature TMDB ORIGINALI
  `w185` già fornite dal componente (mai poster `/api/poster` nelle card,
  mai `images`/`logo`/`external_ids` per lista; chiave assente = avviso
  onesto, mai poster finti). Sorgente effettiva per lista dall'header
  `X-Pictorium-Source` o `response.source` (mai la sorgente attesa):
  footer SVG-ONLY accanto a `{N} titoli` a SINISTRA, Trash a DESTRA;
  `unknown` = nessun logo e nessun testo visibile (tooltip + label
  accessibile solo per sorgenti note). Nessuna pill-sorgente separata
  duplicata da heading. Le card mostrano fino a 10 miniature come JustWatch
  (stesso renderer condiviso, cap 10; la base `.simkl-list-card` è 980px
  fissi: le curated usano `--fill` fluido + `min-w-0` come la coppia JW,
  altrimenti la rail dipinge sopra la sibling; a larghezza pair la rail
  contenuta mostra ~6 con scorrimento, a tutto schermo fino a 10). Le coppie con
  descrittore identico (servizio + slug + policy + variant) rendono affiancate
  Film LEFT + Serie RIGHT nella stessa griglia del JW (`grid-cols-1
  lg:grid-cols-2`, in colonna su mobile); singoli complementari non ambigui
  (un Film + una Serie dello stesso servizio+slug+policy anche con variant
  diversa, es. Rai base Film + variant-it Serie) si appaiano allo stesso
  modo senza fondere dati/identità; `all`/miste = card fullwidth
  separate (mai fake Film/Serie) ANCHE quando il gruppo ha già la coppia
  split (mai early-return che perde sibling); singole = stessa larghezza
  dei singoli JW; ordine gruppi = catalogOrder. Click card = griglia con TUTTE le
  righe pinnate (max 10, media type reali incluse `all`); Trash non apre
  mai (click + tastiera); Click tile = editor con `tmdbId`/`media_type`
  della riga e nome effettivo lista (rinomina > neutro) come contesto
  effimero. Nomi default brevi condivisi UI/manifest (`streamingCatalogName`
  / `genericStreamingCatalogName`): SOLO emoji provider curato + servizio +
  paese localizzato + ` - Top 10` (es. `🔴 Netflix Italia - Top 10`; generici
  ignoti senza emoji mai inventata; niente bandiera paese, sezione o variant
  nel nome — tipo e variant viaggiano in badge/descrittori/ID invariati;
  showEmojis OFF spoglia via `stripCatalogEmojis`, rename esplicite verbatim).
- **Manager**: righe SOLO per cataloghi effettivamente emessi (stessa regola
  del manifest: in opt-in le platform built-in storiche non si listano —
  toggle persistono ma non sono servite; i disabilitati restano gestibili
  e il footer conta solo gli abilitati effettivi) — reorder/rename/home/
  shape esistenti invariati; Power = Hide (flag `enabled`, config
  conservata) vs Cestino = Remove di QUELLA sola lista (identità esatta
  per-section servizio+paese+sorgente+variant+sezione; sibling e altre
  entry restano; pulizia dei soli id derivati caduti da order/disabled/
  renames/home/shapes). Le due liste default JW sono toggle-only (Power,
  mai trash, mai bulk: si disabilitano ma non si eliminano; reset di
  fabbrica invariato). Bulk delete con conferma a due passi: rimuove
  atomicamente SOLO i selezionati cancellabili (liste streaming per-sezione
  in un unico writer + provider custom/addon interi SOLO se tutte le loro
  righe sono selezionate — mai una sezione di un pair; factory JW e altri
  built-in sempre esclusi, conteggio/label sui soli deletabili, disabilitato
  se zero, selezione stale potata, conferma agganciata alla firma esatta
  dei target — cambio selezione la invalida). Keywords stagionali chiuse di default
  (disclosure con aria-expanded/controls, campi montati nascosti: niente
  remount, bozze preservate).
- **Nuovi spazi**: `[]` esplicito + anime disabilitati via `disabledCatalogIds`
  (solo su evidenza positiva di spazio nuovo: fetch ok, dominio cataloghi
  vuoto su server e device blank — failure/lock/profileless-read non sono
  prova). Risultato: solo Top 20 JW generali Film/Serie.
- **JW generale**: heading neutro senza marchio; logo SOLO icona nel footer
  di OGNI box (SVG-only accanto a `{N} titoli`, mai testo/pill) e SOLO se
  QUELLO slot risolve davvero a JustWatch (per-slot, mai flag globale:
  uno slot custom non marchia custom come JW mentre lo slot JW reale
  tiene la sua icona). Niente trash sui box (le classifiche si disabilitano
  ma non si eliminano: toggle Power nel manager, reset di fabbrica
  invariato). Stato in
  `useCustomCatalogs` (singola catena PUT cataloghi, nessun secondo sistema),
  token via `useLocalConfigToken`, helper puri in
  `src/lib/streaming-catalog-client.ts`, nomi paese localizzati in
  `src/lib/streaming-country-display.ts`, i18n completa (18 lingue, niente
  hardcoded).
- **Riga pubblicazione (fatti UI, contratto T1 invariato):** OGNI card
  Cataloghi mostra sotto il footer una riga discreta con l'istante di
  pubblicazione Pictorium dello snapshot servito
  (`Aggiornato in Pictorium: <data ora>` + `Europe/Rome` breve, `<time
  dateTime>` accessibile, data/ora localizzate) oppure — senza pin genuino
  (custom/imported, legacy live, fallback TMDB, outage senza snapshot) — un
  onesto `Orario di aggiornamento non disponibile`, mai una data inventata né
  l'ora della pagina. JW generale: uno stamp per slot (Film vs Serie);
  curated: stamp della lista dal browse (`updatedAt`, già validato
  fail-closed); anime: uno stamp per slot dagli header
  `X-Pictorium-Updated-At-Movie/Series`; mai fetch/loghi/extra per la data
  (viaggia con le righe pinnate). Cache hit non ritimbra; reload rilegge lo
  stesso stamp; cambio sorgente/paese/lista azzera quello vecchio (mai
  resurrect stale). i18n completa (18 lingue, niente hardcoded).

### Anime (`pictorium-anime-movies`, `pictorium-anime`)
`fetchMDBList(listKey, key)` — usa `mdblistAnimeMovie` per i film anime e `mdblistAnime`
per le serie (cache sorgente 12 ore, 60 s sui vuoti). Funziona sia con chiave MDBList sia con endpoint pubblico JSON di fallback.
Risolve i dettagli TMDB e deduplica per `tmdbId`.

**Anime sempre alla fine** (`partitionAnimeCatalogsLast` in `catalog-definitions.ts`,
applicata DOPO filtri e ordinamento in manifest e manager; la pagina Cataloghi
le rende strutturalmente ultime): SOLO i due id built-in canonici (+ alias
legacy `posterium-*` normalizzati) — mai provider/servizi/nomi custom. I
disabilitati restano esclusi (nessun resurrect), l'ordine relativo utente è
preservato dentro e fuori il gruppo anime, nessun duplicato.

## Fonte ranking Top 20 (`rankingSourceMovie` / `rankingSourceSeries`)

I cataloghi globali `pictorium-jw-movies` / `pictorium-jw-series` e i badge
classifica (poster, preview, `/api/trending/rank`) possono usare JustWatch
(default retrocompatibile) oppure una lista importata come fonte ranking. La
selezione vive in `ServerDefaults` + config token (stringa vuota = override JW
esplicito, max 160 caratteri = cap dell'id streaming derivato); il manifest
mostra il nome effettivo della lista al posto di "JustWatch" e la UI la
configura in CataloghiView (due dropdown Film/Serie).

Fonti ammesse:

- catalogo custom importato: solo custom abilitati e compatibili per tipo
  (`mixed` vale per entrambi);
- Top 10 streaming caricata in Pictorium (`streamingSelections`): id derivato
  (`pictorium-stream-*` legacy o `pictorium-stream2-*`) di una selezione
  ABILITATA e compatibile per sezione (`movies`→Film, `series`→Serie, `all`
  mista→entrambi). La lista video e le platform built-in storiche (modalità
  legacy senza `streamingSelections`) NON sono fonti ranking: nessuna
  selezione da abilitare/disabilitare lì;
- catalogo importato da addon Stremio (`customCatalogs[].addon`): abilitato e
  compatibile per lo slot con il tipo REALE del catalogo remoto
  (`addon.catalogType`), mai con il solo tipo locale; lo stesso manifest può
  esporre più cataloghi e resta una fonte distinta per ciascuno. La richiesta
  ranking è fissa (nessuna search/genre), quindi un extra OBBLIGATORIO diverso
  da `skip` rende la lista non selezionabile (fail-closed, mai una lista che
  non può essere letta).

- Puro: `resolveRankingSource()` in `lib/ranking-source.ts` (foglia
  client-safe, riusata da UI e server) — id eliminato, spento
  (`enabled === false`), sezione/tipo remoto incompatibile o non appartenente
  alle selezioni streaming dello spazio → JustWatch, mai errori.
- Recupero: `fetchCustomRankingTop20()` in `lib/custom-ranking.ts`, unica
  funzione per cataloghi/badge/poster — filtro per tipo, risoluzione
  IMDb/TVDB→TMDB, dedup, STOP alle prime 20 posizioni valide (niente filler
  JW, pagine oltre la Top 20 vuote). Errori provider → stato esplicito, mai
  fallback silenzioso; solo `ok` con item va in cache (30 min, tag
  `custom_catalogs`, chiave con hash di selezione/credenziali/namespace).
- Recupero streaming: `fetchStreamingRanking()` in `lib/streaming-ranking.ts`
  risolve la STESSA famiglia pinnata che serve la lista (`stream:<service>:
  <movie|series>` per i legacy, `stream2:*` per i generici, gruppo = paese
  della selezione) via `ensureFreshChartFamily` — un solo snapshot per
  catalogo/preview/badge/poster, senza una seconda classifica indipendente;
  il rinnovo usa la policy FP/JW della lista selezionata, mai il JW generale.
  Le posizioni sono quelle ufficiali della chart Top 10 (1..10): mai
  rinumerate, mai clampate, mai posizioni 11..20 inventate; nelle chart miste
  il filtro per slot preserva i rank reali (possono saltare). Snapshot
  assente (cold failure) = stato `error` esplicito (notice nel catalogo,
  502 nel rank route), mai una sostituzione JW; snapshot `empty` = vuoto
  genuino.
- Recupero addon: `fetchAddonRanking()` in `lib/addon-ranking.ts` rilegge la
  STESSA pagina remota del passthrough addon via `fetchAddonCatalogPage`
  (SSRF-safe, namespace e guard self esistenti), con identità del catalogo
  remoto effettivo (`manifestUrl` + `catalogId` + `catalogType`) nei cache
  key. Conserva ordine e posizioni reali: gli ID non risolvibili si
  scartano senza rinumerare (nessun backfill). Window: 10 righe = Top 10,
  altrimenti prime 20 posizioni (mai dedotto dal nome); nelle fonti miste
  vale il `type` reale della riga. Solo ID già sicuri/risolvibili
  (`tmdb:`/numerico, `tt`/`tvdb` via `/find` condiviso) e nessun details
  fetch. Chiave mancante o fetch fallito = stato `error` esplicito, mai
  cacheato; il TTL `ok`/`empty` (massimo 10 min / 60 s) è limitato dalla
  scadenza assoluta della pagina remota, senza rinnovare un cache hit vecchio.
  Questa scadenza limita anche catalogo globale, rank, poster e preview; il
  catalogo addon selezionato condivide namespace e validità della pagina.
  L'abort del chiamante raggiunge il fetch remoto; gli ID TVDB usano `/find`
  di TMDB con la chiave TMDB, senza richiedere una chiave TVDB.
- Badge: il rank della lista viaggia sul canale `trendRank` con lo stesso
  contratto del custom (label Film/Serie e nome lista); fuori Top 20 o in
  errore nessun badge, mai rank JW. Piattaforme e anime invariati. Le chiavi
  API non entrano mai nei poster URL (solo server-side). Il badge legge il
  rank dal pin streaming e il freshness cap segue la fine slot della famiglia
  (6h `stream2:justwatch:*` / 12h altre), non un TTL fisso.
- Coerenza cache: il catalogo JW con fonte streaming pinna la famiglia PRIMA
  della cache key (fence `:cg`) e include `:rss<hash id>` + TTL di fine slot,
  così un publish invalida subito i ready body e due liste diverse non
  condividono mai il body.
- Spazi senza namespace (local-only/profileless): la selezione viaggia in un
  token firmato `?config=` coniato da `POST /api/config-token` (payload anche
  solo cataloghi: il server completa i visual dai defaults). Le esclusioni
  automatiche space-wide (`disabledContentTags`/`disabledNetworks`, sentinel
  TMDB-fallback incluso) viaggiano nello STESSO token catalog-only con le
  scelte staged/salvate del device (`useLocalConfigToken` le porta sempre,
  anche come `[]` esplicito che azzera i defaults d'istanza; il server
  compone il device DOPO l'istanza e risanitizza). Preview, rank e
  template/poster di install lo includono solo lì (altrove URL identici).
  L'install Stremio da link con token serve cataloghi/poster custom omonimi.
- Cache chiavi catalogo: frammento `:rs<hash>` SOLO sui globali JW così il
  cambio selezione non invalida piattaforme/anime; poster ed ETag seguono già
  via `sdHash`/`configHash`. `/api/trending/rank` custom risponde
  `private, no-cache` (l'URL non cambia con la selezione), JW resta `public`.

## Cicli fissi delle classifiche built-in (`chart-generation.ts` + `chart-renewal.ts`)

Le sorgenti built-in (chart JW giornalieri/popolari/trending, chart piattaforme
JW/FlixPatrol, liste anime MDBList) rinnovano su cadenza fissa portabile
**Europe/Rome 00/06/12/18 per le famiglie JustWatch, 00/12 per tutte le
altre** (DST-aware, indipendente dal timezone del server),
NON su TTL rolling per-entry. La cadenza è per NOME famiglia (selection
policy): `jw:{movie|series}:{charts,popular,trending}` e `stream2:justwatch:*`
a 6h; legacy `stream:`, `platform:`, `stream2:auto|flixpatrol` e `anime:` a 12h. I pin vecchi migrano senza flush. Il rinnovo è INDIPENDENTE per famiglia canonica
(`jw:{movie|series}:{charts|popular|trending}`, `platform:<key>:{movie|series}`,
`anime:{movie|series}`): nessuna barriera all-source, nessun inventario globale.
Implementazione in `src/lib/chart-generation.ts` (pin/publish atomico per
famiglia) + `src/lib/chart-renewal.ts` (`ensureFreshChartFamily`: refresh
awaited riusabile di un trigger schedulato esterno opzionale —
`scripts/chart-warmup.mjs`, guida operatore in `docs/chart-warmup.md`:
one-shot/watch che visita le sole prime pagine built-in via manifest/catalog
GET pubblici, off by default; il lazy renewal resta il fallback invariato).

- **Refresh per-famiglia**: dopo il boundary il pin della famiglia resta
  stantio e UNA richiesta al suo catalogo/rank la rinfresca (awaited, bounded
  dai timeout interni delle sorgenti; niente fetch che sopravvivono al
  lifecycle, niente scheduler, niente fire-and-forget). Una sola famiglia per
  richiesta: mai platform/anime/modi non correlati. Finestre non-canoniche
  (skip/genre oltre la prima pagina, `first` diverso da 20 nel rank) NON
  rinfrescano: pin read-only + contenuto live. Keyless JW (notice) e generi
  non mappati (vuoto fail-closed) fanno zero I/O chart. Il failure gate (60s
  dopo un errore) salta il refresh.
- **Gruppo**: famiglie JW/piattaforme = `(region.code, region.lang)` SOLO —
  i loro fetch non portano credenziali, quindi chiavi TMDB/MDBList non devono
  MAI partizionarle (keyed e pubblico condividono le stesse righe). Famiglie
  anime = `(region.code, region.lang, hash-chiave-MDBList-effettiva)` (keyed vs
  pubblico mai mescolati). Mai segreti in snapshot/chiavi/log/URL (solo hash).
  Pin/coalescing/chiavi isolano gruppo esatto + generazione su TUTTI i
  consumer (cataloghi, rank, mdblist/anime, preflight poster — custom/search/
  addon esclusi da ogni I/O chart).
- **Cycle-aware source refresh**: le cache sorgenti in-scope (JW 6h, MDBList,
  FlixPatrol) accettano un floor `minFetchedAtMs` = inizio slot corrente:
  entry pre-boundary vengono rifetchate davvero (mai relabel di `Date.now` su
  payload vecchi), mai timbrate come fresche in-slot. Le entry in-slot e le
  cache indipendenti di quality/availability JW restano intatte. Quality/
  availability e custom invariati.
- **Publish atomica per famiglia**: la famiglia pubblica quando IL SUO fetch
  riesce (MDBList down blocca solo l'anime; JW/piattaforme procedono). Una
  lettura zero-row RIUSCITA è un empty genuino del ciclo e pubblica uno
  snapshot `empty` su OGNI famiglia (il miss resta null, mai resurrect del
  rank salvato); solo il fallimento di trasporto (HTTP !ok, payload invalido,
  abort, circuito aperto — gli adapter strict lanciano, mai `[]` conflati)
  blocca il publish. Commit guardato atomico: su KV script Lua unico
  (lease-owner + generation-pointer correnti verificati server-side); su file
  single-process mutex per-famiglia + check dello stale-owner + recheck di
  generazione (un write ritardato non atterra mai dopo una publish più nuova,
  anche se la lease è scaduta). Lease single-owner non-bloccante (i
  concorrenti servono il pin vecchio, mai attesa); rigetto out-of-order (slot
  vecchio dopo publish nuova). Qualsiasi esito non-`ok` (stale/error/throw)
  NON marca la memoria: nessuna publication privata, resta l'ultimo snapshot
  buono (o live a freddo). Provenance piattaforma (`justwatch`/`flixpatrol`)
  registrata nello snapshot (ordine/righe fanno fede): le piattaforme rinnovano FP-first per lato.
  Rollout senza flush: i pin JW persistiti restano validi fino al boundary successivo (poi rinfrescano FP-first).
  La provenance distingue le generazioni: nessuna chiave esistente mente sulla sorgente, nessun bump di versione serve.
- **Strict cutover cross-instance**: il pin rivalida SEMPRE lo storage durevole
  (single source of truth; memoria solo fallback su errore): una publish di
  un'altra istanza invalida subito le vecchie chiavi ready (`:cg` fence).
  Multi-istanza richiede KV/Redis (il file multi-process resta best-effort e
  NON è garanzia accettata — vedi header di `chart-generation.ts`).
- **Failure retention**: errore/outage di trasporto (HTTP !ok, payload invalido,
  abort, circuito aperto — gli adapter strict lanciano, mai `[]` conflati;
  un error-negative in cache non vale mai come empty per i caller strict)
  blocca il publish della famiglia e conserva l'ultimo snapshot buono; retry
  non prima di 60s. Una lettura zero-row RIUSCITA pubblica invece uno
  snapshot `empty` (il miss resta null, mai resurrect del rank salvato). A
  freddo (mai pubblicato) il primo fetch riuscito pubblica subito; in
  fallimento le richieste servono live/fallback storici (mai snapshot
  parziali). Le piattaforme con snapshot canonico VUOTO lo servono vuoto
  (niente fallback live FlixPatrol che resusciterebbe righe ritirate). Il
  poster su cold failure degrada al rank salvato (contratto charts storico);
  un miss genuino resta null. Il poster pinna SOLO le famiglie necessarie
  (niente I/O chart con ranking spento, rank esplicito o sorgente custom per
  il ramo JW; l'anime resta indipendente anche con custom selezionato).
- **Coerenza (coherence over speed)**: dopo un publish, i ready body vecchi non
  sono MAI serviti — le chiavi catalogo/rank portano `:cg<generation>` (+
  `:g<gruppo>` per l'isolamento credenziali); la publish invalida per chiave,
  senza prewarm delle varianti (users×regioni×generi×skip non precomputate).
  Ogni richiesta pinna UNA famiglia e non mescola mai snapshot di due
  generazioni; catalogo e badge leggono le STESSE righe pubblicate (stesso
  ordine + stessi rank; oltre la Top 20 nessun rank window-local inventato:
  la prima pagina canonica viene dalle righe pubblicate). Skip/genre oltre le
  finestre canoniche restano live in-slot-fresh (stessa forma di oggi: finestra
  live + snapshot canonico per la mappa rank). Titoli/anni anime preservati
  negli snapshot (fallback catalogo senza TMDB).
- **Ready body con fine famiglia**: i ready body non-vuoti delle finestre canoniche
  in-scope si riusano fino alla FINE DEL PINNED SLOT della famiglia (6h JW vs
  12h legacy, mai un blind 12h), fenced dalla generazione pubblicata (il rinnovo
  invalida subito); stesso slot servito fino al boundary anche se le cache
  rolling sottostanti scadono (zero churn in-slot). Esclusi (custom/search/
  addon/varianti), vuoti ed errori: TTL storici invariati (1h, 60s).
- **Persistenza**: KV (`chartfam:pub/pubgen/meta/lease`, EX bounded 7d)
  quando configurato, file atomici `chartfam-*` in `DATA_DIR` altrimenti
  (single-process esatti), memoria sotto Vitest (`noop`). Snapshot pubblicati
  conservati 7 giorni su entrambi i backend (KV TTL + sweep file oltre 7d a
  parità; meta/gate a 36h): retention finita, e una famiglia in outage non
  viene mai garbage-collected dal publish di un'altra. Snapshot bounded
  (rank rows, mai dettagli TMDB né chiavi; cap 512KB, anime ≤500, piattaforme
  ≤10, chart/popular/trending ≤20). Failure KV/file = fail-open
  (memoria/live). Restart e cross-istanza ricaricano il published.
- **Lettori**: cataloghi built-in (`catalog-handler.ts`), `/api/trending/rank`
  (fence `:cg` + gruppo, custom escluso), preflight poster (rank dallo
  snapshot + fallback salvato su cold failure; chiavi coalescing con versione
  snapshot; cap freshness a fine-slot di famiglia), `/api/mdblist/anime` (chiave con
  gruppo + generazioni famiglie). Esclusi (invariati): custom/search/addon,
  quality/availability JW indipendenti, proxy TMDB-trending, diagnostica
  `/api/mdblist`, warmup (finestre non canoniche: riscalda le cache esistenti,
  non pubblica; si sveglia ai boundary 00/12, le 06/18 JW rinnovano lazy alla
  prima richiesta), route diagnostica `/api/flixpatrol/top10` (proxy FP live per
  la UI editor, fuori dal path di consegna Stremio).
- **Timestamp di pubblicazione (`updatedAt`, contratto T1 per la UI del follow-up)**:
  `snapshot.publishedAt` (ms epoch) dello snapshot SERVITO — pubblicazione
  Pictorium, MAI l'update della sorgente (non la chart-date fp-crawler), MAI
  l'ora della richiesta/pagina. `/api/tmdb/trending` → oggetto `updatedAt:
  {movie, series}` (null senza pin genuino: custom/unsupported/cold); browse
  read-only `/api/streaming-catalog` → singolo `updatedAt` (stessa chiave
  fenced `:cg`); `/api/mdblist/anime` → header `X-Pictorium-Updated-At`
  (body array invariato; assente senza pin; con entrambe le famiglie vale il
  minimo). Cache hit NON ritimbra; outage con last-good conserva lo stamp
  vecchio; un empty genuino pubblicato porta il suo stamp nuovo; legacy/custom
  senza snapshot non mintano mai (`null`/assente). Zero fetch extra (TMDB/JW):
  viaggia con le righe pinnate. Nessun segreto/namespace negli stamp.

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

- Navigazione video solo film (parità Easy Catalogs): le preview movie
  espongono `behaviorHints: { defaultVideoId: <id emesso>, hasScheduledVideos: false }`
  e `videos: []` (stessa shape di Easy); `/meta` movie espone gli stessi campi
  (`defaultVideoId` = `primaryId` esistente: id IMDb valido nel caso normale,
  fallback tipato `tmdb:<id>`). Le serie restano byte-identiche
  (episodi/videos e nessun hint film). I cataloghi addon preservano il
  passthrough remoto (nessun hint sintetico).

- Cache catalogo (`cacheSet`/`cacheGet` in `lib/cache.ts`): key include tipo,
  `catalogId`, `POSTER_URL_VERSION`, hash `config` e hash `mdblist_key`.
  La key è `stremio:catalog:v4` (v4 con hints video film: le entry v3 senza
  `behaviorHints`/`videos:[]` non vengono più lette e scadono naturalmente;
  le chiavi search dedicate portano il frammento `:idv2` (v2 = id IMDb-first
  via external_ids + hints film: le entry pre-fix non vengono più lette e
  scadono col TTL breve da 10 min).
  TTL: 1h dalla generazione per il catalogo **non vuoto** (TTL esplicito, vince
  sul refresh schedulato del tag `catalog`); catalogo **vuoto** → 60 s.
- Cache meta (`meta-handler.ts`): key include `episodeGroupId:updatedAt` del
  mapping (film e serie) così save poster/ordinamento invalidano anche
  cross-instance; frammento `:mhv1` (hints video film: le entry pre-fix senza
  `hasScheduledVideos`/`videos:[]` non vengono più lette e scadono col TTL);
  TTL 12h.
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
  Stesso titolo in altra lista = invariato; nessun default globale; il
  `/meta` generico resta senza contesto (byte-identico): accetta un `theme=`
  esplicito solo come contesto effimero lista/test Stremio («Testa URL
  Stremio»), su entrambi i canvas con isolamento cache (`:th<tema>` in
  chiave meta; `shape` già in chiave poster a sé).

  **Parole chiave custom (per utente, bounded):** oltre ai built-in, ogni
  spazio può definire fino a 20 parole/frasi per tema
  (`seasonalHalloweenKeywords` / `seasonalChristmasKeywords` in
  `ServerDefaults`, max 40 caratteri l'una): stesso match whole-word/phrase
  sui soli nomi lista (mai titoli, mai regex — i metacaratteri valgono
  letterali; la precedenza Halloween resta, built-in sempre conservati).
  Persistite come gli altri record catalogo (PUT `/api/defaults` +
  localStorage + token config catalog-only per gli spazi
  local-only/profileless); sanitize a ogni scrittura/lettura
  (`sanitizeSeasonalCustomKeywords` in `seasonal-theme.ts`). Server
  (`resolveCatalogSeasonalTheme(..., { seasonalKeywords })`) e client
  (`navigateToPoster(item, src, listName, seasonalKeywords)`) usano lo
  stesso matcher/leaf. Il cambio ruota le chiavi via `sdHash` (defaults) o
  `cfg` (token); nessun frammento extra (il per-titolo viaggia via mapping).

  **Scelta per-titolo (Automatica/Nessuna/Halloween/Natale):** campo flat
  `seasonalTheme` nel mapping (`"halloween"`/`"christmas"`/`"none"`/assente,
  condiviso tra i formati — nessun profilo `landscape`). Esplicita a tema
  vince sul contesto lista e segue il titolo ovunque nei percorsi non-preview (cataloghi + meta +
  URL Stremio via `resolveEffectiveSeasonalTheme`); in preview effettiva autorizzata il `theme=` staged vince sul mapping salvato (mai resurrect); `none`
  esplicito sopprime un tema ereditato; assente = Automatica (segue la
  lista). Editor: selettore in `BadgeControls` (+ `theme=` effettivo in
  preview); copertina-only la azzera (contratto stili). Cache sicura:
  versione mapping (`mv`/`updatedAt`) distingue le scelte a parità di
  query; il banner pulito resta sempre senza tema.
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
- Non usare l'id emesso (`tt`, potenzialmente condiviso tra entry split) per
  dedup/selezione: dedup, mapping salvati e poster URL restano sul tmdbId numerico.
- Non rimuovere il passaggio della chiave della richiesta in `resolveImdbId`.
- Non hardcoddare nuovi cataloghi nel route: aggiungili a `PICTORIUM_CATALOGS` (e a
  `WARMUP_CATALOG_IDS` se devono essere preriscaldati).

## File coinvolti

- `src/lib/catalog-definitions.ts` — elenco cataloghi + warmup
- `src/lib/streaming-catalogs.ts` — selezioni streaming opt-in (foglia client-safe: servizi, ID legacy + generici `stream2-*`, sanitize, nomi neutrali, gate JW, policy source)
- `src/lib/streaming-availability.ts` — indice FP availability (server-only, base + variant) + `GET /api/streaming-availability` (filtri `service`/`country`/`section`/`source`)
- `src/app/api/streaming-availability/route.ts` — route discovery read-only
- `src/app/api/streaming-catalog/route.ts` — browse read-only (proiezione TMDB originale, zero renderer)
- `src/lib/catalog-handler.ts` — `pictoriumCatalog(req, mediaType, rawId, userParam, configParam)` (logica unica). `userParam` (param `u=`/`user`) è il profilo UUID: entra nel cache key come `:u<uuid>` e nei poster URL come `user` (`&u=`). `configParam` è il config token (`config=`).
- `src/lib/ranking-source.ts` — selezione fonte Top 20 (pura, client-safe)
- `src/lib/custom-ranking.ts` — Top 20 da lista custom (unica funzione condivisa)
- `src/lib/streaming-ranking.ts` — Top 10 di una lista streaming come fonte ranking (pin condiviso, rank ufficiali 1..10)
- `src/lib/addon-ranking.ts` — Top 10/20 di un catalogo addon importato come fonte ranking (pagina remota condivisa, posizioni reali)
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
