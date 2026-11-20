# Fila di icone "Dove guardare" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opzione opt-in che disegna sul poster una fila di icone dei provider flatrate TMDB per il paese scelto.

**Architecture:** Un modulo dati (`watch-providers.ts`) e un renderer (`watch-providers-render.ts`) nuovi; due parametri (`watchProviders` bool, `watchRegion` string) cablati come `disabledNetworks` (stesso percorso defaults → config token → query → `poster-service`). Con l'opzione attiva la fila sostituisce il logo network nello stesso slot.

**Tech Stack:** Next.js (leggi skill `nextjs-docs`), sharp, zod, Vitest, Playwright. Skill di progetto: `tmdb-api`, `poster-sync`, `perf`, `pictorium-security`, `testing`.

**Spec:** `docs/superpowers/specs/2026-11-20-watch-providers-badge-design.md`

## Global Constraints

- Solo provider `flatrate` da `/{movie|tv}/{id}/watch/providers`, ramo `results[REGIONE]`, ordine di TMDB.
- Max 3 icone + contatore "+N" (N = provider totali − 3).
- Switch spento di default; con switch spento o senza dati/chiave/paese il poster è identico a oggi.
- Chiave TMDB request-scoped, mai env. Nessuna nuova env.
- Il fetch va in parallelo e non allunga il caso peggiore (cap 1500 ms, `AbortSignal.any`); nessuno slot di render tenuto durante l'attesa.
- Parametri validati come gli altri (`validation.ts`, regione solo se in `REGIONS`).
- Commit solo su richiesta dell'utente; durante il lavoro test mirati, batch completo prima dell'integrazione (AGENTS.md → Verification Strategy).

## Review Focus

- Titolo senza provider nel paese → poster identico a oggi, il logo network resta (Task 3).
- TMDB giù/timeout/401 → nessun errore, nessuna icona (Task 1, 3).
- `watchRegion` non valida o malevola (`../`, lunga, minuscola) → ignorata, si usa `posterRegion` (Task 2).
- Provider senza `logo_path` → saltato, non una casella vuota (Task 1).
- Esattamente 3 provider → niente "+N"; 4 → "+1" (Task 3).

---

### Task 1: Dati provider

**Files:**
- Create: `src/lib/watch-providers.ts`
- Test: `src/__tests__/lib/watch-providers.test.ts` (segui la cartella test esistente più vicina)

**Interfaces:**
- Produces: `interface WatchProvider { readonly id: number; readonly name: string; readonly logoPath: string }`; `parseWatchProviders(json: unknown, region: string): WatchProvider[]`; `getWatchProviders(mediaType: "movie" | "tv", tmdbId: number, region: string, apiKey: string | undefined, signal?: AbortSignal): Promise<WatchProvider[]>` (mai throw, `[]` su errore).

- [ ] **Step 1: Test falliti** — `parseWatchProviders` con fixture `{results:{IT:{flatrate:[{provider_id:8,provider_name:"Netflix",logo_path:"/n.jpg",display_priority:0}, …]}}}`: ordine per `display_priority`; scarta voci senza `logo_path`; `rent`/`buy` ignorati; regione assente → `[]`; input non-oggetto/`__proto__` → `[]`. `getWatchProviders` con `fetch` mockato: 401 e rete giù → `[]` senza throw.
- [ ] **Step 2: Esegui** `npx vitest run src/__tests__/lib/watch-providers.test.ts` → FAIL.
- [ ] **Step 3: Implementa** i due export in `src/lib/watch-providers.ts`; `getWatchProviders` usa `tmdbFetch` (vedi `tmdb.ts`, esportalo se serve) con la stessa cache/coalescing dei dettagli.
- [ ] **Step 4: Esegui** lo stesso comando → PASS.

### Task 2: Parametri `watchProviders` / `watchRegion` end-to-end

**Files (modella ogni punto su `disabledNetworks`, stessi file):**
- Modify: `src/lib/types.ts`, `src/lib/server-defaults.ts:457`, `src/lib/validation.ts`, `src/app/api/defaults/route.ts:354`, `src/lib/config-token.ts`, `src/app/api/config-token/route.ts`, `src/lib/poster-config.ts`, `src/lib/poster-url.ts`, `src/lib/stremio-poster-params.ts`, `src/lib/stremio-poster-url.ts`, `src/lib/save-defaults.ts`, `src/lib/useDefaults.ts`, `src/lib/useLocalConfigToken.ts`, `src/lib/context.tsx`, `src/lib/contexts/PosterEditorContext.tsx`, `src/components/settings/useSettingsSession.ts`, `src/app/api/poster/[type]/[id]/route.ts` (~688, ~889)
- Test: aggiungi casi ai test di `validation`, `poster-config`, `poster-url` esistenti.

**Interfaces:**
- Produces: campi `watchProviders?: boolean` (default `false`) e `watchRegion?: string` (codice `REGIONS`, es. `"IT"`); query `wp` (`"1"` solo se ON) e `wpr` (solo se ≠ default); catena `query > config token > server defaults > default`; risolti in `route.ts` e passati a `poster-service` come `watchProviders: boolean` e `watchRegion: string` (già con fallback a `posterRegion.code`).

- [ ] **Step 1: Test falliti** — validation accetta `"IT"`/`"US"`, scarta `"it"`, `"../"`, stringhe >2 caratteri e non in `REGIONS`; `poster-url` emette `wp=1` solo se ON; roundtrip defaults → token → query mantiene i due valori.
- [ ] **Step 2: Esegui** i test toccati con `npx vitest run <file>` → FAIL.
- [ ] **Step 3: Implementa** il cablaggio punto per punto seguendo `disabledNetworks`; regione non valida → `undefined` (mai errore).
- [ ] **Step 4: Esegui** gli stessi test + parity mirati → PASS.

### Task 3: Fetch, renderer e slot network

**Files:**
- Create: `src/lib/watch-providers-render.ts`
- Modify: `src/app/api/poster/[type]/[id]/resolve-sources.ts` (accanto a r.352), `src/lib/poster-service.ts` (~1533-1591, slot network)
- Test: `src/__tests__/rendering/watch-providers-render.test.ts`

**Interfaces:**
- Consumes: Task 1 (`getWatchProviders`, `WatchProvider`), Task 2 (`watchProviders`, `watchRegion`).
- Produces: `renderWatchProviderRow(providers: readonly WatchProvider[], iconPx: number): Promise<{ png: Buffer; w: number; h: number } | null>` (stesso tipo bitmap di `networkLogoForLayout`); `null` se la lista è vuota.

- [ ] **Step 1: Test falliti** — 0 provider → `null`; 3 → larghezza = 3 icone + 2 gap, nessun "+N"; 4 → compare "+1" (larghezza maggiore del caso 3); download logo fallito per un provider → saltato.
- [ ] **Step 2: Esegui** `npx vitest run src/__tests__/rendering/watch-providers-render.test.ts` → FAIL.
- [ ] **Step 3: Implementa** il renderer: icone quadrate arrotondate via sharp, loghi da `image.tmdb.org` con lo stesso fetch sicuro usato da `network-svgs.ts` (SSRF-safe); contatore "+N" come piccolo badge testuale riusando l'helper testo esistente.
- [ ] **Step 4: Integra** — in `resolve-sources.ts` avvia `getWatchProviders` in parallelo (cap 1500 ms, `AbortSignal.any([renderAbort.signal, …])`) solo se `watchProviders`; in `poster-service.ts`, se la lista non è vuota, `networkRawResult`/`networkLogoForLayout` diventano la fila; lista vuota → ramo network attuale invariato.
- [ ] **Step 5: Esegui** il test del renderer + un render di prova con il mock server (`e2e/mock-server.mjs`) → PASS, poster con switch OFF byte-identico (snapshot esistenti invariati).

### Task 4: Impostazioni, preview e i18n

**Files:**
- Modify: `src/components/settings/TagsNetworksSection.tsx`, `src/components/settings/DefaultsPosterPreview.tsx`, `src/lib/translations/*.json` (tutte le lingue; `en.json` e `it.json` tradotte, le altre con la stringa inglese come le chiavi simili)
- Test: caso nel test di componente/i18n esistente (chiavi presenti in tutte le lingue).

**Interfaces:**
- Consumes: `ed.watchProviders`, `ed.setWatchProviders`, `ed.watchRegion`, `ed.setWatchRegion` (da Task 2, `PosterEditorContext`).

- [ ] **Step 1: Test fallito** — le chiavi `ui.watchProviders` e `ui.watchRegion` esistono in ogni file di traduzione.
- [ ] **Step 2: Implementa** `Toggle` "Mostra dove guardare" + `<select>` paese (da `REGIONS`, flag + label) visibile solo con lo switch ON, nella sezione Tag e Network; la preview client passa `wp`/`wpr` come il server.
- [ ] **Step 3: Esegui** i test i18n/UI mirati → PASS.

### Task 5: Contratto, versione e verifica

**Files:**
- Modify: `.agents/render-params.md` (righe `wp`/`wpr` accanto a `netLogo`), `src/data/changelog.ts` (voce 1.28.0)
- Regenerate: `node scripts/write-render-version.mjs`

- [ ] **Step 1:** documenta `wp`/`wpr` nel contratto (client `poster-url.ts` ↔ server `poster-config.ts`, catena di precedenza, "emesso solo se ON").
- [ ] **Step 2:** rigenera RENDER_VERSION; aggiungi la nota al changelog.
- [ ] **Step 3:** aggiungi uno scenario visuale mirato (`--grep "watch providers"`, vedi `.agents/visual-testing.md`) e crea lo snapshot solo per questo caso.
- [ ] **Step 4: Batch finale** `npm run verify` → tutto verde; nessuno snapshot esistente cambiato.
