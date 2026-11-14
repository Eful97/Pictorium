# Pictorium — Dettaglio funzioni

[← Torna al README](../README.it.md) · [🇬🇧 English](FEATURES.md)

## 🛠 Dettaglio funzioni

<details>
<summary><strong>🖼️ Locandine, loghi & grafica</strong></summary>

* **Selezione poster clean**: scegli in un click la locandina senza testo tra i candidati ufficiali TMDB (`iso_639_1 === null`).
* **Import poster personalizzati**: importa artwork da URL diretto, Pinterest, Imgur, Reddit o Postimages con anteprima live, gestione tessere e persistenza.
* **Algoritmo best-fit intelligente**: analizza luminosità e zone vuote per scalare e posizionare il logo evitando di coprire i volti.
* **Sfocatura progressiva (Sharp C++)**: intensità crescente verso il fondo con tinta di scena same-hue, scurimento quadratico e anti-seam, in pochi ms e a basso consumo di RAM.
* **Rotazione automatica 24h**: alterna ogni giorno più locandine selezionate per lo stesso titolo.
* **Loghi network ufficiali**: riconoscimento ed embedding automatico per Netflix, Prime Video, Disney+, Apple TV+, HBO Max, Paramount+, Sky/NOW, Crunchyroll, Rai, Mediaset e oltre 30 studi (Marvel, Pixar, Ghibli, Warner Bros, A24).

</details>

<details>
<summary><strong>🏷️ Badge, rating & riconoscimenti</strong></summary>

* **✨ Qualità streaming (4K / FHD / HD / SD)**: rilevata in tempo reale dai flussi di Stremio, con fallback automatico su JustWatch. Pacchetti badge qualità opzionali: vedi [docs/quality-badge-packs.md](quality-badge-packs.md).
* **8 stili badge genere & voto**: *Ombra, Pill, Barra, Colore, Bordo, Vetro, Minimale, Inchiostro* (`Genere | Voto | Anno`), con palette che si adatta alla locandina. Chiavi env/URL: `shadow`, `pill`, `bar`, `colored`, `bordo`, `vetro`, `minimal`, `ink`.
* **Nastro verticale Netflix Top 10**: il caratteristico nastro rosso laterale con posizione live (supporto dedicato anche per le serie anime).
* **Premi cinematografici**: riconoscimento automatico di Oscar, Cannes, BAFTA, Emmy e badge *"Absolute Cinema"* per i titoli della IMDb Top 250.
* **Classifiche sincronizzate**: il badge segue la classifica in tempo reale; se un titolo esce dalla chart, il badge si aggiorna da solo.
* **✨ Effetto Pre-Digitale (Coming Soon)**: per i film usciti al cinema ma non ancora in streaming (rilevati via JustWatch/TMDB): velo scuro sul poster e nastro rosso "Coming Soon". È un flag URL per-richiesta (`pre=1`) o un default per l'intera libreria, non un campo salvato per singolo titolo.
* **🔌 Provider voti personalizzati**: mostra voti da qualsiasi API esterna (via IMDb ID) con pill dedicate. Dettagli in [docs/custom-rating.md](custom-rating.md).

</details>

<details>
<summary><strong>📺 Stagioni, episodi & anime</strong></summary>

* **✨ Rilevamento automatico parti**: passa in automatico da stagioni standard a Parti originali per serie strutturate a blocchi (es. *La Casa di Carta*, *Lupin*).
* **🌀 Spacchettamento anime**: risolve la catalogazione TMDB che raggruppa intere serie anime in una singola stagione, ripristinando la suddivisione ufficiale (S1, S2, S3, S4 + Speciali in S0).
* **Supporto TVDB & AniZip**: seleziona manualmente gli ordinamenti alternativi TheTVDB (*Aired, DVD, Absolute, Alternate*) o AniZip (*AniList / AniDB*).
* **Anteprima episodi live**: visualizza prima di salvare esattamente come appariranno stagioni, titoli e miniature su Stremio.

</details>

<details>
<summary><strong>🗂️ Libreria, automazione & backup</strong></summary>

* **Gestione massiva ne "I Miei Poster"**: selezione multipla dei poster salvati con eliminazione di gruppo.
* **Backup completo & ripristino**: esporta e ripristina con un click l'intera configurazione dello spazio (poster salvati, preset personalizzati, stili e preferenze).
* **Template URL per Nuvio & AIOMetadata**: template dedicati per gestori di cataloghi esterni con risoluzione automatica degli ID TMDB. Gli spazi utente usano di default **Segui il mio spazio**: copia il template una volta sola e le modifiche salvate si applicano senza sostituire il link. **Impostazioni fisse nel link** resta disponibile nelle opzioni avanzate e i template esistenti mantengono i loro override espliciti. La variante automatica Nuvio lascia comunque al client la scelta del formato immagine e copre anche i cataloghi anime (ID `kitsu:`, `anilist:`, `mal:`, `anidb:`, `tvdb:` mappati su TMDB).
  I link Segui (`live=1`) richiedono rivalidazione HTTP e riusano i render interni aggiornati. AIOMetadata e gli altri proxy di immagini devono rispettare questa policy; aggiorna le immagini già in cache usando i controlli disponibili nella versione installata. I nuovi header non possono eliminare le copie esterne esistenti e un poster già mostrato si aggiorna solo quando il client lo richiede di nuovo. Ranking live e altri dati upstream mantengono i loro tempi di aggiornamento interni. Dettagli dell'endpoint: [docs/INTEGRAZIONE.md](INTEGRAZIONE.md).

</details>

<details>
<summary><strong>🔒 Sicurezza: PIN & spazi multi-utente</strong></summary>

#### Protezione PIN (istanze singole / personali)
* **Blocco ad ogni avvio**: richiesta del PIN all'avvio e a ogni refresh (F5) per proteggere modifiche e impostazioni.
* **Setup guidato**: configurabile nel passo 3 del wizard di primo avvio, o in qualsiasi momento dalle Impostazioni.
* **Stremio invariato**: il PIN blocca solo l'editor web; gli endpoint di Stremio (`/manifest.json`, `/api/poster/*`, `/catalog/*`) restano sempre accessibili.
* **Rotazione**: se il PIN è stato impostato tramite token admin, la rotazione di `PICTORIUM_ADMIN_TOKEN` lo disabilita automaticamente (binding crittografico anti-persistenza). Dopo una rotazione del token, reimposta il PIN se desiderato.

#### Spazi multi-utente (istanze pubbliche condivise)
Attivando `PICTORIUM_MULTI_USER=1`, più utenti condividono lo stesso server in modo totalmente isolato:
* **Spazio personale via UUID**: ogni utente ha un URL `/u/<uuid>/configure` con mapping, default e chiavi API separati (TMDB, MDBList, TVDB, Simkl, Fanart.tv).
* **Crittografia a riposo**: le chiavi API degli utenti sono salvate cifrate con AES-256-GCM tramite `PROFILE_ENCRYPTION_KEY`.
* **Autenticazione & recovery**:
  * **Password di sessione**: richiesta a ogni visita per sbloccare l'editor (non viene salvata permanentemente nel browser).
  * **Recovery key (secret)**: mostrata una sola volta alla creazione — salvala subito. Resta valida per recuperare l'accesso o ruotare le credenziali finché non la ruoti.
* **Protezione anti-brute-force**: limite automatico sui tentativi di password errati.

</details>

> 📢 Per segnalare vulnerabilità in privato (mai con issue pubbliche), vedi [SECURITY.md](../SECURITY.md).
