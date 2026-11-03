# Bundled fonts

Scaricati da `node scripts/download-fonts.mjs`, versionati nel repo perché il
render dei poster (`src/lib/fonts.ts` → resvg) li legge da disco con
`loadSystemFonts: false`: senza i file il badge esce vuoto.

| File | Famiglia | Licenza | Uso |
|---|---|---|---|
| `Inter-Regular.ttf`, `Inter-Bold.ttf`, `Inter-Black.ttf` | Inter | SIL Open Font License 1.1 | Testo latino di tutti i badge (pesi 400/700/900) |
| `NotoSansSymbols2-Regular.ttf` | Noto Sans Symbols 2 | SIL Open Font License 1.1 | Glifo stella ★ del badge genere |
| `Rubik-Regular.ttf`, `Rubik-Bold.ttf`, `Rubik-Black.ttf` | Rubik | SIL Open Font License 1.1 | Testo ebraico e arabo: Inter non ha questi glifi |
| `BarlowCondensed-Regular.ttf`, `BarlowCondensed-Bold.ttf`, `BarlowCondensed-Black.ttf` | Barlow Condensed (expo-google-fonts 0.4.1) | SIL Open Font License 1.1 | Selettore "Font dei badge" (pesi 400/700/900) |
| `Oswald-Regular.ttf`, `Oswald-SemiBold.ttf`, `Oswald-Bold.ttf` | Oswald (expo-google-fonts 0.4.2) | SIL Open Font License 1.1 | Selettore "Font dei badge" (pesi 400/600/700; il 900 risolve sul Bold) |

Rubik copre latino, ebraico e arabo. resvg fa fallback per-glifo sull'intero fontdb,
quindi la sola presenza dei file evita i quadratini anche dove `font-family`
resta `Inter` — ma quel fallback ignora il peso richiesto e ripiega sempre sul
regular, per questo `fontFamilyFor` (in `src/lib/badge-svg-shared.ts`) dichiara
`Rubik` esplicitamente quando il testo contiene ebraico.

## Licenze (testi completi vendorizzati)

I testi integrali della SIL Open Font License 1.1, con gli avvisi di copyright
delle versioni effettivamente incluse, sono vendorizzati byte-identici alle
fonti autorevoli in [`licenses/`](licenses) (verifica: 2026-10-12). Ogni testo
contiene le sezioni complete PREAMBLE, DEFINITIONS, PERMISSION & CONDITIONS
(nel testo Inter pinnato intitolata `PERMISSION AND CONDITIONS`, riga 48),
TERMINATION e DISCLAIMER; nessuno dichiara un Reserved Font Name (la locuzione
compare solo nel boilerplate DEFINITIONS, nessuna riga `with Reserved Font
Name ...`). I binari dei
font non sono stati modificati (SHA256 prima/dopo identici, vedi sotto).

| Famiglia | Testo | SHA256 | Fonte autorevole (revisione immutabile) | Copyright nel testo |
|---|---|---|---|---|
| Inter | [`licenses/OFL-Inter.txt`](licenses/OFL-Inter.txt) | `4d7d9c95e7d7f2f0ebf76d5e0b344826b74e903a34028ee18ab54bb639e45906` | `https://raw.githubusercontent.com/rsms/inter/5fa70f6e8c0ecad97544e19aba2d5062aa8c3e7a/LICENSE.txt` (tag `v3.19`, commit `5fa70f6e8c0ecad97544e19aba2d5062aa8c3e7a`) | Copyright (c) 2016-2020 The Inter Project Authors. |
| Noto Sans Symbols 2 | [`licenses/OFL-NotoSansSymbols2.txt`](licenses/OFL-NotoSansSymbols2.txt) | `b118dd41337806a5d4797052c77caf3bd096aed783e5eb21b4d11154351e1ac0` | `https://raw.githubusercontent.com/google/fonts/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/notosanssymbols2/OFL.txt` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/symbols) |
| Rubik | [`licenses/OFL-Rubik.txt`](licenses/OFL-Rubik.txt) | `472cbe7c25441df63e9c7864b43eb3c0f4b3df950c66a76224e6cfe1eae843fb` | `https://raw.githubusercontent.com/google/fonts/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/rubik/OFL.txt` | Copyright 2015 The Rubik Project Authors (https://github.com/googlefonts/rubik) |
| Barlow Condensed | [`licenses/OFL-BarlowCondensed.txt`](licenses/OFL-BarlowCondensed.txt) | `186d750eb496a4c17a76385f82be6aea2ac1cf2de074a811d63786cf374ea73f` | `https://raw.githubusercontent.com/google/fonts/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/barlowcondensed/OFL.txt` | Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow) |
| Oswald | [`licenses/OFL-Oswald.txt`](licenses/OFL-Oswald.txt) | `0fd731a904b729a4e02eaf5e8ebd06783edd9abe400e8882760160230675b652` | `https://raw.githubusercontent.com/google/fonts/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/oswald/OFL.txt` | Copyright 2016 The Oswald Project Authors (https://github.com/googlefonts/OswaldFont) |

Perché Inter punta a `v3.19` e non a `master`: i binari inclusi sono Inter
3.019 (name table: `Copyright 2020 The Inter Project Authors`), mentre il
`LICENSE.txt` di `master` (linea v4.x) riporta solo `Copyright (c) 2016 ...`.
Il testo del tag `v3.19` (`Copyright (c) 2016-2020 ...`, stesso titolare)
copre la linea 3.019 inclusa. I quattro testi da `google/fonts` sono identici
(byte) sia alla revisione pinnata `bd8f81ddb5c74d5c8897b36ad88b440266245103`
(HEAD di `main` al 2026-10-09) sia a `main` al momento della verifica, e le
loro righe di copyright sono identiche alle name table incorporate.

## Provenienza dei binari (copyright/versione dalla name table, 2026-10-12)

| File | Versione (nameID5) | Copyright (nameID0) | Sorgente distribuzione (`scripts/download-fonts.mjs`) | Prova di identità |
|---|---|---|---|---|
| `Inter-Regular.ttf` | Version 3.019;git-0a5106e0b | Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter) | jsDelivr `@expo-google-fonts/inter` non versionato (layout flat pre-0.3.x) | byte-identico a `@expo-google-fonts/inter@0.2.3/Inter_400Regular.ttf` |
| `Inter-Bold.ttf` | Version 3.019;git-0a5106e0b | Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter) | jsDelivr `@expo-google-fonts/inter` non versionato (layout flat pre-0.3.x) | byte-identico a `@expo-google-fonts/inter@0.2.3/Inter_700Bold.ttf` |
| `Inter-Black.ttf` | Version 3.019;git-0a5106e0b | Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter) | jsDelivr `@expo-google-fonts/inter` non versionato (layout flat pre-0.3.x) | byte-identico a `@expo-google-fonts/inter@0.2.3/Inter_900Black.ttf` |
| `NotoSansSymbols2-Regular.ttf` | Version 2.008; ttfautohint (v1.8.4.7-5d5b) | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/symbols) | `raw.githubusercontent.com/google/fonts/main/ofl/notosanssymbols2/` | byte-identico a `google/fonts@bd8f81dd/.../NotoSansSymbols2-Regular.ttf` |
| `Rubik-Regular.ttf` | Version 2.300;gftools[0.9.30] | Copyright 2015 The Rubik Project Authors (https://github.com/googlefonts/rubik) | `fonts.gstatic.com/s/rubik/v31/...` (URL statici) | copyright incorporato identico a `OFL-Rubik.txt` (associazione via copyright: l'OFL non dichiara versioni; canale gstatic senza artefatto versionato confrontabile) |
| `Rubik-Bold.ttf` | Version 2.300;gftools[0.9.30] | Copyright 2015 The Rubik Project Authors (https://github.com/googlefonts/rubik) | `fonts.gstatic.com/s/rubik/v31/...` (URL statici) | come sopra |
| `Rubik-Black.ttf` | Version 2.300;gftools[0.9.30] | Copyright 2015 The Rubik Project Authors (https://github.com/googlefonts/rubik) | `fonts.gstatic.com/s/rubik/v31/...` (URL statici) | come sopra |
| `BarlowCondensed-Regular.ttf` | Version 1.408 | Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow) | jsDelivr `@expo-google-fonts/barlow-condensed@0.4.1` | byte-identico all'URL pinnato `...@0.4.1/400Regular/...` |
| `BarlowCondensed-Bold.ttf` | Version 1.408 | Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow) | jsDelivr `@expo-google-fonts/barlow-condensed@0.4.1` | byte-identico all'URL pinnato `...@0.4.1/700Bold/...` |
| `BarlowCondensed-Black.ttf` | Version 1.408 | Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow) | jsDelivr `@expo-google-fonts/barlow-condensed@0.4.1` | byte-identico all'URL pinnato `...@0.4.1/900Black/...` |
| `Oswald-Regular.ttf` | Version 4.103;gftools[0.9.33.dev8+g029e19f] | Copyright 2016 The Oswald Project Authors (https://github.com/googlefonts/OswaldFont) | jsDelivr `@expo-google-fonts/oswald@0.4.2` | byte-identico all'URL pinnato `...@0.4.2/400Regular/...` |
| `Oswald-SemiBold.ttf` | Version 4.103;gftools[0.9.33.dev8+g029e19f] | Copyright 2016 The Oswald Project Authors (https://github.com/googlefonts/OswaldFont) | jsDelivr `@expo-google-fonts/oswald@0.4.2` | byte-identico all'URL pinnato `...@0.4.2/600SemiBold/...` |
| `Oswald-Bold.ttf` | Version 4.103;gftools[0.9.33.dev8+g029e19f] | Copyright 2016 The Oswald Project Authors (https://github.com/googlefonts/OswaldFont) | jsDelivr `@expo-google-fonts/oswald@0.4.2` | byte-identico all'URL pinnato `...@0.4.2/700Bold/...` |

SHA256 dei binari (verifica 2026-10-12, identici prima/dopo questa modifica):

| SHA256 | File |
|---|---|
| `41ab0f707a2bfab8133ccdfcdab52282f5f79e5751f43a264805451c7bb95fb8` | `Inter-Regular.ttf` |
| `790c108befe859dac2ddbd20af3fbb6917c601b3d544c8a05761519f3b5508fe` | `Inter-Bold.ttf` |
| `3afb2b056547597bb7917bf754bd42f3ebbf4b32560902e556b16f1b6e66b758` | `Inter-Black.ttf` |
| `7d5fb73b7ca67a6798101741f5d280a3d016a56a197afcd4199dbb57b4b82a21` | `NotoSansSymbols2-Regular.ttf` |
| `cc6a4222027f8e57ff86a50c5ba88f12326d7223bde9bf6531538633ebad3343` | `Rubik-Regular.ttf` |
| `2d6393d64232ea3e0eeff79165d80df61c0859213abdd638b0ec1e81d21098dc` | `Rubik-Bold.ttf` |
| `09a739c4c59a0d13dc22a72b8e0949f16eabc92d3de3ee0bc9cb8fb697c4e1ef` | `Rubik-Black.ttf` |
| `dd8271eb0ced7add028539113155a99000c1e62dee2dc48a1b2765c00f4862ab` | `BarlowCondensed-Regular.ttf` |
| `53550669f93c07de6221e051905462f862066459eb50148268b5628104a58a30` | `BarlowCondensed-Bold.ttf` |
| `f93d540611df31c8a105889df111a8bd400c0b50b9c120028b4aab5ff659e1cd` | `BarlowCondensed-Black.ttf` |
| `147373bfe10a9b1e0eb649bcf6408566d0cb7334271845f24d4c224cca1c4412` | `Oswald-Regular.ttf` |
| `901c0d593fcb06080fd49d01262391254e472efd4e1d21734557e9ef869922d6` | `Oswald-SemiBold.ttf` |
| `21843a0ccca2e97030da1330961646510ed6e9b8bb39620974c1195b9803034a` | `Oswald-Bold.ttf` |

## Copertura glifi e limiti di una "dieta" dei font (audit 2026-11-03)

Stato dell'audit: **nessun binario modificato**. I 13 TTF restano byte-identici
(SHA256 riverificati il 2026-11-03: 13/13 corrispondono alla tabella sopra; i 13
hash sono tutti distinti, quindi non esiste un file duplicato da eliminare) e
`RENDER_VERSION` non cambia.

### Copertura misurata (cmap reale dei TTF, non stime)

| Famiglia (pesi) | Peso | Code point mappati | Fasce principali |
|---|---|---|---|
| Inter (3) | 920,2 KiB | 2.505 | Latin Ext-A 127, Latin Ext-B 207, Latin Ext-Add 256 (vietnamita), greco 121, cirillico 254, punteggiatura 85, frecce 28, dingbats 13 |
| Noto Sans Symbols 2 (1) | 1.204,2 KiB | 2.955 | simboli geometrici 96, simboli vari 121, dingbats 145, tecnici 37, frecce 13 |
| Rubik (3) | 513,5 KiB | 885 | ebraico 47, arabo 89 (+ forme di presentazione 106), cirillico 176, Latin Ext-A 126 |
| Barlow Condensed (3) | 299,6 KiB | 525 | Latin Ext-A 119, Latin Ext-B 22 |
| Oswald (3) | 256,3 KiB | 850 | Latin Ext-A 128, Latin Ext-B 80, cirillico 222 |

Totale 3.193,8 KiB (3,12 MiB), di cui Noto Symbols 2 da solo il 37,7%.

Copertura delle etichette reali dei badge per lingua UI (19 lingue):

| Lingue | Font che le copre |
|---|---|
| `en it fr de es es-419 pt pt-br nl sv` | tutte le famiglie |
| `pl cs ro tr` | tutte (Latin Ext-A/B) |
| `vi` (`ạ ả ấ … ự`) | Inter, Barlow Condensed, Oswald (Noto e Rubik ne coprono 6/40) |
| `he ar` | solo Rubik |
| `ja ko` | **nessuna famiglia** (0 glifi Hiragana/Katakana/Hangul/CJK) |

Simboli (testo libero): Inter ha `★ ✓ → • … €`, Noto Symbols 2 ha
`★ ✦ ✧ ✓ ✔ • … €`. `✦ ✧ ✔` esistono **solo** in Noto e `→` **solo** in Inter:
i due font si completano, nessuno dei due è ridondante. La stella del badge
genere è già un path SVG, quindi Noto serve al caso comune solo come fail-safe.

### Perché il subset "solo lingue UI" è rifiutato

1. **Inter è l'unico font sempre caricato** (`fontFilesFor` in `src/lib/fonts.ts`
   mette sempre il gruppo Inter nel fontdb). Toglierle greco, cirillico o il
   blocco Latin Extended-Additional (vietnamita, coperto solo da Inter/Barlow/
   Oswald) rimuove copertura che oggi funziona — non solo per le lingue UI.
2. **Il testo libero non è vincolato alle 19 lingue**: `ltext` (fino a 60
   caratteri, `TEXT_LOGO_MAX_LENGTH` in `src/lib/text-logo.ts`), `label`/`extra`
   manuali, `customBadge` e il wordmark automatico derivato dal titolo TMDB
   possono essere in qualsiasi scrittura. Caso misto reale: una stringa con
   ebraico/arabo più parole cirilliche fa scegliere `Rubik` a `fontFamilyFor`
   per TUTTA la stringa, quindi la parte cirillica la deve rendere Rubik stesso
   (che la copre): un subset Rubik latino+ebraico+arabo la romperebbe.
3. **Noto Symbols 2 è il fail-safe dichiarato**: `mayNeedSymbolFallback`
   (`src/lib/svg-badge.ts`) tiene il font nel fontdb appena il testo esce dalle
   fasce note (ASCII, latin-ext, Latin Ext-Add, greco, cirillico, ebraico,
   arabo, punteggiatura, forme di presentazione). Ridurlo trasformerebbe
   caratteri oggi dipinti in tofu.
4. **ja/ko non migliora con un subset**: nessun font bundle ha glifi CJK, quindi
   le etichette ja/ko sono già senza glifo (lacuna preesistente, invariata). Un
   subset latin-only non toglie nulla lì e peggiora tutto il resto: la lacuna si
   chiude solo aggiungendo una faccia CJK (decisione di peso/licenza), mai
   rimpicciolendo le altre.

### Passo "dieta" rimandato (gate pending): fontTools assente

`python -m fontTools.subset` non è installato su questa macchina (verificato il
2026-11-03: `ModuleNotFoundError: No module named 'fontTools'`), quindi nessuna
tabella è stata riscritta a mano. Installazione (NON eseguita: aggiunge una
dipendenza di build locale, richiede approvazione esplicita):

```bash
python -m pip install fonttools==4.59.4
```

Procedura conservativa ammessa (vale solo se produce PNG byte-identici su tutti
i golden: diversamente si torna indietro):

- `--unicodes=` con l'**unione** dei code point già mappati (nessun glifo
  rimosso), oppure nessuno subsetting affatto;
- mai toccare `name` (fontdb/resvg risolvono la famiglia da lì), `GPOS`/`GSUB`
  (kerning e shaping arabo/ebraico), `glyf`/`loca`/`cmap`/`head`/`hhea`/`hmtx`/
  `maxp`/`OS/2`;
- risparmi realmente misurati: `post` (nomi dei glifi, ~164 KiB sui 13 file;
  il formato 3 evita i nomi, che il rasterizzatore non usa — da provare col
  confronto PNG, non da assumere) e le tabelle di hinting `fpgm`/`prep`/
  `cvt ` (~15 KiB). resvg non applica hinting, ma anche qui la prova richiesta
  resta il confronto PNG;
- `DSIG` non esiste in nessuno dei 13 file (verificato), quindi non c'è nulla da
  buttare lì;
- i binari cambiati vanno rigenerati con `node scripts/write-render-version.mjs`
  (i TTF sono in `RENDER_FILES`), poi SHA256 in questo README, test narrow
  (`polish-font-coverage`, `badge-font`, `hebrew-badges`, `arabic-badges`,
  `render-version-files`) e gate visuale.

Tetto realistico senza toccare i glifi: ~179 KiB su 3.270.492 byte (5,6%), a
fronte di un invalidamento completo di `RENDER_VERSION` (tutte le cache poster).
