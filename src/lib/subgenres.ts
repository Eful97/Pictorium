/**
 * Sub-genre badge detection from TMDB keywords and tags.
 * Labels use clean typography (no emoji glyphs) to ensure 100% vector-crisp Resvg rendering.
 */

export interface SubGenreRule {
  key: string
  keywords: string[]
  labels: Record<string, string>
}

const SUB_GENRES: SubGenreRule[] = [
  {
    key: "timetravel",
    keywords: ["time travel", "time loop", "time machine", "wormhole", "time manipulation"],
    labels: { it: "Viaggi nel Tempo", en: "Time Travel", fr: "Voyage temporel", de: "Zeitreise", es: "Viajes en el tiempo", he: "מסע בזמן", pl: "Podróż w czasie", ar: "سفر عبر الزمن", tr: "Zamanda Yolculuk", nl: "Tijdreizen", sv: "Tidsresor", vi: "Du hành thời gian", ja: "タイムトラベル", ko: "타임 트래블", pt: "Viagem no Tempo", cs: "Cesta časem", ro: "Călătorie în timp" },
  },
  {
    key: "cyberpunk",
    // NOTE: "dystopia/dystopian/virtual reality/artificial intelligence
    // they caused false positives on non-cyberpunk movies (e.g. The Handmaid's Tale,
    // Her, Ready Player One). Cyberpunk is distinctive enough from its core terms.
    keywords: ["cyberpunk", "android", "cybernetics"],
    labels: { it: "Cyberpunk", en: "Cyberpunk", fr: "Cyberpunk", de: "Cyberpunk", es: "Cyberpunk", he: "סייברפאנק", pl: "Cyberpunk", ar: "سايبربانك", tr: "Siberpunk", nl: "Cyberpunk", sv: "Cyberpunk", vi: "Cyberpunk", ja: "サイバーパンク", ko: "사이버펑크", pt: "Cyberpunk", cs: "Cyberpunk", ro: "Cyberpunk" },
  },

  {
    key: "whodunit",
    // NOTE: "detective" and "investigation" removed — they are too broad and
    // triggered false positives on generic police procedurals.
    keywords: ["whodunit", "murder mystery", "private investigator", "sleuth"],
    labels: { it: "Giallo", en: "Whodunit", fr: "Whodunit", de: "Whodunit", es: "Whodunit", he: "מי הרוצח", pl: "Tajemnica", ar: "من القاتل؟", tr: "Katil Kim?", nl: "Wie is de moordenaar?", sv: "Vem är mördaren?", vi: "Truy tìm hung thủ", ja: "ミステリー", ko: "미스터리", pt: "Mistério", cs: "Detektivka", ro: "Mister polițist" },
  },
  {
    key: "heist",
    keywords: ["heist", "bank robbery", "caper", "robbery", "master thief"],
    labels: { it: "Film di Rapina", en: "Heist", fr: "Film de braquage", de: "Heist", es: "Robos", he: "סרט שוד", pl: "Film z napadu", ar: "أفلام سرقة", tr: "Soygun Filmi", nl: "Overvalfilm", sv: "Kuppfilm", vi: "Phim trộm cướp", ja: "強盗映画", ko: "하이스트", pt: "Assalto", cs: "Loupež", ro: "Jaf" },
  },
  {
    key: "zombie",
    // NOTE: "infected" removed — medical/virus outbreak keywords would falsely
    // trigger the zombie badge on non-zombie contagion thrillers.
    keywords: ["zombie", "zombies", "undead", "apocalypse zombie"],
    labels: { it: "Film di Zombie", en: "Zombie", fr: "Film de zombies", de: "Zombie", es: "Zombis", he: "זומבים", pl: "Film zombie", ar: "زومبي", tr: "Zombi", nl: "Zombie", sv: "Zombies", vi: "Zombie", ja: "ゾンビ", ko: "좀비", pt: "Zumbis", cs: "Zombie", ro: "Zombi" },
  },
  {
    key: "vampire",
    keywords: ["vampire", "vampires", "dracula", "blood drinker"],
    labels: { it: "Vampiri", en: "Vampires", fr: "Vampires", de: "Vampire", es: "Vampiros", he: "ערפדים", pl: "Wampiry", ar: "مصاصو دماء", tr: "Vampirler", nl: "Vampieren", sv: "Vampyrer", vi: "Ma cà rồng", ja: "吸血鬼", ko: "흡혈귀", pt: "Vampiros", cs: "Upíři", ro: "Vampiri" },
  },
  {
    key: "paranormal",
    keywords: ["haunted house", "ghost", "demonic possession", "exorcism", "poltergeist", "supernatural horror", "paranormal"],
    labels: { it: "Paranormale", en: "Paranormal", fr: "Paranormal", de: "Paranormal", es: "Paranormal", he: "על-טבעי", pl: "Paranormalne", ar: "خوارق", tr: "Paranormal", nl: "Paranormaal", sv: "Paranormalt", vi: "Siêu nhiên", ja: "超常現象", ko: "초자연", pt: "Paranormal", cs: "Paranormální", ro: "Paranormal" },
  },
  {
    key: "kaiju",
    keywords: ["kaiju", "giant monster", "godzilla", "king kong"],
    labels: { it: "Kaiju & Mostri", en: "Kaiju & Monsters", fr: "Kaiju", de: "Kaiju", es: "Kaiju", he: "קאיג'ו ומפלצות", pl: "Kaiju i potwory", ar: "كايجو ووحوش", tr: "Kaiju ve Canavarlar", nl: "Kaiju & Monsters", sv: "Kaiju & Monster", vi: "Kaiju & Quái vật", ja: "怪獣", ko: "괴수", pt: "Kaiju", cs: "Kaiju", ro: "Kaiju" },
  },
  {
    key: "postapocalyptic",
    // NOTE: "survival horror" removed — it is a video-game genre tag that appears
    // on non-post-apocalyptic survival horror games/movies (e.g. The Descent).
    keywords: ["post-apocalyptic", "wasteland", "nuclear winter"],
    labels: { it: "Post-Apocalittico", en: "Post-Apocalyptic", fr: "Post-apocalyptique", de: "Postapokalyptisch", es: "Postapocalíptico", he: "פוסט-אפוקליפטי", pl: "Postapokaliptyczny", ar: "ما بعد نهاية العالم", tr: "Kıyamet Sonrası", nl: "Post-apocalyptisch", sv: "Postapokalyptisk", vi: "Hậu tận thế", ja: "ポストアポカリプス", ko: "종말 이후", pt: "Pós-apocalíptico", cs: "Postapokalyptický", ro: "Postapocaliptic" },
  },
  {
    key: "foundfootage",
    keywords: ["found footage", "mockumentary", "handheld camera"],
    // NOTE: "mockumentary" can appear on comedy mockumentaries (This Is Spinal Tap),
    // but these rarely overlap with TMDB horror keywords. Acceptable low risk.
    labels: { it: "Found Footage", en: "Found Footage", fr: "Found Footage", de: "Found Footage", es: "Metraje encontrado", he: "Found Footage", pl: "Found Footage", ar: "لقطات مكتشفة", tr: "Buluntu Görüntü", nl: "Found Footage", sv: "Found Footage", vi: "Found Footage", ja: "ファウンドフッテージ", ko: "파운드 푸티지", pt: "Found Footage", cs: "Found Footage", ro: "Found Footage" },
  },
  {
    key: "noir",
    keywords: ["neo-noir", "film noir", "hardboiled", "femme fatale"],
    labels: { it: "Film Noir", en: "Film Noir", fr: "Film Noir", de: "Film Noir", es: "Cine Negro", he: "Film Noir", pl: "Film noir", ar: "نوار", tr: "Kara Film", nl: "Film noir", sv: "Noir", vi: "Phim Noir", ja: "ノワール", ko: "누아르", pt: "Filme Noir", cs: "Film noir", ro: "Film noir" },
  },
  {
    key: "spaghettiwestern",
    keywords: ["spaghetti western", "gunslinger", "wild west"],
    labels: { it: "Spaghetti Western", en: "Western", fr: "Western", de: "Western", es: "Western", he: "מערבון", pl: "Spaghetti Western", ar: "ويسترن سباغيتي", tr: "Spagetti Western", nl: "Spaghettiwestern", sv: "Spaghettiwestern", vi: "Viễn Tây", ja: "マカロニウェスタン", ko: "스파게티 웨스턴", pt: "Western spaghetti", cs: "Spaghetti western", ro: "Western spaghetti" },
  },
  {
    key: "martialarts",
    keywords: ["martial arts", "kung fu", "karate", "samurai", "ninja"],
    labels: { it: "Arti Marziali", en: "Martial Arts", fr: "Arts martiaux", de: "Kampfsport", es: "Artes marciales", he: "אומנויות לחימה", pl: "Sztuki walki", ar: "فنون قتالية", tr: "Dövüş Sanatları", nl: "Vechtsport", sv: "Kampsport", vi: "Võ thuật", ja: "武術", ko: "무술", pt: "Artes Marciais", cs: "Bojová umění", ro: "Arte marțiale" },
  },
  {
    key: "spaceopera",
    // NOTE: "space travel", "alien invasion", and "spacecraft" removed — they
    // flagged hard sci-fi (The Martian, Interstellar) and alien-invasion action
    // as space opera. Core terms are sufficient for Star Wars / Mandalorian / Trek.
    keywords: ["space opera", "space western", "intergalactic"],
    labels: { it: "Space Opera", en: "Space Opera", fr: "Space Opera", de: "Space Opera", es: "Space Opera", he: "אופרת חלל", pl: "Space opera", ar: "أوبرا فضائية", tr: "Uzay Operası", nl: "Spaceopera", sv: "Rymdopera", vi: "Space Opera", ja: "スペースオペラ", ko: "스페이스 오페라", pt: "Space Opera", cs: "Vesmírná opera", ro: "Operă spațială" },
  },
  // Appended after the original rules on purpose: measured on 342 real TMDB
  // titles, appending adds badges to titles that had none and displaces zero
  // existing badges. Inserting earlier would steal noir/paranormal/martialarts
  // badges from titles that already show them.
  {
    key: "superhero",
    // NOTE: "based on comic" removed — it flagged non-superhero comic
    // adaptations (Fighting Spirit, Mob Psycho 100). The single word
    // "superhero" also covers "masked superhero", "teen superhero" and
    // "superhero team" through word-boundary matching.
    keywords: ["superhero"],
    labels: { it: "Supereroi", en: "Superhero", fr: "Super-héros", de: "Superhelden", es: "Superhéroes", he: "גיבורי-על", pl: "Superbohaterowie", ar: "أبطال خارقون", tr: "Süper Kahramanlar", nl: "Superhelden", sv: "Superhjältar", vi: "Siêu anh hùng", ja: "スーパーヒーロー", ko: "슈퍼히어로", pt: "Super-heróis", cs: "Superhrdinové", ro: "Supereroi" },
  },
  {
    key: "mafia",
    keywords: ["mafia", "yakuza", "gangster", "organized crime"],
    labels: { it: "Mafia", en: "Mafia", fr: "Mafia", de: "Mafia", es: "Mafia", he: "מאפיה", pl: "Mafia", ar: "مافيا", tr: "Mafya", nl: "Maffia", sv: "Maffia", vi: "Mafia", ja: "マフィア", ko: "마피아", pt: "Máfia", cs: "Mafie", ro: "Mafie" },
  },
  {
    key: "spy",
    keywords: ["spy", "secret agent", "espionage"],
    labels: { it: "Spionaggio", en: "Spy", fr: "Espionnage", de: "Spionage", es: "Espionaje", he: "ריגול", pl: "Szpiedzy", ar: "تجسس", tr: "Casusluk", nl: "Spionage", sv: "Spioner", vi: "Điệp viên", ja: "スパイ", ko: "스파이", pt: "Espionagem", cs: "Špionáž", ro: "Spionaj" },
  },
  {
    key: "prison",
    // NOTE: "prisoner" removed — it flagged "concentration camp prisoner"
    // (Life Is Beautiful) and "prisoner of war" (The Pianist).
    keywords: ["prison", "penitentiary"],
    labels: { it: "Prigione", en: "Prison", fr: "Prison", de: "Gefängnis", es: "Cárcel", he: "כלא", pl: "Więzienie", ar: "سجون", tr: "Hapishane", nl: "Gevangenis", sv: "Fängelse", vi: "Nhà tù", ja: "刑務所", ko: "감옥", pt: "Prisão", cs: "Vězení", ro: "Închisoare" },
  },
  {
    key: "courtroom",
    // NOTE: "trial" removed — it adds no title this rule doesn't already
    // catch and would flag "trial by combat" outside a courtroom setting.
    keywords: ["courtroom", "courtroom drama"],
    labels: { it: "Tribunale", en: "Courtroom", fr: "Procès", de: "Gerichtssaal", es: "Tribunal", he: "בית משפט", pl: "Sala sądowa", ar: "قاعة المحكمة", tr: "Mahkeme Salonu", nl: "Rechtszaal", sv: "Rättegång", vi: "Phòng xử án", ja: "法廷", ko: "법정", pt: "Tribunal", cs: "Soudní síň", ro: "Sala de tribunal" },
  },
  {
    key: "slasher",
    // "slasher" also covers "slasher horror" and "proto-slasher" (hyphen is a
    // word boundary), so the single term is the whole rule.
    keywords: ["slasher"],
    labels: { it: "Slasher", en: "Slasher", fr: "Slasher", de: "Slasher", es: "Slasher", he: "סלאשר", pl: "Slasher", ar: "سلايشر", tr: "Slasher", nl: "Slasher", sv: "Slasher", vi: "Slasher", ja: "スラッシャー", ko: "슬래셔", pt: "Slasher", cs: "Slasher", ro: "Slasher" },
  },
  {
    key: "werewolf",
    keywords: ["werewolf"],
    labels: { it: "Licantropi", en: "Werewolf", fr: "Loup-garou", de: "Werwolf", es: "Hombres lobo", he: "אדם זאב", pl: "Wilkołaki", ar: "مستذئبون", tr: "Kurt Adam", nl: "Weerwolf", sv: "Varulv", vi: "Người sói", ja: "狼男", ko: "늑대인간", pt: "Lobisomem", cs: "Vlkodlaci", ro: "Vârcolaci" },
  },
  {
    key: "bodyhorror",
    keywords: ["body horror"],
    labels: { it: "Body Horror", en: "Body Horror", fr: "Body Horror", de: "Body Horror", es: "Body Horror", he: "אימה גופנית", pl: "Body horror", ar: "رعب جسدي", tr: "Beden Korku", nl: "Body horror", sv: "Body horror", vi: "Kinh dị cơ thể", ja: "ボディホラー", ko: "바디 호러", pt: "Body Horror", cs: "Body horror", ro: "Body horror" },
  },
]

function matchKeywordPattern(keyword: string, kwPattern: string): boolean {
  // Word-boundary matching for all patterns prevents substring false
  // positives (e.g. "ghost" matching "ghostbusters").
  const escaped = kwPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`\\b${escaped}\\b`, "i")
  return regex.test(keyword)
}

export function getSubGenreLabel(keywords: string[], locale = "it"): string | null {
  return getSubGenreMatch(keywords, locale)?.label ?? null
}

/**
 * Localized label for a canonical sub-genre key (settings UI rows). Same
 * labels as the badges, never a match: unknown keys → null.
 */
export function getSubGenreLabelByKey(key: string, locale = "it"): string | null {
  const sub = SUB_GENRES.find((s) => s.key === key)
  if (!sub) return null
  const lang = (locale || "it").slice(0, 2)
  return sub.labels[lang] || sub.labels.it
}

/**
 * Canonical sub-genre match: the stable `SUB_GENRES[].key` alongside the
 * localized label. Space-wide exclusions (`disabledContentTags`) filter on
 * the key (`subgenre:<key>` or the `subgenre` family) — never on the
 * localized label, which moves with the UI language.
 */
export function getSubGenreMatch(
  keywords: string[],
  locale = "it",
): { key: string; label: string } | null {
  return getAllSubGenreMatches(keywords, locale)[0] ?? null
}

/**
 * Every canonical sub-genre match in rule-priority order (same labels as
 * `getSubGenreMatch`). The auto badge picks the first match that is not
 * disabled space-wide, so a disabled first keyword yields to the next
 * enabled sub-genre before lower-priority buckets (true story, book, …).
 * The manual dropdown keeps offering every computed label (authoritative
 * explicit choices are never filtered here).
 */
export function getAllSubGenreMatches(
  keywords: string[],
  locale = "it",
): { key: string; label: string }[] {
  if (!keywords || !keywords.length) return []
  const normalized = keywords.map((k) => k.toLowerCase().trim())
  const lang = (locale || "it").slice(0, 2)
  const out: { key: string; label: string }[] = []
  for (const sub of SUB_GENRES) {
    if (sub.keywords.some((kwPattern) => normalized.some((nk) => matchKeywordPattern(nk, kwPattern)))) {
      // Tutte le 17 lingue UI canoniche hanno i 22 label; locale non
      // supportati ripiegano sull'italiano.
      out.push({ key: sub.key, label: sub.labels[lang] || sub.labels.it })
    }
  }
  return out
}
