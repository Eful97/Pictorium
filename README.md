---
title: Posterium
emoji: 🖼️
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 8080
pinned: false
---

<p align="center">
  <img src="public/posterium.png" alt="Posterium" width="380" />
</p>

<h3 align="center">Generatore Dinamico di Poster Cinematografici per Stremio & Media Center</h3>

<p align="center">
  Locandine clean senza testo, loghi vettoriali ad alta definizione, rating IMDb/TMDB/Rotten Tomatoes, badge qualità streaming 4K, classifiche Netflix Top 10 e ordinamento stagioni intelligente. Tutto renderizzato al volo con Sharp C++ & SVG.
</p>

<p align="center">
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FEful97%2FPosterium"><img src="https://vercel.com/button" alt="Deploy with Vercel" /></a>
  <a href="#-docker--compose"><img src="https://img.shields.io/badge/Docker-Supported-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" /></a>
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js&logoColor=white" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-green?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square" alt="License AGPLv3" />
</p>

---

## 📸 Anteprima

<div align="center">
  <img src="https://raw.githubusercontent.com/Eful97/Posterium/master/public/Screen/home.png" alt="Posterium Home" width="100%" style="border-radius: 8px; margin-bottom: 8px;" />
</div>

<table align="center" width="100%">
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/Eful97/Posterium/master/public/Screen/editor.png" alt="Posterium Editor" style="border-radius: 6px;" /></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/Eful97/Posterium/master/public/Screen/myposters.png" alt="Posterium My Posters" style="border-radius: 6px;" /></td>
  </tr>
  <tr>
    <td align="center"><em>Editor WYSIWYG & Anteprima Live</em></td>
    <td align="center"><em>I Miei Poster & Gestione Cataloghi</em></td>
  </tr>
</table>

<div align="center" style="margin-top: 12px;">
  <img src="https://raw.githubusercontent.com/Eful97/Posterium/master/public/Screen/1405.jpg" alt="Poster Demo — Rapacità" width="32%" style="border-radius: 6px;" />
  <img src="https://raw.githubusercontent.com/Eful97/Posterium/master/public/Screen/79696.jpg" alt="Poster Demo — Manifest" width="32%" style="border-radius: 6px;" />
  <img src="https://raw.githubusercontent.com/Eful97/Posterium/master/public/Screen/97546.jpg" alt="Poster Demo — Ted Lasso" width="32%" style="border-radius: 6px;" />
</div>

---

## ⚡ Caratteristiche Principali

| Funzionalità | Descrizione |
|---|---|
| 🎯 **Motore Grafico WYSIWYG** | Un unico endpoint (`/api/poster/{type}/{id}`) basato su Sharp C++ ed SVG serve l'anteprima web in tempo reale e il poster finale su Stremio con pixel-perfect sync. |
| 📦 **Addon 100% Autonomo** | Fornisce direttamente a Stremio schede dettagliate, trame in italiano, loghi trasparenti, sfondi 4K, trailer YouTube e tutte le stagioni con thumbnail ed episodi tradotti. |
| 📺 **Ordinamento Intelligente Parti & Anime** | Rileva automaticamente i gruppi **Original Parts** (es. *La Casa di Carta*, *Lupin*) e spacchetta le mega-stagioni uniche degli anime su TMDB (es. *Re:ZERO*, *Jujutsu Kaisen*) nelle vere stagioni con cui sono distribuiti. |
| 🏷️ **Badge Qualità & Voti** | Visualizza in tempo reale risoluzione video (4K/1080p/720p), voti aggregati da oltre 16 fonti (IMDb, TMDB, Rotten Tomatoes, Letterboxd, MAL), premi Oscar/Cannes e nastri Netflix Top 10. |
| 🌐 **Cataloghi Personalizzati** | Importa watchlist e collezioni da **Letterboxd, Trakt, TMDb, TheTVDB, MDBList** e classifiche trend in tempo reale tramite JustWatch GraphQL. |
| ⚡ **Zero Conflitti di Cache** | Versioning deterministico con `RENDER_VERSION` e `APP_VERSION` automatiche. Se cambi uno stile, Stremio aggiorna istantaneamente le immagini. |

---

## 🛠️ Funzionalità in Dettaglio

### 🖼️ Locandine, Loghi & Grafica
* **Selezione Poster Clean**: Scegli in un click la locandina senza testo tra i candidati ufficiali TMDB (`iso_639_1 === null`).
* **Algoritmo Best-Fit Intelligente**: Analizza luminosità e zone vuote per scalare e posizionare il logo evitando di coprire i volti.
* **Sfocatura Sfondo (Sharp C++)**: Generazione di sfondi blur cinematografici ultra-rapidi (10–20ms) a basso consumo di RAM.
* **Rotazione Automatica 24h**: Alterna automaticamente ogni giorno più poster salvati per lo stesso titolo.
* **Loghi Network Ufficiali**: Riconoscimento ed embedding automatico per Netflix, Prime Video, Disney+, Apple TV+, HBO Max, Paramount+, Sky/NOW, Crunchyroll, Rai, Mediaset e oltre 30 studi (Marvel, Pixar, Ghibli, Warner Bros, A24).

### 🏷️ Badge, Rating & Riconoscimenti
* **✨ Qualità Streaming (4K / 1080p / 720p / SD)**: Rilevata in tempo reale dai flussi di Stremio con fallback automatico su JustWatch.
* **6 Stili Badge Genere & Voto**: *Shadow, Pill, Bar, Colored, Bordo, Vetro* con palette adattiva alla locandina.
* **Nastro Verticale Netflix Top 10**: Il caratteristico nastro rosso laterale con posizione live (supporto dedicato anche per Anime).
* **Premi Cinematografici**: Riconoscimento automatico Oscar, Cannes, BAFTA, Emmy e badge *"Absolute Cinema"* per i titoli della IMDb Top 250.
* **Classifiche Sempre Sincronizzate**: Il badge Top 10/20 segue la classifica live; se un titolo esce dalla chart, il badge si aggiorna da solo.

### 📺 Stagioni, Episodi & Anime
* **✨ Rilevamento Automatico Parti**: Passa in automatico da stagioni standard a Parti originali per serie come *La Casa di Carta* (5 parti) e *Lupin* (4 parti).
* **🌀 Spacchettamento Anime**: Risolve la catalogazione TMDB che comprime intere serie anime in una sola stagione (es. *Re:ZERO* 85 episodi, *Jujutsu Kaisen* 59 episodi), ripristinando la corretta suddivisione stagionale (S1, S2, S3, S4 + Speciali in S0).
* **Supporto TVDB & AniZip**: Possibilità di selezionare manualmente gli ordinamenti alternativi TheTVDB (*Aired, DVD, Absolute, Alternate*) o AniZip (*AniList / AniDB*).
* **Anteprima Episodi Live**: Visualizza prima di salvare esattamente come appariranno le stagioni, i titoli e le miniature in Stremio.

---

## 🚀 Deploy Rapido

Scegli la modalità più comoda per la tua installazione:

| Piattaforma | Costo | Tipologia | Persistenza | Ideale per |
|---|---|---|---|---|
| [▲ **Vercel**](#-vercel-1-click) | **Gratis** | Serverless | Upstash Redis (KV) | **Consigliato**: 1 click, zero manutenzione, CDN globale |
| [🐳 **Docker Compose**](#-docker--compose) | **Gratis** | Container | Volume locale (`/data`) | NAS, Home Server, mini-PC (Unraid/TrueNAS) |
| [🤗 **Hugging Face**](#-hugging-face-spaces) | **Gratis** | Docker (16GB RAM) | Storage Bucket | Ottima RAM gratuita per istanze condivise |
| [🦾 **Oracle Cloud**](#-altre-modalit-di-installazione) | **Gratis** | VPS ARM (24GB RAM) | Disco Locale | Sempre online con risorse dedicate a costo zero |

---

### ▲ Vercel (1-Click)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FEful97%2FPosterium)

1. Clicca sul pulsante **Deploy with Vercel** qui sopra e crea il progetto.
2. Nella dashboard di Vercel, vai su **Storage** → **Create Database** → seleziona **Upstash (Redis)** e collegalo al progetto (imposta automaticamente `KV_REST_API_URL` e `KV_REST_API_TOKEN`).
3. Vai in **Settings → Environment Variables** e aggiungi:
   * `POSTERIUM_PUBLIC_INSTANCE` = `1`
   * `POSTERIUM_TMDB_KEY` = *La tua chiave TMDB* ([registrati gratis su TMDB](https://www.themoviedb.org/settings/api))
4. Vai su **Deployments** → menu **⋯** → **Redeploy**.
5. Apri l'URL generato e clicca su **Installa su Stremio**!

---

### 🐳 Docker & Compose

Crea un file `docker-compose.yml`:

```yaml
services:
  posterium:
    image: eful97/posterium:latest # o build locale: .
    container_name: posterium
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - POSTERIUM_PUBLIC_INSTANCE=1
      - POSTERIUM_TMDB_KEY=la_tua_chiave_tmdb
    volumes:
      - posterium-data:/data

volumes:
  posterium-data:
```

Avvia il container:
```bash
docker compose up -d
```
Il manifest per Stremio sarà disponibile su: `http://<IP-SERVER>:8080/manifest.json`.

---

<details>
<summary><strong>👉 Altre modalità di installazione (Hugging Face, Oracle Cloud, VPS Caddy, Termux)</strong></summary>

#### 🤗 Hugging Face Spaces
1. Crea una Space su Hugging Face con SDK **Docker** collegata al repo `Eful97/Posterium`.
2. In **Settings → Variables and secrets**:
   * `NODE_OPTIONS` = `--max-old-space-size=1024`
   * `POSTERIUM_PUBLIC_INSTANCE` = `1`
   * `POSTERIUM_TMDB_KEY` = *la tua chiave TMDB*
3. In **Settings → Storage**, collega uno Storage Bucket montato su `/data`.
4. Manifest Stremio: `https://<tua-space>.hf.space/manifest.json`.

#### 🦾 Oracle Cloud Always Free (ARM Ampere)
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
git clone https://github.com/Eful97/Posterium && cd Posterium
echo "POSTERIUM_PUBLIC_INSTANCE=1" > .env
echo "POSTERIUM_TMDB_KEY=la_tua_chiave" >> .env
sudo docker compose up -d
```

#### 🖥️ VPS + Caddy (HTTPS Automatico)
```caddyfile
tuodominio.com {
    reverse_proxy posterium:8080
}
```

#### 📱 Termux (Android)
```bash
pkg update && pkg install nodejs git -y
git clone https://github.com/Eful97/Posterium && cd Posterium
npm install --ignore-scripts && npm run build && npm start
```
</details>

---

## 🔑 Configurazione & Variabili d'Ambiente

### Variabili Essenziali

| Variabile | Default | Descrizione |
|---|:---:|---|
| `POSTERIUM_PUBLIC_INSTANCE` | `0` | Imposta a `1` su Vercel/HF per consentire il salvataggio dei poster e l'uso dell'editor senza token admin. |
| `POSTERIUM_TMDB_KEY` | *(opzionale)* | Chiave API TMDB d'istanza per generare poster e cataloghi senza doverla inserire nei client. |
| `POSTERIUM_TVDB_API_KEY` | *(opzionale)* | Chiave TheTVDB per ordinamenti stagioni alternativi e descrizioni episodi. |
| `POSTERIUM_MDBLIST_KEY` | *(opzionale)* | Chiave MDBList per liste personalizzate e cataloghi anime. |
| `POSTERIUM_REGION` | `IT` | Paese delle classifiche JustWatch/FlixPatrol e lingua dei titoli (`IT`, `US`, `GB`, `FR`, `DE`, `ES`, `JP`, `KR`, `BR`, `IN`, `CA`, `AU`). Overridabile per-richiesta con `?region=` e per-utente via config-token/default salvati. |
| `POSTERIUM_DATA_DIR` | `./data` | Cartella di persistenza su disco per database e file salvati. |
| `KV_REST_API_URL` / `TOKEN` | *(vuoto)* | Parametri di connessione Upstash Redis per deploy serverless su Vercel. |

---

<details>
<summary><strong>⚙️ Variabili Avanzate, Stili Predefiniti & Pipeline di Rendering</strong></summary>

### Stili Grafici Predefiniti per i Cataloghi
| Variabile | Valori | Effetto |
|---|---|---|
| `POSTERIUM_BADGE_STYLE` | `shadow`, `pill`, `bar`, `colored`, `bordo`, `vetro` | Stile dei badge genere/voto. |
| `POSTERIUM_RANKING_BADGE_STYLE` | `default`, `bar`, `colored`, `pill`, `netflix` | Stile del badge per le classifiche. |
| `POSTERIUM_RIBBON_SIDE` | `left` / `right` | Lato del nastro verticale Netflix Top 10. |
| `POSTERIUM_BLUR_ENABLED` | `1` / `0` | Attiva o disattiva lo sfondo sfocato. |
| `POSTERIUM_BADGE_QUALITY` | `1` / `0` | Mostra/nasconde il badge qualità streaming (4K/1080p). |
| `POSTERIUM_NETWORK_LOGO` | `1` / `0` | Mostra/nasconde il logo del network (Netflix, Prime, ecc.). |
| `POSTERIUM_GRADIENT_HEIGHT` | `5` – `100` | Altezza percentuale del gradiente nero inferiore. |

### Concorrenza & Protezione Memoria
| Variabile | Default | Descrizione |
|---|:---:|---|
| `POSTERIUM_MAX_CONCURRENT_RENDERS` | `4` | Massimo numero di render paralleli su Sharp (protezione OOM). |
| `POSTERIUM_RENDER_TIMEOUT_MS` | `30000` | Timeout massimo per completare un render (ms). |
| `POSTERIUM_CACHE_MAX_MB` | `150` | Memoria RAM massima riservata alla cache delle immagini. |
| `POSTERIUM_SELF_WARMUP` | `1` | Preriscaldamento automatico dei cataloghi all'avvio. |
| `POSTERIUM_LOG_LEVEL` | `info` | Livello di log (`debug`, `info`, `warn`, `error`). |
</details>

---

## 🧪 Sviluppo in Locale

```bash
# 1. Clona il repository
git clone https://github.com/Eful97/Posterium && cd Posterium

# 2. Installa le dipendenze
npm install

# 3. Avvia il server di sviluppo
npm run dev

# 4. Esegui i test unitari (Vitest)
npm test

# 5. Verifica completa del codice (Typecheck + Lint + Unit test + Build)
npm run verify
```

---

## 📄 Licenza & Crediti

* Rilasciato sotto licenza open-source **GNU Affero General Public License v3.0 (AGPL-3.0)**.
* Ispirato al progetto [erdb](https://github.com/realbestia1/erdb) di realbestia1.
* Dati e metadati forniti da [TMDb](https://www.themoviedb.org/), [TheTVDB](https://thetvdb.com/) e [JustWatch](https://www.justwatch.com/).
* Loghi network e studi cinematografici per gentile concessione di [Wikimedia Commons](https://commons.wikimedia.org/).
