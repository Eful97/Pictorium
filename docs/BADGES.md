# Extending the Badge System

## Structure

The priority chain is defined in `src/lib/badge-priority.ts:computeBadge()`.

## How to add a new badge type

1. **Define the badge** in `getAllBadgeOptions()` in `badge-priority.ts`:
   ```ts
   { key: "badge.myNewBadge", label: "My New Badge" }
   ```

2. **Add translations** in every file under `src/lib/translations/*.json`:
   ```json
   "badge.myNewBadge": "Etichetta in questa lingua"
   ```

3. If the badge requires external data, add it to `metaInfo` in `context.tsx` and
   fetch it in `openPosterBrowser()` with parallel `Promise.all`.

4. Add to the priority chain in `computeBadge()` — insert at the correct position
   (first match wins).

5. If the badge has a different style, add a case in the renderer
   `svg-badge.ts` (`renderRankingBadge` or `renderExtraBadge`).

## Priority order (top to bottom)

`computeBadge()` restituisce la prima condizione vera; `getAllBadgeOptions()` elenca tutte le opzioni selezionabili nell'editor.

- In uscita (`upcomingRelease`)
- Rank anime (MDBList)
- Rank trend (JustWatch)
- Nuovo film / nuova serie (< 2 settimane)
- Vincitore premio (Wikidata P166)
- IMDb Top 100 (Top 250 rank 1..100) — *Absolute Cinema* (film only; fallback snapshot 2026-10-22, refresh via `node scripts/write-imdb-top250-snapshot.mjs`)
- Nomination (Wikidata P1411)
- Sub-genere
- Regista (Wikidata P57)
- Studio/Network (TMDB o Wikidata)
- Badge extra personalizzato (`extra`)

> `Miniserie` e `Ritorna` (serie in corso) sono opzioni selezionabili ma non entrano nella catena di priorità. La franchise (Wikidata P179) è stata rimossa.

## Testing

Badges are tested in `src/__tests__/rendering/badge-validation.test.ts`.
Add a test for every new badge in the chain.
