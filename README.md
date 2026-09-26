---
title: Pictorium
emoji: 🖼️
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 8080
pinned: false
---

<p align="center">
  <img src="public/pictorium.png" alt="Pictorium" width="380" />
</p>

<h3 align="center">Generatore Dinamico di Poster Cinematografici per Stremio & Media Center</h3>

<p align="center">
  <a href="README.md"><b>🇮🇹 Leggi in Italiano</b></a> • <a href="README.en.md"><b>🇬🇧 Read in English</b></a>
</p>

<p align="center">
  Locandine clean senza testo, loghi vettoriali ad alta definizione, rating IMDb/TMDB/Rotten Tomatoes, badge qualità streaming 4K, classifiche Netflix Top 10 e ordinamento stagioni intelligente. Tutto renderizzato al volo con Sharp C++ & SVG.
</p>

<p align="center">
  <a href="https://discord.gg/sYfWyXYVUp"><img src="https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord Community" /></a>
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FEful97%2FPictorium"><img src="https://vercel.com/button" alt="Deploy with Vercel" /></a>
  <a href="#-docker--compose"><img src="https://img.shields.io/badge/Docker-Supported-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" /></a>
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js&logoColor=white" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22-green?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square" alt="License AGPLv3" />
  <a href="https://github.com/Eful97/Pictorium/actions/workflows/ci.yml"><img src="https://github.com/Eful97/Pictorium/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
</p>

> [!TIP]
> 🚀 **Prova l'[istanza pubblica](https://pictorium.duckdns.org)**: crea il tuo spazio personale con la tua chiave TMDB gratuita.  
> 💬 Entra nella community su [Discord](https://discord.gg/sYfWyXYVUp) per supporto, novità e segnalazioni.  
> ☕ Supporta il progetto su [Ko-fi](https://ko-fi.com/eful97) per mantenere attiva la VPS comunitaria.

---

## 📸 Anteprima

<div align="center">
  <img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/home.png" alt="Pictorium Home" width="100%" style="border-radius: 8px; margin-bottom: 8px;" />
</div>

<table align="center" width="100%">
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/editor.png" alt="Pictorium Editor" style="border-radius: 6px;" /></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/myposters.png" alt="Pictorium My Posters" style="border-radius: 6px;" /></td>
  </tr>
  <tr>
    <td align="center"><em>Editor WYSIWYG & Anteprima Live</em></td>
    <td align="center"><em>I Miei Poster & Libreria Personale</em></td>
  </tr>
  <tr>
    <td colspan="2"><img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/catalogs.png" alt="Pictorium Catalogs" style="border-radius: 6px; margin-top: 8px;" /></td>
  </tr>
  <tr>
    <td align="center" colspan="2"><em>Cataloghi Dinamici & Classifiche Streaming JustWatch</em></td>
  </tr>
</table>

<div align="center" style="margin-top: 12px;">
  <img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/1405.jpg" alt="Poster Demo — Dexter" width="31%" style="border-radius: 6px; margin: 1%;" />
  <img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/155.jpg" alt="Poster Demo — The Dark Knight" width="31%" style="border-radius: 6px; margin: 1%;" />
  <img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/66732.jpg" alt="Poster Demo — Stranger Things" width="31%" style="border-radius: 6px; margin: 1%;" />
</div>

<div align="center" style="margin-top: 8px;">
  <img src="https://raw.githubusercontent.com/Eful97/Pictorium/master/public/Screen/1368337.jpg" alt="Effetto Pre-Digitale — Coming Soon" width="31%" style="border-radius: 6px;" />
  <br />
  <em>Effetto Pre-Digitale: velo scuro + nastro "Coming Soon" sui film non ancora in streaming</em>
</div>

---

## ⚡ Caratteristiche Principali

| Funzionalità | Descrizione |
|---|---|
| 🎯 **Motore Grafico WYSIWYG** | Un unico endpoint (`/api/poster/{type}/{id}`) basato su Sharp C++ ed SVG serve l'anteprima web in tempo reale e il poster finale su Stremio con pixel-perfect sync. |
| 📦 **Addon 100% Autonomo** | Fornisce direttamente a Stremio schede dettagliate, trame localizzate, loghi trasparenti, sfondi 4K, trailer YouTube e tutte le stagioni con miniature ed episodi tradotti. |
| 📺 **Ordinamento Intelligente Parti & Anime** | Rileva automaticamente i gruppi **Original Parts** (*La Casa di Carta*, *Lupin*) e spacchetta le mega-stagioni anime compresse su TMDB (*Re:ZERO*, *Jujutsu Kaisen*) nelle vere stagioni ufficiali. |
| 🏷️ **Badge Qualità & Voti** | Visualizza in tempo reale risoluzione video (4K/FHD/HD), voti aggregati da oltre 16 fonti (IMDb, TMDB, Rotten Tomatoes, Letterboxd, MAL), premi Oscar/Cannes e nastri Netflix Top 10. |
| 🌐 **Cataloghi Personalizzati** | Importa watchlist e collezioni da **Letterboxd, Trakt, TMDb, TheTVDB, MDBList** e classifiche trend in tempo reale tramite JustWatch GraphQL. |
| 🌍 **Interfaccia Multilingua Dinamica** | Interfaccia localizzata in 10 lingue con cambio istantaneo in tempo reale senza ricaricare la pagina. |
| 🔒 **Protezione PIN & Spazi Multi-Utente** | Protezione con codice PIN per istanze singole, oppure modalità multi-utente con spazi isolati e crittografia AES-256-GCM. Locandine e manifest Stremio rimangono sempre funzionanti. |
| ⚡ **Zero Conflitti di Cache** | Versioning deterministico con `RENDER_VERSION` e `APP_VERSION` automatiche: ogni modifica grafica aggiorna istantaneamente le immagini su Stremio. |

---

## 🛠️ Funzionalità in Dettaglio

### 🖼️ Locandine, Loghi & Grafica
* **Selezione Poster Clean**: Scegli in un click la locandina senza testo tra i candidati ufficiali TMDB (`iso_639_1 === null`).
* **Algoritmo Best-Fit Intelligente**: Analizza luminosità e zone vuote per scalare e posizionare il logo evitando di coprire i volti.
* **Sfocatura Progressiva (Sharp C++)**: Blur a intensità crescente verso il fondo con tinta di scena same-hue, scurimento quadratico e anti-seam, in pochi ms e a basso consumo di RAM.
* **Rotazione Automatica 24h**: Alterna automaticamente ogni giorno più locandine selezionate per lo stesso titolo.
* **Loghi Network Ufficiali**: Riconoscimento ed embedding automatico per Netflix, Prime Video, Disney+, Apple TV+, HBO Max, Paramount+, Sky/NOW, Crunchyroll, Rai, Mediaset e oltre 30 studi (Marvel, Pixar, Ghibli, Warner Bros, A24).

### 🏷️ Badge, Rating & Riconoscimenti
* **✨ Qualità Streaming (4K / FHD / HD / SD)**: Rilevata in tempo reale dai flussi di Stremio con fallback automatico su JustWatch.
* **7 Stili Badge Genere & Voto**: *Shadow, Pill, Bar, Colored, Bordo, Vetro, Minimal* (`Genere | Voto | Anno`) con palette cromatica che si adatta ai colori della locandina.
* **Nastro Verticale Netflix Top 10**: Il caratteristico nastro rosso laterale con posizione live (supporto dedicato anche per serie Anime).
* **Premi Cinematografici**: Riconoscimento automatico Oscar, Cannes, BAFTA, Emmy e badge *"Absolute Cinema"* per i titoli della IMDb Top 250.
* **Classifiche Sincronizzate**: Il badge segue la classifica in tempo reale; se un titolo esce dalla chart, il badge scompare automaticamente.
* **✨ Effetto Pre-Digitale (Coming Soon)**: Per i film usciti al cinema ma non ancora in streaming (rilevati via JustWatch/TMDB): velo scuro sul poster e nastro rosso "Coming Soon". Attivabile per-titolo, via query `?pre=1` o per l'intera libreria.
* **🔌 Provider Voti Personalizzati**: Visualizza voti da qualsiasi API esterna (via IMDb ID) con pill dedicate. Dettagli in [docs/custom-rating.md](docs/custom-rating.md).

### 📺 Stagioni, Episodi & Anime
* **✨ Rilevamento Automatico Parti**: Passa in automatico da stagioni standard a Parti originali per serie strutturate a blocchi (es. *La Casa di Carta*, *Lupin*).
* **🌀 Spacchettamento Anime**: Risolve la catalogazione TMDB che raggruppa intere serie anime in una singola stagione, ripristinando la suddivisione ufficiale (S1, S2, S3, S4 + Speciali in S0).
* **Supporto TVDB & AniZip**: Seleziona manualmente gli ordinamenti alternativi TheTVDB (*Aired, DVD, Absolute, Alternate*) o AniZip (*AniList / AniDB*).
* **Anteprima Episodi Live**: Visualizza prima di salvare esattamente come appariranno stagioni, titoli e miniature su Stremio.

### 🔒 Sicurezza: PIN & Spazi Multi-Utente

#### Protezione PIN (Istanze Singole / Personali)
* **Blocco Pannello ad Ogni Avvio**: Richiesta del codice PIN all'avvio e ad ogni refresh (F5) per proteggere modifiche e impostazioni.
* **Setup Guidato**: Configurabile in pochi secondi al primo avvio (Step 3 del wizard) o modificabile dalle Impostazioni.
* **Stremio Invariato**: Il PIN blocca solo l'editor web; gli endpoint di Stremio (`/manifest.json`, `/api/poster/*`, `/catalog/*`) rimangono sempre accessibili.
* **Rotazione**: se il PIN è stato impostato tramite token admin, la rotazione di `PICTORIUM_ADMIN_TOKEN` lo disabilita automaticamente (binding crittografico anti-persistenza). Dopo una rotazione del token, reimposta il PIN se desiderato.

#### Spazi Multi-Utente (Istanze Pubbliche Condivise)
Attivando `PICTORIUM_MULTI_USER=1`, l'istanza permette a più utenti di condividere lo stesso server in modo totalmente isolato:
* **Spazio Personale via UUID**: Ogni utente ha un proprio identificativo univoco (`/u/<uuid>/configure`) con mapping, default e chiavi TMDB separate.
* **Crittografia a Riposo**: Le chiavi API dell'utente sono salvate su disco cifrate con AES-256-GCM tramite `PROFILE_ENCRYPTION_KEY`.
* **Autenticazione & Recovery**:
  * **Password di Sessione**: richiesta ad ogni visita per sbloccare l'editor (non viene salvata permanentemente nel browser).
  * **Recovery Key (Secret)**: codice segreto mostrato una sola volta alla creazione per recuperare l'accesso in caso di smarrimento o ruotare le credenziali.
* **Protezione Anti-Brute-Force**: Limite automatico sui tentativi di inserimento password errati e protezione da abusi.

---

## 🚀 Deploy Rapido

| Piattaforma | Costo | Tipologia | Persistenza | Ideale per |
|---|---|---|---|---|
| [▲ **Vercel**](#-vercel-consigliato) | **Gratis** | Serverless | Upstash Redis (KV) | **Consigliato**: 1 click, zero manutenzione, CDN globale ([📺 Video Guida](https://www.youtube.com/watch?v=FP6VJ2vGYiY)) |
| [🐳 **Docker Compose**](#-docker--compose) | **Gratis** | Container | Volume locale (`/data`) | NAS, Home Server, mini-PC (Unraid, TrueNAS, CasaOS) |
| [🤗 **Hugging Face**](#-altre-modalit-di-installazione) | **Gratis** | Docker (16GB RAM) | Storage Bucket | Ottima RAM gratuita per istanze condivise |
| [🦾 **Oracle Cloud**](#-altre-modalit-di-installazione) | **Gratis** | VPS ARM (24GB RAM) | Disco Locale | Sempre online con risorse dedicate a costo zero |

---

### ▲ Vercel (Consigliato)

[![Video Guida YouTube](https://img.shields.io/badge/YouTube-Video_Guida_Setup-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=FP6VJ2vGYiY)

> 📺 **Video Guida**: Segui la [procedura su YouTube](https://www.youtube.com/watch?v=FP6VJ2vGYiY) per completare il setup in meno di 2 minuti.

1. **Ottieni la chiave API TMDB (gratuita)**:
   * Registrati su [themoviedb.org](https://www.themoviedb.org/signup) e vai in **Impostazioni → API**.
   * Copia la **Chiave API (v3 auth)** (stringa alfanumerica di 32 caratteri).
2. **Fai il Fork del repository**:
   * Clicca su **Fork** in alto a destra su [github.com/Eful97/Pictorium](https://github.com/Eful97/Pictorium).
3. **Importa su Vercel**:
   * Accedi a [vercel.com](https://vercel.com) e clicca su **Add New… → Project**.
   * Importa il fork di Pictorium e imposta le variabili d'ambiente:
     * `PICTORIUM_TMDB_KEY` = *la tua chiave TMDB v3*
     * `PICTORIUM_PUBLIC_INSTANCE` = `1`
   * Clicca su **Deploy**.
4. **Collega il Database Upstash Redis (Gratuito)**:
   * Al termine del deploy, apri la dashboard del progetto su Vercel.
   * Vai nella scheda **Storage → Connect Store → Upstash (Redis)** e conferma la creazione.
5. **Redeploy**:
   * Nella scheda **Deployments**, clicca sui tre puntini (**⋯**) dell'ultimo deployment e seleziona **Redeploy** (necessario per agganciare Upstash).
6. **Installa su Stremio**:
   * Apri l'URL della tua istanza (es. `https://tuo-pictorium.vercel.app`), completa il wizard iniziale e clicca su **Installa su Stremio**!

> **Aggiornamenti Futuri**: Per aggiornare la tua istanza, ti basterà aprire il tuo fork su GitHub e cliccare su **Sync fork → Update branch**. Vercel effettuerà il redeploy automatico in 60 secondi senza toccare i tuoi dati.

---

### 🐳 Docker & Compose

Usa il `docker-compose.yml` già incluso nel repo (hardening, healthcheck e volume persistente `posterium-data` già configurati) — non serve scriverne uno a mano:

```bash
git clone https://github.com/Eful97/Pictorium && cd Pictorium
cp .env.example .env
```

Compila nel `.env` almeno `PICTORIUM_TMDB_KEY` e `PICTORIUM_ADMIN_TOKEN` (un segreto lungo a tua scelta), poi:

```bash
docker compose up -d
```

> Il primo avvio compila l'immagine in locale (qualche minuto, di più su ARM). Per partire subito con l'immagine precompilata: `docker compose pull pictorium && docker compose up -d --no-build`. Le route admin sono chiuse di default: incolla il token in **Impostazioni → Token admin** (solo sessione) per usare warmup, cache e salvataggi dalla UI. Solo su LAN fidata puoi usare `PICTORIUM_PUBLIC_INSTANCE=1` al posto del token.
>
> Se venivi dal vecchio esempio con volume `pictorium-data` e hai già salvataggi, copiali prima di passare al compose del repo: `docker run --rm -v pictorium-data:/from -v posterium-data:/to alpine cp -a /from/. /to/`

L'interfaccia e il manifest Stremio saranno disponibili su `http://<IP-SERVER>:8080`.

---

<details>
<summary><strong>👉 Altre modalità di installazione (Hugging Face, Oracle Cloud, VPS Caddy, Termux)</strong></summary>

#### 🤗 Hugging Face Spaces
1. Crea una Space su Hugging Face con SDK **Docker** collegata al repo `Eful97/Pictorium`.
2. In **Settings → Variables and secrets**:
   * `NODE_OPTIONS` = `--max-old-space-size=1024`
   * `PICTORIUM_PUBLIC_INSTANCE` = `1`
   * `PICTORIUM_TMDB_KEY` = *la tua chiave TMDB*
3. In **Settings → Storage**, collega uno Storage Bucket montato su `/data`.

#### 🦾 Oracle Cloud Always Free (ARM Ampere)
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
git clone https://github.com/Eful97/Pictorium && cd Pictorium
cp .env.example .env
```
Compila `PICTORIUM_TMDB_KEY` e `PICTORIUM_ADMIN_TOKEN` nel `.env`, poi `sudo docker compose up -d` (usa il compose del repo). Poi incolla il token in **Impostazioni → Token admin** (solo sessione). Su istanza esposta non usare `PICTORIUM_PUBLIC_INSTANCE=1`.

#### 🖥️ VPS + Caddy (HTTPS Automatico)
```caddyfile
tuodominio.com {
    reverse_proxy pictorium:8080
}
```
Su dominio pubblico proteggi l'editor con `PICTORIUM_ADMIN_TOKEN` (sblocco in Impostazioni → Token admin), non con `PICTORIUM_PUBLIC_INSTANCE=1`.

#### 📱 Termux (Android)
```bash
pkg update && pkg install nodejs git -y
git clone https://github.com/Eful97/Pictorium && cd Pictorium
npm install --ignore-scripts && npm run build && npm start
```
</details>

---

## 🔑 Variabili d'Ambiente

### Variabili Principali

| Variabile | Default | Descrizione |
|---|:---:|---|
| `PICTORIUM_PUBLIC_INSTANCE` | `0` | Se `1`, le route admin restano aperte senza token (LAN fidata, demo pubbliche). Su istanze esposte lasciare `0` e usare il token qui sotto. |
| `PICTORIUM_ADMIN_TOKEN` | *(opzionale)* | Segreto per istanze private (`PUBLIC_INSTANCE=0`): incollalo in Impostazioni → Token admin (solo sessione, muore col tab) per abilitare warmup, svuotamento cache e salvataggi dalla UI. |
| `PICTORIUM_TMDB_KEY` | *(opzionale)* | Chiave API TMDB d'istanza per generare poster e cataloghi automaticamente. |
| `PICTORIUM_TVDB_API_KEY` | *(opzionale)* | Chiave TheTVDB per ordinamenti stagioni alternativi ed episodi. |
| `PICTORIUM_MDBLIST_KEY` | *(opzionale)* | Chiave MDBList per liste personalizzate e cataloghi anime. |
| `PICTORIUM_REGION` | `IT` | Nazione predefinita per classifiche e disponibilità streaming (`IT`, `US`, `GB`, `FR`, `DE`, `ES`, ecc.). |
| `PICTORIUM_DATA_DIR` | `./data` | Percorso della cartella per salvare configurazioni e poster su disco. In Docker deve puntare a un volume persistente (`/data`, volume `posterium-data`, scrivibile da uid 1000): il file nasce al primo save, quindi "not found" con 0 poster a installazione fresca è normale. |
| `PICTORIUM_REDIS_URL` | *(vuoto)* | Redis nativo (TCP) per HA multi-replica senza volume `/data`: mapping, default, profili, epoche e rate-limit diventano condivisi tra le repliche. Vince su `KV_REST_*` se entrambi settati (nessuna migrazione automatica). Su ElfHosted/K8s basta `REDIS_URL` (letto come fallback). |
| `KV_REST_API_URL` / `TOKEN` | *(vuoto)* | Credenziali Upstash Redis per deploy serverless su Vercel. |
| `PICTORIUM_HOSTED_BY` | *(vuoto)* | Sponsor/hosting pubblico: se `elfhosted` mostra il banner ElfHosted nella home (rilevamento automatico da host `elfhosted.com` come fallback). Vuoto = nessun banner. |
| `PICTORIUM_POSTER_PARAMS` | *(auto)* | Hardening anti cache-busting poster: `presets` limita le richieste non-preview a un set finito di render (allowlist cache key, step numerici 5/10/5px, `ac` solo palette, niente free-text/override keyless anonimi), `free` è il comportamento storico. Auto-`presets` su istanze pubbliche (`PUBLIC_INSTANCE=1`, `HOSTED_BY=elfhosted` o `MULTI_USER=1`); la preview WYSIWYG resta live negli spazi utente e sessioni sbloccate. |
| `PICTORIUM_PREVIEW_AUTH` | *(auto)* | Hardening preview: sulle istanze pubbliche le preview anonime (`preview=1` senza spazio né sessione) vengono declassate e cachate come normali (niente bypass bot). Con spazio reale o sessione sbloccata restano live. Auto-on sulle pubbliche (`PUBLIC_INSTANCE=1`, `HOSTED_BY=elfhosted`, `MULTI_USER=1`); `0` per forzare OFF, `1` per forzare ON. |
| `PICTORIUM_FRAME_ANCESTORS` | *(HF default)* | Sovrascrive i `frame-ancestors` CSP (default compatibile con HF Spaces). Es. `'self'` per istanze pubbliche che non vogliono essere embeddate. |

### Modalità Multi-Utente

| Variabile | Default | Descrizione |
|---|:---:|---|
| `PICTORIUM_MULTI_USER` | `0` | Se `1`, abilita gli spazi isolati per utenti su `/u/<uuid>/configure`. |
| `PROFILE_ENCRYPTION_KEY` | *(vuoto)* | **Obbligatoria** con `MULTI_USER=1`. Chiave hex a 64 caratteri (AES-256-GCM, genera con `openssl rand -hex 32`). |
| `PICTORIUM_MAX_MAPPINGS_PER_USER` | `500` | Numero massimo di poster salvabili per ogni utente. |
| `PICTORIUM_MAX_USERS` | *(illimitato)* | Limite massimo di utenti registrabili sull'istanza. |
| `PICTORIUM_PUBLIC_STATS` | `1` | Imposta `0` per restituire i conteggi utenti di `/api/status` solo agli admin (la striscia "spazi" in home resta nascosta ai visitatori). |

<details>
<summary><strong>⚙️ Variabili Avanzate, Stili Predefiniti & Pipeline</strong></summary>

### Stili Predefiniti di Rendering
| Variabile | Default | Descrizione |
|---|:---:|---|
| `PICTORIUM_BADGE_STYLE` | `shadow` | Stile badge genere/voto (`shadow`, `pill`, `bar`, `colored`, `bordo`, `vetro`). |
| `PICTORIUM_RANKING_BADGE_STYLE` | `default` | Stile del badge per le classifiche (`default`, `bar`, `colored`, `pill`, `netflix`). |
| `PICTORIUM_RIBBON_SIDE` | `left` | Lato del nastro Netflix Top 10 (`left` / `right`). |
| `PICTORIUM_BLUR_ENABLED` | `1` | Attiva o disattiva lo sfondo sfocato dei poster verticali. |
| `PICTORIUM_TINT_STRENGTH` | `20` | Intensità della tinta di scena per lo sfondo sfocato (0–100). |
| `PICTORIUM_BADGE_QUALITY` | `1` | Mostra/nasconde il badge di risoluzione video streaming (4K/FHD). |
| `PICTORIUM_QUALITY_SOURCE` | `torrentio` | Sorgente qualità streaming: `torrentio` (con fallback JustWatch), `justwatch` (solo JW), `none` (badge mai mostrato, zero upstream). |
| `PICTORIUM_NETWORK_LOGO` | `1` | Mostra/nasconde il logo del network o studio di produzione. |
| `PICTORIUM_PRE_RELEASE` | `0` | Velo scuro + nastro "Coming Soon" per film non ancora in streaming. |
| `PICTORIUM_GRADIENT_HEIGHT` | `65` | Altezza percentuale della sfumatura scura inferiore. |

### Concorrenza & Performance
| Variabile | Default | Descrizione |
|---|:---:|---|
| `PICTORIUM_MAX_CONCURRENT_RENDERS` | `4` | Limite massimo di render Sharp contemporanei (anti-OOM). |
| `PICTORIUM_RENDER_TIMEOUT_MS` | `30000` | Timeout massimo di rendering prima del fallback (ms). |
| `PICTORIUM_CACHE_MAX_MB` | `150` | Memoria RAM massima riservata alla cache immagini in memoria. |
| `PICTORIUM_SELF_WARMUP` | `1` | Preriscaldamento automatico dei cataloghi all'avvio del server. |
</details>

---

## 🧪 Sviluppo in Locale

```bash
# 1. Clona il repository
git clone https://github.com/Eful97/Pictorium.git && cd Pictorium

# 2. Installa le dipendenze
npm install

# 3. Avvia il server di sviluppo
npm run dev

# 4. Esegui i test unitari (Vitest)
npm test

# 5. Verifica completa (Typecheck + Lint + Test + Build)
npm run verify
```

---

## 📄 Licenza & Crediti

* Rilasciato sotto licenza open-source **GNU Affero General Public License v3.0 (AGPL-3.0)**.
* Ispirato al progetto [erdb](https://github.com/realbestia1/erdb) di realbestia1.
* Dati e metadati forniti da [TMDb](https://www.themoviedb.org/), [TheTVDB](https://thetvdb.com/) e [JustWatch](https://www.justwatch.com/).
* Loghi network e studi per gentile concessione di [Wikimedia Commons](https://commons.wikimedia.org/).
