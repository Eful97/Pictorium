# Report Audit — Pictorium

**Data:** 31/08/2026 · **Commit:** `089e152` (master) · **Working tree:** pulita al momento dell'audit

## Verifiche eseguite

| Verifica | Esito |
|---|---|
| `npx tsc --noEmit` | ✅ Nessun errore |
| `npx eslint .` | ⚠️ 0 errori, 3 warning |
| `npx vitest run` (unit) | ✅ 78 file, **668/668 test passano** |
| `npm audit --omit=dev` | 🔴 **4 vulnerabilità high (sharp)** |
| Review manuale security-critical code | proxy SSRF, auth, token HMAC, rate-limit, store, cache, Docker |

---

## 🔴 Criticità ALTA

### 1. `sharp <0.35.0` — 4 CVE high in libvips (inherited)

`npm audit` segnala **sharp 0.34.5** con vulnerabilità ereditate da libvips:
**CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591**
(GHSA-f88m-g3jw-g9cj), severità **high**.

È la criticità più rilevante in assoluto perché **sharp è il cuore della pipeline
poster** (`route.ts → poster-runtime-cache.ts → poster-service.ts`): decodifica
immagini remote **non fidate** (poster/backdrop TMDB, loghi, immagini proxyate
dagli addon). Le CVE di decoding di libvips su input non fidato sono esattamente
il vettore esposto dall'applicazione.

**Fix:** aggiornare a `sharp@0.35.4`. Attenzione: è una modifica al rendering →
per il Golden Rule serve rieseguire `e2e/pictorium-visual.spec.ts` e verificare
che `RENDER_VERSION`/snapshot non cambino; se l'output visivo cambia,
rigenerare la render version con `node scripts/write-render-version.mjs` (mai a mano).

## 🟡 Criticità MEDIE

### 2. 3 warning `react-hooks/exhaustive-deps` — possibili stale closure

- `src/components/EditView.tsx:162` — dipendenza `selected` mancante
- `src/components/EditView.tsx:177` — dipendenza `rightTabs` mancante
- `src/components/EpisodeGroupControls.tsx:97` — dipendenze `selected` e `tvdbError` mancanti

Non sono errori, ma nei `useEffect` editor-side (WYSIWYG) una stale closure può
causare preview non sincronizzate col server — esattamente il rischio che il
Golden Rule vuole prevenire. Da valutare: o aggiungere le dipendenze, o
documentare perché sono volute (eslint-disable mirato).

### 3. Rate-limit in-memory per-process (limite architetturale noto)

`src/lib/rate-limit.ts` usa una `Map` locale al processo. Su deploy
**multi-istanza** (HF Spaces con più replica, Vercel serverless multi-lambda)
i bucket non sono condivisi: il limite effettivo è `N × maxTokens`. Il codice è
corretto per singola istanza ed è un trade-off documentato, ma su istanze
pubbliche ad alto traffico resta il perimetro anti-abuse più debole.
Eventuale mitigazione futura: bucket su KV/Upstash quando `KV_REST_API_URL`
è configurato.

## 🟢 Osservazioni MINORI / hardening già buono

1. **CSP parziale** (`next.config.ts`, `vercel.json`): contiene solo
   `frame-ancestors`. Nessun `default-src`/`script-src`, quindi non mitiga XSS.
   Rischio contenuto (React escapa l'output, e l'unico `dangerouslySetInnerHTML`
   è `InstallModal.tsx:208` con SVG QR generato localmente dalla lib `qrcode`,
   non da input utente) — ma estendere la CSP sarebbe hardening a costo quasi zero.
2. **`isSameOrigin` (CSRF)**: fail-closed correttamente implementato, con
   X-Forwarded-Host fidato solo se combacia con Host o allowlist. Ok.
3. **SSRF nel proxy addon**: protezione solida — DNS pin via `undici Agent`,
   check su tutti gli IP risolti (A+AAAA), redirect manuali ri-validati, path
   allowlist solo per resource addon, parametri chiave stripped. Nessun problema.
4. **Config token HMAC**: fail-closed in produzione senza secret, firma
   verificata in constant-time, clamp difensivo dei numeri. Ok.
5. **Store mappings**: write queue + atomic rename (tmp file), riretta da disco
   dentro la coda (fix lost-update), cache KV con inflight dedup. Ok.
6. **Cache**: bounds su entry/byte/MAX_TTL, cleanup timer che si auto-spegne. Ok.
7. **Docker**: non-root uid 1000, `cap_drop: ALL`, `no-new-privileges`,
   healthcheck, limit 512M vs `--max-old-space-size=384` (margine presente ma
   sottile se sharp fa burst: già mitigato da `SHARP_CACHE_MEMORY_MB`).
8. **`.env.local`** presente in locale ma correttamente ignorato da git (`.env*`).

---

## Esito remediation (31/08/2026)

| # | Criticità | Stato |
|---|---|---|
| 1 | sharp CVE high (top-level) | ✅ **FIX APPLICATO** — aggiornato a `sharp@0.35.4` |
| 1b | sharp/postcss vulnerabili **bundlati in Next 16.2.7** + advisory Next (SSRF/DoS/cache confusion, tutti high) | ✅ **FIX APPLICATO** — Next aggiornato a `16.3.3` (minor upgrade nella major 16); `npm audit fix` ha risolto anche `nanoid` |
| 2 | warning exhaustive-deps | ✅ **FIX APPLICATO** — `EditView.tsx` (deps su campi primitivi di `selected` + `useMemo` su `rightTabs`), `EpisodeGroupControls.tsx` (stesso pattern; rimosso il read di `tvdbError` da stale closure che cancellava l'errore appena impostato dal fetch — fix di un bug reale di visualizzazione errori TVDB) |
| 3 | rate-limit per-process | ✅ **FIX APPLICATO** — `rateLimit` ora usa un contatore fixed-window condiviso su Upstash/Vercel KV quando `KV_REST_API_URL`/`KV_REST_API_TOKEN` sono configurati (`PICTORIUM_RATELIMIT_KV=0` per forzare l'in-memory); su errore KV degrada automaticamente al bucket per-processo (fail-open locale). Firma ora async: 33 call site aggiornate. Documentato in README (Variabili d'Ambiente) |
| CSP parziale | Osservazione minore #1 | ✅ **FIX APPLICATO** — CSP estesa in `next.config.ts` e `vercel.json` (in sync): `default-src 'self'`, `script-src 'self' 'unsafe-inline'` (+ `'unsafe-eval'` e websocket HMR solo in dev), `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob: https://image.tmdb.org`, `connect-src 'self'` (tutte le fetch client sono same-origin `/api/*`), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`; `frame-ancestors` invariato per HF Spaces |

### Audit finale

`npm audit --omit=dev` → **found 0 vulnerabilities** (prima: 4 high).

### Verifiche post-fix

| Verifica | Esito |
|---|---|
| `npm run verify` (tsc + eslint + 668 unit test + build Next 16.3.3) | ✅ Tutti passano, **eslint 0 errori 0 warning** |
| `npm run e2e:visual:clean` (visual regression, build pulita) | ✅ **36/36 passate**, nessuna differenza snapshot → `RENDER_VERSION` invariato, nessuna rigenerazione necessaria |
| `npx playwright test e2e/` (suite completa con CSP estesa, build pulita) | ✅ **51/51 passate** (visual + smoke + catalog-meta) |

