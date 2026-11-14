# Pictorium — Configurazione

[← Torna al README](../README.it.md) · [🇬🇧 English](CONFIGURATION.md)

## 🔑 Configurazione

Tutte le variabili usano il prefisso `PICTORIUM_*`. I vecchi nomi `POSTERIUM_*` restano accettati come fallback (con warning di deprecazione una tantum); `PICTORIUM_*` vince sempre. I valori sono letti a livello di modulo, quindi cambiare una variabile richiede un restart. Le richieste scoped `?u=` non ricadono mai sulle chiavi d'istanza.

### Essenziali

| Variabile | Default | Descrizione |
|---|:---:|---|
| `PICTORIUM_ADMIN_TOKEN` | *(opzionale)* | Segreto per istanze private: incollalo in Impostazioni → Token admin (solo sessione, muore col tab) per abilitare warmup, svuotamento cache e salvataggi dalla UI. Senza (e senza sessione PIN) le route admin rispondono 401. |
| `PICTORIUM_TMDB_KEY` | *(opzionale)* | Chiave TMDB v3 d'istanza per poster e cataloghi. In alternativa salva le chiavi dall'app: finiscono in uno store cifrato (AES-256-GCM, `0600`) che le richieste Stremio anonime risolvono senza env. |
| `PICTORIUM_REGION` | `IT` | Nazione predefinita per classifiche e disponibilità streaming (`IT`, `US`, `GB`, `FR`, `DE`, `ES`, …). |
| `PICTORIUM_DATA_DIR` | `./data` | Cartella per configurazioni, poster salvati e cache locali. In Docker deve puntare al volume persistente (`/data`, scrivibile da uid 1000). Il file nasce al primo save, quindi "not found" con 0 poster a installazione fresca è normale. |
| `PICTORIUM_REDIS_URL` | *(vuoto)* | Redis nativo (TCP) per HA multi-replica senza volume `/data`. Vince su Upstash REST se entrambi sono settati (nessuna migrazione automatica). Su Kubernetes è letto anche il semplice `REDIS_URL`. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | *(vuoto)* | Credenziali Upstash REST canoniche per deploy serverless. I nomi legacy iniettati da Vercel `KV_REST_API_URL` / `KV_REST_API_TOKEN` portano le stesse credenziali e sono accettati con warning di deprecazione. |
| `PICTORIUM_KV_CACHE` | *(attiva con KV)* | Con Redis/KV, `0` tiene la cache delle risposte solo in memoria (lo stato resta su KV). Utile sulle istanze pubbliche; sconsigliato su serverless. |
| `PICTORIUM_IMAGE_FORMAT` | `webp` | Formato poster per i client che non dichiarano preferenze: `webp` (~25–30% più leggero a pari qualità) o `jpeg` (universale, per client datati). `?fmt=` resta override per richiesta nei due sensi. Richiede restart; il cambio invalida la cache una volta sola. |
| `PICTORIUM_HOSTED_BY` | *(vuoto)* | Sponsor/hosting pubblico: `elfhosted` mostra il banner ElfHosted (rilevamento automatico da host `elfhosted.com`). Vuoto = nessun banner. |
| `PICTORIUM_DUCKDNS_NOTICE` | *(vuoto)* | `1` mostra il banner dismissibile "questa istanza chiude" (l'avviso una tantum del deployment DuckDNS). Solo env, nessun rilevamento hostname. `NEXT_PUBLIC_DUCKDNS_NOTICE` è accettata come alias. |
| ~~`PICTORIUM_PUBLIC_INSTANCE`~~ | *(rimossa)* | Vecchio switch, non più letto: se ancora impostato viene ignorato e non apre nulla. Le route admin sono sempre fail-closed senza token o sessione PIN. |

### Chiavi API e provider

| Variabile | Default | Descrizione |
|---|:---:|---|
| `PICTORIUM_TVDB_API_KEY` | *(opzionale)* | Chiave TheTVDB per ordinamenti stagioni alternativi, descrizioni episodi e liste TheTVDB (BYOK: header, query `tvdb_key` o chiave del profilo vincono su questa). |
| `PICTORIUM_MDBLIST_KEY` | *(opzionale)* | Chiave MDBList per liste personalizzate, cataloghi anime e rating aggregati. |
| `PICTORIUM_FANART_KEY` | *(opzionale)* | Chiave progetto Fanart.tv per la sezione poster verticali nell'editor (solo server, mai esposta al browser). Senza, la sezione spiega che non è configurata. |
| `PICTORIUM_RATING_MIN_VOTES` | `10` | Numero minimo di voti per fonte per i rating aggregati MDBList: le fonti con `votes` note sotto questa soglia vengono escluse; `0` disattiva il filtro. Conteggi assenti/malformati restano sempre; RogerEbert è esente. |
| `PICTORIUM_TRAKT_CLIENT_ID` | *(opzionale)* | Client ID API Trakt (registrazione app Pictorium unica) per le liste pubbliche come cataloghi custom e per l'OAuth per-spazio (PKCE, senza secret). |
| `PICTORIUM_TRAKT_REDIRECT_URI` | *(opzionale)* | URI di redirect OAuth esatta registrata nella dashboard Trakt (il path è sempre `/api/trakt/callback`, es. `https://your-instance/api/trakt/callback`). Mai derivata dalla richiesta. |
| `PICTORIUM_CUSTOM_RATING_*` | *(non impostate)* | Provider voti personalizzato (`_ENABLED`, `_ENDPOINT`, `_API_KEY`, `_API_KEY_HEADER`) più `PICTORIUM_CUSTOM_RATINGS` per la riga predefinita. Endpoint e header si possono impostare anche dall'editor; la chiave è solo env. Vedi [docs/custom-rating.md](custom-rating.md). |
| `PICTORIUM_EPISODE_RATINGS_PROVIDER` | `showgrid` | Fonte ★ per episodio nelle miniature TV: `showgrid` (poll IMDb per-episodio via ShowGrid, poi voto episodio TMDB), `tmdb`/`off` (solo voto episodio TMDB), oppure `seriesgraph`/`dataset` in opt-in. |
| `PICTORIUM_SHOWGRID_URL` | *(non impostata)* | Override opzionale dell'origin http(s) per l'API ShowGrid predefinita (default `https://api.theshowgrid.com`; lo stesso override serve il mock E2E deterministico). |
| `PICTORIUM_NON_COMMERCIAL_ACK` | *(non impostata)* | `1` conferma il permesso non commerciale richiesto dai provider opt-in `seriesgraph`/`dataset`. Nessun effetto sulla fonte ShowGrid predefinita. |
| `PICTORIUM_SERIESGRAPH_URL` | *(non impostata)* | Endpoint del provider opt-in SeriesGraph. Richiesto con `PICTORIUM_EPISODE_RATINGS_PROVIDER=seriesgraph`; spedito come stub fail-closed (nessun fetch) finché non esiste un consenso scritto. |
| `PICTORIUM_IMDB_DATASET_URL` | *(non impostata)* | Percorso http(s) assoluto di un dataset episodi IMDb con licenza per il provider opt-in `dataset`; spedito come stub fail-closed (nessuna importazione). |

> [!NOTE]
> **Rating episodi.** ShowGrid è attivo di default per una decisione esplicita dell'operatore che accetta il rischio di terze parti: non ha licenza e il permesso del provider è ancora in sospeso (cache 12h, fail-open sul voto TMDB). I provider opt-in sono fail-closed: senza `PICTORIUM_NON_COMMERCIAL_ACK=1` e il loro URL loggano un warning e ripiegano su ShowGrid. Cinemeta non è più consultato sul percorso episodi (i valori legacy `cinemeta`/`imdb` sono alias di ShowGrid); i rating dei titoli continuano a usare Cinemeta.
>
> **Quota MDBList.** La quota giornaliera è per account, condivisa tra chiavi e app; le chiamate rating senza chiave vengono saltate (restano i fallback Cinemeta/nativi).
>
> **Trakt OAuth.** Una sola registrazione app Trakt per istanza (client ID + redirect URI, NESSUN client secret: le nuove app Trakt usano PKCE e non ricevono secret — un `PICTORIUM_TRAKT_CLIENT_SECRET` residuo viene ignorato, rimuovilo). Gli utenti collegano il proprio account da Impostazioni → Spazio; Pictorium importa solo la watchlist e le liste standard private, in sola lettura (nessuna scrittura, nessuna cronologia, Smart Lists non supportate). I token sono cifrati con `PROFILE_ENCRYPTION_KEY` su storage persistente; senza persistenza le connessioni si perdono al restart. Disconnect elimina i token locali (verificato, fenced) ma la revoca upstream è best-effort: per revocare davvero l'accesso rimuovi anche l'app da https://trakt.tv/settings/apps.

### Hardening per hosting condiviso

| Variabile | Default | Descrizione |
|---|:---:|---|
| `PICTORIUM_POSTER_PARAMS` | *(auto)* | `presets` limita le richieste non-preview a un set finito di render (allowlist cache key, step 5/10/5px, `ac` solo palette, niente free-text/override keyless anonimi); `free` è il comportamento storico. Auto-`presets` su hosting condiviso (`HOSTED_BY=elfhosted` o `MULTI_USER=1`); la preview WYSIWYG resta live negli spazi utente e nelle sessioni sbloccate. |
| `PICTORIUM_PREVIEW_AUTH` | *(auto)* | Su hosting condiviso le preview anonime (`preview=1` senza spazio né sessione) vengono declassate e cachate come normali richieste (niente bypass bot). Spazi utente e sessioni sbloccate restano live. `0` forza OFF, `1` forza ON; nessun effetto sulle istanze private. |
| `PICTORIUM_PROXY_ALLOW_DOMAINS` | *(private: aperto; condivise: deny)* | Allowlist comma-separated di host (sottodomini inclusi) che il proxy addon può contattare. Su istanze condivise una lista non impostata è default-deny: un'istanza pubblica non deve essere un open relay. Le istanze private self-hosted mantengono il comportamento aperto storico. |
| `PICTORIUM_PROXY_ALLOW_ANY` | `0` | **Pericolosa, mai su istanza pubblica**: riapre il proxy addon a qualsiasi host quando non c'è allowlist (open relay / SSRF-by-proxy per chiamanti anonimi). Preferisci `PICTORIUM_PROXY_ALLOW_DOMAINS`. |
| `PICTORIUM_TRUST_PROXY` | `0` | Imposta `1` **solo** dietro un reverse proxy/Cloudflare che sovrascrive gli header di IP client: abilita `cf-connecting-ip` (preferito) / `x-real-ip` / primo hop `x-forwarded-for` per le chiavi di rate-limit. Senza un proxy fidato questi header sono falsificabili, quindi di default non ne viene letto nessuno e i chiamanti anonimi condividono un unico bucket (`local`). |
| `PICTORIUM_CLIENT_IP_HEADER` | *(vuoto)* | Con `TRUST_PROXY=1`, fida esattamente un header (es. `cf-connecting-ip` dietro Cloudflare). Deve portare un solo valore impostato dal proxy: nomi con virgole o invalidi vengono rifiutati con un warning una tantum. |
| `PICTORIUM_ALLOWED_HOSTS` | *(vuoto)* | Hostname pubblici comma-separated fidati come `X-Forwarded-Host` dal controllo same-origin (CSRF). Lascia vuoto salvo che un proxy inoltri un host diverso dall'`Host` della richiesta. |
| `PICTORIUM_RATELIMIT_POSTER_MAX` | `200` | Budget burst del bucket rate-limit dei poster (accettati 10–10000; valori invalidi ricadono su `200`). |
| `PICTORIUM_FRAME_ANCESTORS` | *(default HF)* | Sovrascrive i `frame-ancestors` CSP (default compatibile con HF Spaces). Es. `'self'` per istanze pubbliche che non devono essere embeddate. |

### Multi-utente

| Variabile | Default | Descrizione |
|---|:---:|---|
| `CONFIG_HMAC_SECRET` | *(vuoto)* | Chiave HMAC che firma i link `?config=`/`/c/<config>/` di condivisione e installazione. Obbligatoria in produzione: senza, i token non firmati vengono rifiutati (fail-closed). Accettata anche come `ENCRYPTION_KEY_SECRET`. |
| `PICTORIUM_MULTI_USER` | `0` | Se `1`, abilita gli spazi isolati per utenti su `/u/<uuid>/configure`. La card PIN d'istanza e lo store chiavi API d'istanza vengono nascosti: ogni spazio usa la propria password di sessione e le proprie chiavi, mentre le impostazioni d'istanza si sbloccano con `PICTORIUM_ADMIN_TOKEN`. |
| `PROFILE_ENCRYPTION_KEY` | *(vuoto)* | **Obbligatoria** con `MULTI_USER=1`. Chiave hex a 64 caratteri (AES-256-GCM, genera con `openssl rand -hex 32`). Impostala una volta e conservala: ruotarla rende illeggibili le chiavi API e i token Trakt salvati finché non vengono reinseriti. |
| `PICTORIUM_MAX_MAPPINGS_PER_USER` | `500` | Numero massimo di poster salvabili per ogni spazio utente. |
| `PICTORIUM_MAX_USERS` | *(illimitato)* | Limite massimo di spazi utente creabili. Il default illimitato è mantenuto per compatibilità (istanze esistenti possono già superare qualsiasi tetto fisso); **su istanze pubbliche imposta un valore esplicito** per limitare la creazione di spazi. |
| `PICTORIUM_PUBLIC_STATS` | `1` | Imposta `0` per restituire i conteggi utenti di `/api/status` solo agli admin (la striscia "spazi" in home resta nascosta ai visitatori). |

<details>
<summary><strong>Stili di rendering predefiniti</strong></summary>

| Variabile | Default | Descrizione |
|---|:---:|---|
| `PICTORIUM_BADGE_STYLE` | `shadow` | Stile badge genere & voto: `shadow`, `pill`, `bar`, `colored`, `bordo`, `vetro`, `minimal`, `ink`. |
| `PICTORIUM_RANKING_BADGE_STYLE` | `default` | Stile badge delle classifiche (`default`, `bar`, `colored`, `pill`, `netflix`). |
| `PICTORIUM_RIBBON_SIDE` | `left` | Lato del nastro Netflix Top 10 (`left` / `right`). |
| `PICTORIUM_RIBBON_ENABLED` | `1` | `1` = nastro all'angolo, `0` = badge classifica centrato. |
| `PICTORIUM_BLUR_ENABLED` | `1` | Attiva o disattiva lo sfondo sfocato cinematografico. |
| `PICTORIUM_TINT_STRENGTH` | `20` | Intensità della tinta di scena per lo sfondo sfocato (0–100). |
| `PICTORIUM_TOP_SHADE` | `50` | Intensità dell'ombra lineare superiore (0–100, `0` = spenta). |
| `PICTORIUM_TOP_SHADE_HEIGHT` | `25` | Altezza dell'ombra lineare superiore in % del canvas poster (0–100, `0` = spenta). |
| `PICTORIUM_BADGE_QUALITY` | `1` | Mostra/nasconde il badge di risoluzione video streaming (4K/FHD). |
| `PICTORIUM_AGE_BADGE` | `0` | Mostra/nasconde il badge di classificazione per età sotto lo stack qualità (etichetta originale del paese, nessuna conversione). |
| `PICTORIUM_AGE_COUNTRY` | `IT` | Paese della classificazione per età (ISO-2, es. `US`, `FR`; `GLOBAL` è rifiutato). Indipendente dalla lingua UI e dalla regione streaming. |
| `PICTORIUM_QUALITY_SOURCE` | `justwatch` | Sorgente live della qualità streaming: `justwatch` (solo JustWatch) o `none` (nessun provider live; il DB locale vale comunque). Il valore legacy `torrentio` e i valori ignoti sono normalizzati a `justwatch` e non causano mai chiamate live a Torrentio. I dati Torrentio servono solo ad ampliare/aggiornare il DB locale `av-specs.json` tramite gli script offline dell'operatore. Catena poster: param `quality` esplicito > DB locale > sorgente live. |
| `PICTORIUM_NETWORK_LOGO` | `1` | Mostra/nasconde il logo del network o studio di produzione. |
| `PICTORIUM_PRE_RELEASE` | `0` | Velo scuro + nastro "Coming Soon" per film non ancora in streaming. |
| `PICTORIUM_GRADIENT_HEIGHT` | `65` | Altezza percentuale della sfumatura scura inferiore. |

</details>

<details>
<summary><strong>Concorrenza & performance</strong></summary>

| Variabile | Default | Descrizione |
|---|:---:|---|
| `PICTORIUM_MAX_CONCURRENT_RENDERS` | Scalato sulla CPU `2`–`8` (`4` in docker-compose) | Render Sharp contemporanei massimi (anti-OOM). Non impostata = `min(8, max(2, availableParallelism()))`; un valore esplicito (1–32) vince sempre, un valore invalido ricade su `4`. |
| `PICTORIUM_MAX_CONCURRENT_FETCHES` | `12` | Fetch upstream/immagini contemporanei massimi nella pipeline (1–32). Chi attende non tiene buffer immagine, quindi questo budget è volutamente più alto di quello dei render. |
| `PICTORIUM_RENDER_SLOT_WAIT_MS` | `15000` | Attesa massima per uno slot di render prima di un 503 limitato (500–60000 ms). Su Vercel senza valore esplicito il default è `7500`. |
| `PICTORIUM_RENDER_QUEUE` | `0` | Coda di render limitata (0–128). `0` = chi attende si accoda fino a `PICTORIUM_RENDER_SLOT_WAIT_MS`; `N` > 0 = oltre `N` si riceve subito un 503 (backpressure invece di coda illimitata). |
| `PICTORIUM_ZOMBIE_GRACE_MS` | `10000` | Per quanto un render abbandonato dal deadline watchdog continua a occupare uno slot prima di essere rilasciato a forza (1000–120000 ms). Lo zombie continua in background finché non termina. |
| `PICTORIUM_RENDER_TIMEOUT_MS` | `30000` | Deadline massima di render prima di un 503 limitato con `Retry-After` (1000–40000 ms). Oltre la deadline il job tardivo non mette mai in cache e non conta doppio il 503. |
| `PICTORIUM_NEGATIVE_CACHE_TTL_MS` | `5000` | Per quanto un render fallito (500/503/404) viene ricordato, per non martellare un upstream rotto (1000–60000 ms). |
| `PICTORIUM_DYNAMIC_POSTER_TTL_MS` | `21600000` (6 h) | TTL di storage per i poster on-demand (non mappati), che guida anche gli header `Cache-Control`/Surrogate (clamp 5 min–24 h, jitter deterministico ±10% per cache key). I poster mappati seguono il refresh giornaliero. |
| `PICTORIUM_IMG_CACHE_MB` | `32` | Budget RAM per la cache byte delle immagini scaricate in-process (0–512 MB, `0` la disattiva). |
| `PICTORIUM_CACHE_MAX` | `4000` | Voci massime nella cache metadati in memoria (deve essere > 100, altrimenti `4000`). Un poster renderizzato occupa 2 voci (~60-110KB webp + header): con 4000 a limitare per primo è il tetto in byte `PICTORIUM_CACHE_MAX_MB`. È il knob del numero di entry: `PICTORIUM_CACHE_MAX_ENTRIES` non viene letto. |
| `PICTORIUM_CACHE_MAX_MB` | `150` | RAM massima per la cache metadati in memoria (deve essere > 10 MB, altrimenti `150`). |
| `PICTORIUM_POSTER_DISK_CACHE` | attivo (spento su Vercel) | Salva i poster renderizzati in `DATA_DIR/poster-cache`: dopo un riavvio/deploy tornano dal disco (~0,4 ms) invece di essere ri-renderizzati a freddo. Stessi TTL/SWR della memoria; svuotato con il clear della cache o il salvataggio dei default globali. `0`/`false`/`off`/`no` lo disattiva. |
| `PICTORIUM_POSTER_DISK_CACHE_MB` | `512` | Tetto della cache poster su disco (16–10240 MB); si eliminano prima i file usati meno di recente. |

</details>

<details>
<summary><strong>Operatività & diagnostica</strong></summary>

| Variabile | Default | Descrizione |
|---|:---:|---|
| `PICTORIUM_SELF_WARMUP` | `1` | Preriscaldamento dei cataloghi core all'avvio (entrypoint Docker). |
| `PICTORIUM_WARMUP_TOKEN` | *(non impostata)* | Secondo fattore opzionale per `POST /api/warmup`: se impostata, è accettato un header `x-warmup-token` corrispondente in alternativa a un token admin valido. |
| `PICTORIUM_WARMUP_ORIGIN` | *(derivata)* | Origin usata dal self-fetch del warmup. Default: `VERCEL_URL` se presente, altrimenti `http://127.0.0.1:<PORT>`. |
| `CRON_SECRET` | *(non impostata)* | Segreto che Vercel Cron allega come `Authorization: Bearer …` chiamando `GET /api/warmup`; senza, quella chiamata è fail-closed. |
| `PICTORIUM_LOG_LEVEL` | `info` | `debug`, `info`, `warn` o `error`. Valori invalidi ricadono su `info`. |
| `PICTORIUM_LOG_FORMAT` | `human` | `human` per righe leggibili, `json` per log strutturati. |
| `PICTORIUM_ALLOW_DEV_ADMIN` | `0` | Solo sviluppo: apre le route admin anche su host non loopback. Non impostarla su un'istanza deployata. |
| `PICTORIUM_ALLOWED_HOSTS` | *(vuoto)* | Vedi [Hardening per hosting condiviso](#hardening-per-hosting-condiviso). |
| `PICTORIUM_BIND_IP` | `0.0.0.0` | Solo Docker Compose: interfaccia host su cui viene pubblicata la porta. |
| `PICTORIUM_HOST_PORT` | `8080` | Solo Docker Compose: porta pubblicata sull'host (il container resta su `8080`). |
| `PICTORIUM_NODE_OLD_SPACE` | `384` | Solo Docker Compose: `--max-old-space-size` del container (alzalo per istanze condivise grandi). |
| `SHARP_CONCURRENCY` / `SHARP_CACHE_MEMORY_MB` | `2` / `64` | Impostate dal Dockerfile e sovrascrivibili in Compose. |
| `NODE_MAX_OLD_SPACE` | `384` | **Build arg** dell'immagine (`docker build --build-arg NODE_MAX_OLD_SPACE=1024 …`). `scripts/tune-env.mjs` può suggerire valori tarati. |

</details>

---

## ⚠ Limiti noti

Scelte architetturali deliberate, non bug:

* **Cache poster JPEG in-process** (RAM/disco, default 32 MB via `PICTORIUM_IMG_CACHE_MB`): mai in Redis/KV, che conserva solo metadati leggeri e cataloghi. Riversare binari JPEG in KV causerebbe bloat RAM e saturazione banda interna.
* **Persistenza premi Wikidata** (7g fresh / 30g stale, disco o KV): le risposte riuscite — incluse quelle legittimamente vuote, esplicitamente non degradate — vengono salvate anche per singolo titolo (`DATA_DIR/wikidata`, tetto soft di ~2000 file applicato da una prune throttled tra una scansione e l'altra, oppure KV con scadenza 30 giorni quando è configurato un backend), così restart e disservizi upstream servono dati recenti invece di rifare la richiesta. I record freschi (≤7 giorni) ripopolano la cache condivisa con la loro vita residua (mai estesa); i record fino a 30 giorni vengono serviti in modalità degradata se l'upstream fallisce, poi ignorati. I fallimenti non vengono mai persistiti; le letture durevoli sono limitate (250ms di budget aggiuntivo dopo un miss condiviso, refresh upstream limitato a min(1500ms, 2250ms di deadline stale totale dall'inizio della richiesta) sotto la race dei 2500ms del poster) e fail-open.
* **Persistenza dei rating grezzi MDBList** (default 24h / 7g per i film vecchi, disco o KV): le risposte grezze riuscite del provider — indicizzate per ID IMDb più hash della chiave API, mai in chiaro — vengono salvate anche su storage (`DATA_DIR/mdblist-raw`, un JSON per identità, ≤2000 voci / ≤16MiB applicati per processo da una prune in background innescata dalle scritture, oppure l'envelope L2 condiviso su KV quando è configurato un backend Redis/KV), così i restart servono rating recenti senza rifare le richieste. I record su disco ripopolano la cache in memoria con la loro vita residua (mai estesa); miss, errori e richieste interrotte non vengono mai persistiti; le scritture sono fire-and-forget fuori dal percorso caldo con concorrenza limitata (le scritture in eccesso vengono scartate fail-open), le letture sono probe asincroni su singolo file di proprietà dell'operazione di fetch condivisa (una lettura lenta senza altri chiamanti non avvia mai un fetch upstream), e tutta l'I/O è fail-open. La retention converge per processo; scritture concorrenti possono superare temporaneamente i tetti fino alla prune successiva di ciascun processo. La persistenza su disco richiede storage durevole configurato esplicitamente (`PICTORIUM_DATA_DIR` impostata — sempre vera in Docker grazie al default `/data` dell'entrypoint); con il default nudo `./data` o in modalità KV il disco non viene mai letto, scritto o scansionato.
* **Paginazione JustWatch**: la GraphQL upstream pagina solo via `$first` — il server fa overfetch (max 60) e taglia in locale. Uno `skip` profondo può costare più di un fetch upstream.
* **Suite E2E visiva Chromium-only**: snapshot deterministici su un solo browser; Firefox/WebKit non coperti di proposito.
* **HSTS al reverse proxy**: il container non forza `Strict-Transport-Security` con preload (romperebbe LAN/Docker in HTTP). TLS+HSTS stanno a Caddy / Cloudflare / Nginx — vedi il deploy con Caddy sopra.
* **Warmup limitato**: all'avvio si scaldano solo 8 cataloghi core (`WARMUP_CATALOG_IDS`). Scaldare tutto causerebbe 429 TMDB e boot oltre i probe di liveness.
* **Interfaccia in ebraico (RTL)**: `he` è selezionabile tra le lingue, ma il layout non applica la direzione destra→sinistra (`dir="ltr"` fisso in `src/app/layout.tsx`): i testi ebraici sono tradotti, l'impaginazione resta sinistra→destra. La composizione delle etichette tiene conto delle stringhe RTL (es. il numero di stagione sta *dentro* la stringa tradotta, così ogni lingua decide dove metterlo), ma la pagina non è impaginata a specchio.
* **Versione dell'app negli artefatti container**: `APP_VERSION` è automatica e conta i commit dalla versione in `package.json`, quindi richiede la storia git. Il `Dockerfile` del repo esclude `.git` dal build context: senza il build-arg `APP_VERSION` l'immagine riporta la versione base del `package.json`. Le build CI su tag passano il build-arg e riportano la versione di rilascio.
