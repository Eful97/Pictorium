# Pictorium - Render Parameters (Client ↔ Server)

> **Source of truth.** This file is the canonical map of every visual render parameter
> in Pictorium. The client preview is a single `<img src={previewUrl}>` that loads
> `/api/poster/{type}/{id}` — the same endpoint used by Stremio. There is no
> duplication: preview = final poster. When this file and the code disagree on
> current behavior, **CODE WINS** — update this file. Vale solo per la
> descrizione fattuale del comportamento attuale rispetto a documentazione
> obsoleta: mai su requisiti utente, contratti pubblici o policy di sicurezza.

Quando modifichi un parametro di resa visiva, ispeziona l'implementazione
condivisa e i consumer interessati (URL client e lato server) e aggiorna solo
quelli toccati — mai edit speculari forzati su entrambi i lati per cambi
solo-server al renderer condiviso. Lo skill `poster-sync` guida il workflow.

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

**Componenti configurabili** (`bg`/`by`/`br`): genere, anno e voto si attivano **indipendentemente**. Default tutti ON → `Dramma • ★ 8.2 • 2024` (la resa centra la riga in entrambi i renderer; non è byte-identica al passato: il vecchio flusso con `dx` decentrava la riga di ~13-18px in Blink tagliando la prima lettera). Il badge si mostra se almeno un componente abilitato ha un valore disponibile (`hasGenreBadge = badgesEnabled && ((genre && bg) || (rating > 0 && br) || (year && by))`). Lato SVG i segmenti sono condizionali in `badge-svg-shared.ts:buildGenreTextFlow` — ogni segmento visibile ha il suo `<text>` ad ancora centrale posizionato dalle stime (niente `dx`/`dy`: Blink li include nella misura dell'ancoraggio mentre resvg li esclude e ignora `textLength` sui flussi multi-tspan, vedi sotto) e la stella è un path posizionato, mai un glifo Noto in un tspan. La riga resta centrata in entrambi i renderer per costruzione. In landscape i badge si rendono con `pw = 500` (`badgePw` in `poster-service.ts`: stessi pixel assoluti del portrait); il badge superiore centrale (rank/extra, non nastro) è al 120% (`topBadgePw`); posizioni, overflow-protection e chiavi cache restano sul canvas vero (`LAND_W/H`). Le barre genere in landscape non esistono (lo stile `bar` degrada a `shadow` come il ranking); la `bottom-bar` dei separati è disattivata in landscape (normalizzata a `bottom-pills` DOPO cascata via `getSeparateRatingsStyleForShape`, raw salvati intatti) e le pills landscape sono ancorate a DESTRA con la geometria base del badge genere (`landscapeRightAnchorLeft`, extra 0 opticalShift 0: margine pieno senza +40 genere, niente `gox`/`goy`). Il logo in landscape è contenuto a max 40% larghezza e 24% altezza (`LANDSCAPE_LOGO_*` in `logo-layout.ts`, stessi di `context.tsx` e `poster-fit-score.ts`) col fondo a ~10px dal bordo, in linea col badge genere (`LANDSCAPE_LOGO_BOTTOM_MARGIN_PCT`/`TOP_OFFSET`). Il gradiente di default in landscape è 20% invece di 30% (solo quando non esplicitato).

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
| Misura testo | `estimateTextWidth()` per-glyph in `badge-svg-shared.ts`; ogni segmento è un `<text>` a tspan singola vincolato con il proprio `textLength` + `lengthAdjust="spacingAndGlyphs"` (onorato sia in Blink che in resvg, a differenza del vecchio `textLength` sull'intera riga multi-tspan che resvg ignorava) |
| Allineamento verticale | Un `<text>` per segmento con `text-anchor="middle"` sulla sua stima (niente `dx` di separazione, niente `adjustedX`), stessa `y` e `dominant-baseline="central"` per tutti; stella come path SVG posizionato (stesso ingombro del glifo ★) |
| Font badge (`bfont`) | `fontFamilyFor(testo, font)` in `badge-svg-shared.ts`: "inter" → Inter, "barlow-condensed" → Barlow Condensed, "oswald" → Oswald; ebraico/arabo → sempre Rubik (nessuno dei tre ha quei glifi). `estimateTextWidth(testo, fs, font)` scala la stima Inter di 0.73 (Barlow) / 0.80 (Oswald), rapporti misurati con resvg su 10 stringhe × pesi 600/700/900; nessuna scala sul testo Rubik. La ★ del voto è sempre un path SVG 5 punte (`starPath`, stessa tinta oro o `starFill`) in uno slot dedicato posizionato dalle stime (coi font non-Inter evita anche il fallback resvg che duplicava il glifo precedente e allargava ~+40% quando una tspan ★ Noto seguiva contenuto non-Inter nello stesso `<text>`). |
| Chiavi cache | `badgeFont` entra in tutte le chiavi badge (`genre`/`rank`/`quality`/`comingsoon`/`separate`); `bfont` è in `POSTER_CACHE_ALLOWLIST` e fail-closed in `normalizePosterCacheParams` (invalido = assente = Inter). |
| Stili badge (`badgeStyle`) | `shadow` — textShadow; `minimal` — separatore pipe `|` + textShadow discreto (1px); `pill` — gradiente satinato `satinPillStops(bottomLight)` + stroke adattivo 1.5px (`bottomLight ? black 0.12 : white 0.22`, come quality/bar) + testo ad alto contrasto (`bottomLight ? 0.95 white : 0.88 black`) + ombra 3D singola + padding simmetrico 14; `bar` — gradiente satinato `satinPillStops(bottomLight)` full-width (polarità del fondo) + bordo profilo 1.5px adattivo + testo ad alto contrasto (`bottomLight ? 0.95 white : 0.88 black`), nessuna ombra esterna; `colored` — bg tinta di scena same-hue (bottom per genere, top per ranking; `ac=` vince) normalizzata ad automatic lightness fissa HSL 5/12 (100/240 dialogo Windows: hue/saturazione intatte, solo L; `ac=` manuale byte-identico, blur/tinta naturali invariati) + testo adattivo (pill piatta, niente satinatura); `bordo` — rect arrotondato con bordo 2px + stroke calibrato + bg protettivo (`bottomLight ? white 0.55 : black 0.32`: milky su fondi chiari, smoky su fondi scuri) + testo adattivo (`bottomLight ? dark : #e5e7eb`, come vetro); `vetro` — vetro liquido iOS (gradiente multi-stop + bordo 1.5px, stesso box model e dimensioni identiche al bordo: padding e rect coincidenti; sheen superiore invariato, centro protettivo `light ? white 0.55 : black 0.22` con base `light ? white 0.38 : black 0.45`) + testo adattivo come bordo |
| Sfondo pill/bar | bar (`buildGenreBarSvg`) = gradiente satinato `satinPillStops(bottomLight)` full-width + bordo profilo 1.5px adattivo + ombra 3D singola (code tagliate = bordo poster, invisibili); pill genere = gradiente satinato `satinPillStops(bottomLight)` (polarità del fondo, non del top) + ombra 3D singola + padding simmetrico 14 (colored inclusa: tinta piatta + ombra); pill ranking/extra = `satinPillStops(topLight)` |
| Posizione Y unificata | Box model normalizzato: zero salti di baseline tra stili (`genreStyleShiftY` rimosso); altezza uniforme `badgeBoxHeight(fs)`; la riga multi-rating segue sopra il badge |
| Testo pill/bar | bar = ad alto contrasto `bottomLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"` (su fondi chiari la barra diventa grafite scura, come la pill); pill genere/ranking/extra = ad alto contrasto (`bottomLight`/`topLight ? 0.95 white : 0.88 black`, come quality); nastro Netflix e riga multi-rating restano `0.80` (hanno textShadow dedicato); pill colored resta tinta piatta + `textColorForBg` (preferenza visiva bianco mentre il contrasto effettivo resta ≥2:1, non soglia WCAG — es. `#E67E22` bianco 2.9 vs nero 5.9 → bianco; fondi troppo chiari/gialli restano neri) |
| Stella voto | gradiente oro verticale `#FCD34D → #F59E0B` (`linearGradient#starg`) sul `tspan` stella; bullet `•` a opacità 0.45 (solo ingombro visivo, metriche invariate); stile `colored` su accent caldo (`isWarmGoldAccent`: hue 20-70, sat > 0.35): stella piatta in colore testo (l'oro annegherebbe) |
| Bordo bar | profilo 1.5px adattivo (`bottomLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"`), come quality-badge; la vecchia `line` 1px `rgba(0,0,0,0.10)` è rimossa |
| Box Model Unificato | Altezza scatola `badgeBoxHeight(fs) = fs + round(fs * 0.40) * 2` (`1.8 * fs`), padding X `round(fs * 0.75)`, ombra uniforme `badgeShadowBox(h)` (`blur = max(round(h * 0.20), 4), off = max(round(h * 0.10), 2)`) condiviso da tutti i badge centrati |

## Accento automatico adattivo (genere/rank/extra `colored`)

L'accento AUTOMATICO estratto (tinta di scena same-hue) si adatta alla banda
locale del badge invece di restare alla lightness fissa 5/12: hue/saturazione
intatti, L in [0.24, 0.60] (`solveAdaptiveAccent` in `accent-color.ts`), testo
renderer 4.5:1 prima priorità (`textColorForBg`), separazione fondo 3:1 seconda;
se 4.5 è irraggiungibile nei bound, vince il best-contrast documentato
(`feasibleText=false`, nessuna garanzia pretesa). Genere = banda bottom,
rank/extra = banda top. Approssimazione a DUE BANDE, mai pixel-exact per badge:
media striscia 8% sul canvas effettivo (portrait `STD_WxSTD_H`, landscape
`LAND_WxLAND_H` — il service campiona il buffer già fittato dalla route) +
velo nero analitico (top: alpha `0.75·topShade/100`, nullo con `tsh=0`; bottom: `blurDarkness`
solo a blur attivo) misurato in luminanza WCAG lineare sui canali velati, non
sulla media Rec.709 non-lineare. Vignetta/pre-release/scrim laterali non
modellati (stima conservativa); offset espliciti possono portare il badge fuori
banda (vale l'anchor-nearest). `ac=` manuale resta byte-identico (bypass);
fallback genere/grigio senza estrazione e tinta senza banda restano alla
normalizzazione legacy 5/12 byte-identica (tutto `GENRE_FALLBACK`, Comedy
inclusa); palette fisse provider-glass/neutral mai adattive; Fresh/Card hanno
aspetto fisso (solo un extra `colored` automatico riusato dentro Fresh/Card si
adatta via path condiviso). Il picker auto in UI (`BadgeControls`) mostra la
shade EFFETTIVA dipinta (header `X-Pictorium-Accent` della stessa risposta
immagine caricata via XHR blob da `usePosterPreview`, hook
`useEffectiveAccent`, display-only: mai dentro `isManualAccent`/`ac=`/mapping;
la base legacy `autoAccentColor` da `useRootColors` resta solo identità
canonica per il confronto manuale): nessuna fetch JSON dedicata nel flusso
normale, nessuna dipendenza da finestre TTL (`?accentmeta=1` resta solo
diagnostica read-only, mai necessaria al picker; record vecchi senza header =
unknown onesto): default picker = banda bottom/genere (la
card del picker), top/rank solo quando è l'unico a dipingere, con entrambe le
zone etichettate (`ui.accentAutoTop/Bottom`, anche se uguali) e provenienza
`manual` etichettata senza riscrivere il canonico; stili che non dipingono /
loading / unknown = caption onesta (`ui.accentAutoNone/Detecting/Unavailable`,
picker disabilitato su placeholder) con percorso manuale sempre disponibile
(`ui.chooseManualColor`, scrive il canonico solo su scelta esplicita).
Sotto il picker la caption `ui.accentAutoHint` lo chiarisce. Blur sempre sulla
tinta naturale, mai sull'adattato. CPU bound: max 2 crop cachati
(`poster-extract` 24h) + max 2x~38 valutazioni solver, nessun fetch/decode in più.
Estrazione e bande solo per gli stili che dipingono l'accento (genere `colored`,
top `colored`/`corner`/extra-`number`/`default` con accentFill; `follow-rank`
segue il fallback `rs` del renderer): gli altri stili e le bande manuali `ac=`
non decodificano nulla e tengono il valore legacy stabile in chiave cache.

## Badge Ranking/Extra

| Parametro | Server (`svg-badge.ts:renderRankingBadge/renderExtraBadge`) |
|---|---|
| Font size base | `30 * pw / 380` (rank), `×0.9` per extra; nastro Netflix a base `24 * 1.15 * 1.10` (+10% rispetto al default precedente) |
| Dicitura nastro | I nastri di classifica mostrano `TOP`, numero e sottotitolo periodo (`ribbonLabel`: "Oggi" localizzato, per film/serie come per anime; override custom esplicito vince sulle rank-key); altezza `w × 1.65`, testi centrati (`TOP` a `0.30h` senza sub, `0.20h` con sub, numero a `0.60h`). Senza `ribbonLabel` il sottotitolo resta nascosto. |
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
| Sfondo badge qualità | Gradiente satinato traslucido a polarità pill (`satinPillStops(topLight)`); altezza unificata `badgeBoxHeight(fs)`; bordo `topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"` 1.5px; ombra 3D singola + padding simmetrico 14; testo invariato (`topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"`) + crenatura `letter-spacing="0.06em"` (marchio tecnico; `textLength` pinnato su stima+tracking); font base `17 * pw / 380` (era `14`). Tag tier `standard` = la pill neutra storica (`buildQualityBadgeSvg` in `badge-svg-shared.ts` via `renderQualityBadge`, la STESSA ricetta della pill età `standard`: padding X `0.75 × fs`, raggio pieno `boxH/2`, stessa satinatura/bordo/ombra/testo/crenatura). Non esiste più un tag tier più largo/quadrato dedicato: ogni tier testuale usa la pill, quindi tier ed età condividono forma e padding. Nel gruppo con più elementi il box VISIBILE di ogni elemento testuale è pinnato alla larghezza del marchio 4K dello stile attivo (`targetW` = `markRefWidth`: pill 4K per `standard`, tag knockout 4K per `knockout`, cornice mono 4K per `mono`, icona 4K per `color`/`premium`, lastra Nova 4K per `nova`): le etichette più larghe (FHD, PG-13, TV-MA) riducono il font (`fitBadgeGlyphFs`, stesse metriche/tracking, `textLength` pinnato) invece di allargare la colonna o stirare i glifi, mentre altezza/raggio/padding restano quelli della base (banda comune). Un solo elemento resta il bitmap naturale storico; i marchi A/V portano la cornice dello stile e il glifo conserva l'aspect nativo DENTRO la cornice (mai stretch, inset condiviso `avPlateGlyphBox`). Il tier `mono` NON usa l'asset icona statico: usa la STESSA ricetta dinamica dell'età mono (`buildAgeEmphasisSvg`/`renderAgeEmphasisBadge`, etichetta reale 4K/FHD/HD/SD), quindi qualità `mono` ed età `mono` hanno un solo materiale; `color` (asset icona) e `knockout` mantengono le proprie ricette. Marchi formato A/V (unico set di asset per tutti gli stili, reso in `poster-service.ts`): larghezza VISIBILE normalizzata al badge 4K dello stile attivo (prima era `boxH × aspect del viewBox`: IMAX/HDR risultavano 2–4× più larghi), viewBox ritagliata sul box d'inchiostro misurato (`avMarkInkBox` in `quality-badge-styles.ts`, costanti guardate da un test che rimisura gli asset) e altezza naturale dall'aspect (mai stretch; sui marchi nudi la larghezza è quella dell'inchiostro, sulle placche è quella ESTERNA della placca con il glifo dentro). Ancora per stile: `standard` = larghezza della pill satinata 4K, marchio DENTRO la stessa pill del tier/età (raggio pieno `boxH/2`, gradiente `satinPillStops`, bordo 1.5) con inchiostro adattivo alla polarità (scuro su pill chiara, chiaro su pill scura); `mono` = larghezza della cornice mono 4K, marchio DENTRO il contorno alto contrasto dell'età mono (`fill="none"`, raggio `0.30 × boxH`, stroke `AGE_MONO_STROKE_*`, bianco su top scuro / nero su chiaro); `color` = glifo `#FD5` su placca `#262626` con cornice `#FFCB00` (palette campionata dall'asset 4K color, nessun colore nuovo); `premium` = glifo nell'accento del formato su placca neutra scura; `knockout` = tag bianco largo quanto il tag knockout 4K con glifo riempito dall'inchiostro nero al 70% (`KNOCKOUT_INK_OPACITY`) disegnato SOPRA l'artwork che resta visibile nel ritaglio (mask sul corpo bianco + filtro ombra applicato al rect, come il tier: un filtro sul `<g>` lascerebbe il glifo grigio/semi-opaco), quindi 30% di contributo artwork invece di un nero piatto sul tag bianco + alone LEGGERO esterno dedicato (`knockoutOuterShadow`), fuori dal box del tag: il filtro 3D sul rect mascherato non lascia nessun alone all'esterno (la mask è applicata DOPO il filtro, misurato a raster). Etichetta generica `HDR` preservata (mai `HDR10`). Priorità solo-render: se l'effettivo include sia `hdr` che `hdr10plus`, il gruppo disegna solo HDR10+ (dopo la selezione utente/default/mapping — DB, provenance, raw salvati e chiavi cache invariati; `hdr`-solo invariato). Stile `knockout` (`qbs`, SOLO qualità — l'età `knockout` usa il builder dedicato SOLO età `buildAgeKnockoutSvg`, mai questo; come `mono`/`color` in preview esplicito e Stremio solo-non-standard): targhetta bianca opaca con glifi ritagliati via mask (stesso box esterno della pill, `rx = 0.30 * boxH`, niente stroke/gradiente; glifi mask a `~1.35x fs` con `textLength` pinnato sulla stima oversize e margini anti-clipping). Il corpo bianco resta un vero cut-out (non copre l'artwork nelle lettere) e sopra i fori è disegnato l'inchiostro nero al 70% (`KNOCKOUT_INK_OPACITY`, layer `<g opacity>` con la STESSA geometria del testo mask): a raster il glifo è nero alpha ~0.70 e, compositato su un fondo colorato, restituisce esattamente il 30% del fondo (un nero al 70% sopra il tag bianco opaco darebbe un grigio piatto, senza artwork). Alone LEGGERO esterno dedicato (`KNOCKOUT_SHADOW_FILTER` = `feDropShadow` dx 0 / dy 1 / blur 2 / alpha 0.35, layer `knockoutOuterShadow` in `badge-svg-shared.ts`, riusato dai marchi A/V in `poster-service.ts`): la mask del layer copre l'INTERO box del tag (angoli compresi), quindi l'ombra resta fuori dal tag, nessun alone entra nei ritagli (lì resta solo l'inchiostro al 70% sopra l'artwork), nessuna tacca d'ombra negli angoli e geometria/`TOP_SHADOW_PAD` invariati. Il filtro 3D condiviso resta sul rect mascherato (bordo dei fori) ma da solo non dipinge nulla fuori dal tag. L'età `knockout` (builder dedicato `buildAgeKnockoutSvg`) resta invariata: nessun alone e fori davvero trasparenti (`alpha 0`, nessun inchiostro).; con Dolby (verificato `localSpec`, combo `dv+atmos` o singolo) e altri formati impilati sotto il tier in colonna verticale come gli altri stili (anche Dolby usa il tag bianco con glifo inchiostrato al 70%, indipendente da `topLight`); senza Dolby resta il tier knockout (mai fallback a standard). Stile `premium` (`qbs`, ADDITIVO, SOLO qualità — non sostituisce nessuno stile esistente): il tier riusa l'asset `color` invariato (`qualityBadgeIconStyle` mappa `premium` → set `color`: nessun set di asset nuovo) e i marchi A/V sono glifi colorati su una placca COMPATTA scura neutra (`renderPremiumIconBadge` in `poster-service.ts`): altezza `badgeBoxHeight(fs)` come le altre icone (base `17 * pw / 380`, quindi ancoraggi/stack invariati), placca `rgba(16,17,21,0.88)` + stroke `rgba(255,255,255,0.20)` 1.5px, `rx = 0.30 * boxH`, larghezza ESTERNA della placca = larghezza del tier 4K dello stile attivo (icona `color`, 38px a pw380 / 49px a pw500: la placca non è mai più larga del tier), glifo proporzionale DENTRO la placca con inset uniforme piccolo `0.10 * fs` per lato (`AV_PLATE_GLYPH_INSET_FACTOR`, mai padding additivo che allarghi la colonna) e aspect naturale (l'altezza segue, mai stirata; tetto di sicurezza `0.56 * boxH` che preserva il rapporto, per futuri marchi stretti), ombra 3D condivisa (`TOP_SHADOW_FILTER`), padding ombra `TOP_SHADOW_PAD` simmetrico. Accenti = scelte di design Pictorium (mai una dichiarazione di colori ufficiali dei marchi, nessun asset copiato): HDR/HDR10+ `#F2C14E`, IMAX `#4FD1E3`, Dolby Vision/Atmos e combo `dv+atmos` `#B9A6FF` (un solo accento per il lockup unito). La placca è indipendente da `topLight` (sempre scura: leggibilità dei colori su fondi chiari e scuri, come il tag bianco `knockout`), quindi il bitmap premium non cambia con la polarità. Il tier degli altri stili resta quello condiviso (`renderQualityBadge` per `standard`, cornice dinamica condivisa con l'età per `mono`, asset icona per `color`, `renderQualityKnockoutBadge` per `knockout`), non toccato da `premium`; cambiano solo i marchi A/V per la normalizzazione di larghezza richiesta, e la pill età mantiene la propria ricetta (`standard` = pill neutra, `knockout` = tag dedicato), e precedenza HDR10+ su `hdr`, combo `dv+atmos`, identità/ordine dei marchi e chiavi cache restano quelli degli altri stili. Stile `nova` (`qbs`, ADDITIVO, nessun asset: `qualityBadgeIconStyle("nova")` resta null, nessun path inventato): lastra quasi nera bluastra (`AGE_NOVA_BODY_*`), bordo con gradiente metallico (`AGE_NOVA_BORDER_*`, spessore `AGE_NOVA_BORDER_WIDTH` DENTRO il box), sheen interno in alto (`AGE_NOVA_HIGHLIGHT_*`), glifi bianchi in grassetto con taglio corsivo (`AGE_NOVA_SKEW_X`, nessun font nuovo), indipendente dalla polarità (lastra sempre scura); è lo STESSO materiale dinamico (`buildAgeEmphasisSvg`/`renderAgeEmphasisBadge`, ramo `AgeEmphasisStyle "nova"`) di tier qualità, età e marchi A/V, quindi un solo look e zero file in `public/`. Trasporto: `qbs` emesso da `normalizeQualityBadgeStyleForTransport` (derivato dall'enum `QUALITY_BADGE_STYLES`). |

## Badge contenuto: vera storia / libro / prossimo episodio / soli N episodi

Quattro badge automatici opt-out via bucket `sash` (nessun nuovo parametro
URL, nessun nuovo contratto): riusano i fetch esistenti
(`next_episode_to_air`/`number_of_episodes` dai details, keyword dal fetch
keyword già usato per i sottogeneri) e il renderer unico esistente.
Selezione manuale dagli stessi meccanismi (dropdown `BadgeControls` =
`getAllBadgeOptions`, override custom salvato vince sempre).

| Badge | Regola server (`poster-badge.ts`) | Priorità |
|---|---|---|
| `badge.trueStory` ("Based on a true story") | `getTrueStoryLabel`: match ESATTO su keyword TMDB normalizzata (lowercase+trim) in {`based on true story`, `based on a true story`} — mai sottostringhe né testo del titolo; film e serie | Extra, dopo il sottogenere e prima del libro (ordine deterministico documentato, sotto novità/rank/premi) |
| `badge.basedOnBook` ("Based on a book") | `getBasedOnBookLabel`: match esatto in {`based on novel or book`, `based on novel`, `based on book`, `based on young adult novel`} — `based on comic book` resta fuori; film e serie; con storia vera valgono entrambe, auto = storia vera | Extra, dopo la storia vera (stesso bucket, mai sopra) |
| `badge.nextEpisode` ("Nuovo episodio · {data}") | `getNextEpisodeLabel`: SOLO serie TV, `air_date` futura di 1..14 giorni DI CALENDARIO (diff UTC DST-safe, oggi/passato/>14/assente/invalido esclusi; film mai); data formattata come l'upcoming (`df`/locale) | Bucket `new`, subito dopo la nuova stagione e sopra i premi (stesso ordine del fork); MAI congelato nel mapping (`resolveSavedBadgeExtra` lo esclude come upcoming/nuova stagione) + TTL effimero 120s quando mostrato, così la data non resta stantia oltre la messa in onda |
| `badge.onlyEpisodes` ("Solo {n} episodi") | `getFewEpisodesLabel`: SOLO tipo miniserie (`isMiniseriesType`, mai una serie ordinaria breve) con conteggio intero noto 1..8; fuori bound = Miniserie semplice invariata | Arricchisce la Miniserie in coda all'extra (stesso slot, non un nuovo bucket); congelabile come la Miniserie (formato permanente) |

Liste keyword e idee riusate dal fork kesemb2/Pictorium-HE al commit
pinnato documentato in NOTICE (solo `s_truestory`/`s_book`, `fewEpisodes`,
`getNextEpisodeLabel` + inserimento dopo la nuova stagione; niente rotazione
giornaliera né altre tag del fork). Finestra calendario DST-safe,
chiavi i18n 18 lingue, lifetime effimero e wiring editor sono integrazione
originale.

## Pill Network Logo

Il fallback TMDB (percorsi normale e raw) mantiene colori e trasparenza
originali, con ombra nera invariata (alpha 0.55). Non applica la
ricolorazione bianca; geometria e selezione SVG-first restano invariate.
La tabella seguente descrive i loghi locali, non il fallback TMDB.

Lockup combinato: un titolo che elenca SIA Paramount+ SIA Showtime rende un
solo mark (`paramount_showtime`, `public/networks/Paramount+_with_Showtime_logo.svg`)
al posto di due mark separati o del primo match. La regola vive una volta in
`network-keys.ts:getCombinedNetworkKey` (nessun fork per funzione). Se il mark
dominante della lista è un'altra rete il lockup non lo sostituisce; se una
delle due marche (o il lockup stesso) è spenta, o se `Altri loghi` è OFF per
la metà non-featured `showtime`, si torna al primo match normale.

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
| Stack | UN solo bitmap: pill verticali `logoH = round(fs * 0.95)`, `h = pt + logoH + gap + fs + pt` (`px = round(fs*0.6)`, `pt = max(2, round(fs*0.22))`, `gap = max(2, round(fs*0.18))`), gap stack `SEPARATE_STACK_GAP = 5`; larghezza uniforme `colW = max(contenuti) + px*2` (colonna dritta); `rx = round(maxH * 0.32)` condiviso; contenimento sopra il badge genere (o dentro il canvas senza genere): shrink proporzionale SOLO sull'overflow reale, misurato sul placement finale voluto (`stackTop + sepOY`, clamp dentro il canvas) contro il bordo genere con gap 6px — mai per conteggio (gruppi 1-5 che entrano restano byte-identici), a qualsiasi scala, mai enlarge |
| Cap display | max 5 (`pickSeparateRatings` in `ratings.ts`: ordine selezione `rsrc`, skip miss/0; vuoto → fallback media) |
| Formati | decimale 1 cifra (`7.3`); famiglia percent (`tomatoes`, `popcorntime`) come `88%` (`formatSeparateValue`) |
| Colori | convenzione quality-badge: `topLight ? dark pill : light pill`, bordo 1.5px adattivo, ombra dedicata ridotta (`seps`: dx=2, dy=2, blur 2, 0.55 — la 3D standard sbordava nel gap 5px sembrando squadrata) |
| Loghi | `public/rating/*.svg` a colori brand originali (mai ricolorati), embed `<image data:...>` come le pill network; asset mancante → pill skippata (mai 500) |
| Posizione | bordo destro allineato al badge qualità (`right = qualityRight`), `top = qualityBoxBottom + 6` + 5 portrait (`PORTRAIT_SEPARATE_SHIFT_Y`, solo formato poster; pad inferiore sottratto in scala, gap ottico 6px); senza qualità parte dal top (`netBaseTop - 10` + 5 portrait, "sale"); con nastro a destra segue a sinistra (stesso branch `isRightRibbonCorner`); in landscape segue il badge qualità come in portrait senza +5 |
| Offset gruppo (`separateBadgeOffsetX/Y` / `sepox`/`sepoy`) | intero gruppo (colonna o riga, mai singoli provider): `left += ox`, `top += oy` (positivo Y = giù, come gli altri offset) con clamp dentro il canvas; `bottom-bar` portrait full-width: X ignorata esplicitamente (solo Y); in landscape la barra è pills (X attiva); catena `query > mapping effettivo per formato > config token > defaults effettivi > 0`, clamp `±2000`, step 5 in presets; bitmap badge invariati (solo placement, chiavi `separate` invariate; chiave poster/`dv` li includono). UI: slider X/Y in Trasforma per-titolo/default/Orizzontale (stesso range/bounds degli altri offset); X disabilitata con hint in `bottom-bar` portrait |
| Priorità | mai col custom provider: se la riga custom è renderizzata, lo stack si nasconde |
| Sostituzione | con stack attivo (`useSeparate`) il badge genere nasconde il segmento ★ (`badgeRating` effettivo = false) |
| Stile layout (`separateRatingsStyle` / `sepstyle`) | enum `column` (default storico), `bottom-bar` (solo portrait), `bottom-pills`, `bottom-mono` (icone tonde + voti monocolore, senza contenitore), `bottom-color` (icone tonde brand + voti, senza contenitore); catena query > mapping effettivo per formato > config token > defaults effettivi > `column` (garbage → `column`); landscape: solo `bottom-bar` → `bottom-pills` DOPO cascata (`getSeparateRatingsStyleForShape` in `badge-styles.ts`, riusato da config/service/preview/UI — raw salvati intatti, portrait invariato; `bottom-mono`/`bottom-color` passano invariati in entrambi i formati); emesso esplicito solo quando bottom negli URL Stremio (come `bs`/`rs`, mai in `dv`), sempre esplicito in preview (`column` incluso, WYSIWYG); in allowlist cache key + hardening enum |
| Bottom attivo | `badgesEnabled && badgeRating && sep && stile bottom` (centralizzato in `resolveSeparateDisplayState`, INDIPENDENTE dai valori: con voti assenti nasconde comunque genere+anno+voto, senza inventare valori); la soppressione è EFFETTIVA solo a render — `bg`/`by`/`br` salvati non mutati (tornando a `column` si ripristinano); in bottom la riga custom provider è esclusa (`suppressCustomRow`, mai duplicata; il custom conserva la priorità storica sulla colonna, invariata). UI: selettore `sepstyle` (Colonna/Barra/Pill/Monocolore/Icone colorate) visibile con rating separati ON — in landscape la Barra è disabilitata (visibile, mai selezionata, hint `ui.separateRatingsBarLandscapeHint`; selezione mostrata sullo stile normalizzato via `getSeparateRatingsStyleForShape`) e il raw salvato resta (in portrait torna); in bottom i toggle genere/anno sono disabilitati (visivo + aria, callback inattiva) ma i valori restano conservati — stesso comportamento nei default globali. Lo stile è condiviso tra formati in UI (niente selettore Orizzontale dedicato), ma un eventuale override `landscape` già salvato nei dati si rispetta in load/save (mapping effettivo, profilo preservato, stash cambio formato) |
| Riga bottom (`renderSeparateRatingsBottom` + `poster-service.ts`) | UN solo bitmap: logo provider + valore inline (logo a sinistra, valore a destra, `textLength` stabilizzato); `bottom-bar` = fascia satinata adattiva `satinPillStops(bottomLight)` full-width a filo in basso (SOLO portrait — in landscape normalizzata a pills a monte, mai renderizzata); `bottom-pills` = 1-5 pill adattive `rx = h/2` con bordo 1.5px + ombra `seps`, in portrait riga centrata con margine `round(20 * CH / 570)` dal bordo + 5 Y portrait solo pills (`PORTRAIT_SEPARATE_SHIFT_Y`; bar full-width a filo esclusa: il +5 sarebbe annullato dal clamp), in landscape ancorate a DESTRA con la geometria base genere (`landscapeRightAnchorLeft` extra 0 opticalShift 0: margine pieno `18*CW/380` senza il +40 ottico del genere, base landscape −20 X / −10 Y via `LANDSCAPE_BOTTOM_PILLS_SHIFT_*`, slider `sepox`/`sepoy` neutri 0 e additivi dopo); `bottom-mono`/`bottom-color` = icone tonde + voto senza pillola/barra né contenitore (stessa geometria pills: centrata in portrait, destra in landscape con stessa base −20 X / −10 Y, stessi slider e collisioni logo; `loadRoundRatingLogo` in `separate-rating-renderer.ts`: piastra tonda, mono = grigio `208` su fondo scuro / `32` su chiaro con voto monocolore — bianchi oltre 230 preservati come controforme — color = piastra brand originale (`imdb` gialla `#f6c700` senza rettangolo, `tomatoes` natural senza piastra, resto `#032541`) + voto chiaro su scuro); materiale/testo/bordo seguono `bottomLight` come il badge genere (fondo chiaro → pill scura + testo chiaro, fondo scuro → pill chiara + testo scuro) — loghi brand invariati; reservation logo titolo = geometria colonna equivalente (`logoBadgeVisibility`, solo reservation); base font `round(max(15 * pw / 380, 11))` (`23` per i bare, `15` per bar/pills), scala % 10..200 nativa come la colonna; fit sul font (loop max 4 fino a `max(8, 55% base)` con rebuild coerente) + shrink bitmap proporzionale di sicurezza — mai clipping; vuota → null (mai placeholder) |
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
> (scala null = auto-fit, offset null = 0) + scale/offset badge + stili/toggle
> per-titolo del profilo `landscape` (badge, classifica, qualità/formati/età,
> network — vedi "Badge per-titolo per formato" sotto); restano condivisi solo
> i controlli global-only (sash/qualità-minima/lato-nastro, senza campo
> per-titolo). Risoluzione server:
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
> **Badge per-titolo per formato (Verticale/Orizzontale):** gli stessi stili e
> toggle dei default vivono anche nel profilo per-titolo `mapping.landscape`
> (`LandscapeSettings`: `showBadges`/`rankingBadges`/`badgeGenre`/`badgeYear`/
> `badgeRating`/`badgeQuality`/`ageBadge`/`ageCountry`/`ageBadgeStyle`/
> `customRatings`/`separateRatings` + `badgeStyle`/
> `rankingBadgeStyle`/`extraBadgeStyle`/`badgeFont`/`qualityBadgeStyle`/
> `videoFormats` + `networkLogo`/`networkLogoPosition`/`ribbonEnabled` +
> `customBadge`/`accentColor` (più i campi ritirati inerti
> `badgePresetId`/`badgePresetRev`, mai resi); chiavi
> assenti = eredita il flat, mai migrazione in lettura — con semantica
> explicit-null-shadows per i quattro visuali un tempo condivisi: chiave
> PRESENTE nel profilo (inclusa `null`, per customBadge anche `""`) vince sul
> flat per la forma landscape (`null`/`""` nel profilo = la forma landscape
> rende automatico, mai resurrect del flat). Solo i manuali persistono
> per l'accento (auto mai congelato). Risoluzione
> server identica ai default: query > mapping effettivo per formato
> (`effectiveMappingForShape` in `types.ts`, riusato da `poster-config`,
> route pre-gate e `stremio-poster-url`) > config token > defaults effettivi
> per forma > default di formato; `xbs` segue le stesse regole own-rank dei
> default (`follow-rank` ombreggia il flat, legacy `null`/assente eredita).
> Restano condivisi per-titolo: fonti voto (`ratingSources`,
> intenzionalmente condiviso per disegno server), metadati/base/rotazioni; e i
> global-only senza campo
> per-titolo (sash/qualità-minima/lato-nastro) seguono i default effettivi
> per forma. L'età è per-titolo dal mapping effettivo (`ageBadge`/`ageCountry`/
> `ageBadgeStyle`, flat + profilo `landscape`, stessa regola degli altri
> toggle/stili: assente/null = eredita, `false` esplicito vince sul default
> ON). Editor: stato unico per formato in editing con stash al cambio
> (`EditView`, come il tuning) e init dal mapping effettivo (`context`); il
> save scrive il flat in portrait (preservando il profilo + backfill dei
> pre-edit cambiati via `snapshotMissingMappingLandscape`) e il profilo in
> landscape (preservando il flat verbatim; accent solo-manuale; campi Lab
> ritirati preservati verbatim, mai resi); "salva solo poster" azzera le custom come
> prima. Nessun nuovo parametro URL/chiave cache (`extra`/`ac`
> esistenti veicolano i valori effettivi di forma).
>
> **Boundary di salvataggio (l'indipendenza è reale solo se il save preserva
> l'altro formato — il POST `/api/mappings` è full-replace, la risoluzione
> per-formato da sola non basta).** Regole (`usePosterSave`, puri in
> `visual-presets.ts`): save landscape = flat portrait preservato VERBATIM
> dal salvato (concreto resta, `null` resta `null`, assente resta assente —
> mai il live landscape; mapping nuovo = assente/eredita, mai clone del
> landscape); save portrait = backfill nel profilo del PRE-EDIT effettivo
> per le sole chiavi che l'edit muove (profilo sparse altrimenti): flat
> concreto = verbatim, flat inherit-`null`/assente = chain-effective
> (`mappingShapeChainEffective`: profilo default Orizzontale > default flat >
> factory storica fail-closed — mai il live editato, mai guess ciechi sotto
> default non-canonici; senza provenance resta il fallback legacy
> factory/skip, mai il live). Entrambi i formati editati prima di un singolo
> save = stash dell'altro formato (`otherShapeStash`: il
> portrait vince per i flat nel save landscape, il landscape vince per il
> profilo nel save portrait; tutte le 24 chiavi per-titolo — tuning/logo/sfumatura
> sulle regole esistenti). Lo stash dell'altro formato è condiviso per-titolo
> in `PosterEditorContext` (vedi `src/lib/shape-draft.ts`: un solo owner alla
> volta, chiave `userId:media_type:id` — un nuovo titolo, anche non salvato ma
> con identità reale, non legge mai lo stash del precedente; key mismatch =
> null): EditView vi specchia lo stash allo switch di formato e lo dichiara
> sul titolo aperto; il Save manuale passa il proprio stash esplicito (vince),
> TUTTI gli altri full-save (`saveConfig` senza stash esplicito e gli autosave
> di esclusione poster/backdrop via `useSharedShapeStash`) risolvono lo shared
> sullo stesso boundary — mai caduta al mapping salvato per lo staged. Il
> cover-only non viaggia mai sullo stash (clear intenzionale, contratto
> invariato). Stash verbatim (false/0/[]/`follow-rank` preservati, mai
> filtrati); la provenance logo-scale del ripristino allo switch resta locale
> in EditView (il save consuma i draft verbatim come il path esplicito).
> Resta condiviso per disegno server solo `ratingSources` (fonti voto, senza
> chiave profilo). Azzeramento portrait (accento automatico esplicito):
> l'apertura ripristina il manuale salvato nel live e lo stash portrait
> dichiara la chiave PRESENTE (`null` = auto esplicito, mai inherit
> intoccato), quindi il save landscape azzera il flat (drop = auto, stesso
> contratto del save portrait dove `undefined` = drop = auto); senza visita
> portrait (chiave assente) il save landscape preserva il salvato verbatim.
> Il ricalcolo auto (`useRootColors`) riempie solo il canale auto e non
> clobbera mai un manuale esplicito (ripristinato all'apertura o dallo stash
> al cambio formato). L'accento automatico esplicito in landscape si scrive
> `null` di profilo (ombreggia il flat, mai resurrect).
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
> **Preview contestuale default (U2):** `previewFamily` (`auto`/`rank`/`info`/`extra`/…)
> + `previewExtra` (campione `__badge.*` risolto server-side) viaggiano solo
> nella preview default (`buildDefaultsPreviewUrl`, stesso endpoint poster,
> nessun renderer duplicato) e non si salvano mai. `auto` rende la priorità
> effettiva salvata per forma (`sash`, `rank` incluso quando abilitato);
> `rank` restringe a `rank` quando la preview configurata può davvero
> dipingere un rank (master ON + bucket `rank` nella sash effettiva) e il
> layout configurato resta intatto (Fresh/Card inclusi); quando non può
> (master OFF o bucket rimosso) rende la composizione reale SENZA classifica
> (sash effettiva meno `rank` + campione info come `extra`), mai uno stato
> vuoto intermedio. Il selettore preview-only delle Impostazioni espone
> esattamente QUESTI due stati (con classifica / fallback reale) riusando le
> family esistenti (`rank` / `extra`, card e toolbar dell'editor ingrandito;
> la miniatura mobile senza chrome lo mostra nell'editor ingrandito) e
> disabilita "con classifica" quando la preview non può dipingere un rank;
> nessuna impostazione salvata toccata. L'idoneità è solo di CONFIGURAZIONE
> (master + bucket nella sash effettiva): che un numerale venga davvero
> dipinto lo decide il renderer, con il rank reale della fonte o con il
> campione demo già dichiarato quando il titolo in preview non ne ha uno — il
> selettore non promette mai una classifica live verificata.
> `info` e `extra` sono gli stati SENZA classifica: entrambi tolgono `rank`
> dalla sash effettiva (gli altri bucket abilitati restano, nulla viene
> inventato) qualunque sia la disponibilità del campione, quindi un numerale
> non può mai comparire mentre il selettore dice "senza". Lo stato premuto
> descrive la RICHIESTA che ha prodotto l'immagine: "con" solo quando la query
> si restringe a `sash=rank`, "senza" per `info`/`extra` e per ogni forma in
> cui la classifica non è configurata; `auto`/`logo`/`gradient`/`genre`/
> `ratings`/`quality` tengono la priorità effettiva completa (un `upcoming` o
> un premio può vincere sul rank), quindi sono richieste transitorie ignote e
> nessuno dei due stati resta premuto finché non si sceglie esplicitamente.
> `info` forza il primo campione info abilitato con `xbs` proprio (niente
> campione a categorie spente); `extra` (solo dalla card stile extra) forza il
> campione `extra` quando il bucket è consentito, altrimenti il primo info
> abilitato — mai un fantasma a categorie spente. `genre` (stile genere/font)
> forza un campione preview-only con `layout=standard`: Fresh/Card hanno
> aspetto fisso e nascondono il badge genere per contratto renderer (mai
> restyle), così `bs`/`bfont` restano visibili senza toccare lo staged/salvato.
> Le card segnalano la family su focus/pointer
> (mai hover, nessun move focus); Auto ripristina sash effettivo e rimuove
> `extra` forzato. `rank`/`auto` mostrano sempre il layout configurato
> (Fresh incluso); il ritorno a `rank`/`auto` ripristina Fresh.

## Parametri URL (query string)

| Parametro | Inviato da client (`context.tsx`) | Letto da server (`route.ts`) |
|---|---|---|
| `badges` | `globalBadges ? null : "0"` | `qBadges !== "0"` — master del SOLO gruppo basso genere/rating (`hasGenreBadge`, custom/separate rows, età): `badges=0` NON spegne la placca superiore (rank/extra restano se `ranking=1`, per disegno utente) |
| `ranking` | `rankingBadges ? null : "0"` | `qRanking !== "0"` — master della SOLA placca superiore (rank/extra, sash inclusa): `ranking=0` la spegne sempre, anche con `badges=1`; `badges=0` non la tocca |
| `bg` | `badgeGenre === false ? "0" : null` | `qBg !== null ? qBg !== "0"` — nasconde il GENERE nel badge genere/rating |
| `by` | `badgeYear === false ? "0" : null` | `qBy !== null ? qBy !== "0"` — nasconde l'ANNO nel badge genere/rating |
| `br` | `badgeRating === false ? "0" : null` | `qBr !== null ? qBr !== "0"` — nasconde il VOTO nel badge genere/rating |
| `cr` | sempre esplicito in preview (`cr=0/1`, WYSIWYG); solo-OFF in pattern/Stremio | `qCr` — display riga rating custom: `query > mapping.customRatings > config > defaults > true`, AND con env `PICTORIUM_CUSTOM_RATING_ENABLED` |
| `rsrc` | `ratingSources` per-titolo (preview); per-titolo salvato o default globale (Stremio) | fonti voto medio ★: `query > mapping.ratingSources > config token > server defaults (RATING_SOURCES) > imdb+tmdb` — parser unico `resolveRatingSources` (whitelist `SUPPORTED_RATING_SOURCES`). La selezione guida anche il routing provider (`requestedSources` in `ratings.ts`): imdb-only/imdb+tmdb = Cinemeta primario + fallback MDBList; tmdb-only con voto diretto genuino = zero upstream; simkl/anilist/kitsu da soli = solo direct provider (mai MDBList, MAL resta MDBList); il voto TMDB diretto genuino vince su MDBList anche sulle cache hit |
| `sep` | `separateRatings` per-titolo (preview, sempre esplicito `sep=0/1`); solo-ON in pattern/Stremio | colonna separati: `query > mapping.separateRatings > config token > server defaults (PICTORIUM_SEPARATE_RATINGS) > false`, AND con portrait + `badgeRating` + ≥1 valore (altrimenti fallback media) |
| `sepscale` | scala colonna separati per-titolo (preview sempre esplicita, default 130); solo valore in pattern/Stremio non-compact (in compact coperta da `dv`) | scala `%` 10..200 (default unico 130 per tutti gli stili): `query > mapping(.landscape) > config token > server defaults(.landscape, `PICTORIUM_SEPARATE_BADGE_SCALE`) > 130` |
| `sepstyle` | layout separati per-titolo (preview sempre esplicita, default `column`); solo valore bottom in pattern/Stremio non-compact (mai in `dv`: enum a bassa cardinalità come `bs`/`rs`, resta esplicita anche in compact) | layout `column`/`bottom-bar`/`bottom-pills`/`bottom-mono`/`bottom-color` (default `column` = resa storica): `query > mapping(.landscape) > config token > server defaults(.landscape) > column` (nessuna env dedicata); query presente ma invalida/vuota → `column` esplicito, mai eredita mapping (chiave cache distinta dall'assenza); `bottom-bar` + landscape → `bottom-pills` DOPO cascata (raw intatti) |
| `gradHeight` | `gradientHeight` | `qGradHeight` — alimenta l'altezza del gradiente/sfocatura (blurHeight): query > mapping > config token > server defaults > default di formato (30 portrait, 20 landscape; mapping non-clean senza valore congelato: 20). Post-selezione solo Stremio unmapped: se il poster finale ha testo incorporato, i default globali non vincono sul profilo non-clean (20/80, come il client) |
| `bf` | `blurFade` (slider editor 0..100 + double-click reset 50, 70 in landscape) | punto di attacco transizione 0..100 (default 50 portrait, 70 landscape, 80 profilo non-clean senza valori congelati): query > mapping > config token > server defaults > 50 (70 landscape, 80 non-clean). Emessa sempre esplicita in preview e Stremio. Curva ease-out continua `u = 1-(1-t)^γ` (γ = 1 + (1-bf/100)·2.5; default 50 → γ=2.25): tocca 1 solo all'ultima riga, NESSUN plateau (il vecchio `min(t/fadeStop,1)` appiattiva il fondo e piega lo shade) |
| `tint` | `tintStrength` (slider editor 0..100 + default globale, double-click reset 20) | `qTint` — intensità tinta di scena 0..100 (default 20): query > mapping (`tintStrength`) > config token > server defaults (`PICTORIUM_TINT_STRENGTH`) > 20. Emessa sempre esplicita in preview e Stremio. Nessun profilo landscape dedicato (vale per entrambi i canvas) |
| `ts` | `topShade` (slider editor 0..100 + default globale `defaultTopShade`, double-click reset 50) | `qTs` — ombra lineare superiore 0..100 (default 50): query > mapping (`topShade`) > config token > server defaults (`PICTORIUM_TOP_SHADE`) > 50. Solo flat (vale per entrambi i canvas, come la tinta). Preview sempre esplicita (`ts=0/..`); Stremio solo quando ≠ 50 (URL esistenti invariati). Sotto compactTuning la risolve il server dal mapping |
| `tsh` | `topShadeHeight` (slider editor 0..100 + default globale `defaultTopShadeHeight`, double-click reset 25) | `qTsh` — altezza ombra superiore in % del canvas 0..100 (default 25 = look storico): query > mapping (`topShadeHeight`, profilo `landscape` sopra il flat per la forma orizzontale, assente = segue il flat) > config token > server defaults (`PICTORIUM_TOP_SHADE_HEIGHT`, profilo `landscape` sopra per la forma orizzontale) > 25. 0 = ombra disattivata qualunque sia `ts` (il renderer salta il composite come con forza 0). Preview sempre esplicita (`tsh=0/..`); Stremio solo quando ≠ 25 (URL esistenti invariati, stessa regola di `ts`). Sotto compactTuning entra in `dv` e la risolve il server dal mapping |
| `dv` | mai dallo stato (firmata dal builder) | hash FNV-1a (8 hex) del tuning omesso negli URL compatti — emessa solo con `compactTuning`, mai letta dal render: invalida browser/edge/Stremio a ogni cambio default senza cambiare un pixel. Il proxy addon emette la stessa chiave ma con copertura totale dei defaults (`proxyDefaultsSignature` in `addon-proxy.ts`: stili/toggle inclusi — i param espliciti clobberebbero i mapping, vedi catena query > mapping) |
| `tl` | `topLight ? "1" : "0"` (sempre, anche per genre badges) | `qTopLight` — override se presente |
| `bl` | `bottomEdgeColor` via `useRootColors` (solo a calcolo completato, come `tl`) | `qBottomLight` — override se presente, altrimenti calcolo server sulla striscia inferiore corretto per la banda blur (`computeBottomLight`) |
| `qmin` | — (solo default globale, nessun per-titolo in Fase 1) | `q.get("qmin")` > server defaults (`PICTORIUM_QUALITY_MIN`) > `"SD"` — tier sotto soglia = niente badge; emesso negli URL Stremio solo quando ≠ `SD` |
| `sash` | — (solo default globale via 5 toggle Impostazioni, nessun per-titolo in Fase 4) | `q.get("sash")` > server defaults (`PICTORIUM_SASH_ORDER`) > ordine standard (`upcoming,rank,new,award,extra`) — sottoinsieme ordinato, non listati = spenti, `sash=` vuoto = tutto spento, garbage = default; emesso negli URL Stremio solo quando ≠ default |
| `dct` | default globale `defaultDisabledContentTags` (tab Impostazioni · Tag e Network, nessun per-titolo, nessun profilo landscape, nessuna recipe preset); preview/default-preview SEMPRE esplicite (`dct=` vuoto a staged vuoto, WYSIWYG) | tag badge automatici disabilitati space-wide (ID canonici, vedi `content-tags.ts`): filtrano PRIMA della selezione priorità (il disabilitato cede al successivo abilitato nel bucket, poi ai bucket successivi; con più match sottogenere canonici il primo disabilitato cede al successivo ABILITATO prima di trueStory/libro; manuali `queryExtra`/custom restano autoritativi e il dropdown resta non filtrato). Catena: query `dct` (csv allowlist, presente-ma-vuoto/garbage = `[]` esplicito che vince su config/defaults) > config token > server defaults (flat condivisi) > `[]` (storico). Emesso negli URL Stremio solo quando non-vuoto (URL legacy invariati); esplicito anche in compact (bassa cardinalità, mai in `dv`); in chiave cache canonical sorted con distinzione presente/assente (`dct=` esplicito ≠ assenza che può ereditare, come `sepstyle`/`layout`; `normalizePosterCacheParams`) |
| `dnet` | default globale `defaultDisabledNetworks` (stesso tab/contratto di `dct`: 24 mark featured con righe individuali (`FEATURED_NETWORK_IDS`) + gruppo condiviso `Altri loghi` (ogni altro mark locale + sentinel `__tmdb_fallback`, toggle con logo TMDB ufficiale, default ON = storico; nessuna icona per le righe tag, thumbnail SVG locali contain/lazy/alt-vuota solo righe featured) | mark network disabilitati space-wide (ID canonici, vedi `network-keys.ts`, stesso matcher `getNetworkKey` del renderer): skippati prima dei path locale E fallback TMDB (mai resurrect), su tutti i layout (Standard/Fresh/Card). Il sentinel `__tmdb_fallback` (mai chiave SVG canonica, mai in `NETWORK_IDS`/display, bound 77 = 76 + sentinel) con gruppo OFF disabilita TUTTI i mark locali non-featured prima del load E l'intero secondo passaggio TMDB PRIMA di qualsiasi fetch; i featured restano governati solo dal proprio toggle (enable/disable-all muove solo `FEATURED_NETWORK_IDS`, l'Altri resta indipendente). Accensione esplicita del gruppo = bulk intent: azzera sentinel + ID nascosti stored; ID nascosti stored altrimenti preservati verbatim e onorati (gruppo misto dichiarato onesto in UI). Catena/emissione/chiave come `dct` sopra (presente-ma-vuoto/garbage = `[]` esplicito, `dnet=` ≠ assenza) |
| `df` | default globale `defaultDateFormat` (tendina Impostazioni: `locale`/`dmy`/`mdy`/`iso`); preview sempre esplicita (`df=locale/…`, WYSIWYG) | formato data badge "in uscita": query > server defaults (`dateFormat`) > `locale` (fail-closed: ignoti = `locale`); emesso negli URL Stremio solo quando ≠ `locale` (URL esistenti invariati) |
| `age` | default globale `defaultAgeBadge` (toggle Impostazioni · Badge, default OFF) + per-titolo editor (`BadgeControls` famiglia Qualità, indipendente per formato); preview sempre esplicita (`age=0/1`, WYSIWYG) | badge testuale di classificazione per età: pill neutra tra tier qualità e formati A/V top-right (sotto il 4K, sopra DV/Atmos, stessi offset/scale/cap; rende anche senza 4K). Catena con per-titolo: query > mapping effettivo per formato > config token > server defaults effettivi per forma (`PICTORIUM_AGE_BADGE`) > false. Spento = zero fetch TMDB extra e resa storica invariata; richiede il master `badgesEnabled` (lo spegne tutto). Emesso negli URL Stremio solo quando ON (+ `age=0` esplicito con `config`) |
| `agecountry` | default globale `defaultAgeCountry` (tendina Impostazioni · Badge, default `IT`, mai auto-cambiata con lingua/regione) + per-titolo editor (stessa tendina, indipendente per formato); preview sempre esplicita (`agecountry=IT/…`, WYSIWYG) | paese della classificazione età (ISO-2 maiuscolo, `GLOBAL` escluso): query > mapping effettivo per formato > config token > server defaults effettivi per forma (`PICTORIUM_AGE_COUNTRY`) > `IT` (fail-closed per livello: garbage/`GLOBAL`/non ISO-2 cade sul livello successivo; etichetta originale del paese senza conversioni né fallback cross-country, dati assenti = badge nascosto). Emesso negli URL Stremio solo col badge attivo |
| `agebs` | default globale stile pill età (selettore Impostazioni · Badge, default `standard` = resa storica) + per-titolo editor (stesso selettore, indipendente per formato); preview sempre esplicita (`agebs=` con lo stile risolto, WYSIWYG). Vocabolario UNICO condiviso con la qualità (`AGE_BADGE_STYLES` in `badge-styles.ts`, enum unica per schemi Zod, config token, URL, cache e UI — nessuna lista duplicata): `standard` (pill neutra satinata storica, `renderQualityBadge`, byte-identica in standalone), `mono` (cornice rettangolare + glifi monocromatici ad alto contrasto: bianco su top scuro / nero su top chiaro, NESSUN riempimento satinato né placca — è la STESSA ricetta del tier qualità `mono`, che ora usa questo frame dinamico al posto dell'asset icona: un solo materiale per qualità ed età), `color` (glifo giallo `#FD5` su placca scura `#262626` con cornice gialla `#FFCB00`: palette `COLOR_MARK_*` già esistente, campionata dall'asset tier `color`, nessun colore nuovo né colore ufficiale d'età inventato), `knockout` (tag bianco con lettere ritagliate trasparenti, cut-out genuino via mask, builder dedicato SOLO età `buildAgeKnockoutSvg`/`renderAgeKnockoutBadge` — mai il builder condiviso della qualità knockout (che ora inchiostra i glifi al 70%)), `premium` (glifo oro `#F2C14E` = accento di design `premiumAccentHex("gold")` su placca premium scura compatta `PREMIUM_PLATE_BG` `rgba(16,17,21,0.88)` + stroke `PREMIUM_PLATE_STROKE` `rgba(255,255,255,0.20)`), `nova` (lastra quasi nera bluastra `AGE_NOVA_BODY_*` con gradiente di bordo metallico `AGE_NOVA_BORDER_*`, sheen interno `AGE_NOVA_HIGHLIGHT_*` e glifi bianchi grassetto corsivo `AGE_NOVA_SKEW_X`, indipendente dalla polarità: STESSO materiale dinamico condiviso con tier qualità e marchi A/V — stessa ricetta di famiglia, nessun asset). Gli stili `mono`/`color`/`premium`/`nova` usano un'unica ricetta di famiglia (`buildAgeEmphasisSvg` in `badge-svg-shared.ts`, wrapper `renderAgeEmphasisBadge` in `svg-badge.ts`): `mono` è CONDIVISO col tier qualità `mono` (stesso frame, etichetta reale), `color`/`premium` restano SOLO età (ramo `renderAgePill` in `poster-service.ts`): stessa scatola della famiglia età (padding X `1.0 × fs`, raggio `0.30 × boxH`, altezza `badgeBoxHeight(fs)`, glifi alla base `fs` senza oversize — nel gruppo reale il font scende solo per stare nella colonna comune, mai glifi stirati — tracking `0.06em` con `textLength` pinnato sulla stima, font `bfont`, `escSvg`, ombra 3D condivisa `TOP_SHADOW_FILTER`, bordo tenuto DENTRO il box come le placche AV), quindi stack/offset/scale/cap e correzioni per-item (`quality:age`) restano identici in tutti gli stili. Con più elementi nel gruppo la larghezza VISIBILE di tier e pill età è pinnata allo stesso `targetW` del marchio 4K dello stile attivo (colonna comune: tier/età/formati davvero larghi uguale, non solo tela trasparente), mentre l'elemento singolo (es. solo età) mantiene il box naturale storico; l'etichetta è sempre dinamica (12/PG-13/TV-MA: nessun asset numerico statico) e le placche `color`/`premium`/`nova` sono indipendenti dalla polarità del fondo, mentre `mono` segue `topLight`. `standard` e `knockout` mantengono i rispettivi renderer byte-identici (nessuna modifica di geometria/stile: le nuove ricette sono additive). Controlli età e qualità restano indipendenti: cambiare lo stile qualità non copia nulla sull'età e viceversa. Le anteprime del selettore per la famiglia età (`family="age"` di `BadgeStyleSelector`) usano lo STESSO builder condiviso via data URI con etichetta neutra `Aa` (mai l'asset statico `4K` della qualità: singola fonte col renderer); anche lo swatch `mono` della famiglia qualità usa lo stesso builder con l'etichetta reale `4K` (l'asset statico mono non è più usato né dal renderer né dal selettore). Catena con per-titolo: query > mapping effettivo per formato > config token > server defaults effettivi per forma > `standard` (query presente-ma-invalida = `standard` esplicito, fail-closed come `bfont`). In allowlist cache key (`agebs` invalido → `standard`, mai delete: l'assenza può ereditare knockout; lo stile entra nella chiave del gruppo qualità/età) |
| `pre` | `preRelease` editor live per-titolo (preview titolo) + default globale `defaultPreRelease` (toggle Impostazioni · Badge, default OFF, per-shape `land ?? flat` in landscape); preview titolo/defaults SEMPRE esplicita (`pre=0/1`, WYSIWYG — come `ribbon`/`cr`/`sep`: senza, un default salvato ON scavalcerebbe lo staged OFF e la preview mostrerebbe il nastro a effetto spento) | `qPre` — effetto pre-digitale: velo scuro (sotto logo e badge, che restano luminosi) + nastro angolare rosso "coming soon!" in alto (a sinistra; a destra con side="right") sui film senza disponibilità digitale/streaming (JW offerte non-CINEMA > TMDB type 4). Catena: query > config token > server defaults (`PICTORIUM_PRE_RELEASE`, effettivi per forma) > false. Emesso negli URL Stremio solo quando ON (+ `pre=0/1` esplicito con `config`, come `badges`/`ranking`/`age`) |
| `hideLogo` | mai dal client (solo banner Stremio) | solo query `hideLogo=1`: salta il composite logo film (fetch tenuto per i colori accent). Vale per entrambi i canvas: il landscape cuoce il logo come il portrait (vincoli 16:9), solo il banner pulito lo nasconde. Col banner (landscape) il badge genere va in basso a DESTRA (ancoraggio destro, niente shift landscape) e il network segue i rami "senza logo" (top-left / a fianco del nastro) |
| `rd`/`fad` | date complete `release_date`/`first_air_date` (solo se valide `YYYY-MM-DD`) | ramo query: date a piena precisione per rilevamento pre-digitale (fallback `year` → `${y}-01-01`) |
| `title` | `selected.title \|\| selected.name` (preview) / `mapping?.title` (Stremio) | titolo per il match JustWatch (`preTitle`: mapping > query > session > `genreName`) — senza, la ricerca usa `genreName` e il match per tmdbId fallisce (rilevamento pre-digitale + qualità degradati) |

> `gradColor`, `gradOpacity`, `gradFade`, `gradDir` sono **parametri morti**: non vengono più letti dal server (il gradiente usa il colore accent + `gradHeight`). `bottomGradientSVG` in `badges.ts` non è più chiamato dal compositore poster. Non reintrodurli.
| `rank` | `badge.rank` (se rankingBadges attivi) | `qRank` — override del ranking |
| `animerank` | rank anime del titolo selezionato (da `mdblistAnimeList`, solo preview WYSIWYG) | `qAnimeRank` — override del rank anime (`media_type=tv`); senza, il server lo calcola da `fetchMDBList` con la chiave della richiesta o il fallback d'istanza (`PICTORIUM_MDBLIST_KEY`). Con `rk=` valido omesso in preview (vince `rk=`, come Stremio che non lo emette mai per queste liste) |
| `rk` | parametro diagnostico/manuale (nessuna emissione automatica da cataloghi/card: i badge automatici risolvono live) | intero 0..100 (`0` = unranked esplicito, invalido/assente = legacy). Precedenza finale: `rank=` esplicito > `rk=` > rank live da fonte selezionata. `rk=` valido salta entrambi i fetch trend/anime e sopprime l'anime win; entra nella chiave cache/ETag (stesso titolo rank N vs M = byte distinti); con `ranking=0` mai emesso/mai numero automatico |
| `label` | `badge.rankLabel \|\| badge.label` | `qLabel` — override label ranking |
| `extra` | `badge.label` (se extra) o `customBadge` | `queryExtra` — forza badge extra |
| `bs` | `badgeStyle` | `qBs` — "shadow"/"pill"/"bar"/"colored"/"bordo"/"vetro"/"minimal" (catena query > mapping effettivo per formato > config > defaults effettivi per forma; il default landscape sceglie lo stile orizzontale) |
| `bfont` | `badgeFont` | `q.get("bfont")` — "inter"/"barlow-condensed"/"oswald" (default "inter" = resa storica; assente o non valido → Inter). Catena query > mapping effettivo per formato > config > defaults effettivi per forma. |
| `rs` | `rankingBadgeStyle` | `qRs` — "default"/"colored"/"pill"/"bordo"/"vetro"/"netflix"/"corner"/"number" ("bar" rimosso: degrada a "default"; "corner" = pill piatta tinta accent ancorata alto-sx; "number" = solo cifre Inter Bold con gradiente bianco→argento e ombra morbida, senza piastra/nastro/`#`/label, ancorato alto-sx come `corner` ma specchiato a dx con `side=right`; collisioni network/qualità/Coming Soon condivise col `corner`; i rank `number` rendono su una baseline X di stile `NUMBER_BADGE_BASE_OFFSET_X=-20` canvas px — vedi `tox`) |
| `xbs` | `extraBadgeStyle` (per-titolo o default; assente = legacy `rs`) | `qXbs` — "default"/"pill"/"colored"/"bordo"/"vetro"/"corner" (solo extra; assente ovunque = legacy `rs`; invalido = assente; rank usa sempre `rs`). Sentinel esplicito `follow-rank` (query/mapping/token/profilo, entrambi i formati) = own-rank del formato effettivo (renderer: `null` via fallback `rs`, nastri/numeri inclusi; query vince su mapping/token/profilo). Legacy `null`/assente/invalido = eredita il livello successivo (mai shadow, URL legacy byte-identici; il per-titolo segue il profilo `landscape` con fallback al flat) |
| `tscale`/`tox`/`toy` | `topBadgeScale`/`topBadgeOffsetX`/`topBadgeOffsetY` (badge CLASSIFICA superiore) | scala `%` 10..200 (default 100, tutti gli stili) + offset px (default 0, solo centrati). Semantica `tox` = baseline di stile + aggiustamento utente: per un rank `number` (`topBadge.type=rank`, stile effettivo `number`) la X effettiva è `tox + NUMBER_BADGE_BASE_OFFSET_X(-20)` (stesso su sx/dx e portrait/landscape; gli slider UI mostrano l'effettivo e convertono l'edit in aggiustamento, i raw salvati non migrano mai); extra in fallback legacy `rs=number` e tutti gli altri stili restano sulla baseline storica (X effettiva = `tox`). URL preview/Stremio emettono sempre il `tox` raw (mai doppio conteggio: la baseline si applica una sola volta al render) |
| `exscale`/`exox`/`exoy` | `extraBadgeScale`/`extraBadgeOffsetX`/`extraBadgeOffsetY` (badge EXTRA superiore) | opt-in, stessi bound classifica; assente (o query invalida) = fallback legacy sul tuning classifica (URL invariati). Catena: query > mapping per-shape > config token > defaults per-shape > legacy. Il render seleziona il tuning per kind del topBadge effettivo (rank → classifica, extra → extra-dopo-fallback): nastro sempre classifica, `number` mai -20 su extra. Emissione esplicita solo se definito; in compact entra in `dv` solo in quel caso (altrimenti firma storica invariata). Regola indipendenza (implementata in `extra-materialize.ts`, applicata da setter classifica + `applyVisualPreset`): il primo edit classifica materializza l'extra precedente indipendente (tutti gli assi ancora in follow) PRIMA di cambiare il rank; l'edit extra non tocca mai la classifica. Reset extra = torna a null (segui) |
| `gscale` | `genreBadgeScale` (badge genere/rating in basso) | scala `%` 10..200 (default 100 su base 28.6px nativa; la **barra** scala nativa via font per restare full-width) |
| `gox`/`goy` | `genreBadgeOffsetX`/`genreBadgeOffsetY` | offset px (default 0, solo stili non-bar) |
| `qscale` | `qualityBadgeScale` (badge qualità streaming) | scala `%` 10..200 (default 100 su base 17px nativa) |
| `qox`/`qoy` | `qualityBadgeOffsetX`/`qualityBadgeOffsetY` | offset px (default portrait -10/+15, landscape 0/0; espliciti incl. 0 vincono) |
| `sepox`/`sepoy` | `separateBadgeOffsetX`/`separateBadgeOffsetY` (gruppo separati) | offset px (default 0; colonna/pills entrambi gli assi, `bottom-bar` portrait solo Y — X ignorata, mai nuovo renderer) |
| `bit` | `badgeItemTransforms` (correzioni dei SINGOLI badge: un rating, un marchio qualità/AV) | opt-in (`bit` assente = layout automatico, URL legacy byte-identici). Forma wire canonica `id=scala,offsetX,offsetY` ordinata per id, separatore `;` — vedi `badge-item-transforms.ts`. Identità STABILI, mai indici d'array: `rating:<source>` (stessa fonte del valore/logo, es. `rating:imdb`), `quality:tier` (slot del badge qualità), `quality:age` (pill età), `quality:format:<dv|hdr|hdr10plus|atmos|imax>`, `quality:combo:dv-atmos` (marchio fuso DV+Atmos). Scala `%` 10..200, offset px `±2000`; neutrali (100/0/0) e id sconosciuti scartati (fail-closed). Catena `query > mapping effettivo per formato > config token > defaults effettivi > nessuna`; entra in cache chiave canonicalizzata (garbage = assenza, nessun poisoning) e in `RENDER_FILES`. UI: maniglie dedicate sulla preview ingrandita + input numerici per item nel pannello Trasforma; recupero esplicito `Riunisci`/`Riunisci al gruppo` (rimuove solo le correzioni del target, mai lo snapshot del preset applicato: vedi il paragrafo dedicato su Reset vs Riunisci) |
| `netscale` | `networkLogoScale` (logo network) | scala `%` 10..200 (default 100) |
| `netPos` | `networkLogoPosition` (sempre esplicito in preview: `auto`/`top`; Stremio solo in modo `top`) | `auto` = specchio dinamico; `top` = sempre all'angolo superiore, lato del nastro effettivo (destra solo con nastro rank/preset o Coming Soon a destra, sinistra con tutti gli altri badge o senza — anche in vista Stremio; stacking Coming Soon del lato + shift nastro stesso lato + shrink vs centrale; qualità trasloca a sinistra quando il network finisce a destra). Catena: query > mapping (`networkLogoPosition`) > config token > server defaults > `auto` |
| `nox`/`noy` | `networkLogoOffsetX`/`networkLogoOffsetY` | offset px (default 0) |
| `side` | `ribbonSide === "right" ? "right" : null` (modalità Stremio; default Nuvio = sinistra) | `qSide` — "right" sposta nastro Netflix (specchiato) + logo network + nastro Coming Soon a destra |
| `shape` | `posterShape` (sempre esplicito in preview: `poster`/`landscape`; default globale `defaultPosterShape`, per-titolo dal mapping) | catena `shape` > mapping (`posterShape`) > config token > server defaults (`PICTORIUM_POSTER_SHAPE`) > `"poster"` — solo `landscape` attiva il canvas 16:9 (`LAND_W=768/LAND_H=432`, base = backdrop TMDB via `posterUrlOriginal`, oppure base custom da `customBackdropUrl` — indipendente dal portrait `customPosterUrl` — via query `backdrop=` allowlisted come `poster=` (bound 2048, stesso flusso validato, fallback TMDB in parallelo, mai 500) o salvato; Stremio usa sempre il mapping, mai `backdrop=`); emesso negli URL Stremio solo quando landscape (il portrait resta omesso per non invalidare la cache) |
| `align` | `logoAlign` per-shape (sempre esplicito in preview landscape; mai in portrait) | `left`/`center` esplicito > override profilo Orizzontale (concreto vince, `null`/assente = segue il flat) > flat `sd.logoAlign` > default di formato (landscape `left`, poster `center`) — i portrait sono sempre centrati, nessun globale li sposta mai; in portrait l'opzione Sinistra è un no-op dimostrato (disabilitata in UI) |
| `ac` | `accentColor` SOLO se manuale (`isManualAccent`: diverso da `autoAccentColor` auto-rilevato via `useRootColors`, come il server) — mai l'auto, mai nel mapping salvato | `qAc` — override colore accent (vince su tutto: badge colored, blur tint, scrim) |
| `badgePreset`/`prv`/`pt`/`bp`/`bpf`/`bpt` | — (rimossi: custom Badge Lab ritirato) | Parametri ritirati, inerti: non entrano in allowlist/cache key (`POSTER_CACHE_ALLOWLIST`), l'hardening li cancella e la route li ignora — vecchi URL e binding salvati (`mapping.badgePresetId`/`badgePresetRev`/`badgePresets`/`badgePresetFollows`, `ServerDefaults.badgePresets`, token `config`) collassano sul render nativo senza cambiare un pixel né bustare la cache. I campi persistiti restano validati e archiviati verbatim (mai cancellati dallo storage), ma non influenzano più chiavi o byte. |
| `live` | mai dallo stato editor (solo template "Segui il mio spazio": `followSpace` in `buildUrlPattern`, o `live: true` esplicito nel builder) | `live=1` — politica di rivalidazione (non forza il render): header `public, no-cache, max-age=0, must-revalidate` senza SWR su 200 e 304 + mai immutable; i parametri assenti seguono lo spazio (`badges`/`ranking`/`be` compresi, vedi sotto) |
| `tvdb_key` | mai dal client (solo gallery/ordinamenti manuali; Stremio usa il fallback d'istanza) | chiave TVDB per gallery artwork, episodi e ordinamenti. Il poster automatico **non** fa più rescue TVDB: senza clean TMDB usa il fallback in lingua e non sovrappone il logo in portrait. La selezione TVDB resta manuale (`poster=`/mapping) e viene renderizzata come qualsiasi artwork esplicito. La chiave non entra mai nella cache key (segreto); nessun flag `tvdb=1` |
| `theme` | contesto effimero lista di origine (`seasonalTheme` in `PosterState`, da `navigateToPoster(item, src, listName, seasonalKeywords)` — le keyword custom utente estendono lo stesso match nomi-lista; Stremio dal nome catalogo effettivo via `resolveCatalogSeasonalTheme` in `catalog-handler.ts`) sotto la scelta per-titolo editor (`seasonalThemeChoice` in `PosterState`, selettore `BadgeControls` → `mapping.seasonalTheme`, vince sul contesto via `resolveEffectiveSeasonalTheme`) | SOLO query `theme=<tema canonico>` (`halloween`/`christmas`, nient'altro è valido; Natale riconosciuto in tutte le lingue UI + keyword custom bounded per spazio — vedi leaf `seasonal-theme.ts`; nomi misti → `halloween`) su entrambi i canvas col proprio asset (`resolveSeasonalTheme` in `poster-config.ts` + override mapping via `resolveEffectiveSeasonalTheme` (non-preview: scelta esplicita vince, `none` sopprime, assente = Automatica segue la lista; preview effettiva autorizzata: vince il `theme=` staged e il mapping salvato è ignorato — mai resurrect); con valori invalidi/assenti = unframed, stessa chiave dell'assenza). Catena mapping SOLO per-titolo (`mapping.seasonalTheme` flat condiviso, mai config/defaults; nessun profilo landscape). In allowlist cache key + `stremio-poster-params.ts` (esplicito anche in compact, mai in `dv`); il catalogo aggiunge `:th<tema>` alla chiave. Nel service la cornice sta SOPRA lo sfondo/trattamento (backdrop, vignetta, velo, ombra, blur) ma SOTTO TUTTO il chrome — logo e badge inclusi (rank/extra, Coming Soon, network, qualità, genere, separati, età) + overlay Fresh/Card — per richiesta utente esplicita, in ogni layout (standard/Fresh/Card) e forma (portrait/landscape; solo il banner pulito shape=landscape + hideLogo resta senza cornice); il `/meta` generico senza `theme=` resta byte-identico (il `theme=` esplicito vale solo come contesto effimero lista/test Stremio, su entrambi i canvas, con `:th<tema>` in chiave cache meta). Asset CANONICI `public/seasonal-frames/halloween.svg` + `public/seasonal-frames/christmas.svg` (portrait 500×750) + `public/seasonal-frames/halloween landscape.svg` + `public/seasonal-frames/christmas landscape.svg` (landscape 768×432, mappa esplicita `seasonalFrameAssetPath`, mai stirati) (in `RENDER_FILES`, byte-identici all'arte utente); il prototipo offline `design/seasonal-frames/` resta storia nel branch di feature e non è spedito (nessuna copia sincronizzata da mantenere) |

> Retired: custom Badge Lab (libreria preset per family, editor `/lab/badges`,
> pagina `/presets`, API `/api/presets/*`, binding `badgePreset`/`prv`/`bp`/`bpf`/`bpt`
> e campi persistiti `badgePresetId`/`badgePresetRev`/`badgePresets`/`badgePresetFollows`).
> Rimosso su approvazione esplicita: i preset custom/house non rendono piu' e non
> alterano chiavi/cache; i badge nativi delle 9 famiglie restano invariati e i preset
> visivi generali (ready/personali, `PresetsPanel`) non sono toccati. I campi persistiti
> restano validati e archiviati verbatim (mai cancellati dallo storage) ma sono inerti
> al render. Dettagli e file coinvolti nel report di rimozione; la cronologia resta in git.
>
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
> Demo samples (solo preview default Impostazioni, `demo-samples.ts`): `buildDefaultsPreviewUrl` emette sempre `demosamples=1`; la route lo accetta solo con preview effettiva post-downgrade (`preview=1` + flag `1`, fail-closed; declassata → flag rimosso dalla chiave). Dataset sintetico fisso, zero fetch/chiavi: rank 11, tier `4K` (passa sempre `qmin`), network Netflix (SVG già bundlato, fallback nel service DOPO i candidati reali in ordine invariato), voti per le sole fonti `rsrc` richieste con merge gap-only (reali intatti, media regola imdb+tmdb), genere/anno fallback solo se assenti (date passate fisse), etichetta età fallback solo quando il titolo non ne ha una reale (nessuna certification per il paese), formati A/V: la SELEZIONE ABILITATA (`formats` della preview, `none` = nessun marchio; lista ristretta = esattamente quella; nessuna restrizione = `KNOWN_VIDEO_FORMATS`) unita alle spec reali del titolo, così anche una spec parziale (es. solo DV) mostra gli altri marchi abilitati. Il gate è la selezione: un marchio disabilitato non viene mai resuscitato, nemmeno se la spec reale lo contiene, e il renderer unico continua a fare la sua precedenza (HDR10+ sostituisce HDR, DV+Atmos fusi in un solo lockup), quindi il campione non forza mai doppioni esclusivi. La certification reale non viene mai sostituita. I toggle/stili restano l'unico gate di rendering (`ranking=0` → niente rank, `formats=none` invariato, `age=0` → niente pill età, niente premi/upcoming/Top250/Coming Soon campionati); `queryExtra` segue l'API reale. In chiave cache via allowlist (campione/genuino separati); le preview non si scrivono mai. Mai in `buildPreviewUrl` editor né negli URL Stremio. UI: avviso `ui.defaultsPreviewSamplesNotice`.

## Trascinamento diretto dei badge (solo editor)

Nessun parametro nuovo, nessun secondo renderer. Nelle Impostazioni globali la
preview piccola NON è una superficie di editing: espone solo un ingresso
etichettato ("Modifica poster", icona ingrandisci; la miniatura mobile ha la
stessa destinazione) che apre DIRETTAMENTE l'editor ingrandito. Le maniglie sono
i box FINALI riportati dal renderer via `debug=1&netgeo=1` (blocco `badges`, gli
stessi numeri del poster mostrato). Il blocco riporta il layout del POSTER INTERO
(`layout`: `ranked` = classifica effettivamente dipinta, `fallback` = senza
classifica) e i box di OGNI elemento realmente composto in Standard, Fresh e
Card (badge top rank/extra, numerale Fresh/Card, blocco meta/genere, qualità,
separati, logo network, logo titolo). Dentro l'editor ingrandito il click sul poster non chiude mai il dialogo (nessun
gesto perso): chiudono il controllo esplicito, Escape e il backdrop del Modal
condiviso (focus trap e ripristino invariati). Il toggle `previewBadgeDrag` vive
SOLO qui e governa esclusivamente il trascinamento col puntatore: è **opt-out**
(assente = spostamento ATTIVO, `"0"` = spento), perché un puntatore inerte al
primo avvio è indistinguibile da una funzione rotta; spento, la selezione e il
resize agli angoli restano disponibili, mentre il corpo non si muove.

**Editor per-titolo (stesso overlay, adattatore diverso).** Anche il titolo
APERTO nell'editor ha l'ingresso "Modifica poster" (header del pannello
Anteprima, `PerTitleBadgeEditor`): apre lo STESSO `PosterBadgeDragLayer` sullo
stesso `previewUrl` che la preview mostra, con l'adattatore per-titolo
(`usePerTitleBadgeGeometry`) iniettato al posto di
`useShapeBadgeGeometryDefaults`. Nessuna seconda implementazione del drag,
nessun secondo renderer: cambia solo CHI riceve le scritture. Semantica
stretta:

- ogni gesto (move/resize/multi-select/guide/snap/contenimento/reset/rejoin)
  scrive SOLO lo stato live del titolo e della forma in editing, cioè gli
  stessi valori degli slider Trasforma e del payload di salvataggio: i
  controlli numerici non possono desincronizzarsi e la preview WYSIWYG emette
  `qox`/`bit`/… aggiornati;
- nessun default globale, nessun profilo dell'altra forma, nessuna baseline di
  preset e nessuna scrittura su mapping vengono toccati: la persistenza resta
  il SOLO pulsante Salva esistente (con i suoi guard e il suo payload,
  flat o profilo `landscape`, `bit` incluso). Chiudere la superficie non
  salva e non scarta: la bozza è lo stato live dell'editor, e uscire dal
  titolo segue le regole di uscita esistenti;
- "Testa URL Stremio" continua a risolvere `/meta` dal mapping SALVATO: finché
  non si salva mostra il poster salvato, non la bozza;
- riferimento di reset = gli stessi valori dei Reset per-titolo del tab
  Trasforma (default globale effettivo della forma corrente, `land ?? flat`
  — inclusi fallback stile separati e proiezione follow del network). Mai lo
  snapshot del preset applicato, che è un concetto della sessione Impostazioni;
  stessa gerarchia del resto: il reset di gruppo scarta anche le correzioni
  per-item possedute dalla famiglia, il rejoin elimina solo quelle;
- nessun travaso tra titoli: la superficie è chiave `titolo:forma`, si chiude
  al cambio titolo, l'adattatore rifiuta ogni scrittura dopo
  l'unmount/cambio identità, e riaprire un titolo senza aver salvato riparte
  dai valori salvati (le bozze non sono persistite).

**Livello del target (GROUP vs ITEM).** La toolbar dell'editor espone due
pulsanti etichettati (Gruppi / Badge singoli) e UNA sola delle due famiglie di
maniglie è disegnata e hit-testabile per volta: le maniglie di gruppo e quelle
per-item non si sovrappongono mai, quindi un gruppo il cui box è quasi tutto
coperto dai singoli badge resta sempre raggiungibile. Il cambio livello svuota
la selezione (spazi di target diversi).

**Selezione multipla (stile Windows).** Click semplice = seleziona un target;
Ctrl/Cmd-click = aggiunge o toglie; trascinamento sul fondo vuoto del poster =
marquee che seleziona tutti i target del livello attivo toccati (Ctrl/Cmd
estende la selezione corrente); click sul fondo vuoto senza trascinamento =
svuota. Trascinare uno qualsiasi dei target selezionati muove TUTTA la
selezione con un unico delta condiviso, clampato a TUTTI i box selezionati
(intersezione dei limiti di ciascuno: nessun membro esce dalla cornice) e
snappato dal box UNIONE; il doppio click ripristina la selezione corrente. La
selezione è normalizzata: un item il cui gruppo è selezionato viene scartato,
quindi padre+figli non possono mai traslare due volte (e i due livelli sono
comunque esclusivi). Le scritture multiple sono ATOMICHE: una sola scrittura di
stato per gesto (`applyFamilyMoves` / `applyItemMoves`), così il batching di
React non può tenere solo l'ultimo membro.

Il trascinamento scrive gli offset X/Y esistenti
(`tox`/`toy`, `exox`/`exoy`, `gox`/`goy`, `qox`/`qoy`, `sepox`/`sepoy`,
`nox`/`noy`, logo titolo `ox`/`oy`): resta sincronizzato in entrambe le
direzioni con gli slider Trasforma. Il compositor Card applica gli stessi
offset e scale (geometria fissa solo a valori neutri), quindi badge e logo
sono spostabili anche su Fresh e Card senza cambiare la resa di default.
**Resize** (solo editor): selezionato un elemento, i quattro angoli sono
maniglie di ridimensionamento che preservano l'aspetto (rapporto della distanza
del puntatore dal centro del box, in px canvas: stessa richiesta a ogni zoom).
Scrivono la STESSA scala dei rispettivi slider Trasforma (`tbs`/`exs`/`gbs`/
`qbs`/`sepscale`/`nls`/logo `scale`), nello stesso layer della forma (flat
portrait, profilo landscape), quindi slider e maniglie restano allineati. La
scala proposta è clampata al contratto server 10..200 (logo: cap UI del layout
attivo, Standard 100 / Fresh 200). In CRESCITA è limitata anche dal riquadro che
i box riportati mostrano: un elemento che già sborda può solo rimpicciolire, uno
a larghezza piena (barra genere) non ha spazio di crescita, un elemento che ci
sta si ferma quando il box previsto tocca il bordo. Il contenimento di
POSIZIONE non è promesso dal resize (il renderer scala attorno al proprio
anchor, gli offset restano margini). `pointercancel` non scrive nulla; le
frecce sulla maniglia d'angolo cambiano la scala di 1 (Shift: 10) con lo stesso
clamp. Per il logo in auto (scala `null`) la baseline del primo resize è
derivata dal box riportato (larghezza resa), mai un 100 inventato; i cap del
renderer restano validi.
Lo slot superiore segue il layout effettivamente dipinto: il profilo fallback
(`extra`) è completo (scala + X + Y) e il primo drag lo materializza; con
`exscale`/`exox`/`exoy` assenti resta il fallback legacy per-asse sul tuning
classifica. Doppio click su una maniglia = reset del SOLO elemento (posizione
E scala) ai default canonici del profilo attivo: in portrait i costanti
esistenti (rank/genere 100/0/0, qualità 100 + offset di forma, separati
scala di stile + 0/0, network 100/0/0, logo auto + 0/0, extra null = follow),
in landscape la cancellazione delle chiavi di profilo (eredita i flat, stesso
contratto dei Reset esistenti). Il top slot si resetta solo nel layout che lo
mostra; le altre famiglie non vengono toccate. Il doppio click non committa il
drag concorrente. Le guide di allineamento (centro poster, bordi/centri degli
altri badge, snap a ~6px schermo) e la preview ingrandita sono solo overlay
dell'editor: mai renderizzate nel poster.

**Riunisci al gruppo (recupero esplicito, NON un reset).** Accanto ai Reset
(preset-aware: con un preset applicato ripristinano lo snapshot immutabile,
anche le correzioni per-item che conteneva al momento dell'apply) esistono due
affordance distinte: `Riunisci` sulla riga numerica di un singolo badge e
`Riunisci al gruppo` sulla card Qualità del tab Trasforma, più il pulsante
della toolbar di selezione dell'editor ingrandito. Rimuovono SOLO le correzioni
`quality:*`/`rating:*` possedute dal target, sempre: mai lo snapshot applicato,
mai la posizione/scala del gruppo (`qscale`/`qox`/`qoy`) né le altre famiglie.
Il rejoin di gruppo lavora sulla mappa STORATA, quindi elimina anche le identità
non dipinte (formato soppresso da hdr10plus, combo fuso, pill età assente) e non
dipende da una geometria fresca o dalle righe elencate. Scrive solo la bozza
(singolo Save per persistere: flat `null` / profilo landscape `null` ESPLICITO,
non una chiave cancellata, altrimenti erediterebbe le correzioni portrait); una
mappa già pulita non scrive nulla (nessun dirty/conflict fittizio) e lo stato
`pending` dell'overlay viene azzerato, così la maniglia non continua a disegnare
il delta rimosso.

**Contenimento nel riquadro (solo drag).** Il delta proposto viene limitato
contro il box riportato dal renderer e il canvas, su entrambi gli assi e in ogni
layout/zoom (Standard, Fresh, Card, portrait e landscape; badge e logo titolo),
PRIMA di disegnare la maniglia e PRIMA di scrivere gli offset: overlay e valori
salvati sono lo stesso movimento (`resolveBadgeDragDelta` →
`containBadgeDragDelta`). Lo snap gira prima del contenimento: un aggancio che
spingerebbe oltre il bordo non viene onorato e la guida dell'asse accorciato non
viene mostrata. Gli assi bloccati (`fixedX`: X ignorata dal renderer) restano
non toccati. Delta interi, arrotondati verso l'interno quando accorciati, così
l'offset intero salvato non può cadere mezzo pixel fuori.

Garanzia effettiva e limiti dichiarati:

- bounds = i box riportati in `badges`: corpo visibile per le famiglie ancorate
  per corpo (`genre`, `rank`, `extra`), intera bitmap composta per i layer
  bitmap (`quality`, `separate`, `network`) e per il logo titolo. Per le
  famiglie "corpo" il bleed d'ombra trasparente può quindi restare tagliato dal
  bordo mentre il corpo visibile è dentro; per le altre il box include già il
  padding della bitmap (contenimento conservativo).
- box fuori riquadro all'inizio (offset salvati o badge più grande del
  canvas): il drag non peggiora la situazione e non fa salti — nessun
  riallineamento coatto al bordo. Il contenimento pieno si raggiunge muovendo
  verso l'interno; non viene inventato un contenimento impossibile.
- elemento più largo/alto del canvas: contenimento pieno impossibile; il clamp
  lo tiene comunque a copertura del riquadro (nessun vuoto sull'asse).
- gli slider Trasforma NON condividono questo limite: restano sul contratto
  esistente (escursione piena per asse, nessun contenimento promesso, vedi
  `badge-offset-ranges.ts`), condivisi con l'editor per-titolo e gli edit
  numerici. Il limite è del solo trascinamento diretto.
- geometria non ancora disponibile (`badges` assente): nessun bound applicato e
  nessuna maniglia, come prima.
- asse bloccato (`fixedX`, es. barra genere full-width): il delta finale è **0**
  su quell'asse (`resolveBadgeDragDelta`), overlay e commit compresi. Prima il
  drag orizzontale scriveva comunque `gox` (offset mai applicato dal renderer,
  invisibile ora ma riapplicato se lo stile smettesse di essere ancorato):
  niente stato fantasma, nessun nuovo parametro.

### Regola di ancoraggio: gli offset sono margini, non geometria assoluta

Nessun nuovo modello di posizionamento: ogni famiglia è composta dal renderer
unico a partire dal PROPRIO anchor automatico (margine/griglia di formato), e
gli offset esistenti (`tox`/`toy`, `exox`/`exoy`, `gox`/`goy`, `qox`/`qoy`,
`sepox`/`sepoy`, `nox`/`noy`, logo `ox`/`oy`) sono **delta di margine**
applicati DOPO quell'anchor. Il drag globale scrive gli stessi valori dei
controlli Trasforma, quindi il margine resta relativo: a parità di offset il
badge mantiene la stessa distanza dall'anchor anche quando la sua dimensione
cambia (es. qualità ancorata a destra: `left = CW − pad − w + qox`, il bordo
destro non si muove scalando). Precedenza invariata (query > mapping per-titolo
> token > default): una correzione per-titolo resta per-titolo, il drag della
preview default non scrive mai geometria per-titolo (`poster-config.ts`).
Anchors di riferimento: rank/extra centrati in alto (o angolo per
`corner`/`number`, nastro ancorato e NON trascinabile — nessun box riportato),
qualità in alto a destra, network secondo `networkLogoPosition` (e
`networkLogoFollowTitle` resta invariato: il network segue il titolo, mai il
contrario), genere/metadati al centro o a destra in landscape, separati
ancorati al fondo del box qualità, logo titolo in basso-centro (o
`logoAlign=left`).

### Logo titolo: area massima, aspetto e anchor

`computeLogoBox` (`logo-layout.ts`) fa un contain-fit dentro l'area massima del
formato (portrait: altezza 25% + larghezza canvas; landscape: 40% × 24%) con
rapporto d'aspetto della sorgente preservato (+/−1px di arrotondamento) e mai
un box più piccolo del fit massimo; `computeLogoLayout` lo ancora in
basso-centro, quindi **il bordo inferiore e il centro sono identici per ogni
logo** (wordmark largo, quadrato, verticale) a parità di scala: la scala cambia
solo la dimensione, `ox`/`oy` sono margini dall'anchor e non spostano il fit.
Coperto da test dedicati in `src/__tests__/rendering/logo-layout.test.ts`
(wide/square/tall/extreme, 25/50/100%, entrambi i formati). Fresh e Card hanno
gli slot propri già documentati (stessa regola, costanti diverse).

Padding trasparente: il layout Standard/Fresh misura la **bitmap** (nessun trim
inchiostro), il compositor Card fa trim dell'inchiostro (P14). La differenza è
nota e volutamente invariata: un trim anche in Standard/Fresh cambierebbe la
resa di ogni logo con padding ed è una modifica visiva esplicita (snapshot +
`RENDER_VERSION`), non un effetto collaterale di questa regola.

> **Debito aperto (non risolto qui):** la persistenza whole-poster
> `ranked`/`fallback` (profilo top slot completo su entrambi i layout, senza
> split del solo slot superiore) resta incompleta: il drag materializza il
> profilo dipinto e il reset è gated per layout, ma non è una persistenza
> completa dei due layout. Non va dichiarata completa finché non è implementata.

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
| Sorgente logo | — | `fetchLogoImg`: raster a `w500` al primo tentativo (single fetch, niente `original`/`w780` — `w780` non è una taglia logo documentata); SVG vettoriali a `original` (semantica vettoriale), URL assoluti invariati. Cap anti-OOM 10MB, abort/timeout/404 rilanciano senza retry. Poster/backdrop restano `w500` |
| Margine inferiore | `bottomMarginPct: 12` con badge genere, `10` storico senza (mirror in `context.tsx` per i bound slider) | `bottomMarginPct: hasGenreBadge ? 12 : undefined` (default 10) — solleva il logo sopra il badge basso |
| Calibrazione Y portrait | `topOffset: PORTRAIT_LOGO_TOP_OFFSET (10)` — logo 10px più in basso (mirror in `context.tsx` per i bound slider, `poster-fit-score.ts` per l'auto-fit; landscape escluso: non baked-in) | Stesso offset (ramo portrait, già solo-portrait) |
| Calibrazione invisibile landscape | slider sempre a 0 (nessun default visibile) | `LANDSCAPE_LOGO_SHIFT_X/Y (+10/-10)` sommati in `poster-service.ts` agli offset risolti (`ox`/`oy` > mapping > default globali), come `PORTRAIT_LOGO_TOP_OFFSET` in portrait |
| Logo manuale su portrait non-clean | ammesso: tiles sempre abilitate, preview emette `logo` anche non-clean, mapping/route lo persistono e rendono | default nessun auto (auto solo da clean o landscape); `logoDisabled` sempre onorato; `?logo=` esplicita vince |

## Base portrait senza poster clean

Solo portrait, ramo automatico (nessun `poster=` di query e nessun mapping): se
TMDB non espone poster clean (`iso_639_1 === null`) ma ha almeno un backdrop e un
logo, la base del canvas 2:3 è il cover-crop del **primo backdrop clean** (in
mancanza, il primo backdrop in qualsiasi lingua) via `cropBackdropToPortrait`
(`cropBackdropToPortrait(..., "center")` → crop cover geometricamente
centrato, `sharp` `position: "centre"`: deterministico, nessuna euristica di
salienza/densità che sposti o tagli il soggetto — `entropy` tagliava il bacio
su un backdrop reale, `attention` tagliava i volti su un altro. `attention`
resta il default dell'helper per la rescue B2 — nessun secondo renderer; il
focus è solo un parametro). La base
non ha titolo cotto, quindi vale come clean: il logo resta
composto sopra (`autoPosterClean = true`) e la sfumatura segue il profilo clean.
Senza backdrops la catena in lingua resta intatta (preferita → originale → primo
poster) con logo tolto. Con `disableCleanPosters` ON (scelta esplicita per la
catena in lingua) il ramo nuovo resta spento. Landscape invariato (base =
backdrop 16:9). La chiave dell'analisi pixel è `portrait:backdropcrop:<path>`: i
byte sono un crop, non il poster nominale.

Preview WYSIWYG: quando il client riconosce lo scenario (`previewBaseAuto` in
`context.tsx`: portrait, pool/eligibilità del ramo automatico, base non custom)
non emette `poster=` né gli hint derivati — la base la sceglie il server con lo
stesso ramo automatico che serve Stremio, quindi la preview rende gli stessi
byte del poster finale. Provenienza della scelta: un tile cliccato in griglia
(`posterPickedKey`, l'unico percorso `selectPoster`) vince sempre sulla base
auto, anche ri-selezionando il poster in lingua che l'auto aveva scelto.

Persistenza: al save in base auto il mapping congela `portraitBackdropPath`
(il backdrop usato per il crop: quello già salvato o, per un titolo nuovo, la
stessa scelta del server) e, se l'editor non ha un logo scelto e non l'ha
disattivato, il logo che il renderer compone (stessa selezione condivisa
`selectBestLogo`) — senza, il crop salvato sarebbe un'immagine senza titolo.
Il ramo mapping della route usa quel backdrop con lo stesso
`cropBackdropToPortrait` (fallback al `posterPath` del mapping su ogni errore
di fetch/crop), lo mette in `analysisKey` (`portrait:backdropcrop:`) e nella
cache key; un tile scelto in griglia azzera il campo (base = poster salvato),
landscape e basi custom restano invariati. Riaprendo un mapping con base
congelata la preview torna in base auto (senza `poster=`), quindi preview e
Stremio restano allineati; i mapping salvati prima di questo campo restano sul
poster in lingua (nessuna migrazione in lettura).

Scelta del backdrop (picker in griglia): quando la base viene da un backdrop e
il titolo ne ha almeno uno clean, il pannello Poster mostra i tile 16:9 dei
soli backdrop clean non esclusi (`PortraitBaseBackdropPicker`, stesso
`PosterBtn` di `BackdropOptions`). La scelta è live in preview come `pbase`
(path TMDB, validato: `/abc123.jpg`) e vince sulla base salvata
(`portraitBackdropPath`), così il renderer unico croppa subito il backdrop
scelto; al save è quel path a essere congelato. Ricliccare il tile attivo torna
alla base automatica/salvata. Guardie: nessun picker senza backdrop clean, i
backdrop in lingua e le basi custom non sono offribili né accettati dal setter,
quindi la catena storica (poster in lingua, provenance `posterPickedKey`) resta
intatta; `pbase` è nell'allowlist della chiave, canonicalizzato in
`sanitizePortraitBaseBackdropPath` (valore non-TMDB = assente) e, come gli
altri override immagine, ignorato per gli anonimi sulle pubbliche in presets
mode (la preview WYSIWYG resta esente).

## Layout copertina Fresh (`layout`)

Opt-in grafico (`standard` = resa storica, default; `fresh` = numerale classifica in vetro + colonna meta a posizioni fisse, stesso renderer unico). Parametro `layout` in query; per-titolo nel mapping (flat + profilo `landscape`); nei default globali (flat + profilo Orizzontale) e nel config token. Nessun nuovo campo oltre `posterLayout`/`landscape.posterLayout`.

> **Preset pronto Fresh (galleria Preset, solo ranked):** settimo tile (`FRESH_VISUAL_DEFAULTS` in `default-visual-presets.ts`, fedele all'export readonly `C:\Users\lucaf\Desktop\fresh.json` + `fresh`/`ranked` espliciti su entrambi i formati, età OFF/IT/standard canonica) — portrait `netflix`+nastro/minimal/knockout/grade 35, landscape `number`/`color`/`follow-rank`/grade 50. La galleria `PresetsPanel` lo applica con `withReadyPresetLayoutFresh` (stesso freeze dell'altro formato dello Standard, mai reset d'ingresso Fresh che distruggerebbe le posizioni 0/null esplicite); i 6 esistenti restano Standard, i personali applicano verbatim.

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

## Layout copertina Card (`provider-glass`/`nuvio`/`stremio`, UI P6)

Stessa catena di persistenza del Fresh (query `layout` > mapping effettivo per formato > config token > default effettivi per formato > `standard`; scope `posterFreshScope` condiviso sullo stesso valore salvato), ma gate di eleggibilità separato (`isEffectiveCardLayout`: rank mostrato 1..20, MAI esteso a 100 — il gate Fresh resta intoccato) e geometria fissa nel compositor condiviso (`card-layout.ts`).

| Aspetto | Regola |
|---|---|
| Selettore UI (`PosterLayoutSelector`) | 5 scelte come radiogroup controllato (Standard, Fresh, Provider Glass, Nuvio, Stremio) con miniature CSS illustrative (storico Standard, full-bleed Fresh, rank+card per le 3 Card — nessun secondo renderer, mai la logica poster reale), griglia responsive `poster-layout-grid` (`grid-cols-2` sullo stretto, mai 5 label lunghe su una riga). Valori `standard` fail-closed, selezioni salvate preservate |
| Scope condiviso (`PosterFreshScopeSelector`) | visibile con Fresh E con Card (nascosto con Standard, valore conservato). Stesso valore `posterFreshScope` salvato per-formato; testi Fresh invariati, per Card wording generico (`ui.posterLayoutScope` + `ui.posterLayoutScopeHint`, rank 1..20 vs 1..100 Fresh — MAI etichettato come Fresh). Per-titolo in `BadgeControls` + default per formato in `BadgeDefaultsSection` (flat Verticale / profilo Orizzontale, come Fresh) |
| Hint attiva Card (`ui.posterLayoutCardHint`) | posizioni fisse rank/provider/meta/titolo + fallback Standard senza rank 1..20; mostrata nella card layout e su ogni gruppo Trasforma disabilitato |
| Trasforma per-titolo (`TransformControls`) | su Card disabilitati (fieldset + hint, valori MAI riscritti): scala/offset classifica, offset X/Y genere, offset X/Y titolo, follow+offset network. Restano attivi: scala titolo/network (P14: ridimensionano gli SLOT Card con UN solo fit del buffer originale — titolo bottom-center su inchiostro reale, mai whitespace-as-logo), scala genere (P15: dimensiona il badge standard principale nella banda sotto-card), extra, qualità, separati, blur/tinta/ombre. La matematica auto aspect Standard NON decide la misura Card: lo slot base è già grande e l'auto titolo vale 100 neutro (come Fresh, byte-identico a esplicito 100) |
| Titolo/provider Card grandi (P14) | slot titolo bottom-CENTER dentro la card: 75% larghezza card (70-80% richiesti, aspect intatta), altezza legata alla fascia bassa (portrait 20% altezza card, landscape 40% — stessa resa assoluta sulla card 16:9 bassa); scala titolo (`scale`, null = 100 neutro) ridimensiona lo slot, UN solo fit shrink-only del buffer ORIGINALE (mai il bitmap Standard pre-ridotto), trim del padding trasparente + centratura sull'inchiostro misurato con padding basso reale. Slot provider allargato alla griglia sinistra (portrait 196×120, landscape 260×100, `pRight <= card.x` a livello slot; dal P17 il piazzamento può superarlo SOLO nella fascia sotto-card, mai dentro l'arte); `netscale` (valori salvati preservati) ingrandisce lo slot, UN solo fit con upscale limitato allo slot; la banda meta parte a destra del mark reale (mai overlap). NESSUN nuovo parametro: `scale`/`netscale` esistenti in preview/Stremio invariati |
| Persistenza | NESSUN nuovo campo: `posterLayout`/`posterFreshScope` esistenti (flat + `landscape`) coprono già le Card per-titolo, default, token e stash cambio-formato (`EditView` generico). Preview/default-preview/Stremio emettono gli ID correnti intatti (contratto P1, testato) |
| Chiavi i18n | `ui.posterLayoutProviderGlass`/`ui.posterLayoutNuvio`/`ui.posterLayoutStremio` (nomi propri identici in tutte le lingue) + `ui.posterLayoutScope`/`ui.posterLayoutScopeHint`/`ui.posterLayoutCardHint` (localizzate, 18 dizionari) |
| Voto Card aggregato (P8) + badge standard (P15) | Media aritmetica pari dei provider selezionati disponibili normalizzati a /10 (`aggregateCardRating` in `card-layout.ts`: separati e media ordinaria già /10 dal fetch MDBList, custom `percent` 0-100 → /10, scale ignote fail-closed, duplicati contati una volta, cap 5 condiviso, zero/non-finiti esclusi, nessun arrotondamento intermedio — solo il display a 1 decimale). P15: l'aggregato alimenta il renderer standard esistente (`renderGenreBadge` via `renderCardMainBadge` nel service — MAI un secondo renderer genere/stelle/anno Card) con toggle genere/anno raw pre-soppressione (badge combinato + separati, esplicito utente; deviazione dalla soppressione bottom standard giustificata: banda sotto-card e riga a filo non collidono) e stile/font/colori/scala standard; arriva al compositore come bitmap già resa nello slot overlay condiviso (contain centrato nella banda, mai clip/collisioni, colonna brand P14 e titolo intatti). Gli helper custom restano come fallback + superficie unit, il service non li alimenta più. Separati opzionali con renderer esistenti (colonna laterale / riga bottom / riga custom, max 5, icone/fonti/ordine invariati, priorità custom storica, mai due stack) |
| Numerale Card alto/stretto (P9) | OGNI rank 1..20 tiene misura/anchor/baseline verbatim del reference (`sizeSingle`/`sizeDouble`, `xSingle`/`xDouble`, `centerY + size*0.34 + drop` — overlap parziale dietro la card è il design `cover.js`, vedi rank 2/4/1 negli esempi). Le doppie cifre (10..20) condensano SOLO in larghezza (`CARD_NUMERAL_CONDENSE_X = 0.6`, stesso pattern `scale(<cx> 1)` del numerale Fresh, senza toccare Fresh): mai shrink uniforme (il vecchio gutter-fit rimpiccioliva le doppie portrait 168px → ~91px). Outline uniforme via anello morfologico (dilatazione post-trasformata — `vector-effect="non-scaling-stroke"` è ignorato da resvg, misurato byte-identico); glow/ombre verbatim per-skin. Misura su inchiostro reale: shift misurato (mai shrink), prima cifra interamente prima della card, seconda a maggioranza visibile, struttura a due masse sulla mask senza ombre (il glow fonde le giunzioni strette). Nessun nuovo parametro/campo/rank oltre 20 |
| Numerale Card LARGE + fix 4 (P16, correzione ciclo 1) | GRANDEZZA: rank 2..20 scalano ×`CARD_NUMERAL_ENLARGE` = 1.18 (punto medio della fascia utente 15-20%, misurato su inchiostro reale entrambi i formati) con stroke proporzionale; rank 1 RESTA verbatim pre-P16 (size/stroke/anchor originali, baseline con la sua misura — "1 andava bene come prima", utente). Anchor/tracking/baseline/condensazione base invariati, occlusione SOLO naturale per ordine layer (numerale prima della card, mai crop del viewport, MAI shift forzato per indurre tuck — "NON obbligatoriamente sotto il poster"). OUTLINE UNICO singoli+doppie: le singole non sono più `<text>` stroked — resvg strokeggia ogni sottopercorso del font separatamente e i contorni del "4" Inter si sovrappongono dentro il glifo, dipingendo segmenti interni spuri (causa misurata: rogue px su old senza filtri, zero sul ring; i counter legittimi restano vuoti). L'anello deriva dalla silhouette UNITA (stessa pipeline delle doppie, hue/gradienti/glow per-skin invariati, counter 6/8/9/0 mai riempiti). CONDENSA ADATTIVA: se a 0.6 la seconda cifra resta <50% visibile (portrait "20" ingrandito, già marginale in P9), retry a 0.55/0.5/0.45 STESSA altezza finché le due masse + prima-prima-card + seconda-maggioranza passano (primo step valido vince, oltre = omesso). Fit misurato su singole (core dentro il canvas) come sulle doppie. Nessun nuovo parametro/campo/rank oltre 20 |
| Provider dentro la cornice (P17, contour BLOCCATO) | PROVIDER (consegnato): il mark scivola leggermente verso il centro (`placeCardProviderMark`: origine a `cardProviderMinLeft` = rima interna cornice + margine proporzionale `max(6, CW/125)`, taglia P14/`netscale` intatte, sotto il rank) e può superare `card.x` SOLO nella fascia strettamente sotto-card (mai dentro l'arte; se i due vincoli sono incompatibili a taglia piena — landscape 150%+ — vince l'arte senza shrink). Banda meta sempre dopo il mark reale + gap; posizione mai dipendente dal badge (niente salti). CONTOUR (non consegnato, bloccato con evidenze): il ripristino del pieno `stroke-width` via anello simmetrico (`dilate`±`erode`) è stato prototipato e MISURATO (spessore steli piatti = vecchio totale su 1/4/7/11/20 entrambi i formati) ma rompe 5 garanzie esistenti — rogue interni sul diagonale del 4 per inflazione del kernel quadrato (~×1.4), fori piccoli parzialmente riempiti dal `dilate`, ombra più forte che riempie la valle tra cifre e il counter dello 0 (PNG diagnostici + log in temp `p17/`); l'unione a due bande risolve i fori ma non diagonale/valle/ombra. Nessun test indebolito: l'anello P16 resta, il task contour va rideciso (tolleranza diagonale o peso ridotto esplicito). Nessun nuovo parametro/campo |
| Tinta fissa provider-glass (palette brand, mai pixel) | SOLO cornice/sfondo vetro `provider-glass` (atmosfera + body + sheen/rim via `brandTintPalette`): tinta da palette FISSA 8 provider per identità brand già risolta (`provider-brand-palette.ts`, chiave canonica `networkKey` del resolver esistente — stessi alias/priorità del logo disegnato: NOW/Sky → `sky`, HBO/Max → `hbo`, Prime/Amazon → `prime`; NESSUN nuovo matcher, NESSUN campionamento pixel da logo/artwork, NESSUN fetch in più). Palette approvata: Netflix `#E50914`, Prime Video `#00A8E1`, Disney+ `#176BCA`, HBO/Max `#7138E8`, Apple TV `#A8ADB5`, Paramount+ `#0064FF`, Crunchyroll `#F47521`, NOW `#00D98B`; provider non listati/assenti (inclusi i fallback TMDB per network ignoti, a prescindere dai loro pixel) = neutro `#707780` dal ramo dedicato (`resolveProviderGlassSkinAccent`, MAI il generico `#555555` che resta per Nuvio/gli altri percorsi). Precedenza: `ac=`/mapping manuale valido vince sempre (contratto pubblico invariato); manuale invalido = ignorato (lookup brand, poi neutro). Il numerale resta cristallo neutro (`cardNumeralMaterial` ignora l'accent per `provider-glass` — la palette non ricolora mai i numeri). Nuvio (nero pieno) e Stremio (viola fisso) byte-identici; Fresh/Standard invariati. Nessun nuovo parametro query/config/store |

## Preset personali: indipendenza del look salvato

Ogni preset personale possiede l'intera ricetta visiva del formato in editing (mai il look precedente): badge/classifica/gradienti/trasformazioni + presentazione ranking (`posterLayout`/`posterFreshScope`) + stile extra standalone (`extraBadgeStyle`) + classificazione (`ageBadge`/`ageCountry`/`ageBadgeStyle`). Chiavi opzionali con nomi/enum del backend (validazione only): gli snapshot legacy senza chiavi restano validi e risolvono i canonici di fabbrica (standard/ranked/extra-null-segui-own-rank/off/IT/standard — stessa fonte di `useDefaults`), mai il live precedente né euristiche sul nome; i valori espliciti (inclusi i `null` canonici) sono onorati verbatim. Snapshot mai riscritti su render/apertura: normalizzazione pura ai bordi capture/apply/thumb/import (`normalizePersonalPreset` + `PERSONAL_FLAT_TO_LANDSCAPE` in `visual-presets.ts`; il contratto ready/per-titolo con la mappa `PRESET_FLAT_TO_LANDSCAPE` congelata resta byte-identico). Fuori dal perimetro (preservati verbatim come i ready): `ratingSources` (senza chiave profilo), `logoAlign` + fit flag (toggle globali), `posterShape` (delivery), credenziali/config provider/cataloghi/regione/userid (mai contenuto preset). Contratto sessione invariato: lo staged normalizza `freshScope "all"` → `"ranked"` per ogni seed (ranked-only), quindi i personali salvati portano `ranked` come qualsiasi altro edit.

### Baseline di reset del preset applicato

Applicare un preset (ready o personale) registra, per il formato in editing, uno snapshot IMMUTABILE della sessione più l'identità (`id`/nome/kind) in `activePresetBaseline:<namespace>:<shape>` (`active-preset-baseline.ts`, localStorage namespaced come i defaults, una voce per formato). I Reset di gruppo, il doppio click fullscreen (gruppo e singolo item) e i reset del pannello Trasforma ripristinano QUELLO snapshot, non i default globali eventualmente salvati dopo: posizione/scala di gruppo, correzioni per-item possedute (`quality:*`/`rating:*`) e gradienti tornano al preset; le altre famiglie restano intatte. Senza preset applicato vale il reset canonico storico (portrait costanti di fabbrica, landscape clear-to-inherit). Un global Save non tocca lo snapshot; l'update esplicito del preset (con conferma) lo rinfresca intenzionalmente. Il riferimento sopravvive al reload; un preset cancellato lascia lo snapshot di reset ma non offre più l'update.

Provenienza e recupero dei riferimenti built-in (`rev` in `active-preset-baseline.ts`): gli snapshot scritti prima che le ricette possedessero le correzioni per-item (campo aggiunto DOPO le ricette) potevano catturare le correzioni LIVE, e ogni reset successivo le resuscitava. Alla lettura un riferimento `kind: "ready"` senza `rev` corrente viene recuperato dalla RICETTA FIDATA (`READY_PRESET_ENTRIES`: valore posseduto della sola chiave item del formato in editing, tutto il resto dello snapshot resta byte-identico) e marcato `rev` — una volta sola. I riferimenti già marcati non vengono mai riscritti (l'immutabilità vince su un cambio di ricetta successivo), un `id` ready sconosciuto resta invariato, e i riferimenti PERSONALI non vengono mai ricostruiti: non esiste una ricetta esterna e senza un backup/export lo snapshot personale è l'unica verità disponibile.

La cancellazione di chiavi di profilo (`undefined` nei reset esistenti) viaggia nel PUT come lista additiva `landscapeReset: string[]` (allowlist `landscape-reset.ts`, fail-closed sul server): il server la applica DOPO merge/backfill, così un edit dei flat non ricongela la chiave cancellata, e non la persiste. `null` non viene mai sovraccaricato come "cancella" (resta un valore esplicito sulle chiavi nullable).

## Controllo dei SINGOLI badge (per-item) — oltre ai gruppi

I trasform dei gruppi restano il default automatico e non cambiano semantica.
In aggiunta, ogni badge composto SEPARATAMENTE dal renderer ha una correzione
propria (scala + X + Y), persistita per **identità stabile** e mai per indice.

- **Identità** (`badge-item-transforms.ts`, unica fonte): `rating:<source>` per
  un provider della colonna/riga separati (la stessa fonte che produce valore e
  logo: `rating:imdb`, `rating:tomatoes`, `rating:metacriticuser`, …),
  `quality:tier` per lo slot qualità, `quality:age` per la pill età,
  `quality:format:<fmt>` per un singolo marchio A/V e `quality:combo:dv-atmos`
  per il marchio FUSO Dolby Vision+Atmos. Un rating assente o riordinato non
  eredita mai il tuning di un altro: l'id non esiste → nessuna correzione. Un
  marchio soppresso/fuso (`hdr` soppresso da `hdr10plus`, `dv`/`atmos` fusi nel
  combo) lascia la propria correzione INERTE, non la trasferisce.
- **Box reali per item**: il blocco `badges` del render diagnostico
  (`debug=1&netgeo=1`) riporta `items[]` con `id`, `family`
  (`quality`|`separate`), box finale e `custom` (correzione attiva). Le maniglie
  leggono SOLO quei box: nessuna geometria indovinata dal client, un solo
  renderer. I controlli numerici prendono dal report solo le IDENTITÀ
  (`id`+`family`); i numeri sono sempre i valori canonici della sessione/forma
  (vedi bullet successivo).
- **Righe numeriche stabili, hitbox fail-closed**: le righe dei controlli
  numerici conservano le identità riportate legandole all'identità SEMANTICA
  dell'URL di preview (`badgeGeometrySourceKey` in `useBadgeDragGeometry.ts`:
  titolo/forma/famiglia/layout/provider/stili; i soli parametri di
  trasformazione — `tscale`/`tox`/…/`bit` — e diagnostica sono esclusi, un
  parametro nuovo conta come semantico). Un edit di sola trasformazione cambia
  l'URL e invalida i BOX (le maniglie restano fail-closed, nessun box stantio)
  ma non ricrea le righe: il testo digitato resta in bozza locale fino a
  blur/Enter (frecce ±1, Shift ±10; Escape annulla; vuoto o non valido non viene
  mai persistito) e focus/caret sopravvivono al refresh. Un cambio semantico
  azzera le righe finché il renderer non riporta il nuovo set, così un badge non
  più composto non resta fantasma. `data-custom` viene dalla mappa canonica, non
  dal flag `custom` dello snapshot; 100/0/0 è la correzione RELATIVA sopra il
  gruppo (mai la scala del gruppo).
- **Ordine di composizione** (documentato, uguale su client e server): il layout
  automatico posiziona l'item nel gruppo; si applica il transform di GRUPPO
  (anchor, offset, scala, fit/shrink di layout); poi la scala dell'ITEM attorno
  al proprio centro; infine l'offset dell'ITEM in px canvas. Quindi spostare il
  gruppo muove tutti gli item, mentre una correzione dell'item è un delta
  relativo sopra il gruppo.
- **Dettach senza reflow**: quando un item ha una correzione, il renderer NON
  ridisegna il gruppo in modo diverso: lo slot automatico resta (nessun altro
  badge si muove), l'item viene tolto dal bitmap composto e ricomposto
  separatamente alla posizione trasformata. Senza correzioni il bitmap è
  **byte-identico** al percorso storico (verificato dai test).
- **Reset (gerarchia naturale)**: la correzione di un item è un delta SOPRA il
  layout della sua famiglia. Doppio click su una maniglia di GRUPPO = reset
  canonico della famiglia (posizione + scala, solo nel layout ranked/fallback
  attivo) E rimozione delle correzioni per-item POSSEDUTE da quella famiglia
  (`quality:*` per qualità/età/formati, `rating:*` per la colonna separati):
  senza questo passaggio gli item resterebbero fuori dal layout ripristinato.
  Doppio click su una maniglia di ITEM (o il bottone Reset della riga numerica)
  = si rimuove SOLO la correzione di quell'item, che torna allo slot
  automatico. Nessun altro gruppo/item/layout viene toccato: le correzioni
  degli altri item sopravvivono.
- **Cache e persistenza**: `bit` è in allowlist e viene canonicalizzato (ordine
  per id, clamp, neutrali rimossi, garbage → vuoto esplicito): `bit` assente
  eredita mapping/config/default; `bit=` forza il layout automatico. Le preview
  inviano il vuoto esplicito quando si riunisce l'ultimo badge, senza riesumare
  le correzioni salvate; la cache distingue vuoto e assente. Persistenza:
  mapping per-titolo (`badgeItemTransforms`, flat + profilo
  `landscape`), default globali (flat + `landscape`), config token, preset
  personali (i preset ready/built-in NON portano correzioni: `default(null)` =
  layout automatico) e localStorage (`defaultBadgeItemTransforms` +
  `badgeItemTransforms`). Con niente configurato il payload/PUT resta
  byte-identico allo storico. Regola di proprietà per forma: chiave ASSENTE =
  eredita il flat (profili legacy invariati), valore concreto o `null`
  ESPLICITO del profilo `landscape` = vince (il `null` è il marcatore
  "automatico" scritto dal preset, stessa semantica di `logoScale: null`);
  tutti i consumer (builder URL di preview/Stremio, `resolvePosterRenderConfig`
  del render e la lettura di geometria dei controlli Trasforma) leggono la
  stessa regola, così il poster reso non resuscita le correzioni del flat
  portrait sopra un `null` posseduto. Anche lo stato LIVE del titolo in editing
  parte dallo stesso effettivo per forma (apertura, cambio formato, reset
  post-cover): `resolveShapeBadgeItemTransforms` in `badge-item-transforms.ts`
  è l'unica lettura, così la preview WYSIWYG emette lo stesso `bit=` che il
  server risolve dai default salvati (nessun desync con «Testa URL Stremio») e
  un titolo nuovo non eredita le correzioni del titolo aperto prima.
- **Reset canonico dei ready look**: il reset trasformazioni dei quick look
  (`quickTransformPatch`, unica fonte per Essential/Ratings/Full in entrambe le
  entry point) include `defaultBadgeItemTransforms: null`, quindi applicare un
  ready look riporta ANCHE le correzioni per-item al layout automatico del
  preset (portrait flat + profilo landscape derivato via
  `PRESET_FLAT_TO_LANDSCAPE`). I ready Apple/BetterPoster/RPDB/Fresh lo portano
  già dallo schema (`default(null)`); la mappa legacy flat→profilo del tab Badge
  (`PRESET_TO_LAND`) proietta la stessa chiave. Senza questo il campo —
  aggiunto dopo le ricette — era semplicemente assente dai quick look, e i
  consumer di apply (che copiano solo le chiavi definite) tenevano le
  correzioni live: l'URL di preview continuava a portare `bit=…` e il poster
  restava spostato, e la baseline di reset (istantanea post-apply) catturava
  quelle correzioni stantie.
- **Limiti dichiarati**: i rating separati sono composti come singole pill solo
  dove il renderer lo fa davvero (colonna Standard portrait/landscape e riga
  bottom: `bottom-bar`/`bottom-pills`/`bottom-mono`/`bottom-color`). In Fresh e
  Card gli stessi valori vivono come RIGHE di testo dentro il blocco meta o la
  banda metadata (un solo SVG/layer): lì `items[]` non li riporta e non esistono
  maniglie per-item — onestà esplicita, i trasform del gruppo (`sepox`/`sepoy`/
  `sepscale`) restano gli unici disponibili. Lo stack qualità/età/formati è
  composto separatamente in TUTTI i layout (Standard, Fresh, Card), quindi le
  maniglie per-item di qualità e marchi A/V funzionano ovunque il marchio sia
  effettivamente disegnato.

## Logo testuale (titoli senza logo TMDB)

Un titolo senza logo TMDB non ha titolo composto. Con `ltext` (testo libero, cap
stretto di 60 caratteri, spazi collassati) + `lfont` (enum dei font badge:
`inter`/`barlow-condensed`/`oswald`) il server rende il testo con i font GIÀ nel
bundle e lo usa come **sorgente logo alternativa** — nessun upload di font,
nessuna dipendenza nuova, nessun font arbitrario. Il buffer PNG trasparente
entra nel path logo esistente: stessa posizione/scala auto per aspect, stessa
velatura adattiva di contrasto, stesso compositing. Preview e Stremio restano
lo stesso renderer.

- **Precedenze**: `ltext` query > `logoText` del mapping > logo TMDB. Il testo
vince sul logo immagine (una sola sorgente logo), `logoDisabled` azzera
entrambi. Testo vuoto/blank = nessun logo (comportamento storico invariato).
- **Resa**: una riga, canvas trasparente, inchiostro bianco con alone scuro e
  l'ombra condivisa `tds`; font via `fontFamilyFor` (fallback Rubik per
  ebraico/arabo) e testo sempre passato da `escSvg` (input utente, nessuna
  iniezione SVG).
- **Cache**: `ltext`/`lfont` sono nell'allowlist della chiave e canonicalizzati
  (spazi collassati, blank = assente, `lfont` ignoto → `inter`). In presets mode
  il testo libero è canonicalizzato sul valore del mapping (assente = nessun
  logo, come `extra`): un `?ltext=$RANDOM` non frammenta la cache. Un mapping
  con `logoDisabled` non viene resuscitato dalla canonicalizzazione.
- **Persistenza**: `logoText`/`logoFont` sul mapping (save completo e cover-only,
  dove il wordmark è identità logo e il logo immagine resta vuoto).

### Wordmark automatico (titolo senza alcun logo TMDB)

Se il titolo non ha nessun logo TMDB la sorgente logo viene generata dal
TITOLO stesso: niente da digitare. Stesso trasporto/pipeline del logo testuale
(un solo renderer), ma testo derivato e resa dedicata.

- **Gate (base senza titolo cotto)**: poster clean (ramo clean), landscape
  (base = backdrop textless) e base portrait dal crop 2:3 di un backdrop,
  incluso il mapping con base congelata (`portraitBackdropPath`/`pbase`).
  MAI su un poster in lingua (titolo già stampato): lì resta il fallback
  storico senza logo. Con clean disabilitati la catena in lingua resta
  intatta. Una base custom URL non è certificabile textless → nessun
  automatico.
- **Precedenze**: logo TMDB/`logo` > `ltext`/`logoText` digitato >
  `logoDisabled` > automatico. Basta una sorgente precedente attiva per
  spegnere l'automatico (una sola sorgente logo).
- **Testo**: titolo nella lingua della richiesta (mapping/selezionato/TMDB),
  MAIUSCOLO, troncato a confine di parola a 30 caratteri di contenuto +
  ellissi `…` (30 = oltre il quale il run di Barlow Condensed uppercase
  sfonderebbe la larghezza del canvas portrait: il logo non ha cap di
  larghezza, solo 25% di altezza; 30 resta leggibile anche nel layout
  landscape 40%). Nessun rimpicciolimento illimitato: una singola parola oltre
  il bound viene tagliata dura (unico caso senza confine).
- **Resa**: Barlow Condensed Black 900 uppercase (font del bundle), tracking
  0.05em, inchiostro bianco con alone scuro e ombra `tds` condivisa, canvas
  trasparente: la ricetta del logo manuale cambia solo per tracking/font.
  Buffer nel path logo esistente (posizione/scala/velatura invariati).
- **Trasporto preview**: solo `lauto=1`, mai il testo. La preview lo emette
  quando la base mostrata è textless e non c'è logo/testo; in base auto
  (senza `poster=`) il server decide già lui. `lauto` è in allowlist e in cache
  key, canonicalizzato a `1` e solo con `title`; in presets mode (non-preview)
  viene rimosso, così un URL Stremio non può mintare un wordmark via query.
- **Persistenza**: NESSUNA. Il wordmark automatico non viene mai scritto come
  `logoText` (né dal save completo né dal cover-only): si rigenera
  deterministicamente a ogni render. Firma della cache image-level:
  `text-logo-auto:<font>:<testo>`.

## Files coinvolti

- `src/components/settings/PosterBadgeDragLayer.tsx` — overlay unico del trascinamento diretto (adattatore iniettabile)
- `src/lib/badge-drag-adapter.ts` — contratto dell'adattatore (letture + scritture del gesto)
- `src/lib/usePerTitleBadgeGeometry.ts` — adattatore per-titolo (bozza del titolo aperto, reset per-titolo)
- `src/components/PerTitleBadgeEditor.tsx` — ingresso fullscreen della preview per-titolo
- `src/components/EditView.tsx` — preview WYSIWYG (singolo `<img src={previewUrl}>`), ingresso "Modifica poster"
- `src/components/PortraitBaseBackdropPicker.tsx` — scelta del backdrop che alimenta la base portrait 2:3 (tile `PosterBtn` landscape, solo clean)
- `src/lib/context.tsx` — stato, URL builder, localStorage
- `src/lib/poster-url.ts` — `buildPreviewUrl()`, `buildUrlPattern()` (parametri client → URL server, incluso il flag preview `lauto`)
- `src/lib/badges.ts` — server-side SVG (bottomGradientSVG morto; `cinematicVignetteSVG` + `topShadeSVG` per l'ombra superiore `ts`/`tsh`)
- `src/lib/svg-badge.ts` — server-side SVG raw badges (renderGenreBadge, renderRankingBadge, renderExtraBadge) + Resvg rendering (font risolti via `FONT_FILES`, nessun embedding negli SVG; vale anche per la riga multi-rating)
- `src/lib/multi-rating-renderer.ts` — riga pill custom rating (`renderMultiRatings`, `MAX_CUSTOM_RATINGS`)
- `src/lib/separate-rating-renderer.ts` — stack colonna separati (`renderSeparateRatingStack`, bitmap unico a larghezza uniforme, logo sopra/punteggio sotto)
- `src/lib/badge-item-transforms.ts` — schema condiviso delle correzioni per SINGOLO badge (identità stabili `rating:<source>`/`quality:*`, forma wire canonica, matematica scala-attorno-al-centro + offset; in RENDER_FILES)
- `src/components/settings/BadgeItemTransformControls.tsx` — controlli numerici per item (stessi valori delle maniglie)
- `src/lib/badge-drag-geometry.ts` — geometria/box riportati, snap e contenimento del drag (incluso il parsing di `badges.items`)
- `src/lib/custom-rating/` — provider server-side (`fetchCustomRatings`, `resolveCustomRatingConfig`, `formatRating`)
- `src/lib/ratings.ts` — aggregatore voti (`fetchAggregatedRating`: routing per selezione — Cinemeta primario + join diretto senza fonti MDBList-exclusive, MDBList solo per gli irrisolti; cache solo base provider mai voto diretto; negativa con fallback nativo; budget 60/40 senza floor, `resolveRatingSources`, `pickSeparateRatings`/`formatSeparateValue`)
- `src/lib/cinemeta.ts` — voto IMDb gratis senza chiave (meta movie/series + fallback tipo, miss su meta vuoto; primario imdb-family quando richiesto; waiter coalesced abort-safe via `raceWithAbort`)
- `src/lib/simkl.ts` — voto Simkl diretto (BYOK, redirect 301 + details; solo se `simkl` in `rsrc`)
- `src/lib/anime-ratings.ts` — voti anime diretti (AniZip mapping tmdb→imdb con fallback + AniList GraphQL + Kitsu REST; solo se `anilist`/`kitsu` in `rsrc`). `anilist`/`kitsu`/`simkl` NON arrivano da MDBList: il parse resta per compatibilità
- `src/lib/badge-priority.ts` — logica priorità badge (condivisa)
- `src/lib/badge-labels.ts` — label pure client-safe (match studio/network, label premi/nomination, QID regex; foglia senza import server, in RENDER_FILES)
- `src/lib/award-ids.ts` — liste ID premi curate (Oscar/Globe/Emmy/Cannes/Venezia, namespace film/serie separati, update annuale; in RENDER_FILES)
- `src/lib/logo-layout.ts` — geometria condivisa logo preview/server
- `src/lib/text-logo.ts` — contratto del logo testuale (sanitize, cap 60, enum font) e del wordmark automatico (troncamento a confine di parola, gate/precedenze, font Barlow Condensed; client-safe, in RENDER_FILES)
- `src/lib/badge-svg-shared.ts` — ricetta SVG del wordmark (`buildTextLogoSvg`, font/escaping condivisi)
- `src/lib/svg-badge.ts` — rasterizzazione del wordmark (`buildTextLogoBuffer`, font del bundle)
- `src/lib/gradient-presets.ts` — preset sfumatura Naturale/Colore/Nero (solo client) + regola pristine al cambio artwork
- `src/app/api/poster/[type]/[id]/route.ts` — composizione poster finale (preview + Stremio usano la stessa route)
- `src/lib/poster-params-hardening.ts` — allowlist cache key, quantizzazione presets, palette `ac`, canonicalizzazione `extra`, strip override keyless (in RENDER_FILES)
- `src/lib/stremio-poster-params.ts` — `compactTuning`: omette il tuning numerico senza `config` (in RENDER_FILES)
- `e2e/pictorium-visual.spec.ts` — test di regressione visiva (screenshot) per poster e interfaccia
- `e2e/pictorium-smoke.spec.ts` — smoke test funzionali

> Dopo ogni modifica ai parametri di resa visiva in QUALSIASI file qui elencato, segui il workflow in `visual-testing.md`.
