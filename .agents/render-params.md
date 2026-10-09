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

**Componenti configurabili** (`bg`/`by`/`br`): genere, anno e voto si attivano **indipendentemente**. Default tutti ON → output byte-identico al passato (`Dramma • ★ 8.2 • 2024`). Il badge si mostra se almeno un componente abilitato ha un valore disponibile (`hasGenreBadge = badgesEnabled && ((genre && bg) || (rating > 0 && br) || (year && by))`). Lato SVG i segmenti sono condizionali in `badge-svg-shared.ts:buildGenreTextFlow` — il `dx` di separazione si emette solo se il segmento ha un precedente visibile (per non sfuocare dal centro quando anno o voto sono il primo segmento). In landscape i badge si rendono con `pw = 500` (`badgePw` in `poster-service.ts`: stessi pixel assoluti del portrait); il badge superiore centrale (rank/extra, non nastro) è al 120% (`topBadgePw`); posizioni, overflow-protection e chiavi cache restano sul canvas vero (`LAND_W/H`). Le barre genere in landscape non esistono (lo stile `bar` degrada a `shadow` come il ranking); la `bottom-bar` dei separati è disattivata in landscape (normalizzata a `bottom-pills` DOPO cascata via `getSeparateRatingsStyleForShape`, raw salvati intatti) e le pills landscape sono ancorate a DESTRA con la geometria base del badge genere (`landscapeRightAnchorLeft`, extra 0 opticalShift 0: margine pieno senza +40 genere, niente `gox`/`goy`). Il logo in landscape è contenuto a max 40% larghezza e 24% altezza (`LANDSCAPE_LOGO_*` in `logo-layout.ts`, stessi di `context.tsx` e `poster-fit-score.ts`) col fondo a ~10px dal bordo, in linea col badge genere (`LANDSCAPE_LOGO_BOTTOM_MARGIN_PCT`/`TOP_OFFSET`). Il gradiente di default in landscape è 20% invece di 30% (solo quando non esplicitato).

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
| Font badge (`bfont`) | `fontFamilyFor(testo, font)` in `badge-svg-shared.ts`: "inter" → Inter, "barlow-condensed" → Barlow Condensed, "oswald" → Oswald; ebraico/arabo → sempre Rubik (nessuno dei tre ha quei glifi). `estimateTextWidth(testo, fs, font)` scala la stima Inter di 0.73 (Barlow) / 0.80 (Oswald), rapporti misurati con resvg su 10 stringhe × pesi 600/700/900; nessuna scala sul testo Rubik. La ★ del voto coi font non-Inter è un path SVG 5 punte (`starPath`, stessa tinta oro o `starFill`) in uno slot dedicato, con flusso spezzato in due testi rigidi senza switch di famiglia (genere+separatore con ancora end prima della stella, voto+anno con ancora start dopo la stella; gap fissi indipendenti dalle stime di larghezza): resvg duplica il glifo precedente e allarga ~+40% quando una tspan ★ Noto segue contenuto non-Inter nello stesso `<text>`. Con "inter" il flusso resta byte-identico allo storico (ancora middle + tspan ★). |
| Chiavi cache | `badgeFont` entra in tutte le chiavi badge (`genre`/`rank`/`quality`/`comingsoon`/`separate`); `bfont` è in `POSTER_CACHE_ALLOWLIST` e fail-closed in `normalizePosterCacheParams` (invalido = assente = Inter). I preset custom/house ignorano il font: chiavi preset invariate. |
| Stili badge (`badgeStyle`) | `shadow` — textShadow; `minimal` — separatore pipe `|` + textShadow discreto (1px); `pill` — gradiente satinato `satinPillStops(bottomLight)` + stroke adattivo 1.5px (`bottomLight ? black 0.12 : white 0.22`, come quality/bar) + testo ad alto contrasto (`bottomLight ? 0.95 white : 0.88 black`) + ombra 3D singola + padding simmetrico 14; `bar` — gradiente satinato `satinPillStops(bottomLight)` full-width (polarità del fondo) + bordo profilo 1.5px adattivo + testo ad alto contrasto (`bottomLight ? 0.95 white : 0.88 black`), nessuna ombra esterna; `colored` — bg tinta di scena same-hue (bottom per genere, top per ranking; `ac=` vince) normalizzata ad automatic lightness fissa HSL 5/12 (100/240 dialogo Windows: hue/saturazione intatte, solo L; `ac=` manuale byte-identico, blur/tinta naturali invariati) + testo adattivo (pill piatta, niente satinatura); `bordo` — rect arrotondato con bordo 2px + stroke calibrato + bg fumé (`bottomLight ? 0.06 : 0.08`) + testo adattivo (`bottomLight ? dark : #e5e7eb`, come vetro); `vetro` — vetro liquido iOS (gradiente multi-stop + bordo 1.5px, stesso box model e dimensioni identiche al bordo: padding e rect coincidenti) + testo adattivo come bordo |
| Sfondo pill/bar | bar (`buildGenreBarSvg`) = gradiente satinato `satinPillStops(bottomLight)` full-width + bordo profilo 1.5px adattivo + ombra 3D singola (code tagliate = bordo poster, invisibili); pill genere = gradiente satinato `satinPillStops(bottomLight)` (polarità del fondo, non del top) + ombra 3D singola + padding simmetrico 14 (colored inclusa: tinta piatta + ombra); pill ranking/extra = `satinPillStops(topLight)` |
| Posizione Y unificata | Box model normalizzato: zero salti di baseline tra stili (`genreStyleShiftY` rimosso); altezza uniforme `badgeBoxHeight(fs)`; la riga multi-rating segue sopra il badge |
| Testo pill/bar | bar = ad alto contrasto `bottomLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"` (su fondi chiari la barra diventa grafite scura, come la pill); pill genere/ranking/extra = ad alto contrasto (`bottomLight`/`topLight ? 0.95 white : 0.88 black`, come quality); nastro Netflix e riga multi-rating restano `0.80` (hanno textShadow dedicato); pill colored resta tinta piatta + `textColorForBg` (preferenza visiva bianco mentre il contrasto effettivo resta ≥2:1, non soglia WCAG — es. `#E67E22` bianco 2.9 vs nero 5.9 → bianco; fondi troppo chiari/gialli restano neri) |
| Stella voto | gradiente oro verticale `#FCD34D → #F59E0B` (`linearGradient#starg`) sul `tspan` stella; bullet `•` a opacità 0.45 (solo ingombro visivo, metriche invariate); stile `colored` su accent caldo (`isWarmGoldAccent`: hue 20-70, sat > 0.35): stella piatta in colore testo (l'oro annegherebbe) |
| Bordo bar | profilo 1.5px adattivo (`bottomLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"`), come quality-badge; la vecchia `line` 1px `rgba(0,0,0,0.10)` è rimossa |
| Box Model Unificato | Altezza scatola `badgeBoxHeight(fs) = fs + round(fs * 0.40) * 2` (`1.8 * fs`), padding X `round(fs * 0.75)`, ombra uniforme `badgeShadowBox(h)` (`blur = max(round(h * 0.20), 4), off = max(round(h * 0.10), 2)`) condiviso da tutti i badge centrati |

## Badge Ranking/Extra

| Parametro | Server (`svg-badge.ts:renderRankingBadge/renderExtraBadge`) |
|---|---|
| Font size base | `30 * pw / 380` (rank), `×0.9` per extra; nastro Netflix a base `24 * 1.15 * 1.10` (+10% rispetto al default precedente) |
| Dicitura nastro | I nastri di classifica mostrano `TOP`, numero e sottotitolo periodo (`ribbonLabel`: "Oggi" localizzato, per film/serie come per anime; override custom esplicito vince sulle rank-key); altezza `w × 1.65`, testi centrati (`TOP` a `0.30h` senza sub, `0.20h` con sub, numero a `0.60h`). Senza `ribbonLabel` il sottotitolo resta nascosto. I preset Badge Lab mantengono la propria etichetta personalizzata. |
| Padding X | `px = round(finalFontSize * 0.75)` (unificato con genre badges) |
| Altezza scatola | `boxH = badgeBoxHeight(fs) = fs + round(fs * 0.40) * 2` (unificato con genre badges) |
| Border radius | `r = round(finalFontSize * 0.45)` per default (`RANKING_DEFAULT_RADIUS_FACTOR`: squadrata ma non a spigolo), `boxH / 2` per pill (lo stile `bar` del ranking è rimosso: `?rs=bar` degrada a default) |
| Ombra | `default`/extra-default: ombra 3D singola stile nastro (`dx=3, dy=3, blur 3.5, 0.65`, solo contenitore) + padding `TOP_SHADOW_PAD=14` su lati/basso (in alto la placca resta a filo, altrimenti sembra staccata); `pill` ranking-extra: stesso filtro ma padding simmetrico 14 anche sopra (`boxH + 28`, `oy = PAD`) perché la pill è staccata di `pillTopGap` dal top — prima l'ombra superiore era tagliata; `badgeShadowBox` resta per stime overflow — `blur = max(round(boxH * 0.20), 4)`, `off = max(round(boxH * 0.10), 2)` dove ancora usato |
| Sfondo | `default`/extra-default/`pill` — gradiente satinato `satinPillStops(topLight)` + bordo sagomato polarizzato 1.5px (`topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"`) + ombra 3D singola sul contenitore, canvas = box + padding ombra (`totalW + 28 × boxH + 14`, filo in alto; `pill` invece `boxH + 28`, simmetrico); `netflix` — nastro satinato con stroke polarizzato come quality (`topLight ? black 0.12 : white 0.22`) e ombra 3D propria, testo `0.80` (ha textShadow dedicato); `colored` — tinta accent piatta + `textColorForBg` (lo stile `bar` del ranking è rimosso) |
| Testo | `topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"` (default/pill, come badge qualità); `colored` = `textColorForBg` (preferenza visiva bianco se contrasto effettivo ≥2:1, non soglia WCAG; non è una pretesa di contrasto massimo — su fondi chiari vince il nero); `vetro`/`bordo` traslucidi: adattivo inverso (`topLight ? dark : #e5e7eb`, come qualità/netflix ma sul vetro) |
| Stabilizzazione testo | `textLength` + `lengthAdjust="spacingAndGlyphs"` sul `<text>` per evitare differenze metriche tra Windows/local e Linux/HF |
| Overflow protection | Stessa formula con `pw - 20`, fattori `3.55` (ranking, include shadow) e `3.2` (extra); extra compatti cappati al 65% di `pw` (solo label oltre il cap si rimpiccioliscono) |
| Posizione | Composito a `top: 0, left: round((pw - w) / 2)` (default/pill/colored); `corner` a `left: netPadX + tox`, `top: pillTopGap + toy` (alto-sx, rank ed extra: stesso anchor, il logo network in collisione impila sotto via `stackNetworkBelowCornerRank`); nastro Netflix a `left: 0` (Nuvio) o `left: STD_W - w` specchiato (Stremio, `side=right`); logo network segue a destra del nastro (`w + 10`) o a sinistra (`STD_W - w - 10 - logoW`) |
| Scala badge superiore (`topBadgeScale` classifica, `extraBadgeScale` extra-dopo-fallback) | Resize bitmap dopo il render (tutti gli stili; la **barra genere** scala nativa via font per restare full-width), prima di `fitBadgeToCanvas`; `%` 10..200, default 100; entra nella `rankBadgeKey` (valore effettivo per kind) |
| Geometria staccata (`isDetached`) | Solo stili centrati (default/extra; il nastro resta ancorato) con `toy !== 0`: tutti e 4 gli angoli raccordati (`rx = r`) invece del tetto dritto; stesso box di render; entra nella `rankBadgeKey` come `detached` (bitmap diverso) |
| Offset badge superiore (`topBadgeOffsetX/Y` classifica, `extraBadgeOffsetX/Y` extra-dopo-fallback) | Solo stili centrati: `left = center + tox`, `top = 0 + toy` (px, default 0) + `pillTopGap` per la pill (`+10` fisso dal bordo alto); il nastro resta ancorato; la matematica overlap usa `finalRankTop + h` |
| Posizione badge qualità | Angolo in alto a destra, margini a box: box destro a `netPadX` dal bordo (`left = CW - netPadX - boxW - pad`, pad in scala), `top = padY - 10 + 5` (bitmap; box a +14 pad); con nastro Netflix a destra (Stremio) va a **sinistra** con box sinistro a `netPadX` (`left = netPadX - pad`) per non restargli accanto, impilato sotto il logo network se occupa il top-left (`top = netBottom + gap`, senza shift) |
| Sfondo badge qualità | Gradiente satinato traslucido a polarità pill (`satinPillStops(topLight)`); altezza unificata `badgeBoxHeight(fs)`; bordo `topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"` 1.5px; ombra 3D singola + padding simmetrico 14; testo invariato (`topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"`) + crenatura `letter-spacing="0.06em"` (marchio tecnico; `textLength` pinnato su stima+tracking); font base `17 * pw / 380` (era `14`). Stile `knockout` (`qbs`, come `mono`/`color` in preview esplicito e Stremio solo-non-standard): targhetta bianca opaca con glifi ritagliati via mask (stesso box esterno della pill, `rx = 0.30 * boxH`, niente stroke/gradiente; glifi mask a `~1.35x fs` con `textLength` pinnato sulla stima oversize e margini anti-clipping); con Dolby (verificato `localSpec`, combo `dv+atmos` o singolo) e altri formati impilati sotto il tier in colonna verticale come gli altri stili (Dolby resta bianco anche su top chiari); senza Dolby resta il tier knockout (mai fallback a standard) |

## Pill Network Logo

| Parametro | Server (`network-svgs.ts:loadNetworkPng` & `poster-service.ts`) |
|---|---|
| Sfondo | `topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)"` |
| Bordo | `topLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.20)"` stroke-width 1px |
| Padding | `px = round(fs * 0.65)`, `pt = pb = round(fs * 0.32)` dove `fs = round(max(18 * pw / 380, 12))` |
| Raggio | `r = round(pillH * 0.35)` (squircle, identico al badge qualità) |
| Posizione | default in alto a sinistra (`top = round(18 * STD_H / 570) + 10`, `left = round(18 * STD_W / 380)`, resta a sinistra anche con `side="right"`); centrato sopra il logo film (`top = logoTop - h - gap + 10`) con logo film + badge alto (nastro Netflix, badge centrale rank/extra, o Coming Soon); senza logo film e con nastro: a fianco del nastro (`w + 10`). Vista Stremio: specchia a destra con angolo destro occupato (nastro rank / Coming Soon). Solo landscape col logo film: mai sopra il logo (zona bassa) — sempre in alto (a fianco del nastro se occupa l'angolo sinistro, sotto il Coming Soon, altrimenti top-left con shrink vs badge centrale). ECCEZIONE stile `corner` (rank o extra) col logo film: di default sopra il logo titolo come in portrait (`cornerNetworkAboveTitle` in `poster-service.ts`: `logoTop - h - gap - NETWORK_LOGO_SHIFT_Y`, centrato sul box del logo titolo in tutti i layout — centrato, Cinematic Left e titoli spostati; gap visivo = `gap`, scale/offset `netscale`/`nox`/`noy` invariati, dopo shrink ricalcolato sulle dimensioni finali); senza spazio sopra il titolo o con collisione irrisolta alla shrink minima → top-left storico; `netPos=top` esplicito e gli altri stili restano invariati, Coming Soon/nastri invariati. Se si sovrappone al badge centrale, rimpicciolisce fino a 0.55x |
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
| Testo | `fontFamilyFor(label)` per-pill (ebraico/arabo → Rubik) + `textLength`/`lengthAdjust="spacingAndGlyphs"` come gli altri badge; `dominant-baseline="central"`, nome troncato a 80 char, `escSvg` |
| Font embedded | Nessun `@font-face` negli SVG: i font si risolvono dal fontdb resvg via `FONT_FILES` (`fonts.ts`: Inter 400/700/900 + Noto Symbols + Rubik 400/700/900) |
| Fit | `w = min(maxWidth, width)` con `maxWidth = STD_W - 40`, `h` in scala proporzionale |
| Posizione | centrata, `top = legacyTop - h - 10` sopra il badge genere (o `STD_H - 20` senza badge) — `poster-service.ts` |

## Colonna rating separati (Separate Ratings)

Opt-in (`sep=1`, default OFF): sostituisce la media ★ nel badge con una colonna a destra di pill verticali (logo provider sopra, punteggio sotto). A OFF zero pixel cambiano.

| Parametro | Server (`separate-rating-renderer.ts:renderSeparateRatingStack` + `poster-service.ts`) |
|---|---|
| Font size | `round(max(14 * pw / 380, 11))` (più piccolo del quality-badge: pill compatte moderne) |
| Scala rating separati (`separateBadgeScale` / `sepscale`) | Nativa via font: `fs = round(base * scala / 100)` (a 100 percorso identico allo storico — esplicito 100 resta byte-identico); padding/gap/loghi derivano da `fs` → tutto scala proporzionalmente; `%` 10..200, default unico 130 per `column`/`bottom-bar`/`bottom-pills` (`getSeparateBadgeDefaultScale`; esplicito query/mapping/token/default, incluso 100, vince sempre); entra nella `separate` badge key; in `compactTuning` omessa e coperta da `dv`. UI solo relativa (`separateBadgeScaleToUI`/`uiToSeparateBadgeScale` in `badge-styles.ts`: raw 130 ↔ 100, range 8..154, raw persistiti mai migrati) |
| Stack | UN solo bitmap: pill verticali `logoH = round(fs * 1.0)`, `h = pt + logoH + gap + fs + pt` (`px = round(fs*0.6)`, `pt = round(fs*0.3)`, `gap = max(2, round(fs*0.2))`), gap stack `SEPARATE_STACK_GAP = 5`; larghezza uniforme `colW = max(contenuti) + px*2` (colonna dritta); `rx = round(maxH * 0.32)` condiviso |
| Cap display | max 3 (`pickSeparateRatings` in `ratings.ts`: ordine selezione `rsrc`, skip miss/0; vuoto → fallback media) |
| Formati | decimale 1 cifra (`7.3`); famiglia percent (`tomatoes`, `popcorntime`) come `88%` (`formatSeparateValue`) |
| Colori | convenzione quality-badge: `topLight ? dark pill : light pill`, bordo 1.5px adattivo, ombra dedicata ridotta (`seps`: dx=2, dy=2, blur 2, 0.55 — la 3D standard sbordava nel gap 5px sembrando squadrata) |
| Loghi | `public/rating/*.svg` a colori brand originali (mai ricolorati), embed `<image data:...>` come le pill network; asset mancante → pill skippata (mai 500) |
| Posizione | bordo destro allineato al badge qualità (`right = qualityRight`), `top = qualityBoxBottom + 6` + 5 portrait (`PORTRAIT_SEPARATE_SHIFT_Y`, solo formato poster; pad inferiore sottratto in scala, gap ottico 6px); senza qualità parte dal top (`netBaseTop - 10` + 5 portrait, "sale"); con nastro a destra segue a sinistra (stesso branch `isRightRibbonCorner`); in landscape segue il badge qualità come in portrait senza +5 |
| Offset gruppo (`separateBadgeOffsetX/Y` / `sepox`/`sepoy`) | intero gruppo (colonna o riga, mai singoli provider): `left += ox`, `top += oy` (positivo Y = giù, come gli altri offset) con clamp dentro il canvas; `bottom-bar` portrait full-width: X ignorata esplicitamente (solo Y); in landscape la barra è pills (X attiva); catena `query > mapping effettivo per formato > config token > defaults effettivi > 0`, clamp `±2000`, step 5 in presets; bitmap badge invariati (solo placement, chiavi `separate` invariate; chiave poster/`dv` li includono). UI: slider X/Y in Trasforma per-titolo/default/Orizzontale (stesso range/bounds degli altri offset); X disabilitata con hint in `bottom-bar` portrait |
| Priorità | mai col custom provider: se la riga custom è renderizzata, lo stack si nasconde |
| Sostituzione | con stack attivo (`useSeparate`) il badge genere nasconde il segmento ★ (`badgeRating` effettivo = false) |
| Stile layout (`separateRatingsStyle` / `sepstyle`) | enum `column` (default storico), `bottom-bar` (solo portrait), `bottom-pills`, `bottom-mono` (icone tonde + voti monocolore, senza contenitore), `bottom-color` (icone tonde brand + voti, senza contenitore); catena query > mapping effettivo per formato > config token > defaults effettivi > `column` (garbage → `column`); landscape: solo `bottom-bar` → `bottom-pills` DOPO cascata (`getSeparateRatingsStyleForShape` in `badge-styles.ts`, riusato da config/service/preview/UI — raw salvati intatti, portrait invariato; `bottom-mono`/`bottom-color` passano invariati in entrambi i formati); emesso esplicito solo quando bottom negli URL Stremio (come `bs`/`rs`, mai in `dv`), sempre esplicito in preview (`column` incluso, WYSIWYG); in allowlist cache key + hardening enum |
| Bottom attivo | `badgesEnabled && badgeRating && sep && stile bottom` (centralizzato in `resolveSeparateDisplayState`, INDIPENDENTE dai valori: con voti assenti nasconde comunque genere+anno+voto, senza inventare valori); la soppressione è EFFETTIVA solo a render — `bg`/`by`/`br` salvati non mutati (tornando a `column` si ripristinano); in bottom la riga custom provider è esclusa (`suppressCustomRow`, mai duplicata; il custom conserva la priorità storica sulla colonna, invariata). UI: selettore `sepstyle` (Colonna/Barra/Pill/Monocolore/Icone colorate) visibile con rating separati ON — in landscape la Barra è disabilitata (visibile, mai selezionata, hint `ui.separateRatingsBarLandscapeHint`; selezione mostrata sullo stile normalizzato via `getSeparateRatingsStyleForShape`) e il raw salvato resta (in portrait torna); in bottom i toggle genere/anno sono disabilitati (visivo + aria, callback inattiva) ma i valori restano conservati — stesso comportamento nei default globali. Lo stile è condiviso tra formati in UI (niente selettore Orizzontale dedicato), ma un eventuale override `landscape` già salvato nei dati si rispetta in load/save (mapping effettivo, profilo preservato, stash cambio formato) |
| Riga bottom (`renderSeparateRatingsBottom` + `poster-service.ts`) | UN solo bitmap: logo provider + valore inline (logo a sinistra, valore a destra, `textLength` stabilizzato); `bottom-bar` = fascia satinata adattiva `satinPillStops(bottomLight)` full-width a filo in basso (SOLO portrait — in landscape normalizzata a pills a monte, mai renderizzata); `bottom-pills` = 1-3 pill adattive `rx = h/2` con bordo 1.5px + ombra `seps`, in portrait riga centrata con margine `round(20 * CH / 570)` dal bordo + 5 Y portrait solo pills (`PORTRAIT_SEPARATE_SHIFT_Y`; bar full-width a filo esclusa: il +5 sarebbe annullato dal clamp), in landscape ancorate a DESTRA con la geometria base genere (`landscapeRightAnchorLeft` extra 0 opticalShift 0: margine pieno `18*CW/380` senza il +40 ottico del genere, base landscape −20 X / −10 Y via `LANDSCAPE_BOTTOM_PILLS_SHIFT_*`, slider `sepox`/`sepoy` neutri 0 e additivi dopo); `bottom-mono`/`bottom-color` = icone tonde + voto senza pillola/barra né contenitore (stessa geometria pills: centrata in portrait, destra in landscape con stessa base −20 X / −10 Y, stessi slider e collisioni logo; `loadRoundRatingLogo` in `separate-rating-renderer.ts`: piastra tonda, mono = grigio `208` su fondo scuro / `32` su chiaro con voto monocolore — bianchi oltre 230 preservati come controforme — color = piastra brand originale (`imdb` gialla `#f6c700` senza rettangolo, `tomatoes` natural senza piastra, resto `#032541`) + voto chiaro su scuro); materiale/testo/bordo seguono `bottomLight` come il badge genere (fondo chiaro → pill scura + testo chiaro, fondo scuro → pill chiara + testo scuro) — loghi brand invariati; reservation logo titolo = geometria colonna equivalente (`logoBadgeVisibility`, solo reservation); base font `round(max(15 * pw / 380, 11))` (`23` per i bare, `15` per bar/pills), scala % 10..200 nativa come la colonna; fit sul font (loop max 4 fino a `max(8, 55% base)` con rebuild coerente) + shrink bitmap proporzionale di sicurezza — mai clipping; vuota → null (mai placeholder) |
| Cache | chiave stack `badge:separate:<src+val,...>:<CW>:<topLight>` (un composite); chiave bottom `badge:separate-bottom:<stile>:<src+val,...>:<CW>:<bottomLight>:<scala>:<w>` (il segmento `<stile>` distingue anche `bottom-mono`/`bottom-color`: mai collisioni tra stili); flag `sep` nella cache key poster; valori sep nell'etag dei poster dinamici |

## Gradiente fondo poster

| Parametro | Server (`badges.ts:bottomGradientSVG`) |
|---|---|
| Altezza | `gh = max(round(ph * pct / 100), 100)` |
| Colore | `color` + `opacity` |
| Direzione | `y1 = dir === "up" ? "0" : "1"`, `y2 = dir === "up" ? "1" : "0"` |
| Posizione | `top = dir === "up" ? ph - gh : 0` |
| Fade | `0% trasp → svgFadeEnd% trasp → svgSolidPct% opaco → 100% opaco` |
| Posizione badge genere | `badgeY = ph - h - round(20 * ph / 570)` |

> **Preset sfumatura (Naturale/Colore/Nero + 3 custom, solo client):** scorciatoie in
> `TransformControls.tsx` (per-titolo) e `SettingsPanel.tsx` (default globali)
> che scrivono i 5 slider esistenti (`gradHeight`/`blur`/`bf`/`bd`/`tint`) —
> nessun nuovo parametro URL, nessuna chiave cache. Riga condivisa
> `GradientPresetRow.tsx` (3 built-in + fino a 3 personali = 6 totali). Logica in
> `src/lib/gradient-presets.ts` (`GRADIENT_PRESET_COLOR`,
> `NATURAL_GRADIENT_DEFAULTS`, `adjustGradientForPosterChange`,
> `defaultHeightForPoster`/`defaultFadeForPoster`, store custom con
> `sanitizeCustomPresets`/`addCustomGradientPreset`/`deleteCustomGradientPreset`
> in localStorage per namespace). I custom fotografano gli slider correnti e non
> viaggiano mai al server. Il cambio artwork ricalibra
> altezza/fade solo da stato pristine (preset e tweak manuali sopravvivono);
> i default personalizzati restano assoluti (niente auto-calibrazione per tipo
> poster clean vs non-clean).
>
> **Sfumatura per formato (Verticale/Orizzontale):** i flat sono il profilo
> portrait. Il profilo landscape vive in due posti: `landscapeBlur` per-titolo
> (`PosterEditorContext`, init da `mapping.landscape` > default globali
> Orizzontale > default di formato) e `ServerDefaults.landscape` per i default
> globali (tab Impostazioni · Trasforma con sotto-tab Verticale/Orizzontale:
> sfumatura completa — altezza/intensità/fade/darkness/tinta/ombra — + logo
> (scala null = auto-fit, offset null = 0) + scale/offset badge; stili e toggle
> restano condivisi). Risoluzione server:
> query > mapping(.landscape) > config > defaults(.landscape) > default di
> formato (`effectiveDefaultsForShape` in `server-defaults.ts`, usato da
> `poster-config` e `stremio-poster-url`). L'editor segue gli stessi fallback:
> all'ingresso in landscape senza stash/profilo salvato gli slider badge
> partono dai default Orizzontale (`EditView`), all'apertura con default
> Orizzontale idem (`context`), e i cambi ai default a poster aperto si
> propagano live (solo senza mapping salvato, mai freeze involontario).
> La preview in landscape usa il profilo, il save per-titolo lo scrive in
> `mapping.landscape` (solo se toccato o save in landscape, mai freeze
> involontario al save portrait). Lo stash al cambio formato non copre le
> chiavi sfumatura. La sezione Trasforma per-titolo è singola e segue il
> formato in editing (stessa riga preset condivisa).
>
> **Badge per formato (Verticale/Orizzontale):** unico selettore `editTargetShape`
> (`SettingsPanel`, `data-testid="format-target-selector"`, prima dei controlli
> nelle tab visive, stato condiviso Badge/Trasforma): sceglie solo il target di
> modifica — anteprima e default Badge seguono il formato in modifica, il formato
> di consegna (`defaultPosterShape`, Stremio) non cambia mai; fonti dati, regione,
> formato data e API restano condivisi. La tab Badge lega i campi via
> `useShapeBadgeDefaults` (`BadgeDefaultsSection`, `BADGE_VISUAL_LAND_KEYS`):
> portrait = flat condivisi, landscape = profilo `landscape` (`land ?? flat`,
> `null` = eredita — tranne scala/offset logo dove `null` resta auto/zero da
> contratto storico). Il profilo server `landscape` (`server-defaults.ts`,
> `effectiveDefaultsForShape`) copre anche gli stili (`badgeStyle`,
> `rankingBadgeStyle`, `extraBadgeStyle`, `badgeFont`, `qualityBadgeStyle`,
> `videoFormats`), i toggle (`globalBadges`/`rankingBadges`/`badgeGenre`/
> `badgeYear`/`badgeRating`/`badgeQuality`/`customRatings`/`separateRatings`/
> `networkLogo`/`networkLogoPosition`/`preRelease`/`ribbonSide`/`ribbonEnabled`),
> `sashOrder` e `minQuality`; restano sempre condivisi fonti voto, fonte Top 20,
> regione, formato data, API/cataloghi, fit logo e rotazioni. Risoluzione server:
> query > mapping(.landscape) > config token > defaults(.landscape) > default di
> formato. `xbs` è solo-extra: assente ovunque = legacy `rs` (numeri/nastri
> degradano a pill angolo/piastra come oggi, mai migrazione in lettura), invalido
> = assente, il rank usa sempre `rs`. `RankingAppearanceSelector` (default e
> per-titolo): Nastro = `netflix`+ribbon, Numero = `number`+ribbon, Badge =
> `pill`+ribbon; le varianti `colored`/`standard` spengono il nastro (col nastro
> il renderer mostrerebbe il nastro, non il badge), `default` legacy è pura
> lettura (`resolveRankingAppearance`/`resolveRankVariant`, mai scritture). La
> riga posizione (Sinistra/Destra) vive solo nei default: nel per-titolo
> (`BadgeControls`) è omessa — un'anteprima non persistibile al save. Card
> default: Classifica (master `topBadge` + bucket rank chirurgico su `sashOrder`
> + singola appearance, mai secondo switch nastro), Info (genere/anno + stile
> extra indipendente + categorie + Coming Soon), Valutazioni
> (fonti/separati/custom), Qualità (tier/formati/icone/network), Avanzate
> (priorità `sashOrder`, reset del solo profilo).
>
> **Nastro Standard vs Colorato (U1):** stessa geometria nastro Netflix
> (`buildNetflixRankBadgeSVG`); Standard (`rs=netflix`) = satinato
> `satinPillStops(topLight)` + testo `0.80`, Colorato (`rs=colored`+ribbon) =
> tinta accent piatta + `textColorForBg` (stesso criterio dei badge colored).
> Legacy `netflix-color`/`default`+ribbon leggono Standard senza migrare il
> valore salvato (`resolveRibbonVariant`/`ribbonVariantValue`, mai scritture);
> `colored` come Badge spegne il nastro (`rankVariantValue`), come Nastro lo
> accende. Stesso accent → PNG diversi tra Standard e Colorato.
>
> **Preview contestuale default (U2):** `previewFamily` (`auto`/`rank`/`info`/…)
> + `previewExtra` (campione `__badge.*` risolto server-side) viaggiano solo
> nella preview default (`buildDefaultsPreviewUrl`, stesso endpoint poster,
> nessun renderer duplicato) e non si salvano mai. `auto` rende la priorità
> effettiva salvata per forma (`sash`, `rank` incluso quando abilitato);
> `rank` restringe a `rank` (vuoto se rank spento, mai fallback info);
> `info` forza il primo campione info abilitato con `xbs` proprio (niente
> campione a categorie spente). Le card segnalano la family su focus/pointer
> (mai hover, nessun move focus); Auto ripristina sash effettivo e rimuove
> `extra` forzato.

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
| `sepscale` | scala colonna separati per-titolo (preview sempre esplicita, default 100); solo valore in pattern/Stremio non-compact (in compact coperta da `dv`) | scala `%` 10..200 (default 100 = resa storica): `query > mapping(.landscape) > config token > server defaults(.landscape, `PICTORIUM_SEPARATE_BADGE_SCALE`) > 100` |
| `sepstyle` | layout separati per-titolo (preview sempre esplicita, default `column`); solo valore bottom in pattern/Stremio non-compact (mai in `dv`: enum a bassa cardinalità come `bs`/`rs`, resta esplicita anche in compact) | layout `column`/`bottom-bar`/`bottom-pills`/`bottom-mono`/`bottom-color` (default `column` = resa storica): `query > mapping(.landscape) > config token > server defaults(.landscape) > column` (nessuna env dedicata); query presente ma invalida/vuota → `column` esplicito, mai eredita mapping (chiave cache distinta dall'assenza); `bottom-bar` + landscape → `bottom-pills` DOPO cascata (raw intatti) |
| `gradHeight` | `gradientHeight` | `qGradHeight` — alimenta l'altezza del gradiente/sfocatura (blurHeight): query > mapping > config token > server defaults > default di formato (30 portrait, 20 landscape; mapping non-clean senza valore congelato: 20). Post-selezione solo Stremio unmapped: se il poster finale ha testo incorporato, i default globali non vincono sul profilo non-clean (20/80, come il client) |
| `bf` | `blurFade` (slider editor 0..100 + double-click reset 50, 70 in landscape) | punto di attacco transizione 0..100 (default 50 portrait, 70 landscape, 80 profilo non-clean senza valori congelati): query > mapping > config token > server defaults > 50 (70 landscape, 80 non-clean). Emessa sempre esplicita in preview e Stremio. Curva ease-out continua `u = 1-(1-t)^γ` (γ = 1 + (1-bf/100)·2.5; default 50 → γ=2.25): tocca 1 solo all'ultima riga, NESSUN plateau (il vecchio `min(t/fadeStop,1)` appiattiva il fondo e piega lo shade) |
| `tint` | `tintStrength` (slider editor 0..100 + default globale, double-click reset 20) | `qTint` — intensità tinta di scena 0..100 (default 20): query > mapping (`tintStrength`) > config token > server defaults (`PICTORIUM_TINT_STRENGTH`) > 20. Emessa sempre esplicita in preview e Stremio. Nessun profilo landscape dedicato (vale per entrambi i canvas) |
| `ts` | `topShade` (slider editor 0..100 + default globale `defaultTopShade`, double-click reset 50) | `qTs` — ombra lineare superiore 0..100 (default 50): query > mapping (`topShade`) > config token > server defaults (`PICTORIUM_TOP_SHADE`) > 50. Solo flat (vale per entrambi i canvas, come la tinta). Preview sempre esplicita (`ts=0/..`); Stremio solo quando ≠ 50 (URL esistenti invariati). Sotto compactTuning la risolve il server dal mapping |
| `dv` | mai dallo stato (firmata dal builder) | hash FNV-1a (8 hex) del tuning omesso negli URL compatti — emessa solo con `compactTuning`, mai letta dal render: invalida browser/edge/Stremio a ogni cambio default senza cambiare un pixel. Il proxy addon emette la stessa chiave ma con copertura totale dei defaults (`proxyDefaultsSignature` in `addon-proxy.ts`: stili/toggle inclusi — i param espliciti clobberebbero i mapping, vedi catena query > mapping) |
| `tl` | `topLight ? "1" : "0"` (sempre, anche per genre badges) | `qTopLight` — override se presente |
| `bl` | `bottomEdgeColor` via `useRootColors` (solo a calcolo completato, come `tl`) | `qBottomLight` — override se presente, altrimenti calcolo server sulla striscia inferiore corretto per la banda blur (`computeBottomLight`) |
| `qmin` | — (solo default globale, nessun per-titolo in Fase 1) | `q.get("qmin")` > server defaults (`PICTORIUM_QUALITY_MIN`) > `"SD"` — tier sotto soglia = niente badge; emesso negli URL Stremio solo quando ≠ `SD` |
| `sash` | — (solo default globale via 5 toggle Impostazioni, nessun per-titolo in Fase 4) | `q.get("sash")` > server defaults (`PICTORIUM_SASH_ORDER`) > ordine standard (`upcoming,rank,new,award,extra`) — sottoinsieme ordinato, non listati = spenti, `sash=` vuoto = tutto spento, garbage = default; emesso negli URL Stremio solo quando ≠ default |
| `df` | default globale `defaultDateFormat` (tendina Impostazioni: `locale`/`dmy`/`mdy`/`iso`); preview sempre esplicita (`df=locale/…`, WYSIWYG) | formato data badge "in uscita": query > server defaults (`dateFormat`) > `locale` (fail-closed: ignoti = `locale`); emesso negli URL Stremio solo quando ≠ `locale` (URL esistenti invariati) |
| `pre` | `preRelease ? "1" : null` (solo se ON, default OFF) | `qPre` — effetto pre-digitale: velo scuro (sotto logo e badge, che restano luminosi) + nastro angolare rosso "coming soon!" in alto (a sinistra; a destra con side="right") sui film senza disponibilità digitale/streaming (JW offerte non-CINEMA > TMDB type 4). Catena: query > config token > server defaults (`PICTORIUM_PRE_RELEASE`) > false |
| `hideLogo` | mai dal client (solo banner Stremio) | solo query `hideLogo=1`: salta il composite logo film (fetch tenuto per i colori accent). Vale per entrambi i canvas: il landscape cuoce il logo come il portrait (vincoli 16:9), solo il banner pulito lo nasconde. Col banner (landscape) il badge genere va in basso a DESTRA (ancoraggio destro, niente shift landscape) e il network segue i rami "senza logo" (top-left / a fianco del nastro) |
| `rd`/`fad` | date complete `release_date`/`first_air_date` (solo se valide `YYYY-MM-DD`) | ramo query: date a piena precisione per rilevamento pre-digitale (fallback `year` → `${y}-01-01`) |
| `title` | `selected.title \|\| selected.name` (preview) / `mapping?.title` (Stremio) | titolo per il match JustWatch (`preTitle`: mapping > query > session > `genreName`) — senza, la ricerca usa `genreName` e il match per tmdbId fallisce (rilevamento pre-digitale + qualità degradati) |

> `gradColor`, `gradOpacity`, `gradFade`, `gradDir` sono **parametri morti**: non vengono più letti dal server (il gradiente usa il colore accent + `gradHeight`). `bottomGradientSVG` in `badges.ts` non è più chiamato dal compositore poster. Non reintrodurli.
| `rank` | `badge.rank` (se rankingBadges attivi) | `qRank` — override del ranking |
| `animerank` | rank anime del titolo selezionato (da `mdblistAnimeList`, solo preview WYSIWYG) | `qAnimeRank` — override del rank anime (`media_type=tv`); senza, il server lo calcola da `fetchMDBList` con la chiave della richiesta o il fallback d'istanza (`PICTORIUM_MDBLIST_KEY`) |
| `label` | `badge.rankLabel \|\| badge.label` | `qLabel` — override label ranking |
| `extra` | `badge.label` (se extra) o `customBadge` | `queryExtra` — forza badge extra |
| `bs` | `badgeStyle` | `qBs` — "shadow"/"pill"/"bar"/"colored"/"bordo"/"vetro"/"minimal" (vale per entrambi i formati; il default landscape sceglie lo stile orizzontale) |
| `bfont` | `badgeFont` | `q.get("bfont")` — "inter"/"barlow-condensed"/"oswald" (default "inter" = resa storica; assente o non valido → Inter). Vale per entrambi i formati. I preset custom/house del Badge Lab hanno tipografia propria e lo ignorano. |
| `rs` | `rankingBadgeStyle` | `qRs` — "default"/"colored"/"pill"/"bordo"/"vetro"/"netflix"/"corner"/"number" ("bar" rimosso: degrada a "default"; "corner" = pill piatta tinta accent ancorata alto-sx; "number" = solo cifre Inter Bold con gradiente bianco→argento e ombra morbida, senza piastra/nastro/`#`/label, ancorato alto-sx come `corner` ma specchiato a dx con `side=right`; collisioni network/qualità/Coming Soon condivise col `corner`; i rank `number` rendono su una baseline X di stile `NUMBER_BADGE_BASE_OFFSET_X=-20` canvas px — vedi `tox`) |
| `xbs` | `extraBadgeStyle` (per-titolo o default; assente = legacy `rs`) | `qXbs` — "default"/"pill"/"colored"/"bordo"/"vetro"/"corner" (solo extra; assente ovunque = legacy `rs`; invalido = assente; rank usa sempre `rs`) |
| `tscale`/`tox`/`toy` | `topBadgeScale`/`topBadgeOffsetX`/`topBadgeOffsetY` (badge CLASSIFICA superiore) | scala `%` 10..200 (default 100, tutti gli stili) + offset px (default 0, solo centrati). Semantica `tox` = baseline di stile + aggiustamento utente: per un rank `number` (`topBadge.type=rank`, stile effettivo `number`) la X effettiva è `tox + NUMBER_BADGE_BASE_OFFSET_X(-20)` (stesso su sx/dx e portrait/landscape; gli slider UI mostrano l'effettivo e convertono l'edit in aggiustamento, i raw salvati non migrano mai); extra in fallback legacy `rs=number` e tutti gli altri stili restano sulla baseline storica (X effettiva = `tox`). URL preview/Stremio emettono sempre il `tox` raw (mai doppio conteggio: la baseline si applica una sola volta al render) |
| `exscale`/`exox`/`exoy` | `extraBadgeScale`/`extraBadgeOffsetX`/`extraBadgeOffsetY` (badge EXTRA superiore) | opt-in, stessi bound classifica; assente (o query invalida) = fallback legacy sul tuning classifica (URL invariati). Catena: query > mapping per-shape > config token > defaults per-shape > legacy. Il render seleziona il tuning per kind del topBadge effettivo (rank → classifica, extra → extra-dopo-fallback): nastro sempre classifica, `number` mai -20 su extra. Emissione esplicita solo se definito; in compact entra in `dv` solo in quel caso (altrimenti firma storica invariata). Regola indipendenza (implementata in `extra-materialize.ts`, applicata da setter classifica + `applyVisualPreset`): il primo edit classifica materializza l'extra precedente indipendente (tutti gli assi ancora in follow) PRIMA di cambiare il rank; l'edit extra non tocca mai la classifica. Reset extra = torna a null (segui) |
| `gscale` | `genreBadgeScale` (badge genere/rating in basso) | scala `%` 10..200 (default 100 su base 28.6px nativa; la **barra** scala nativa via font per restare full-width) |
| `gox`/`goy` | `genreBadgeOffsetX`/`genreBadgeOffsetY` | offset px (default 0, solo stili non-bar) |
| `qscale` | `qualityBadgeScale` (badge qualità streaming) | scala `%` 10..200 (default 100 su base 17px nativa) |
| `qox`/`qoy` | `qualityBadgeOffsetX`/`qualityBadgeOffsetY` | offset px (default portrait -10/+15, landscape 0/0; espliciti incl. 0 vincono) |
| `sepox`/`sepoy` | `separateBadgeOffsetX`/`separateBadgeOffsetY` (gruppo separati) | offset px (default 0; colonna/pills entrambi gli assi, `bottom-bar` portrait solo Y — X ignorata, mai nuovo renderer) |
| `netscale` | `networkLogoScale` (logo network) | scala `%` 10..200 (default 100) |
| `netPos` | `networkLogoPosition` (sempre esplicito in preview: `auto`/`top`; Stremio solo in modo `top`) | `auto` = specchio dinamico; `top` = sempre all'angolo superiore, lato del nastro effettivo (destra solo con nastro rank/preset o Coming Soon a destra, sinistra con tutti gli altri badge o senza — anche in vista Stremio; stacking Coming Soon del lato + shift nastro stesso lato + shrink vs centrale; qualità trasloca a sinistra quando il network finisce a destra). Catena: query > mapping (`networkLogoPosition`) > config token > server defaults > `auto` |
| `nox`/`noy` | `networkLogoOffsetX`/`networkLogoOffsetY` | offset px (default 0) |
| `side` | `ribbonSide === "right" ? "right" : null` (modalità Stremio; default Nuvio = sinistra) | `qSide` — "right" sposta nastro Netflix (specchiato) + logo network + nastro Coming Soon a destra |
| `shape` | `posterShape` (sempre esplicito in preview: `poster`/`landscape`; default globale `defaultPosterShape`, per-titolo dal mapping) | catena `shape` > mapping (`posterShape`) > config token > server defaults (`PICTORIUM_POSTER_SHAPE`) > `"poster"` — solo `landscape` attiva il canvas 16:9 (`LAND_W=768/LAND_H=432`, base = backdrop TMDB via `posterUrlOriginal`); emesso negli URL Stremio solo quando landscape (il portrait resta omesso per non invalidare la cache) |
| `align` | `logoAlign` (sempre esplicito in preview) | `left`/`center` esplicito > default globale **solo landscape** (`sd.logoAlign`) > default di formato (landscape `left`, poster `center`) — i portrait sono sempre centrati, nessun globale li sposta mai |
| `ac` | `accentColor` SOLO se manuale (`isManualAccent`: diverso da `autoAccentColor` auto-rilevato via `useRootColors`, come il server) — mai l'auto, mai nel mapping salvato | `qAc` — override colore accent (vince su tutto: badge colored, blur tint, scrim) |
| `live` | mai dallo stato editor (solo template "Segui il mio spazio": `followSpace` in `buildUrlPattern`, o `live: true` esplicito nel builder) | `live=1` — politica di rivalidazione (non forza il render): header `public, no-cache, max-age=0, must-revalidate` senza SWR su 200 e 304 + mai immutable; i parametri assenti seguono lo spazio (`badges`/`ranking`/`be` compresi, vedi sotto) |
| `tvdb_key` | mai dal client (solo manuale; Stremio usa il fallback d'istanza) | chiave TVDB per il rescue poster B1: solo ramo non-mappato, solo senza clean TMDB + con logo + solo portrait. Solo il textless (`includesText === false`) salva il logo; con testo il logo si azzera (no doppio logo). La chiave non entra mai nella cache key (segreto); il flag server-side `tvdb=1` separa le entry con rescue attivo |

> Fonte ranking Top 20 (nessun parametro URL dedicato): la selezione
> (`rankingSourceMovie`/`rankingSourceSeries`, `""` = JustWatch) vive nei
> server defaults / config token e si risolve server-side da `u=`/`config=`
> come gli altri default — mai nelle query dei poster (le chiavi restano
> server-side). Con fonte custom il rank alimenta il canale `trendRank`
> (label Film/Serie, niente label JustWatch/anime); fuori Top 20 o in errore
> nessun badge. La preview ricarica via nonce post-save (`rankSourceNonce` in
> `usePosterPreview`, risposte preview no-store), mai con URL diverse: client
> e Stremio vedono lo stesso render.

> URL Stremio (cataloghi/meta): `buildStremioPosterUrl()` emette gli stessi parametri ma dal **mapping salvato con fallback ai default** (`mapping?.X ?? defaults.X`) per `badges`/`ranking`/`bs`/`rs`/`be`/`extra`/toggle/enum — emissione sempre esplicita. Il tuning numerico ad alta cardinalità (`gradHeight`/`blur`/`tint`/`bf`/`bd` + 14 scale/offset `tscale`/`tox`/`toy`/`gscale`/`gox`/`goy`/`qscale`/`qox`/`qoy`/`sepscale`/`sepox`/`sepoy`/`netscale`/`nox`/`noy`) è omesso senza `config` (`compactTuning`): il server lo risolve da mapping > defaults dello spazio (stesso render, chiave convergente). `extra` è emesso solo per customBadge **non** rank-key (`isRankKey`): le rank-key viaggiano via rank live + fallback `mapping.badgeRank`/`trendRank`/`animeRank` su fetch fallito (mai su miss genuina: un titolo uscito dalla chart non resuscita il rank stantio), altrimenti `queryExtra` duplicherebbe il badge (vince sul calcolato).
>
> Template AIO/Custom "Segui il mio spazio" (`followSpace` in `buildUrlPattern`, `linkMode` in `context.tsx`/`InstallModal.tsx`): omette TUTTI i visuali (toggle, stili, tuning, lingua, shape fisso) ed emette solo `u` + `live=1` + `rv` (+ chiavi per policy, + `shape={shape}` nella variante Nuvio). Il server risolve gli assenti da query > mapping > config > spazio > default; con `live=1` anche `badges`/`ranking`/`be` assenti seguono lo spazio (fuori dal live, l'assenza resta default ON come prima). Header live su 200 e 304, ETag + 304 conservati, cache interna riusata.
>
> Validatori e policy HTTP (audit freschezza): l'ETag è l'hash SHA-256 del buffer finale effettivo (rank live, rating, qualità, premi e ogni dipendenza dinamica cambiano i byte → cambia l'ETag; suffisso `:cr` per i custom rating). Il confronto condizionale usa sempre l'ETag della rappresentazione richiesta (canonico/variante/AVIF, mai incrociati). Copia fresca + ETag uguale → 304 senza rendering; copia scaduta + condizionale (o `live=1`) → rivalidazione completa e 304 solo a contenuto invariato, mai 304 sulla copia scaduta; solo le non-condizionali fuori dal live conservano lo SWR. Niente immutable annuale nemmeno con mapping+rv+mv (i dati live non sono coperti dal versionamento): header finiti (24h mappati con SWR, ~6h dinamici, 120s effimeri anche mappati, no-cache sul live). Un TTL esplicito memorizzato (effimero) restringe sempre la policy, mai allargarla.

> Hardening anti cache-busting (v1.23.0, `poster-params-hardening.ts`, `PICTORIUM_POSTER_PARAMS=presets`, auto-on su `PUBLIC_INSTANCE=1`/`HOSTED_BY=elfhosted`/`MULTI_USER=1`): cache key con allowlist rigida (`POSTER_CACHE_ALLOWLIST`, junk `?x=` collassa, repeat deduplicati al primo valore); non-preview con presets → numerici quantizzati (step 5/10/5px), `ac` solo palette `GENRE_FALLBACK`, `extra`/`label` solo da mapping curato (canonicalizzati, mai free-text), override `poster`/`logo`/`backdrop` ignorati su pubbliche anonime. Preview (`preview=1`) live per spazi utente e sessioni sbloccate; sulle istanze pubbliche le preview anonime sono declassate a normale (auto-on, override `PICTORIUM_PREVIEW_AUTH=1/0`). Valori salvati mai toccati.

> Formato Stremio: se il default globale è `landscape`, cataloghi e meta Pictorium emettono `posterShape: landscape` e un URL `shape=landscape` anche per i mapping salvati `poster`. Con default `poster`, il formato per-titolo continua a prevalere. Il mapping salvato non viene modificato.
>
> Demo samples (solo preview default Impostazioni, `demo-samples.ts`): `buildDefaultsPreviewUrl` emette sempre `demosamples=1`; la route lo accetta solo con preview effettiva post-downgrade (`preview=1` + flag `1`, fail-closed; declassata → flag rimosso dalla chiave). Dataset sintetico fisso, zero fetch/chiavi: rank 11, tier `4K` (passa sempre `qmin`), network Netflix (SVG già bundlato, fallback nel service DOPO i candidati reali in ordine invariato), voti per le sole fonti `rsrc` richieste con merge gap-only (reali intatti, media regola imdb+tmdb), genere/anno fallback solo se assenti (date passate fisse). I toggle/stili restano l'unico gate di rendering (`ranking=0` → niente rank, `formats=none` invariato, niente premi/upcoming/Top250/Coming Soon campionati); `queryExtra`/preset seguono l'API reale. In chiave cache via allowlist (campione/genuino separati); le preview non si scrivono mai. Mai in `buildPreviewUrl` editor né negli URL Stremio. UI: avviso `ui.defaultsPreviewSamplesNotice`.

## Bordo poster

| Parametro | Client (`EditView.tsx`) | Server (`route.ts`) |
|---|---|---|
| Bordo | `3px solid rgba(255,255,255,0.80)` | Rimosso (solo client) |
| Overlay | `absolute inset-0 pointer-events-none` (sopra ogni contenuto) | — |

## Logo clean poster

| Parametro | Client | Server |
|---|---|---|
| Dimensione logo | `computeLogoOffsetBounds()` usa `computeLogoBox()` | `computeLogoLayout()` usa `computeLogoBox()` |
| Scala | `logoScale` come percentuale della larghezza poster, max larghezza poster. Limiti UI (c1): per-titolo Fresh 10..200 (`FRESH_TITLE_LOGO_MAX_SCALE`), per-titolo Standard 10..100 invariato (`STANDARD_TITLE_LOGO_MAX_SCALE`), default globali/di formato 10..200; server clamp 10..200 ovunque (`poster-config.ts`), validazione mapping 10..200 (`validation.ts`), query hardening invariato (step 10 in presets, preview sempre esente) | Stessa logica |
| Scala auto | `logoDefaultScale` (logo-selection.ts) | `defScale` in poster-service.ts + `defaultLogoScale` in poster-auto-fit.ts (stessa formula, Golden Rule) — curva `round(37.5 × aspect^(2/3))` cap 75 (2:1 → 60, 2.5:1 → 69, 3:1+ al cap; quadrati invariati a 38). ECCEZIONE Fresh EFFETTIVO (task8a+c1): scala auto/null con Fresh effettivo (layout fresh E (scope `all` O numerale valido 1..100 mostrato, già `rankingEnabled`-gated) — mai layout selezionato da solo, mai appartenenza catalogo) = 100 (`FRESH_TITLE_LOGO_DEFAULT_SCALE`, via `logoEffectiveAutoScale` + sentinel auto `scale=0`/null, mai 100 baked) — espliciti (anche 75/100/150/200) e fallback Standard (fresh+ranked senza rank valido, rank ignoto/pending, ranking spento) restano sulla curva |
| Cap altezza | Solo canvas poster (`posterH`) | Solo canvas poster (`STD_H`) |
| Cap portrait | `maxHeightPct: PORTRAIT_LOGO_MAX_HEIGHT_PCT (25)` — solo altezza, larghezza libera | Stesso cap (via `computeLogoLayout` in portrait; `poster-fit-score` usa gli stessi override) |
| Sorgente logo | — | `fetchLogoImg` (`imgSrc(path, "original")`, nitidezza, niente upsampling); se l'originale supera il cap anti-OOM 10MB, fallback `w780` → `w500`. Poster/backdrop restano `w500` |
| Margine inferiore | `bottomMarginPct: 12` con badge genere, `10` storico senza (mirror in `context.tsx` per i bound slider) | `bottomMarginPct: hasGenreBadge ? 12 : undefined` (default 10) — solleva il logo sopra il badge basso |
| Calibrazione Y portrait | `topOffset: PORTRAIT_LOGO_TOP_OFFSET (10)` — logo 10px più in basso (mirror in `context.tsx` per i bound slider, `poster-fit-score.ts` per l'auto-fit; landscape escluso: non baked-in) | Stesso offset (ramo portrait, già solo-portrait) |
| Calibrazione invisibile landscape | slider sempre a 0 (nessun default visibile) | `LANDSCAPE_LOGO_SHIFT_X/Y (+10/-10)` sommati in `poster-service.ts` agli offset risolti (`ox`/`oy` > mapping > default globali), come `PORTRAIT_LOGO_TOP_OFFSET` in portrait |
| Logo manuale su portrait non-clean | ammesso: tiles sempre abilitate, preview emette `logo` anche non-clean, mapping/route lo persistono e rendono | default nessun auto (auto solo da clean o landscape); `logoDisabled` sempre onorato; `?logo=` esplicita vince |

## Layout copertina Fresh (`layout`)

Opt-in grafico (`standard` = resa storica, default; `fresh` = numerale classifica in vetro + colonna meta a posizioni fisse, stesso renderer unico). Parametro `layout` in query; per-titolo nel mapping (flat + profilo `landscape`); nei default globali (flat + profilo Orizzontale) e nel config token. Nessun nuovo campo oltre `posterLayout`/`landscape.posterLayout`.

| Aspetto | Regola |
|---|---|
| Precedenza server (`resolvePosterLayout` in `poster-config.ts`) | query `layout` > mapping effettivo per formato (`mapping.landscape` vince sul flat) > config token > default effettivi per formato (`effectiveDefaultsForShape`) > `standard`. Query presente ma invalida/vuota = `standard` esplicito, mai eredita (chiave cache distinta dall'assenza) |
| Editor | selettore per-titolo (`BadgeControls`, mai tocca badge/logo/transform) + default per formato (`BadgeDefaultsSection`: Verticale = flat, Orizzontale = solo profilo). All'apertura: mapping effettivo > default effettivo di formato (`poster-layout-resolve.ts`, stessa regola del server). Propagazione live dei default solo senza mapping salvato; in landscape il flat non clobbera mai il profilo esplicito (`land ?? flat`). Stash per-titolo al cambio formato (`EditView`): ogni formato ricorda la propria scelta |
| Template senza titolo | layout effettivo del formato di consegna (`land ?? flat` su `defaultPosterShape`). Limite noto Nuvio: `shape={shape}` cuoce un solo valore (quello del formato di consegna) — una coppia divergente (verticale standard / orizzontale fresh) non congela entrambi in un unico parametro; per consegne divergenti servono template fissi per formato o Segui-spazio (live) |
| Cosa non si applica in Fresh | stili badge di numerale/righe meta/provider (le pill/nastri/placche Standard non esistono in Fresh; i valori restano conservati e si riapplicano tornando a Standard). Le DIMENSIONI/POSIZIONI invece si applicano (vedi riga sotto). Restano attivi: pill qualità, nastro Coming Soon, badge extra superiore, sfocatura/ombre/tinta, controlli logo (scala sempre, offset una sola volta sull'anchor Fresh) |
| Scala titolo Fresh (task8a+c1) | default EFFETTIVO 100 (`FRESH_TITLE_LOGO_DEFAULT_SCALE`): auto/null con Fresh EFFETTIVO rende come esplicito 100 (stesso percorso senza cap Standard + title cap fresh ingrandito della stessa %, byte-identici — nessuna doppia scala; il render cap lascia crescere davvero 100→150→200, solo la sicurezza canvas vincola). Espliciti 20/50/75/100/150/200 onorati ovunque (mai sovrascritti); Standard selezionato o fallback Standard (fresh+ranked senza rank valido/ignoto/pending, ranking spento) = curva aspect storica. Limiti UI (correzione utente "margine fino 150/200"): per-titolo Fresh 10..200 (slider + digitato, entrambi i formati), per-titolo Standard 10..100 invariato, default globali/di formato 10..200 (espliciti, servono al default Fresh). Editor: auto con sentinel (preview `scale=0`, save null) — mai 100 baked; rank-arrival/change, ranking on/off, scope ranked↔all e reset/switch layout riallineano i SOLI auto (100 vs aspect) senza toccare gli espliciti; un 100 automatico non diventa mai un 100 esplicito Standard (provenance `logoScaleExplicit`); con Fresh selezionato ma fallback Standard il controllo 200 resta disponibile come preferenza ma non muove lo Standard finché resta auto (solo un adjust esplicito lo cambia). I salvati espliciti (anche 75) non vengono mai clobberati; tornando a Standard gli altri visuali restano intatti |
| Titolo centrato portrait classificato (task8a2) | SOLO portrait Fresh CON rank valido mostrato: titolo centrato (`x = round((CW − w) / 2)`, stessa baseline di fondo `CH − h − titleBottom`, margine basso invariato) con slot proprio (`rankedTitleMaxW = CW − 2 × round(CW × 0.055)`, margini ~5.5%/lato ≈ 28px @500w come la reference; cap altezza 25% CH — i wordmark larghi legano in larghezza, i marchi alti/quadrati restano nella fascia bassa senza mangiare la colonna meta). Cap separato dal `titleMaxW` comune: portrait senza rank, landscape Fresh e Standard restano byte-identici. 100 = base del controllo scala (mai 100% del canvas); 150/200 ingrandiscono i cap della stessa % fino al SOLO limite genuino del canvas (a 150 il titolo tocca già il bordo, il 200 non cresce oltre — ammesso esplicitamente). `ox`/`oy` UNA sola volta sull'anchor centrato; logo mancante/nascosto invariato; nessun nuovo parametro, nessun renderer client separato (la preview usa lo stesso endpoint) |
| Titolo landscape Fresh ridimensionato (task9) | Landscape Fresh CON o SENZA rank (stesso slot, composizione invariata): titolo in basso a DESTRA (`x = CW − w − titleRight`, baseline `CH − h − titleBottom`, `ox`/`oy` UNA sola volta) con slot base = bound storici logo landscape (`landscapeTitleMaxW = round(CW × 0.40)`, `landscapeTitleMaxH = round(CH × 0.24)` — come `LANDSCAPE_LOGO_MAX_*_PCT` in `logo-layout.ts`; prima il 100 cadeva nello slot intero a destra colonna ~0.63 CW senza cap altezza: wordmark 487×162, marchio quadrato 400×400 raw). 100 = base del controllo scala (mai 100% del canvas); 150/200 ingrandiscono TUTTI E DUE i cap della stessa % fino al SOLO limite genuino del canvas (mai cap statico che cancella la scala). Portrait classificato centrato (task8a2), portrait senza rank e Standard byte-identici (slot loro intoccati) |
| Numerale portrait Fresh alzato di 90px (task10) | SOLO portrait Fresh CON rank valido mostrato: l'anchor numerale scende di calibrazione default `FRESH_PORTRAIT_RANK_Y_SHIFT = -90`px canvas logici PRIMA dello `toy` utente (`numeralTop` 120 → 30 @500×750, share CH 0.16 → 0.04; landscape 0, invariato). La colonna meta classificata segue il numerale per catena esistente (`metaTop` dal box trasformato → sale di 90 anch'essa, più i propri `goy` indipendenti); il provider sotto-meta e la banda blur sinistra seguono la nuova inchiostro reale (stessi pixel di banda, solo campionamento spostato). `toy` salvato mai resettato (termine baseline separato: neutro `toy=0` = nuovo default, offset utente invariati relativi). Font/scala invariati (stesso `fontSize`/`capH`, niente refactor tipografico — quello è task11). Senza rank (`all` non classificato, fallback Standard) e Standard = byte-identici (fallback `metaTop` = `numeralTop` storico, mai shiftato) |
| Numerale Fresh alto/stretto (task12 + correzione c2 rank-aware dal 10 in poi) | SOLO Fresh CON rank valido mostrato (entrambi i formati): i glifi del numerale sono condensati anisotropicamente PER FORMA+RANK — SOLO il portrait dal 10 in poi si restringe ancora (`FRESH_NUMERAL_CONDENSE_X_PORTRAIT = 0.42` per rank portrait 10..100 = 70% della larghezza corrente 0.6 per richiesta utente "schiacciamoli ancora, troppo grandi 2 cifre" / "ok proviamo" / "solo verticale landscape va bene", con vincolo finale "si schiacciano solo dal 10 in poi": le cifre singole portrait 1..9 restano al baseline task12 `FRESH_NUMERAL_CONDENSE_X_PORTRAIT_SINGLE = 0.6`, NON si assottigliano; `FRESH_NUMERAL_CONDENSE_X_LANDSCAPE = 0.6` landscape invariato byte-identico per OGNI rank; globale `FRESH_NUMERAL_CONDENSE_X = 0.6` resta default di fallback) DIRETTAMENTE sulla sorgente SVG condivisa (`freshNumeralSvg`, `transform="scale(<cx> 1)"` con origine x pre-compensata `rim/<cx>`, fattore portato dal box `condenseX` scelto da `freshGeometry` per forma+rank DOPO la validazione del rank — mai per rank assente/non-valido, che non disegna nulla) — mask di riempimento, anello del bordo (silhouette unita, nessun seam) e reference condividono gli stessi glifi, mai post-scale del bitmap glassato (la ROI artwork campiona l'inchiostro finale trasformato; `tscale` 10..200 moltiplica una sola volta la geometria stilizzata, `tox`/`toy` una sola volta). `estW` = stima raw × fattore di forma (contratto di misura normalizzato: inchiostro e stima scalano insieme, il tetto reale/stima resta ~1.14 < 1.2). Contratto altezze (da task11, qui portato a regime e BLOCCATO in c2: il fattore restringe solo la larghezza): UNA sola altezza per TUTTI gli rank 1..100 su entrambi i formati — il reference condensato a singola cifra non lega più contro la colonna meta (fit solo guardia che non ingrandisce mai), quindi portrait = share 0.33 CH (@500×750: font 340, capH 248, inchiostro ~0.33 CH come la reference rank-10; baseline top 30 task10 invariata, `metaTop` 300 per catena esistente), landscape = altezza storica invariata (font 296, capH 216 ≈ 0.50 CH, solo più stretto); anche il 100 ci sta condensato (eccezione 3 cifre solo sicurezza canvas). Tracking proporzionale (`-0.03em` × condensazione, nessun seam), inchiostro reale: due cifre portrait W/capH < 0.8 (prima ~1.5 a 0.6, ~1.04 a 0.6 per il 20). Banda blur sinistra segue l'inchiostro CONDENSATO (stessa origine `box.left − rim`, misura reale — si restringe da sola). Senza rank e Standard = byte-identici; in c2 si muovono SOLO i golden portrait classificati dal 10 in poi (i singoli 1..9 tornano byte-identici al pre-c1; re-pinned con contact sheet portrait 1..20 + full 9/10/20 e confronto 10 landscape in temp `task12-c2/`), landscape classificato byte-identico verificato |
| Banda blur sinistra classificata (task8b) | SOLO Fresh CON rank valido mostrato (entrambi i formati): fascia verticale full-height da `x = 0` a `inkRight + 16px` (`FRESH_LEFT_BLUR_FEATHER`), dove `inkRight` è il VERO bordo inchiostro del numerale trasformato (scan alfa `measureNumeralInk`, stessa origine `box.left − rim` del vetro — mai `estW`/`zoneW`; segue X/scala del numerale via `tscale`/`tox`/`toy`). Singolo blur sigma 9 (`FRESH_LEFT_BLUR_SIGMA`, stesso del vetro per coerenza tinta) + loop raw RGBA con alfa smoothstep (opaco a sinistra, esattamente 0 all'ultima colonna, dither Bayer deterministico come `blur.ts` — un solo encode PNG, nessun roundtrip). Composita SOTTO lo shade (lo shade scurisce la banda come l'artwork nitido: luminanza invariata, solo dettaglio ammorbidito), prima del numerale/meta/titolo e del chrome conservato (qualità/nastri/extra intoccati). Numerale fuori canvas = nessuna banda (skip, mai throw/ROI invalide/intero canvas a sorpresa); senza numerale (unranked `all`, fallback Standard) e Standard = byte-identici. Il vetro continua a campionare il `posterBuf` originale (nessun re-campionamento/costo extra). Y full-height per decisione minima esplicita (la reference utente vincola solo la fine orizzontale) |
| Transform effettivi in Fresh (nessun nuovo parametro/URL) | numerale classifica = `tscale`/`tox`/`toy` (tuning classifica effettivo per formato, già risolto a monte): scala+offset plasmano la GEOMETRIA (`freshGeometry`) PRIMA del campionamento artwork del vetro — il layer nasce già trasformato, mai post-resize; nessuna baseline `NUMBER_BADGE_BASE_OFFSET_X` Standard (anchor Fresh proprio: `padX`/`numeralTop`). Colonna meta = `gscale`/`gox`/`goy`: la scala dimensiona i font di colonna, gli offset spostano il blocco; posizionamento indipendente dal numerale ma catena di default automatica (il `metaTop` classificato deriva dal numerale trasformato). Provider = `netscale` NEL bitmap (già scalato dal renderer unico, mai riapplicato: niente doppia scala) + `nox`/`noy` relativi alla baseline sopra/sotto-meta + contratto `follow=false` + coordinate fisse (verbatim, come lo Standard). Logo titolo = `logoScale` NEL bitmap (già dimensionato dal renderer unico) + `ox`/`oy` UNA sola volta sull'anchor Fresh (in basso CENTRATO nel portrait classificato — task8a2 —, in basso a destra nel landscape classificato e in ogni composizione senza rank; l'anchor Standard è scartato coi suoi offset: niente doppio offset). Neutrali (100/0/follow) = baseline storica byte-identica (golden classificati invariati) ECCETTO il titolo portrait classificato task8a2 e la banda blur sinistra classificata task8b (cambi intenzionali); ogni layer è clampato dentro il canvas anche agli estremi (10..200%, ±2000px; oltre-canvas si clippa come i badge Standard, mai throw/ROI invalide) |
| Senza rank in Fresh | assente/disabilitato/non-valido (mai numerale valido 1..100) = niente colonna sinistra: il blocco meta va in basso a destra vicino al logo titolo (a fianco, bordo destro = sinistra logo − 16px, stessa baseline di fondo; senza logo allineato al margine canvas), network SOPRA IL BLOCCO META (centrato sul blocco meta, gap di colonna `round(metaGap*0.8)` — reversione esplicita utente, NON sopra il titolo). Senza righe meta il network ripiega sopra il logo titolo (gap standard `round(6*CH/570)`, centrato sul box titolo); senza logo né meta è ancorato in basso al bordo blocco. Logo titolo invariato (stesso anchor/dimensioni + i suoi offset). Con rank la colonna sinistra resta byte-identica |
| Cache/URL | `layout` in allowlist; assente ≠ `standard` esplicito (l'assenza può ereditare fresh, lo standard esplicito lo sovrascrive — anche in `compactTuning`, mai dentro `dv`). Stremio: `standard` esplicito viaggia sempre quando impostato, l'assenza resta senza parametro (URL legacy invariati) |
| Scope Fresh (`freshScope`: `all`/`ranked`) | `ranked` = default condiviso (correzione utente "metti di default solo rank"): Fresh solo per i titoli con rank VALIDO MOSTRATO (intero 1..100, già `rankingEnabled`-gated — non l'appartenenza al catalogo, non il testo custom, non i flag catalogo; la sola disponibilità dati non scavalca mai `rankingEnabled`); `all` = override esplicito (Fresh per tutti i titoli, anche senza rank). I mapping salvati espliciti restano intatti (`all` salvato = `all`, `ranked` salvato = `ranked`); solo l'assenza legacy segue il nuovo default `ranked` (scelta deliberata utente). Precedenza server (`resolvePosterFreshScope` in `poster-config.ts`): query `freshScope` > mapping effettivo per formato > config token > default effettivi per formato > `ranked` (query presente ma invalida/vuota = `ranked` esplicito fail-closed, mai eredita). Layout EFFETTIVO (`isEffectiveFreshLayout` in `fresh-layout.ts`, stesso helper `isFreshRank` del numerale — nessuna doppia derivazione): Fresh solo se layout fresh E (scope `all` esplicito O rank valido mostrato) — assente/invalido = `ranked`; deciso nel service DOPO la selezione del `topBadge` (rank da queryExtra > computato > Coming Soon; la soppressione network tocca solo l'extra, mai il rank) e PRIMA di ogni ramo soppresso — senza rank valido il percorso è Standard byte-identico (stesse impostazioni), con rank valido è Fresh identico alla modalità all. Né secondo fetch del rank (riusa `finalRank`/`animeRankResult` già risolti), né nuove cache/timeout. Campi: `posterFreshScope` in mapping (flat + `landscape`), default globali (flat + profilo Orizzontale), config token; query `all` esplicita scavalca sempre un ranked ereditato (stesso contratto di `layout=standard`), l'assenza resta assente (nessun campo nuovo negli URL legacy). Editor: tendina visibile SOLO con Fresh selezionato (`PosterFreshScopeSelector`, per-titolo in `BadgeControls` + default per formato in `BadgeDefaultsSection` via `useShapeDefaults`, stash per formato in `EditView`); la preferenza resta anche con Standard (tornando a Fresh si ritrova, mai mutati i rendering control salvati). Template: scope effettivo del formato di consegna (`land ?? flat`), stessa regola del layout — incluso il limite noto Nuvio (`shape={shape}` cuoce un solo scope: consegne divergenti per formato richiedono template fissi o Segui-spazio) |

## Files coinvolti

- `src/components/EditView.tsx` — preview WYSIWYG (singolo `<img src={previewUrl}>`)
- `src/lib/context.tsx` — stato, URL builder, localStorage
- `src/lib/poster-url.ts` — `buildPreviewUrl()`, `buildUrlPattern()` (parametri client → URL server)
- `src/lib/badges.ts` — server-side SVG (bottomGradientSVG morto; `cinematicVignetteSVG` + `topShadeSVG` per l'ombra superiore `ts`)
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
- `src/lib/award-ids.ts` — liste ID premi curate (Oscar/Globe/Emmy/Cannes/Venezia, namespace film/serie separati, update annuale; in RENDER_FILES)
- `src/lib/logo-layout.ts` — geometria condivisa logo preview/server
- `src/lib/gradient-presets.ts` — preset sfumatura Naturale/Colore/Nero (solo client) + regola pristine al cambio artwork
- `src/app/api/poster/[type]/[id]/route.ts` — composizione poster finale (preview + Stremio usano la stessa route)
- `src/lib/poster-params-hardening.ts` — allowlist cache key, quantizzazione presets, palette `ac`, canonicalizzazione `extra`, strip override keyless (in RENDER_FILES)
- `src/lib/stremio-poster-params.ts` — `compactTuning`: omette il tuning numerico senza `config` (in RENDER_FILES)
- `e2e/pictorium-visual.spec.ts` — test di regressione visiva (screenshot) per poster e interfaccia
- `e2e/pictorium-smoke.spec.ts` — smoke test funzionali

> Dopo ogni modifica ai parametri di resa visiva in QUALSIASI file qui elencato, segui il workflow in `visual-testing.md`.
