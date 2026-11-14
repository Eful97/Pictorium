# Pictorium — Deploy

[← Torna al README](../README.it.md) · [🇬🇧 English](DEPLOY.md)

## 🚢 Deploy

| Piattaforma | Costo | Tipologia | Persistenza | Ideale per |
|---|---|---|---|---|
| [▲ **Vercel**](#-vercel-consigliato) | **Gratis** | Serverless | Upstash Redis (KV) | **Consigliato**: 1 click, zero manutenzione, CDN globale ([📺 Video guida](https://www.youtube.com/watch?v=FP6VJ2vGYiY)) |
| [🐳 **Docker Compose**](#-docker-e-compose) | **Gratis** | Container | Volume locale (`/data`) | NAS, home server, mini-PC (Unraid, TrueNAS, CasaOS) |
| [🤗 **Hugging Face**](#-altri-metodi-di-installazione) | **Gratis** | Docker (16 GB RAM) | Storage bucket | Ottima RAM gratuita per istanze condivise |
| [🦾 **Oracle Cloud**](#-altri-metodi-di-installazione) | **Gratis** | VPS ARM (24 GB RAM) | Disco locale | Sempre online con risorse dedicate a costo zero |

### ▲ Vercel (consigliato)

[![Video Guida YouTube](https://img.shields.io/badge/YouTube-Video_Guida_Setup-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=FP6VJ2vGYiY)

> 📺 Segui la [procedura su YouTube](https://www.youtube.com/watch?v=FP6VJ2vGYiY) per completare il setup in meno di 2 minuti.

1. **Ottieni una chiave API TMDB gratuita**: registrati su [themoviedb.org](https://www.themoviedb.org/signup), apri **Impostazioni → API** e copia la **Chiave API (v3 auth)** (32 caratteri).
2. **Fai il fork del repository**: clicca **Fork** su [github.com/Eful97/Pictorium](https://github.com/Eful97/Pictorium).
3. **Importa su Vercel**: [vercel.com](https://vercel.com) → **Add New… → Project** → importa il fork. Variabili d'ambiente (tutte opzionali tranne `CONFIG_HMAC_SECRET`; Redis arriva al passo successivo):
   * `PICTORIUM_ADMIN_TOKEN` = *un segreto a tua scelta* (opzionale: senza, il primo PIN impostato dalla UI è libero)
   * `CONFIG_HMAC_SECRET` = *un segreto lungo e casuale* (obbligatorio in produzione per i link `?config=` di condivisione/installazione)
   * `PROFILE_ENCRYPTION_KEY` = *hex di 64 caratteri* (obbligatoria solo con `PICTORIUM_MULTI_USER=1`)
   * `PICTORIUM_TMDB_KEY` = *la tua chiave TMDB v3* (opzionale: puoi salvarla dopo il deploy in Impostazioni → Dati & Cache → Configura chiavi API)
   * `CRON_SECRET` = *un segreto casuale* (permette al cron notturno `/api/warmup` di autenticarsi — Vercel lo invia come `Authorization: Bearer <CRON_SECRET>`; senza, la route risponde 401)
4. **Collega Upstash Redis — sempre obbligatorio**: il filesystem di Vercel è read-only, quindi senza Redis mapping e impostazioni non persistono e gli spazi degradano a link `?config=` stateless. Nella dashboard del progetto apri **Storage → Connect Store → Upstash (Redis)** e conferma la creazione. Vercel inietta `KV_REST_API_URL` / `KV_REST_API_TOKEN` (nomi legacy accettati); valgono anche i nomi canonici `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` e un `PICTORIUM_REDIS_URL` nativo.
5. **Redeploy**: scheda **Deployments** → **⋯** sull'ultimo deployment → **Redeploy** (necessario per agganciare Upstash).
6. **Sblocca l'editor, aggiungi le chiavi e installa**: apri l'URL della tua istanza, imposta il primo PIN (Impostazioni → Dati & Cache) oppure incolla `PICTORIUM_ADMIN_TOKEN` in **Impostazioni → Token admin**. Salva le chiavi TMDB/MDBList/TVDB in **Impostazioni → Dati & Cache → Configura chiavi API** (cifrate a riposo, risolte dalle richieste Stremio anonime senza env). Poi clicca su **Installa su Stremio**.

> **Durata delle funzioni**: con Fluid compute (il default attuale) le funzioni Hobby arrivano fino a 300s, e l'app limita le proprie route ben al di sotto (poster 40s, cataloghi 60s, warmup 60s). Un render a freddo o un upstream lento può comunque rispondere con un 503 limitato; mantenere i cataloghi caldi riduce il rischio.

> **Aggiornamenti futuri**: nel tuo fork clicca **Sync fork → Update branch**. Vercel effettua il redeploy in circa 60 secondi senza toccare i tuoi dati.

### 🐳 Docker e Compose

Usa il `docker-compose.yml` già incluso nel repo (hardening, healthcheck e volume persistente `posterium-data` montato su `/data` — i salvataggi sopravvivono ai rebuild del container):

```bash
git clone https://github.com/Eful97/Pictorium && cd Pictorium
cp .env.example .env
docker compose up -d
```

Metti i valori in `.env` — Docker Compose non legge `.env.local`. Sia `PICTORIUM_TMDB_KEY` sia `PICTORIUM_ADMIN_TOKEN` sono opzionali:

* **Istanze domestiche / LAN**: lasciale vuote e avvia. Al primo avvio imposta il PIN in **Impostazioni → Dati & Cache** (6+ cifre, oppure una password di 8–128 caratteri): senza token admin il primo PIN è libero e da lì in poi sblocca l'editor. Gli endpoint Stremio restano pubblici.
* **Esposta su internet o `PICTORIUM_MULTI_USER=1`**: imposta `PICTORIUM_ADMIN_TOKEN` (più `PROFILE_ENCRYPTION_KEY` in multi-utente). Se un token esiste prima che ci sia un PIN, incollalo prima in **Impostazioni → Token admin**: serve per impostare il primo PIN.
* **Chiavi API**: non ti serve `PICTORIUM_TMDB_KEY` nel file. Dopo lo sblocco apri **Impostazioni → Dati & Cache → Configura chiavi API** e salva la chiave TMDB (gratis su [themoviedb.org/signup](https://www.themoviedb.org/signup) → **Impostazioni → API → API Key (v3 auth)**), più MDBList/TVDB se le usi. Sono cifrate a riposo nel volume `/data`; le richieste Stremio anonime le risolvono senza env, mentre le richieste scoped `?u=` non le usano mai.

> Il primo avvio compila l'immagine in locale (qualche minuto, di più su ARM). Per partire subito con l'immagine precompilata: `docker compose pull pictorium && docker compose up -d --no-build`. Le route admin sono chiuse di default (fail-closed): è una sessione PIN valida (oppure il token incollato in **Impostazioni → Token admin**, solo sessione) a sbloccare warmup, cache e salvataggi dalla UI. Il vecchio `PICTORIUM_PUBLIC_INSTANCE` è stato rimosso: se ancora impostato viene ignorato e non apre nulla.
>
> Se venivi dal vecchio esempio con volume `pictorium-data` e hai già salvataggi, copiali prima di passare al compose del repo: `docker run --rm -v pictorium-data:/from -v posterium-data:/to alpine cp -a /from/. /to/`

Apri `http://<IP-SERVER>:8080`, sblocca l'editor e clicca su **Installa su Stremio**. Il manifest vive sulla stessa origine (`/manifest.json`).

### 👉 Altri metodi di installazione

<details>
<summary><strong>Hugging Face, Oracle Cloud, VPS Caddy, Termux</strong></summary>

#### 🤗 Hugging Face Spaces
Hugging Face legge la configurazione dello Space dall'intestazione YAML del `README.md` dello Space. Mettila in cima al README del tuo Space (`app_port: 8080` è obbligatorio, il default 7860 non funziona):

```yaml
---
title: Pictorium
emoji: 🖼️
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 8080
pinned: false
---
```

1. Crea una Space su Hugging Face con SDK **Docker** collegata al repo `Eful97/Pictorium`.
2. In **Settings → Variables and secrets**:
   * `NODE_OPTIONS` = `--max-old-space-size=1024`
   * `PICTORIUM_ADMIN_TOKEN` = *un segreto a tua scelta* (una Space pubblica lo richiede; incolla lo stesso valore in Impostazioni → Token admin per sbloccare l'editor)
   * `PICTORIUM_TMDB_KEY` = *la tua chiave TMDB* (opzionale: puoi anche salvarla da Impostazioni → Dati & Cache → Configura chiavi API dopo il primo sblocco)
3. In **Settings → Storage**, collega uno Storage Bucket montato su `/data`.

#### 🦾 Oracle Cloud Always Free (ARM Ampere)
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
git clone https://github.com/Eful97/Pictorium && cd Pictorium
cp .env.example .env
```
Compila `PICTORIUM_TMDB_KEY` e `PICTORIUM_ADMIN_TOKEN` nel `.env` (puoi omettere la chiave TMDB e salvarla dopo da Impostazioni → Dati & Cache → Configura chiavi API), aggiungi `CONFIG_HMAC_SECRET` se ti servono i link `?config=`, poi `sudo docker compose up -d`. Incolla il token in **Impostazioni → Token admin** (solo sessione). Le route admin sono sempre fail-closed senza token o sessione PIN; il vecchio `PICTORIUM_PUBLIC_INSTANCE` è rimosso e ignorato.

#### 🖥️ VPS + Caddy (HTTPS automatico)
```caddyfile
tuodominio.com {
    reverse_proxy pictorium:8080
}
```
Su dominio pubblico proteggi l'editor con `PICTORIUM_ADMIN_TOKEN` (sblocco in Impostazioni → Token admin): senza, le route admin restano chiuse (fail-closed). Aggiungi `CONFIG_HMAC_SECRET` per i link `?config=` e `PROFILE_ENCRYPTION_KEY` quando `PICTORIUM_MULTI_USER=1`.

#### 📱 Termux (Android)
Termux diretto non è supportato: manca glibc e `sharp` non ha build per Android. Usa Debian via proot-distro:
```bash
pkg install proot-distro -y
proot-distro install debian
proot-distro login debian
# dentro Debian (il nodejs di bookworm è v18, il progetto richiede Node 22+):
apt update && apt install -y curl ca-certificates gnupg git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # deve stampare v22.x
git clone https://github.com/Eful97/Pictorium && cd Pictorium
npm ci && npm run build
PORT=8080 node .next/standalone/server.js
```

</details>
