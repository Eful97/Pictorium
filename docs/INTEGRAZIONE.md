# Guida all'integrazione di Pictorium (solo endpoint poster)

> 🇬🇧 English version: [`INTEGRATION.md`](./INTEGRATION.md)

Questo documento è il contratto stabile per incorporare i poster di
Pictorium in un progetto terzo (es. un add-on Stremio). Descrive solo ciò
che serve a chi integra: l'endpoint poster, i suoi parametri query, le
chiavi API, il comportamento in caso di errore e le regole di
licenza/attribuzione.

## Perimetro: solo endpoint poster

Usa **solo** l'endpoint poster e incorpora le URL risultanti nei tuoi
cataloghi:

```text
GET {tuaIstanza}/api/poster/{movie|series}/{id}
```

- `{movie|series}`: `movie` per i film. `series`, `tv`, `show`, `tvshow`
  indicano tutti le serie TV.
- `{id}`: id numerico TMDB (`.../movie/550`) oppure id IMDb (`.../movie/tt0133093`,
  risolto lato server in TMDB).

**Non** servono `/catalog/*`, `/meta/*`, l'editor web o altre route di
Pictorium. Non c'è niente da rimuovere dal codice — semplicemente non
chiamare ciò che non ti serve. Tenere il deploy intatto (invece di
cancellare codice) mantiene il tuo fork vicino all'upstream.

## Self-hosting (obbligatorio)

Esegui la tua copia. Non puntare il traffico degli utenti finali
sull'istanza di qualcun altro.

- Immagine Docker: `eful97/pictorium:latest` (multi-arch `amd64`/`arm64`),
  oppure deploy Vercel in 1 click dal repo.
- Vedi `docker-compose.yml` e `.env.example` per l'elenco completo delle variabili.
- Le variabili d'ambiente sono lette a module level: cambiarle richiede un
  restart, l'hot reload non le applica.

## Chiavi API

Priorità di risoluzione TMDB (vedi `resolveRequestApiKey` in `src/lib/tmdb.ts`):

1. header `x-api-key` della richiesta (preferito — non compare mai in URL/log),
2. query param `api_key`,
3. fallback d'istanza `PICTORIUM_TMDB_KEY` (**opt-in**, per deploy personali
   single-user; **non** configurarlo su istanze condivise multi-utente).

Setup consigliato:

| Chiave  | Come passarla                       | Perché                                             |
|---------|-------------------------------------|----------------------------------------------------|
| TMDB    | per richiesta (`x-api-key`/`api_key`)| Chiavi per-utente = niente rate limit condiviso. `api_key` è esclusa dalla cache key del poster, quindi le chiavi per-utente **non** frammentano la cache. |
| MDBList | `PICTORIUM_MDBLIST_KEY` sull'istanza | Il rank anime è globale (stessa lista per tutti). Il `mdblist_key` per-richiesta **frammenta** la cache del poster (una miss + render per chiave distinta), quindi meglio la chiave d'istanza. |

Senza alcuna chiave TMDB utilizzabile, i titoli freddi non mappati
rispondono `503` (veloce, senza consumare slot) invece di renderizzare
poster degradati. I titoli mappati o le richieste con `?poster=` esplicito
renderizzano comunque, senza upgrade live di rank/qualità.

## Parametri query

Tutti opzionali. I parametri ignoti vengono ignorati. I valori oltre i
limiti rispondono `400` prima di qualsiasi lavoro di render (vedi
`posterQuerySchema` in `src/lib/validation.ts`: `extra`/`label` ≤ 80
caratteri, `title`/`rsrc` ≤ 200, `poster`/`logo`/`backdrop` ≤ 160, `imdbId`
in formato `^tt\d{1,20}$`). Le URL immagine esterne sono rifiutate — solo
path `https://image.tmdb.org/t/p/...` (o `file_path` TMDB).

| Parametro | Valori | Default | Effetto |
|---|---|---|---|
| `rv` | stringa render version | — | **Invialo sempre.** Cache-buster: quando il renderer cambia, un nuovo `rv` forza CDN/client a scaricare poster freschi. Il valore corrente sta in `src/lib/render-version.ts`. |
| `badges` | `1`/`0` | `1` | Badge genere/voto on/off. |
| `ranking` | `1`/`0` | `1` | Badge ranking/premi on/off. |
| `bg`/`by`/`br`/`bq` | `1`/`0` | `1` | Componenti genere / anno / voto / qualità streaming del badge, indipendenti. |
| `bs` | `shadow` `pill` `bar` `colored` `bordo` `vetro` | `shadow` | Stile badge genere. |
| `rs` | `default` `bar` `colored` `pill` `netflix` | `default` | Stile badge ranking (`default` seleziona il nastro Netflix quando esiste un rank). |
| `gradHeight` | `5`–`100` | `30` | Altezza gradiente inferiore, in percentuale. |
| `blur`/`bf`/`bd` | numeri | `5`/`60`/`40` | Intensità / fade / oscuramento dello sfondo blur. |
| `be` | `1`/`0` | `1` | Sfondo blur on/off (`be=0` lo disabilita). |
| `netLogo` | `1`/`0` | `1` | Pill logo network/studio on/off. |
| `side` | `left`/`right` | decide il server | Lato nastro Netflix / logo network. Passalo esplicito per output deterministico. |
| `ac` | colore hex | auto | Override colore accent (altrimenti campionato dall'artwork). |
| `tl` | `1`/`0` | auto | Modalità testo top-light. Omettilo per farla calcolare al server dalla luminanza. |
| `pre` | `1` | off | Effetto pre-digitale (velo scuro + nastro "Coming Soon"), solo film, default OFF. |
| `lang` | es. `it`, `en` | `it` | Lingua di artwork/metadati. |
| `region` | es. `IT`, `US` | default server | Regione classifiche JustWatch (ranking, qualità, pre-release). |
| `title` | testo (≤ 200) | — | **Invialo.** Titolo usato per il match JustWatch (qualità + pre-release). Senza, il match ripiega su valori generici e degrada. |
| `rd`/`fad` | `YYYY-MM-DD` | — | Data release / prima messa in onda complete. Meglio di `year` (il solo anno diventa 1º gennaio e può mancare la finestra theatrical del pre-release). |
| `imdbId` | `tt...` | — | Aiuta il match degli id esterni (IMDb Top 250, voto aggregato). |
| `rank`/`label` | int / testo (≤ 80) | live | Override esplicito del rank + label. |
| `extra` | testo (≤ 80) | — | Badge testuale custom. |
| `animerank` | int | live | Override rank chart anime (TV). |
| `rsrc` | CSV (≤ 200) | set default | Sorgenti voto per la media aggregata. |
| `poster`/`logo`/`backdrop` | path TMDB | auto | Override artwork esplicito (uso preview/WYSIWYG). |
| `scale`/`ox`/`oy`, `bscale`/`box`/`boy` | numeri | auto | Override geometria logo / backdrop. |
| `mv` | mapping version | — | Rimanda indietro l'`mv` ricevuto: con `mv` corrispondente abilita cache immutabile a lungo termine. |
| `fmt`/`format` | formato immagine | JPEG | Formato output alternativo dove supportato. |
| `preview` | `1` | — | Modalità preview (header no-store). I client live devono ometterla. |
| `debug` | `1` | — | Restituisce JSON con i dati di render invece dell'immagine. |

> Non usare il token `?config=` per integrazioni cross-project: richiede di
> condividere il `CONFIG_HMAC_SECRET` dell'istanza ed è fail-closed in
> produzione. I query param espliciti sono debuggabili e versionabili.

## Risposte e comportamento in caso di errore (integrazione fail-safe)

| Stato | Significato | Cosa fare |
|---|---|---|
| `200` | Poster JPEG (ETag + `304 Not Modified` supportati) | Mettilo in cache. Usa `mv`/`rv` per l'invalidazione. |
| `400` | Id invalido o parametro oltre i limiti | Correggi la richiesta (bug tuo, mai ritentare così com'è). |
| `404` | Per questo titolo non esiste davvero artwork | Fallback al tuo poster normale. Non ritentare in loop. |
| `429` | Rate limited (bucket poster: ~200 burst, ~20 req/s sostenuti per chiave) | Backoff per i secondi di `Retry-After`, poi ritenta o fallback. |
| `503` | Slot render saturi, deadline superata o upstream (TMDB/CDN) lento — include `Retry-After` | Backoff, poi ritenta o fallback. Mai trattarlo come "titolo inesistente". |

**Regola d'oro:** se Pictorium è irraggiungibile/lento o un item non ha
IMDb ID, usa il tuo poster normale. Pictorium non deve mai rompere i tuoi
cataloghi. I poster non mappati cachano ~6h, quelli mappati ~24h; gli errori
di render recenti hanno negative-cache di soli ~5s.

Budget di render di default (via env): max 4 render concorrenti
(`PICTORIUM_MAX_CONCURRENT_RENDERS`), 30s deadline complessiva
(`PICTORIUM_RENDER_TIMEOUT_MS`), ~15s attesa slot. Una griglia fredda di
cataloghi passa agevolmente nel burst da 200 token; scraping sostenuto oltre
~20 rps per chiave prende `429`.

## Licenza e attribuzione (AGPL-3.0-only)

Pictorium è sotto **GNU Affero General Public License v3.0**. In breve per
chi integra:

1. **Tienilo come servizio separato.** Non copiare il renderer nel tuo
   codice — il lavoro combinato ricadrebbe sotto AGPL-3.0 con obbligo di
   pubblicazione sorgente. Una chiamata di rete alla tua istanza Pictorium
   tiene pulite le licenze da entrambe le parti.
2. **Pubblica il fork se lo modifichi.** Qualsiasi modifica servita via rete
   deve avere il Corresponding Source offerto agli utenti di quel server
   (AGPL §13). Le impostazioni specifiche del deploy (chiavi, regione
   default, tuning env) restano da te; i fix generici vanno upstream come PR.
3. **Credito sempre visibile — anche nei tier a pagamento.** Mostra "Powered
   by Pictorium" con link a `https://github.com/Eful97/Pictorium` dove
   l'opzione è presentata. Mai presentarlo come feature tua.
4. Il testo completo sta nel repo (`LICENSE`) e nell'immagine Docker, ed è
   esposto a runtime via `GET /api/license`.
