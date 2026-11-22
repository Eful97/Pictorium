# Fila di icone "Dove guardare" (watch providers per paese) — design

Data: 2026-11-20 · Stato: in attesa di approvazione

## Intento e perché
Richiesta di un utente (Discord): mostrare sul poster **dove si può guardare** il titolo
nel paese scelto (Netflix, Prime, Disney+, …), con dati TMDB/JustWatch, invece del
network di produzione (HBO, AMC, …) che il poster mostra oggi.

## Obiettivi
- Opzione "Mostra dove guardare" che disegna una fila di icone provider in alto.
- Selettore del paese per questa funzione.
- Nessun cambiamento per chi non attiva l'opzione.

## Non-obiettivi
- Provider in noleggio/acquisto (solo flatrate).
- Paese per singolo titolo (solo impostazione unica per spazio utente + override URL).
- Rimuovere o sostituire il logo network di produzione.
- Link o deep-link ai provider.

## Anti-obiettivi
- Poster più lenti: il fetch non deve allungare il caso peggiore (vedi vincoli perf).
- Icone che coprono titolo/logo o escono dal poster.
- Fallire il render se TMDB non risponde o non ha dati.

## Approcci considerati
1. **Un solo logo** nello slot network esistente: diff minimo, ma perde l'informazione
   sugli altri provider. Scartato dall'utente.
2. **Fila di icone** (scelto): risponde alla richiesta, richiede layout nuovo.
3. Fila nello slot network esistente riusando il layout a singolo logo: non regge più icone.

## Design
- **Dati.** TMDB `/{movie|tv}/{id}/watch/providers`, ramo `results[REGIONE].flatrate`,
  ordine di TMDB (`display_priority`). Chiamata via `tmdbFetch` con la chiave API
  dell'utente, cache e coalescing come gli altri dati TMDB (vedi skill `tmdb-api`).
  Fetch solo se l'opzione è attiva.
- **Paese.** Selettore nelle impostazioni (sezione Tag e Network); default = paese già
  usato per `posterRegion`; override via parametro URL. Impostazione unica per spazio.
- **Rendering.** Fino a 3 icone + contatore "+N" in alto, al posto del logo network
  quando l'opzione è attiva. Loghi: SVG locali dove esistono (`network-svgs`),
  `logo_path` TMDB come ripiego (stesso motore di `renderFirstMatchingNetwork*`).
- **Opzione.** Switch "Mostra dove guardare", **spento di default**, in
  `TagsNetworksSection`. Senza dati/chiave/paese il poster resta identico a oggi.
- **Sync.** Parametro client↔server in `.agents/render-params.md`; preview client e
  poster server identici (poster-sync); RENDER_VERSION rigenerata; i18n in tutte le
  lingue; `docs/CONFIGURATION*.md` solo se si aggiungono env (previste: nessuna).

## Vincoli
- Il fetch provider va in parallelo agli altri e rispetta i cap del caso peggiore
  (skill `perf`); niente slot di render tenuto durante l'attesa di rete.
- Chiave TMDB sempre request-scoped, mai env (skill `tmdb-api`).
- Parametri URL/config validati come gli altri (skill `pictorium-security`).

## Scelte mie da verificare
- Max 3 icone + "+N" (alternativa: 4).
- Con l'opzione attiva il logo network di produzione non viene disegnato nello stesso slot.
- Solo flatrate; "free/ads" fuori.

## Lasciato al builder
Posizionamento esatto per portrait/landscape/card, dimensioni icona, forma del
contatore "+N", nome dei parametri, test e snapshot visuali.
