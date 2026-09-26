# Pictorium - Render Parameters (Client ↔ Server)

> **Source of truth.** This file is the canonical map of every visual render parameter
> in Pictorium. The client preview is a single `<img src={previewUrl}>` that loads
> `/api/poster/{type}/{id}` — the same endpoint used by Stremio. There is no
> duplication: preview = final poster. When this file and the code disagree,
> **CODE WINS** — update this file.

When you modify a visual render parameter in one file, update its server counterpart
(or vice versa). The `poster-sync` skill drives this workflow end-to-end.

## Livelli di design: Contenuto vs Chrome

Due livelli, mai mescolati:

- **Badge di Contenuto** (genere, ranking, extra): espressivi, stilabili dall'utente
  (`shadow`/`pill`/`bar`/`colored`/`bordo`/`vetro`/`minimal` in basso;
  `default`/`pill`/`colored`/`bordo`/`vetro`/`netflix` in alto).
- **Chrome di Sistema** (qualità streaming, network logo, rating separati/multi):
  marchi tecnici fissi in pill satinata (come Dolby/IMAX sul poster), mai stilabili.
  Restano coerenti per **griglia** (stessa linea top, stessi margini), non per materiale.

## Griglia superiore (top line ~27-28px, portrait @380×570, scala 100%)

Le misure contano sui **box visibili**, mai sui bitmap (che includono il padding
ombra trasparente `TOP_SHADOW_PAD=14`):

- Network: bitmap == box, `top = netPadY(18) + SHIFT(10)` → box a **28**.
- Qualità: bitmap `top = netBaseTop(18) - 10 + 5 = 13`, box a **27** (+14 pad).
- Ranking pill: bitmap `top = toy + pillTopGap(10)`, box a **24** (+14 pad).
- Ranking default: placca a filo, box a **0** (tab ancorato al bordo, pattern a sé).
- Margini X a box: network `18` a sinistra, qualità `18` a destra (`netPadX`
  entrambi i lati, pad-aware in scala — niente numeri magici).
- Colonna separati: ancorata al **fondo box** qualità (pad inferiore sottratto
  in scala) + gap ottico **6px**; senza qualità parte da `netBaseTop - 10`.

## Badge Genere/Rating (GenreRatingBadges)

**Componenti configurabili** (`bg`/`by`/`br`): genere, anno e voto si attivano **indipendentemente**. Default tutti ON → output byte-identico al passato (`Dramma • ★ 8.2 • 2024`). Il badge si mostra se almeno un componente abilitato ha un valore disponibile (`hasGenreBadge = badgesEnabled && ((genre && bg) || (rating > 0 && br) || (year && by))`). Lato SVG i segmenti sono condizionali in `badge-svg-shared.ts:buildGenreTextFlow` — il `dx` di separazione si emette solo se il segmento ha un precedente visibile (per non sfuocare dal centro quando anno o voto sono il primo segmento). In landscape i badge si rendono con `pw = 500` (`badgePw` in `poster-service.ts`: stessi pixel assoluti del portrait); il badge superiore centrale (rank/extra, non nastro) è al 120% (`topBadgePw`); posizioni, overflow-protection e chiavi cache restano sul canvas vero (`LAND_W/H`). Le barre in landscape sono centrate come lower-third invece che full-width. Il logo in landscape è contenuto a max 55% larghezza e 28% altezza (`maxWidthPct`/`maxHeightPct` in `logo-layout.ts`) con margine inferiore 25%. Il gradiente di default in landscape è 20% invece di 30% (solo quando non esplicitato).

| Parametro | Server (`svg-badge.ts:renderGenreBadge`) |
|---|---|
| Font size | `finalFs = 28.6 * pw / 380` (base; pill/colored NON ridimensionano il font, solo la cornice) |
| Gap genere→bullet | `round(fs / 3)` |
| Gap stella→voto | `round(fs / 6)` |
| Padding orizzontale | `genreBadgeSafePad(finalFontSize) = round(finalFontSize * 1.15)` dentro SVG; scatola genere pill/colored `padX = round(fs * 0.55)` (`GENRE_PILL_PAD_X_FACTOR`, solo cornice — font invariato); altri container `round(fs * 0.75)` (`BADGE_BOX_PAD_X_FACTOR`) |
| Larghezza bullet | `bulletW = round(finalFontSize * 0.35)` |
| Larghezza stella | `starW = round(finalFontSize * 0.92)` |
| Altezza badge | `svgH = badgeBoxHeight(fs) = fs + round(fs * 0.40) * 2` (~`1.8 * fs` unificato per tutti i container); scatola genere pill/colored `fs + round(fs * 0.30) * 2` (`GENRE_PILL_PAD_Y_FACTOR`, solo cornice) |
| Colori testo | `#e5e7eb` |
| Text shadow | `"0 4px 6px rgba(0,0,0,0.5)"` |
| Overflow protection | `totalW + safePad*2 > min(pw - 20, round(pw * 0.84))`, usa `genreBadgeDims()`. Per pill usa `genrePillMaxW(pw)` su `textContentW + padX*2 + safePad*2` (`padX = round(fs * 0.55)`, nessuna ombra esterna; loop max 3 iterazioni con margine 4px) |
| Misura testo | `estimateTextWidth()` per-glyph in `badge-svg-shared.ts`; SVG vincolato con `textLength` + `lengthAdjust="spacingAndGlyphs"` |
| Allineamento verticale | Un solo `<text>` con `text-anchor="middle" x="adjustedX"` (compensa dx) e `<tspan dx=...>`; `dominant-baseline="central"` e stella con `Noto Sans Symbols 2` |
| Stili badge (`badgeStyle`) | `shadow` — textShadow; `minimal` — separatore pipe `|` + textShadow discreto (1px); `pill` — gradiente satinato `satinPillStops(bottomLight)` + stroke adattivo 1.5px (`bottomLight ? black 0.12 : white 0.22`, come quality/bar) + testo ad alto contrasto (`bottomLight ? 0.95 white : 0.88 black`) + ombra 3D singola + padding simmetrico 14; `bar` — gradiente satinato `satinPillStops(bottomLight)` full-width (polarità del fondo) + bordo profilo 1.5px adattivo + testo ad alto contrasto (`bottomLight ? 0.95 white : 0.88 black`), nessuna ombra esterna; `colored` — bg tinta di scena same-hue (bottom per genere, top per ranking; `ac=` vince) + testo adattivo (pill piatta, niente satinatura); `bordo` — rect arrotondato con bordo 2px + stroke calibrato + bg fumé (`bottomLight ? 0.06 : 0.08`) + testo adattivo (`bottomLight ? dark : #e5e7eb`, come vetro); `vetro` — vetro liquido iOS (gradiente multi-stop + bordo 1.5px, stesso box model e dimensioni identiche al bordo: padding e rect coincidenti) + testo adattivo come bordo |
| Sfondo pill/bar | bar (`buildGenreBarSvg`) = gradiente satinato `satinPillStops(bottomLight)` full-width + bordo profilo 1.5px adattivo + ombra 3D singola (code tagliate = bordo poster, invisibili); pill genere = gradiente satinato `satinPillStops(bottomLight)` (polarità del fondo, non del top) + ombra 3D singola + padding simmetrico 14 (colored inclusa: tinta piatta + ombra); pill ranking/extra = `satinPillStops(topLight)` |
| Posizione Y unificata | Box model normalizzato: zero salti di baseline tra stili (`genreStyleShiftY` rimosso); altezza uniforme `badgeBoxHeight(fs)`; la riga multi-rating segue sopra il badge |
| Testo pill/bar | bar = ad alto contrasto `bottomLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"` (su fondi chiari la barra diventa grafite scura, come la pill); pill genere/ranking/extra = ad alto contrasto (`bottomLight`/`topLight ? 0.95 white : 0.88 black`, come quality); nastro Netflix e riga multi-rating restano `0.80` (hanno textShadow dedicato); pill colored resta tinta piatta + `textColorForBg` |
| Stella voto | gradiente oro verticale `#FCD34D → #F59E0B` (`linearGradient#starg`) sul `tspan` stella; bullet `•` a opacità 0.45 (solo ingombro visivo, metriche invariate); stile `colored` su accent caldo (`isWarmGoldAccent`: hue 20-70, sat > 0.35): stella piatta in colore testo (l'oro annegherebbe) |
| Bordo bar | profilo 1.5px adattivo (`bottomLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"`), come quality-badge; la vecchia `line` 1px `rgba(0,0,0,0.10)` è rimossa |
| Box Model Unificato | Altezza scatola `badgeBoxHeight(fs) = fs + round(fs * 0.40) * 2` (`1.8 * fs`), padding X `round(fs * 0.75)`, ombra uniforme `badgeShadowBox(h)` (`blur = max(round(h * 0.20), 4), off = max(round(h * 0.10), 2)`) condiviso da tutti i badge centrati |

## Badge Ranking/Extra

| Parametro | Server (`svg-badge.ts:renderRankingBadge/renderExtraBadge`) |
|---|---|
| Font size base | `24 * pw / 380` (rank), `×0.9` per extra (era 20); nastro Netflix invariato |
| Padding X | `px = round(finalFontSize * 0.75)` (unificato con genre badges) |
| Altezza scatola | `boxH = badgeBoxHeight(fs) = fs + round(fs * 0.40) * 2` (unificato con genre badges) |
| Border radius | `r = round(finalFontSize * 0.7)` per default, `boxH / 2` per pill (lo stile `bar` del ranking è rimosso: `?rs=bar` degrada a default) |
| Ombra | `default`/extra-default: ombra 3D singola stile nastro (`dx=3, dy=3, blur 3.5, 0.65`, solo contenitore) + padding `TOP_SHADOW_PAD=14` su lati/basso (in alto la placca resta a filo, altrimenti sembra staccata); `pill` ranking-extra: stesso filtro ma padding simmetrico 14 anche sopra (`boxH + 28`, `oy = PAD`) perché la pill è staccata di `pillTopGap` dal top — prima l'ombra superiore era tagliata; `badgeShadowBox` resta per stime overflow — `blur = max(round(boxH * 0.20), 4)`, `off = max(round(boxH * 0.10), 2)` dove ancora usato |
| Sfondo | `default`/extra-default/`pill` — gradiente satinato `satinPillStops(topLight)` + bordo sagomato polarizzato 1.5px (`topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"`) + ombra 3D singola sul contenitore, canvas = box + padding ombra (`totalW + 28 × boxH + 14`, filo in alto; `pill` invece `boxH + 28`, simmetrico); `netflix` — nastro satinato con stroke polarizzato come quality (`topLight ? black 0.12 : white 0.22`) e ombra 3D propria, testo `0.80` (ha textShadow dedicato); `colored` — tinta accent piatta + `textColorForBg` (lo stile `bar` del ranking è rimosso) |
| Testo | `topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"` (default/pill, come badge qualità); `colored` = `textColorForBg`; `vetro`/`bordo` traslucidi: adattivo inverso (`topLight ? dark : #e5e7eb`, come qualità/netflix ma sul vetro) |
| Stabilizzazione testo | `textLength` + `lengthAdjust="spacingAndGlyphs"` sul `<text>` per evitare differenze metriche tra Windows/local e Linux/HF |
| Overflow protection | Stessa formula con `pw - 20`, fattori `3.55` (ranking, include shadow) e `3.2` (extra); extra compatti cappati al 65% di `pw` (solo label oltre il cap si rimpiccioliscono) |
| Posizione | Composito a `top: 0, left: round((pw - w) / 2)` (default/pill/colored); nastro Netflix a `left: 0` (Nuvio) o `left: STD_W - w` specchiato (Stremio, `side=right`); logo network segue a destra del nastro (`w + 10`) o a sinistra (`STD_W - w - 10 - logoW`) |
| Scala badge superiore (`topBadgeScale`) | Resize bitmap dopo il render (tutti gli stili; la **barra genere** scala nativa via font per restare full-width), prima di `fitBadgeToCanvas`; `%` 10..200, default 100; entra nella `rankBadgeKey` |
| Geometria staccata (`isDetached`) | Solo stili centrati (default/extra; il nastro resta ancorato) con `toy !== 0`: tutti e 4 gli angoli raccordati (`rx = r`) invece del tetto dritto; stesso box di render; entra nella `rankBadgeKey` come `detached` (bitmap diverso) |
| Offset badge superiore (`topBadgeOffsetX/Y`) | Solo stili centrati: `left = center + tox`, `top = 0 + toy` (px, default 0) + `pillTopGap` per la pill (`+10` fisso dal bordo alto); il nastro resta ancorato; la matematica overlap usa `finalRankTop + h` |
| Posizione badge qualità | Angolo in alto a destra, margini a box: box destro a `netPadX` dal bordo (`left = CW - netPadX - boxW - pad`, pad in scala), `top = padY - 10 + 5` (bitmap; box a +14 pad); con nastro Netflix a destra (Stremio) va a **sinistra** con box sinistro a `netPadX` (`left = netPadX - pad`) per non restargli accanto, impilato sotto il logo network se occupa il top-left (`top = netBottom + gap`, senza shift) |
| Sfondo badge qualità | Gradiente satinato traslucido a polarità pill (`satinPillStops(topLight)`); altezza unificata `badgeBoxHeight(fs)`; bordo `topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"` 1.5px; ombra 3D singola + padding simmetrico 14; testo invariato (`topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"`) + crenatura `letter-spacing="0.06em"` (marchio tecnico; `textLength` pinnato su stima+tracking); font base `17 * pw / 380` (era `14`) |

## Pill Network Logo

| Parametro | Server (`network-svgs.ts:loadNetworkPng` & `poster-service.ts`) |
|---|---|
| Sfondo | `topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)"` |
| Bordo | `topLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.20)"` stroke-width 1px |
| Padding | `px = round(fs * 0.65)`, `pt = pb = round(fs * 0.32)` dove `fs = round(max(18 * pw / 380, 12))` |
| Raggio | `r = round(pillH * 0.35)` (squircle, identico al badge qualità) |
| Posizione | default in alto a sinistra (`top = round(18 * STD_H / 570) + 10`, `left = round(18 * STD_W / 380)`, resta a sinistra anche con `side="right"`); centrato sopra il logo film (`top = logoTop - h - gap + 10`) SOLO con nastro Netflix o Coming Soon; senza logo film e con nastro: a fianco del nastro (`w + 10`). Se si sovrappone al badge centrale, rimpicciolisce fino a 0.55x |
| Scala (`netscale`) | Resize bitmap dopo il fetch, prima del fit; `%` 10..200, default 100 |
| Offset (`nox`/`noy`) | `top += noy`, `left += nox` (px, default 0) dopo il posizionamento automatico |
| Logo interno | `topLight ? rgba(255,255,255,0.85) : rgba(18,18,22,0.88)` (eccetto Marvel a colori brand) |
| Ombra | Nessuna ombra esterna (pill piatta, contrasto garantito dallo sfondo della pill) |

## Riga multi-rating (Custom Rating Provider)

Solo quando il provider è abilitato server-side (`PICTORIUM_CUSTOM_RATING_*`) ed esistono item: a provider OFF nessun pixel cambia (snapshot fermi, niente bump di `RENDER_VERSION`).

| Parametro | Server (`multi-rating-renderer.ts:renderMultiRatings`) |
|---|---|
| Font size | `20` fissa (non scala con `pw`) |
| Pill | `h = 38`, `rx = 19`, padding X totale `28`, gap `8` |
| Cap display | `MAX_CUSTOM_RATINGS = 5` (i dati restano completi, la riga mostra le prime 5) |
| Colori | convenzione ranking-badge: `topLight ? rgba(0,0,0,0.80) : rgba(255,255,255,0.80)` bg; testo `topLight ? rgba(255,255,255,0.80) : rgba(0,0,0,0.80)` |
| Testo | `fontFamilyFor(label)` per-pill (ebraico → Rubik) + `textLength`/`lengthAdjust="spacingAndGlyphs"` come gli altri badge; `dominant-baseline="central"`, nome troncato a 80 char, `escSvg` |
| Font embedded | Nessun `@font-face` negli SVG: i font si risolvono dal fontdb resvg via `FONT_FILES` (`fonts.ts`: Inter 400/700/900 + Noto Symbols + Rubik 400/700/900) |
| Fit | `w = min(maxWidth, width)` con `maxWidth = STD_W - 40`, `h` in scala proporzionale |
| Posizione | centrata, `top = legacyTop - h - 10` sopra il badge genere (o `STD_H - 20` senza badge) — `poster-service.ts` |

## Colonna rating separati (Separate Ratings)

Opt-in portrait-only (`sep=1`, default OFF): sostituisce la media ★ nel badge genere con una colonna a destra di pill verticali (logo provider sopra, punteggio sotto). A OFF zero pixel cambiano.

| Parametro | Server (`separate-rating-renderer.ts:renderSeparateRatingStack` + `poster-service.ts`) |
|---|---|
| Font size | `round(max(14 * pw / 380, 11))` (più piccolo del quality-badge: pill compatte moderne) |
| Stack | UN solo bitmap: pill verticali `logoH = round(fs * 1.0)`, `h = pt + logoH + gap + fs + pt` (`px = round(fs*0.6)`, `pt = round(fs*0.3)`, `gap = max(2, round(fs*0.2))`), gap stack `SEPARATE_STACK_GAP = 5`; larghezza uniforme `colW = max(contenuti) + px*2` (colonna dritta); `rx = round(maxH * 0.32)` condiviso |
| Cap display | max 3 (`pickSeparateRatings` in `ratings.ts`: ordine selezione `rsrc`, skip miss/0; vuoto → fallback media) |
| Formati | decimale 1 cifra (`7.3`); famiglia percent (`tomatoes`, `popcorntime`) come `88%` (`formatSeparateValue`) |
| Colori | convenzione quality-badge: `topLight ? dark pill : light pill`, bordo 1.5px adattivo, ombra dedicata ridotta (`seps`: dx=2, dy=2, blur 2, 0.55 — la 3D standard sbordava nel gap 5px sembrando squadrata) |
| Loghi | `public/rating/*.svg` a colori brand originali (mai ricolorati), embed `<image data:...>` come le pill network; asset mancante → pill skippata (mai 500) |
| Posizione | bordo destro allineato al badge qualità (`right = qualityRight`), `top = qualityBoxBottom + 6` (pad inferiore sottratto in scala, gap ottico 6px); senza qualità parte dal top (`netBaseTop - 10`, "sale"); con nastro a destra segue a sinistra (stesso branch `isRightRibbonCorner`); gap stack `5px` (`SEPARATE_STACK_GAP`) |
| Priorità | mai col custom provider: se la riga custom è renderizzata, lo stack si nasconde |
| Sostituzione | con stack attivo (`useSeparate`) il badge genere nasconde il segmento ★ (`badgeRating` effettivo = false) |
| Cache | chiave stack `badge:separate:<src+val,...>:<CW>:<topLight>` (un composite); flag `sep` nella cache key poster; valori sep nell'etag dei poster dinamici |
| Landscape | `sep` ignorato (media ★ invariata) |

## Gradiente fondo poster

| Parametro | Server (`badges.ts:bottomGradientSVG`) |
|---|---|
| Altezza | `gh = max(round(ph * pct / 100), 100)` |
| Colore | `color` + `opacity` |
| Direzione | `y1 = dir === "up" ? "0" : "1"`, `y2 = dir === "up" ? "1" : "0"` |
| Posizione | `top = dir === "up" ? ph - gh : 0` |
| Fade | `0% trasp → svgFadeEnd% trasp → svgSolidPct% opaco → 100% opaco` |
| Posizione badge genere | `badgeY = ph - h - round(20 * ph / 570)` |

## Parametri URL (query string)

| Parametro | Inviato da client (`context.tsx`) | Letto da server (`route.ts`) |
|---|---|---|
| `badges` | `globalBadges ? null : "0"` | `qBadges !== "0"` |
| `ranking` | `rankingBadges ? null : "0"` | `qRanking !== "0"` |
| `bg` | `badgeGenre === false ? "0" : null` | `qBg !== null ? qBg !== "0"` — nasconde il GENERE nel badge genere/rating |
| `by` | `badgeYear === false ? "0" : null` | `qBy !== null ? qBy !== "0"` — nasconde l'ANNO nel badge genere/rating |
| `br` | `badgeRating === false ? "0" : null` | `qBr !== null ? qBr !== "0"` — nasconde il VOTO nel badge genere/rating |
| `cr` | sempre esplicito in preview (`cr=0/1`, WYSIWYG); solo-OFF in pattern/Stremio | `qCr` — display riga rating custom: `query > mapping.customRatings > config > defaults > true`, AND con env `PICTORIUM_CUSTOM_RATING_ENABLED` |
| `rsrc` | `ratingSources` per-titolo (preview); per-titolo salvato o default globale (Stremio) | fonti voto medio ★: `query > mapping.ratingSources > config token > server defaults (RATING_SOURCES) > imdb+tmdb` — parser unico `resolveRatingSources` (whitelist `SUPPORTED_RATING_SOURCES`) |
| `sep` | `separateRatings` per-titolo (preview, sempre esplicito `sep=0/1`); solo-ON in pattern/Stremio | colonna separati: `query > mapping.separateRatings > config token > server defaults (PICTORIUM_SEPARATE_RATINGS) > false`, AND con portrait + `badgeRating` + ≥1 valore (altrimenti fallback media) |
| `gradHeight` | `gradientHeight` | `qGradHeight` — alimenta l'altezza del gradiente/sfocatura (blurHeight): query > mapping > config token > server defaults > default di formato (30 portrait, 20 landscape; mapping non-clean senza valore congelato: 20). Post-selezione solo Stremio unmapped: se il poster finale ha testo incorporato, i default globali non vincono sul profilo non-clean (20/80, come il client) |
| `bf` | `blurFade` (slider editor 0..100 + double-click reset al default per tipo poster, 70 in landscape) | punto di attacco transizione 0..100 (default 50 portrait, 70 landscape, 80 su mapping non-clean senza valore congelato): query > mapping > config token > server defaults > default di formato/tipo. Emessa sempre esplicita in preview e Stremio |
| `tint` | `tintStrength` (slider editor 0..100 + default globale, double-click reset 20) | `qTint` — intensità tinta di scena 0..100 (default 20): query > mapping (`tintStrength`) > config token > server defaults (`PICTORIUM_TINT_STRENGTH`) > 20. Emessa sempre esplicita in preview e Stremio. Nessun profilo landscape dedicato (vale per entrambi i canvas) |
| `tl` | `topLight ? "1" : "0"` (sempre, anche per genre badges) | `qTopLight` — override se presente |
| `bl` | `bottomEdgeColor` via `useRootColors` (solo a calcolo completato, come `tl`) | `qBottomLight` — override se presente, altrimenti calcolo server sulla striscia inferiore corretto per la banda blur (`computeBottomLight`) |
| `qmin` | — (solo default globale, nessun per-titolo in Fase 1) | `q.get("qmin")` > server defaults (`PICTORIUM_QUALITY_MIN`) > `"SD"` — tier sotto soglia = niente badge; emesso negli URL Stremio solo quando ≠ `SD` |
| `sash` | — (solo default globale via 5 toggle Impostazioni, nessun per-titolo in Fase 4) | `q.get("sash")` > server defaults (`PICTORIUM_SASH_ORDER`) > ordine standard (`upcoming,rank,new,award,extra`) — sottoinsieme ordinato, non listati = spenti, `sash=` vuoto = tutto spento, garbage = default; emesso negli URL Stremio solo quando ≠ default |
| `pre` | `preRelease ? "1" : null` (solo se ON, default OFF) | `qPre` — effetto pre-digitale: velo scuro (sotto logo e badge, che restano luminosi) + nastro angolare rosso "coming soon!" in alto (a sinistra; a destra con side="right") sui film senza disponibilità digitale/streaming (JW offerte non-CINEMA > TMDB type 4). Catena: query > config token > server defaults (`PICTORIUM_PRE_RELEASE`) > false |
| `hideLogo` | mai dal client (solo banner Stremio) | solo query `hideLogo=1`: salta il composite logo film (fetch tenuto per i colori accent). In landscape il logo è comunque sempre nascosto (layout senza baked-in per preview, poster e banner); il parametro serve solo per il portrait. Col banner (landscape) il badge genere va in basso a DESTRA (ancoraggio destro, niente shift landscape) e il network segue i rami "senza logo" (top-left / a fianco del nastro) |
| `rd`/`fad` | date complete `release_date`/`first_air_date` (solo se valide `YYYY-MM-DD`) | ramo query: date a piena precisione per rilevamento pre-digitale (fallback `year` → `${y}-01-01`) |
| `title` | `selected.title \|\| selected.name` (preview) / `mapping?.title` (Stremio) | titolo per il match JustWatch (`preTitle`: mapping > query > session > `genreName`) — senza, la ricerca usa `genreName` e il match per tmdbId fallisce (rilevamento pre-digitale + qualità degradati) |

> `gradColor`, `gradOpacity`, `gradFade`, `gradDir` sono **parametri morti**: non vengono più letti dal server (il gradiente usa il colore accent + `gradHeight`). `bottomGradientSVG` in `badges.ts` non è più chiamato dal compositore poster. Non reintrodurli.
| `rank` | `badge.rank` (se rankingBadges attivi) | `qRank` — override del ranking |
| `animerank` | rank anime del titolo selezionato (da `mdblistAnimeList`, solo preview WYSIWYG) | `qAnimeRank` — override del rank anime (`media_type=tv`); senza, il server lo calcola da `fetchMDBList` con la chiave della richiesta o il fallback d'istanza (`PICTORIUM_MDBLIST_KEY`) |
| `label` | `badge.rankLabel \|\| badge.label` | `qLabel` — override label ranking |
| `extra` | `badge.label` (se extra) o `customBadge` | `queryExtra` — forza badge extra |
| `bs` | `badgeStyle` | `qBs` — "shadow"/"pill"/"bar"/"colored"/"bordo"/"vetro"/"minimal" (in landscape forzato a "shadow": solo default per ora) |
| `rs` | `rankingBadgeStyle` | `qRs` — "default"/"colored"/"pill"/"bordo"/"vetro"/"netflix" ("bar" rimosso: degrada a "default") |
| `tscale`/`tox`/`toy` | `topBadgeScale`/`topBadgeOffsetX`/`topBadgeOffsetY` (badge superiore) | scala `%` 10..200 (default 100, tutti gli stili) + offset px (default 0, solo centrati) |
| `gscale` | `genreBadgeScale` (badge genere/rating in basso) | scala `%` 10..200 (default 100 su base 28.6px nativa; la **barra** scala nativa via font per restare full-width) |
| `gox`/`goy` | `genreBadgeOffsetX`/`genreBadgeOffsetY` | offset px (default 0, solo stili non-bar) |
| `qscale` | `qualityBadgeScale` (badge qualità streaming) | scala `%` 10..200 (default 100 su base 17px nativa) |
| `qox`/`qoy` | `qualityBadgeOffsetX`/`qualityBadgeOffsetY` | offset px (default 0) |
| `netscale` | `networkLogoScale` (logo network) | scala `%` 10..200 (default 100) |
| `nox`/`noy` | `networkLogoOffsetX`/`networkLogoOffsetY` | offset px (default 0) |
| `side` | `ribbonSide === "right" ? "right" : null` (modalità Stremio; default Nuvio = sinistra) | `qSide` — "right" sposta nastro Netflix (specchiato) + logo network + nastro Coming Soon a destra |
| `shape` | `posterShape` (sempre esplicito in preview: `poster`/`landscape`; default globale `defaultPosterShape`, per-titolo dal mapping) | catena `shape` > mapping (`posterShape`) > config token > server defaults (`PICTORIUM_POSTER_SHAPE`) > `"poster"` — solo `landscape` attiva il canvas 16:9 (`LAND_W=768/LAND_H=432`, base = backdrop TMDB via `posterUrlOriginal`); emesso negli URL Stremio solo quando landscape (il portrait resta omesso per non invalidare la cache) |
| `align` | `logoAlign` (sempre esplicito in preview) | `left`/`center` esplicito > default globale **solo landscape** (`sd.logoAlign`) > default di formato (landscape `left`, poster `center`) — i portrait sono sempre centrati, nessun globale li sposta mai |
| `ac` | `accentColor` SOLO se manuale (`isManualAccent`: diverso da `autoAccentColor` auto-rilevato via `useRootColors`, come il server) — mai l'auto, mai nel mapping salvato | `qAc` — override colore accent (vince su tutto: badge colored, blur tint, scrim) |
| `tvdb_key` | mai dal client (solo manuale; Stremio usa il fallback d'istanza) | chiave TVDB per il rescue poster B1: solo ramo non-mappato, solo senza clean TMDB + con logo + solo portrait. Solo il textless (`includesText === false`) salva il logo; con testo il logo si azzera (no doppio logo). La chiave non entra mai nella cache key (segreto); il flag server-side `tvdb=1` separa le entry con rescue attivo |

> URL Stremio (cataloghi/meta): `buildStremioPosterUrl()` emette gli stessi parametri ma dal **mapping salvato con fallback ai default** (`mapping?.X ?? defaults.X`) per `badges`/`ranking`/`bs`/`rs`/`be`/`extra`/toggle/enum — emissione sempre esplicita. Il tuning numerico ad alta cardinalità (`gradHeight`/`blur`/`tint`/`bf`/`bd` + 12 scale/offset `tscale`/`tox`/`toy`/`gscale`/`gox`/`goy`/`qscale`/`qox`/`qoy`/`netscale`/`nox`/`noy`) è omesso senza `config` (`compactTuning`): il server lo risolve da mapping > defaults dello spazio (stesso render, chiave convergente). `extra` è emesso solo per customBadge **non** rank-key (`isRankKey`): le rank-key viaggiano via rank live + fallback `mapping.badgeRank`/`trendRank`/`animeRank` su fetch fallito (mai su miss genuina: un titolo uscito dalla chart non resuscita il rank stantio), altrimenti `queryExtra` duplicherebbe il badge (vince sul calcolato).

> Hardening anti cache-busting (v1.23.0, `poster-params-hardening.ts`, `PICTORIUM_POSTER_PARAMS=presets`, auto-on su `PUBLIC_INSTANCE=1`/`HOSTED_BY=elfhosted`/`MULTI_USER=1`): cache key con allowlist rigida (`POSTER_CACHE_ALLOWLIST`, junk `?x=` collassa, repeat deduplicati al primo valore); non-preview con presets → numerici quantizzati (step 5/10/5px), `ac` solo palette `GENRE_FALLBACK`, `extra`/`label` solo da mapping curato (canonicalizzati, mai free-text), override `poster`/`logo`/`backdrop` ignorati su pubbliche anonime. Preview (`preview=1`) live per spazi utente e sessioni sbloccate; sulle istanze pubbliche le preview anonime sono declassate a normale (auto-on, override `PICTORIUM_PREVIEW_AUTH=1/0`). Valori salvati mai toccati.

## Bordo poster

| Parametro | Client (`EditView.tsx`) | Server (`route.ts`) |
|---|---|---|
| Bordo | `3px solid rgba(255,255,255,0.80)` | Rimosso (solo client) |
| Overlay | `absolute inset-0 pointer-events-none` (sopra ogni contenuto) | — |

## Logo clean poster

| Parametro | Client | Server |
|---|---|---|
| Dimensione logo | `computeLogoOffsetBounds()` usa `computeLogoBox()` | `computeLogoLayout()` usa `computeLogoBox()` |
| Scala | `logoScale` come percentuale della larghezza poster, max larghezza poster | Stessa logica |
| Scala auto | `logoDefaultScale` (logo-selection.ts) | `defScale` in poster-service.ts + `defaultLogoScale` in poster-auto-fit.ts (stessa formula, Golden Rule) — curva `round(37.5 × aspect^(2/3))` cap 75 (2:1 → 60, 2.5:1 → 69, 3:1+ al cap; quadrati invariati a 38) |
| Cap altezza | Solo canvas poster (`posterH`) | Solo canvas poster (`STD_H`) |
| Cap portrait | `maxHeightPct: PORTRAIT_LOGO_MAX_HEIGHT_PCT (25)` — solo altezza, larghezza libera | Stesso cap (via `computeLogoLayout` in portrait; `poster-fit-score` usa gli stessi override) |
| Sorgente logo | — | `imgSrc(path, "original")` (nitidezza, niente upsampling); poster/backdrop restano `w500` |
| Margine inferiore | `bottomMarginPct: 12` con badge genere, `10` storico senza (mirror in `context.tsx` per i bound slider) | `bottomMarginPct: hasGenreBadge ? 12 : undefined` (default 10) — solleva il logo sopra il badge basso |
| Calibrazione Y portrait | `topOffset: PORTRAIT_LOGO_TOP_OFFSET (10)` — logo 10px più in basso (mirror in `context.tsx` per i bound slider, `poster-fit-score.ts` per l'auto-fit; landscape escluso: non baked-in) | Stesso offset (ramo portrait, già solo-portrait) |

## Files coinvolti

- `src/components/EditView.tsx` — preview WYSIWYG (singolo `<img src={previewUrl}>`)
- `src/lib/context.tsx` — stato, URL builder, localStorage
- `src/lib/poster-url.ts` — `buildPreviewUrl()`, `buildUrlPattern()` (parametri client → URL server)
- `src/lib/badges.ts` — server-side SVG (bottomGradientSVG)
- `src/lib/svg-badge.ts` — server-side SVG raw badges (renderGenreBadge, renderRankingBadge, renderExtraBadge) + Resvg rendering (font risolti via `FONT_FILES`, nessun embedding negli SVG; vale anche per la riga multi-rating)
- `src/lib/multi-rating-renderer.ts` — riga pill custom rating (`renderMultiRatings`, `MAX_CUSTOM_RATINGS`)
- `src/lib/separate-rating-renderer.ts` — stack colonna separati (`renderSeparateRatingStack`, bitmap unico a larghezza uniforme, logo sopra/punteggio sotto)
- `src/lib/custom-rating/` — provider server-side (`fetchCustomRatings`, `resolveCustomRatingConfig`, `formatRating`)
- `src/lib/ratings.ts` — aggregatore voti (`fetchAggregatedRating`: MDBList + provider diretti condizionali Simkl/anime + backfill `sources.tmdb` dal voto TMDB diretto + fallback `sources.imdb` via Cinemeta quando MDBList manca, `resolveRatingSources`, `pickSeparateRatings`/`formatSeparateValue`)
- `src/lib/cinemeta.ts` — voto IMDb gratis senza chiave (meta movie/series + fallback tipo, miss su meta vuoto; solo se `imdb` in `rsrc` e MDBList senza imdb)
- `src/lib/simkl.ts` — voto Simkl diretto (BYOK, redirect 301 + details; solo se `simkl` in `rsrc`)
- `src/lib/anime-ratings.ts` — voti anime diretti (AniZip mapping tmdb→imdb con fallback + AniList GraphQL + Kitsu REST; solo se `anilist`/`kitsu` in `rsrc`). `anilist`/`kitsu`/`simkl` NON arrivano da MDBList: il parse resta per compatibilità
- `src/lib/badge-priority.ts` — logica priorità badge (condivisa)
- `src/lib/badge-labels.ts` — label pure client-safe (match studio/network, label premi/nomination, QID regex; foglia senza import server, in RENDER_FILES)
- `src/lib/logo-layout.ts` — geometria condivisa logo preview/server
- `src/app/api/poster/[type]/[id]/route.ts` — composizione poster finale (preview + Stremio usano la stessa route)
- `src/lib/poster-params-hardening.ts` — allowlist cache key, quantizzazione presets, palette `ac`, canonicalizzazione `extra`, strip override keyless (in RENDER_FILES)
- `src/lib/stremio-poster-params.ts` — `compactTuning`: omette il tuning numerico senza `config` (in RENDER_FILES)
- `e2e/pictorium-visual.spec.ts` — test di regressione visiva (screenshot) per poster e interfaccia
- `e2e/pictorium-smoke.spec.ts` — smoke test funzionali

> Dopo ogni modifica ai parametri di resa visiva in QUALSIASI file qui elencato, segui il workflow in `visual-testing.md`.
