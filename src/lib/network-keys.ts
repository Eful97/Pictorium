/**
 * Client-safe canonical network-mark registry (ID ↔ display name).
 *
 * The 76 canonical keys match `NETWORK_MARK_FILES` in `network-files.ts`
 * entry for entry (the single shared filename registry for the bundled
 * `public/networks/` marks, studios included). Display names are
 * proper nouns — identical in every UI language (like the Card skin names),
 * so no i18n keys are needed for the rows.
 *
 * The matcher (`getNetworkKey`) is the SINGLE name→key resolver: it used to
 * live in `network-svgs.ts` (server-only: fs/sharp) and moved here verbatim
 * so both the renderer and the settings UI share it. Never fork the match
 * logic — `network-svgs.ts` re-exports it from here.
 */

/**
 * Name → canonical network key. Pure string matching, no I/O.
 * Moved verbatim from `network-svgs.ts` — keep both in sync by importing,
 * never by copying.
 */
export function getNetworkKey(networkName: string): string | null {
  const lower = networkName.toLowerCase().trim()
  if (lower.includes("netflix")) return "netflix"
  if (lower.includes("hbo") || lower === "max") return "hbo"
  // MGM+ (ex Epix) va prima del generico MGM/Amazon MGM → mgm_plus
  if (lower.includes("mgm+") || lower.includes("mgm plus") || lower === "mgm+" || lower === "mgm plus") return "mgm_plus"
  // Verity: Amazon MGM è identità studio dedicata, non disponibilità Prime Video.
  // "Amazon MGM Studios" contiene "amazon" ma non deve finire sul logo Prime:
  // usa l'asset dedicato Amazon_MGM_Studios_Logo_2.svg (trattamento monocromo
  // adattivo come gli altri, nessun keepColor/oro).
  if (/\bamazon[\s-]+mgm\b/.test(lower)) return "amazon_mgm"
  // Walt Disney Pictures va prima di Disney generico per non clashare con Disney+
  if (lower.includes("walt disney")) return "disney_pictures"
  if (lower.includes("disney")) return "disney"
  // Falso positivo anime/giapponese: WOWOW Prime (canale premium JP, es. Cowboy Bebop
  // TMDB 30991: TV Tokyo + WOWOW Prime) contiene "prime" ma non è Prime Video.
  // Nessun SVG WOWOW: null così passa al fallback TMDB (logo vero) invece del logo Prime.
  if (lower.includes("wowow")) return null
  if (lower.includes("prime") || lower.includes("amazon")) return "prime"
  if (lower.includes("apple")) return "apple"
  // Lockup combinato Paramount+ / Showtime: nome TMDB letterale (rete unica
  // risultante dalla fusione) PRIMA del generico paramount, altrimenti
  // "Paramount+ with Showtime" collasserebbe su `paramount` perdendo Showtime.
  if (lower.includes("paramount+ with showtime") || lower.includes("paramount plus with showtime")) return "paramount_showtime"
  if (lower.includes("paramount")) return "paramount"
  if (lower === "rai" || lower.startsWith("rai ")) return "rai"
  if (lower.includes("crunchyroll")) return "crunchyroll"
  if (lower.includes("mediaset")) return "mediaset"
  if (lower.includes("tubi")) return "tubi"
  if (lower.includes("pluto")) return "pluto"
  // Filtro anime: SKY PerfecTV! (sat giapponese) condivide nome con Sky EU ma è servizio diverso.
  if (lower.includes("sky perfec")) return null
  if (lower.includes("sky cinema")) return "sky_cinema"
  // NOW è lo stesso servizio di Sky (streaming Sky) → stesso logo, alias a sky.
  // Word boundary per evitare falsi positivi tipo "Skydance".
  // NOW matchato solo quando il nome inizia con "now" (NOW / Now TV), non la parola ovunque
  // (evita falsi positivi tipo "Don't Look Now").
  if (/\bsky\b/.test(lower) || lower === "now" || lower.startsWith("now ")) return "sky"
  // Filtro anime: ABC Animation (Asahi, produttore anime) condivide sigla con ABC USA.
  // Escludiamo esplicitamente prima del match ABC per evitare logo ABC USA su poster anime.
  if (lower.includes("abc animation")) return null
  // Word boundary per evitare falsi positivi: "amc" dentro parole composte,
  // "abc" in sigle/parole, "fx" in titoli tipo "The X-Files" spin-off ecc.
  if (/\bamc\+?\b/.test(lower)) return "amc"
  if (/\babc\b/.test(lower) || lower.includes("american broadcasting")) return "abc"
  if (/\bcbs\b/.test(lower)) return "cbs"
  if (lower.includes("20th century") || lower.includes("century studios")) return "century"
  // Filtro anime: White Fox (studio di Re:Zero) contiene "fox" ma non è FOX network USA.
  if (lower.includes("white fox")) return null
  if (/\bfox\b/.test(lower) || lower === "fox network" || lower.startsWith("fox ")) return "fox"
  if (/\bfxx?\b/.test(lower)) return "fx"
  if (lower.includes("hulu")) return "hulu"
  if (lower.includes("national geographic") || /\bnat\s?geo\b/.test(lower)) return "natgeo"
  // Peacock is NBCUniversal's streaming brand: match it BEFORE the generic
  // NBC rules below so "Peacock" / "NBCUniversal Peacock" resolve to the
  // dedicated mark instead of the NBC mark. A bare "NBCUniversal" (no
  // Peacock) still falls through to nbc.
  if (lower.includes("peacock")) return "peacock"
  if (lower.includes("nbcuniversal")) return "nbc"
  if (/\bnbc\b/.test(lower)) return "nbc"
  if (lower === "mbs" || lower.includes("mainichi")) return "mbs"
  if (/\bshowtime\b/.test(lower)) return "showtime"
  // Filtro anime: Nippon Columbia (etichetta musicale anime) vs Columbia Pictures.
  // Solo "columbia pictures" deve mappare a columbia, per evitare logo Columbia su OST anime.
  if (lower.includes("nippon columbia")) return null
  if (lower.includes("warner bros")) return "warner"
  if (lower.includes("universal pictures")) return "universal"
  if (lower.includes("columbia pictures")) return "columbia"
  if (lower.includes("marvel")) return "marvel"
  if (
    lower.includes("dc studios") ||
    lower.includes("dc films") ||
    lower.includes("dc entertainment") ||
    lower.includes("dc comics") ||
    lower.includes("dc universe") ||
    lower === "dc"
  ) return "dc"
  if (lower.includes("pixar")) return "pixar"
  // Filtro Sony Music (anime) vs Sony Pictures (film) — non mostrare Sony per OST anime
  if (lower.includes("sony music")) return null
  if (/\bsony\b/.test(lower)) return "sony"
  if (lower === "a24" || lower.includes("a24")) return "a24"
  if (lower.includes("legendary")) return "legendary"
  if (lower.includes("lionsgate")) return "lionsgate"
  if (lower.includes("fandango")) return "fandango"
  if (lower.includes("medusa")) return "medusa"
  if (lower.includes("ghibli") || lower.includes("studio ghibli")) return "ghibli"
  if (lower.includes("lucasfilm")) return "lucasfilm"
  if (lower.includes("miramax")) return "miramax"
  if (lower.includes("metro-goldwyn") || lower.includes("metro goldwyn") || /\bmgm\b/.test(lower)) return "mgm"
  if (lower.includes("castle rock")) return "castle_rock"
  if (lower.includes("dreamworks")) return "dreamworks"
  if (lower.includes("indiana")) return "indiana"
  if (lower.includes("taodue")) return "taodue"
  if (lower.includes("bandai")) return "bandai"
  if (lower.includes("mappa")) return "mappa"
  if (lower.includes("madhouse")) return "madhouse"
  if (lower.includes("skydance")) return "skydance"
  if (lower.includes("studiocanal") || lower.includes("studio canal") || lower.includes("studio-canal")) return "studiocanal"
  if (lower.includes("big talk")) return "bigtalk"
  // Frasi intere distintive: "bat" da solo o "horror" da solo non devono matchare.
  if (lower.includes("bat in the sun")) return "batinthesun"
  if (lower.includes("horror section")) return "horrorsection"
  if (lower.includes("direzione generale") || lower.includes("cinema e audiovisivo") || lower.includes("dg cinema")) return "dg_cinema"
  // Nuovi loghi mappati (file in public/networks/): frasi distintive per
  // evitare falsi positivi, stesso pattern di batinthesun/horrorsection.
  if (lower.includes("new line")) return "new_line"
  if (lower.includes("jagged edge")) return "jagged_edge"
  if (lower.includes("gracie")) return "gracie"
  if (lower.includes("deseo")) return "deseo"
  if (lower.includes("bellanova")) return "bellanova"
  // Anton: strict word boundary — "Danton"/"Antonia"/"Stanton" must NOT match.
  if (/\banton\b/.test(lower)) return "anton"
  // CoMix Wave Films: full "comix wave" phrase (with or without "Films") —
  // generic "Wave"/"Films" alone must NOT match.
  if (lower.includes("comix wave")) return "comix_wave"
  if (lower.includes("filmauro")) return "filmauro"
  // Next Entertainment World (NEW): full-phrase match only — a bare /new/
  // matcher would collide with New Line Cinema and generic "New …" names.
  if (lower.includes("next entertainment world")) return "next_ent"
  // Studio Bones (anime studio, yellow-square "bones" wordmark): strict word
  // boundary — "Heartbones Entertainment" and other embedded tokens must NOT match.
  if (/\bbones\b/.test(lower)) return "bones"
  // Argos: strict word boundary — "Argos"/"ARGOS" match; embedded tokens
  // like "Argosy" never match (no boundary before a word char).
  if (/\bargos\b/.test(lower)) return "argos"
  // Real Time (Italian TV channel): full-phrase match only — a bare
  // "Real"/"Time" or unrelated "…time" names must NOT match.
  if (lower.includes("real time")) return "real_time"
  // Curated 2026-10 additions (bundled SVG marks in public/networks/):
  // Discovery+ — match ONLY the plus family ("Discovery+", "DiscoveryPlus",
  // "Discovery Plus"). A bare "Discovery Channel" / "Discovery" (no plus)
  // is NOT this brand: return null so it falls through to the TMDB fallback
  // (real logo) instead of the Discovery+ mark.
  if (lower.includes("discovery+") || lower.includes("discoveryplus") || lower.includes("discovery plus")) return "discovery_plus"
  // BBC — strict word boundary ("BBC One", "BBC iPlayer" match; substrings
  // like "CBeebies"-style compounds without a boundary never match).
  if (lower === "bbc" || /\bbbc\b/.test(lower)) return "bbc"
  // ITV — word boundary with optional trailing digit/X ("ITV", "ITV1",
  // "ITV2", "ITVX", "ITV Studios" match; "Positiv"-style embeddings never
  // match: no boundary before a word char).
  if (/\bitvx?\d*\b/.test(lower)) return "itv"
  // Channel 4 — full phrase only ("Channel 4", "Channel4", "Channel Four").
  // A bare "4" or unrelated "Film4"/"E4"-style names never match.
  if (lower.includes("channel 4") || lower.includes("channel4") || lower.includes("channel four")) return "channel4"
  // Starz — literal "starz" only (matches "Starz", "Starzplay"); generic
  // "Star"-prefixed studio strings without the trailing "z" never match.
  if (lower.includes("starz")) return "starz"
  // BritBox — "BritBox" or spaced "Brit Box" only.
  if (lower.includes("britbox") || lower.includes("brit box")) return "britbox"
  return null
}

/**
 * Canonical mark IDs (76 bundled marks, studios included).
 * Order matches `NETWORK_MARK_FILES` in `network-files.ts` entry for entry
 * (registry coherence is asserted in `tag-network-map-coherence.test.ts`).
 */
export const NETWORK_IDS: readonly string[] = [
  "netflix", "hbo", "disney", "prime", "apple", "paramount", "rai",
  "crunchyroll", "sky", "mediaset", "tubi", "pluto", "amc", "abc",
  "cbs", "fox", "fx", "hulu", "natgeo", "peacock", "nbc", "mbs", "showtime",
  "paramount_showtime",
  "warner", "universal", "century", "columbia", "sony", "disney_pictures",
  "marvel", "pixar", "a24", "legendary", "lionsgate", "fandango",
  "medusa", "ghibli", "mgm", "amazon_mgm", "mgm_plus", "lucasfilm",
  "miramax", "castle_rock", "dreamworks", "indiana", "sky_cinema",
  "taodue", "bandai", "mappa", "madhouse", "skydance", "studiocanal",
  "dg_cinema", "dc", "bigtalk", "batinthesun", "horrorsection",
  "new_line", "jagged_edge", "gracie", "deseo", "bellanova", "anton",
  "comix_wave", "filmauro", "next_ent", "bones",
  "discovery_plus", "bbc", "itv", "channel4", "starz", "britbox", "argos",
  "real_time",
]

/**
 * Display names for the 76 canonical marks. Proper nouns — identical in
 * every UI language (like the Card skin names), never translated.
 */
export const NETWORK_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  netflix: "Netflix",
  hbo: "HBO / Max",
  disney: "Disney+",
  prime: "Prime Video",
  apple: "Apple TV",
  paramount: "Paramount+",
  rai: "Rai",
  crunchyroll: "Crunchyroll",
  sky: "Sky / NOW",
  mediaset: "Mediaset Infinity",
  tubi: "Tubi",
  pluto: "Pluto TV",
  amc: "AMC",
  abc: "ABC",
  cbs: "CBS",
  fox: "FOX",
  fx: "FX",
  hulu: "Hulu",
  natgeo: "National Geographic",
  peacock: "Peacock",
  nbc: "NBC",
  mbs: "MBS",
  showtime: "Showtime",
  paramount_showtime: "Paramount+ with Showtime",
  warner: "Warner Bros.",
  universal: "Universal Pictures",
  century: "20th Century Studios",
  columbia: "Columbia Pictures",
  sony: "Sony",
  disney_pictures: "Walt Disney Pictures",
  marvel: "Marvel Studios",
  pixar: "Pixar",
  a24: "A24",
  legendary: "Legendary",
  lionsgate: "Lionsgate",
  fandango: "Fandango",
  medusa: "Medusa Film",
  ghibli: "Studio Ghibli",
  mgm: "MGM",
  amazon_mgm: "Amazon MGM Studios",
  mgm_plus: "MGM+",
  lucasfilm: "Lucasfilm",
  miramax: "Miramax",
  castle_rock: "Castle Rock",
  dreamworks: "DreamWorks",
  indiana: "Indiana Production",
  sky_cinema: "Sky Cinema",
  taodue: "Taodue",
  bandai: "Bandai",
  mappa: "MAPPA",
  madhouse: "Madhouse",
  skydance: "Skydance",
  studiocanal: "StudioCanal",
  dg_cinema: "Direzione Generale Cinema",
  dc: "DC Studios",
  bigtalk: "Big Talk",
  batinthesun: "Bat in the Sun",
  horrorsection: "Horror Section",
  new_line: "New Line Cinema",
  jagged_edge: "Jagged Edge",
  gracie: "Gracie Films",
  deseo: "Deseo",
  bellanova: "Bellanova",
  anton: "Anton",
  comix_wave: "CoMix Wave Films",
  filmauro: "Filmauro",
  next_ent: "Next Entertainment World",
  bones: "Bones",
  discovery_plus: "Discovery+",
  bbc: "BBC",
  itv: "ITV",
  channel4: "Channel 4",
  starz: "Starz",
  britbox: "BritBox",
  argos: "Argos",
  real_time: "Real Time",
}

const NETWORK_ID_SET: ReadonlySet<string> = new Set(NETWORK_IDS)

/**
 * Client-safe featured network IDs (24): the only marks with individual
 * settings rows. Order follows the user-approved curation (20 popular +
 * Peacock, Discovery+, BBC, Starz). Every other canonical mark plus the
 * TMDB fallback rides the shared `Altri loghi` (Other) group toggle.
 *
 * Single definition: the settings tab renders exactly these rows
 * (independent enable/disable-all), and the renderer treats every other
 * canonical key as group-gated (see below).
 */
export const FEATURED_NETWORK_IDS: readonly string[] = [
  "netflix", "prime", "disney", "hbo", "apple", "paramount", "sky",
  "crunchyroll", "rai", "mediaset", "warner", "universal", "marvel",
  "pixar", "sony", "dreamworks", "ghibli", "a24", "century", "lionsgate",
  "peacock", "discovery_plus", "bbc", "starz",
]

const FEATURED_NETWORK_SET: ReadonlySet<string> = new Set(FEATURED_NETWORK_IDS)

/** True for one of the 24 individually selectable marks. */
export function isFeaturedNetworkKey(networkKey: string): boolean {
  return FEATURED_NETWORK_SET.has(networkKey.toLowerCase().trim())
}

/**
 * True when the shared Other group (`Altri loghi`) is switched OFF, i.e.
 * the space wants every non-featured bundled mark AND the whole TMDB
 * fallback suppressed. Backed by the same `__tmdb_fallback` sentinel in
 * `disabledNetworks` (absent/empty list = historical all-ON).
 */
export function isOtherNetworksDisabled(disabled: ReadonlySet<string> | readonly string[] | null | undefined): boolean {
  return isTmdbFallbackDisabled(disabled)
}

/**
 * Documented sentinel for the shared Other group preference (`Altri loghi`):
 * present in a space's `disabledNetworks` list it switches OFF every
 * non-featured bundled mark (before load, no fetch/render) together with
 * the otherwise-unlisted TMDB fallback logos (fetched per title). Absent =
 * historical behavior (everything enabled).
 *
 * The sentinel is NOT a canonical SVG key on purpose:
 * - never listed in `NETWORK_IDS` (the registry stays 76 bundled marks) and
 *   never shown in `NETWORK_DISPLAY_NAMES` (no settings row of its own — the
 *   `Altri loghi` toggle owns the group);
 * - `getNetworkKey` never returns it, so it can never match a real mark;
 * - `isNetworkDisabled` never treats it as a disabled registered mark;
 * - the renderer gates the whole Other group on it (every non-featured
 *   local mark fails its group check before load, the TMDB path is skipped
 *   before any fetch) while featured marks stay governed by their own
 *   individual toggles only (see `isOtherNetworkMarkDisabled`);
 * - the settings featured enable-all/disable-all helpers move only
 *   `FEATURED_NETWORK_IDS`; the Other toggle keeps its staged value.
 */
export const TMDB_FALLBACK_SENTINEL = "__tmdb_fallback"

/** Max entries: 76 canonical marks + the Other-group sentinel. Derived. */
export const MAX_DISABLED_NETWORKS = NETWORK_IDS.length + 1

/**
 * Bounded validation for space-wide disabled network marks: keeps known
 * canonical IDs (lowercased/trimmed) plus the documented Other-group
 * sentinel, dedupes, caps at 77 (76 marks + sentinel).
 * Unknown IDs are dropped (fail-closed); non-arrays → [] (absent = history).
 *
 * Stored hidden (non-featured) IDs are preserved verbatim: turning the
 * Other group back ON never silently drops them, and the renderer keeps
 * honoring them individually (see `isOtherNetworkMarkDisabled`).
 */
export function sanitizeDisabledNetworks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== "string") continue
    const id = v.toLowerCase().trim()
    if (id !== TMDB_FALLBACK_SENTINEL && !NETWORK_ID_SET.has(id)) continue
    if (out.includes(id)) continue
    out.push(id)
    if (out.length >= MAX_DISABLED_NETWORKS) break
  }
  return out
}

/** True when the canonical mark is disabled space-wide. */
export function isNetworkDisabled(networkKey: string | null | undefined, disabled: ReadonlySet<string> | readonly string[] | null | undefined): boolean {
  if (!networkKey || !disabled) return false
  const key = networkKey.toLowerCase().trim()
  if (key === TMDB_FALLBACK_SENTINEL) return false
  return Array.isArray(disabled) ? disabled.includes(key) : (disabled as ReadonlySet<string>).has(key)
}

/**
 * True when the space disables the otherwise-unlisted TMDB fallback logos.
 * The sentinel gates the whole Other group: every non-featured local mark
 * plus the TMDB-fetch path (featured marks are unaffected, see
 * `isOtherNetworkMarkDisabled` below).
 */
export function isTmdbFallbackDisabled(disabled: ReadonlySet<string> | readonly string[] | null | undefined): boolean {
  if (!disabled) return false
  return Array.isArray(disabled)
    ? disabled.includes(TMDB_FALLBACK_SENTINEL)
    : (disabled as ReadonlySet<string>).has(TMDB_FALLBACK_SENTINEL)
}

/**
 * Group-aware mark check for the renderer: a featured mark is disabled only
 * by its own individual toggle; a non-featured mark is disabled by its own
 * stored toggle (kept for pre-group lists, never silently dropped) OR by
 * the Other group switch (`__tmdb_fallback` present = whole group OFF).
 * The sentinel itself is never a mark.
 */
export function isOtherNetworkMarkDisabled(networkKey: string | null | undefined, disabled: ReadonlySet<string> | readonly string[] | null | undefined): boolean {
  if (!networkKey) return false
  const key = networkKey.toLowerCase().trim()
  if (key === TMDB_FALLBACK_SENTINEL) return false
  if (isNetworkDisabled(key, disabled)) return true
  if (isFeaturedNetworkKey(key)) return false
  return isTmdbFallbackDisabled(disabled)
}

/**
 * Combined-mark rule for titles that list BOTH Paramount+ and Showtime: the
 * single `paramount_showtime` lockup replaces two separate marks (and plain
 * first-match-wins). Shared by every renderer entry point (pill/raw,
 * legacy/hybrid) — never re-implemented per function.
 *
 * Returns null (caller falls through to normal first-match) when:
 * - the candidate list does not resolve to both `paramount` and `showtime`;
 * - either constituent mark is off — individual toggle, or the shared Other
 *   group for the non-featured `showtime`: disabling one brand must never
 *   resurrect the combined mark for the other;
 * - the combined mark itself is off (own stored toggle / Other group OFF);
 * - the list's dominant mark (what plain first-match would pick) is another
 *   network: the lockup only ever replaces a mark it is made of, never
 *   Netflix/HBO/Apple on a title that happens to carry the pair as well.
 *
 * A single combined TMDB name ("Paramount+ with Showtime") is resolved
 * directly by `getNetworkKey` and never reaches this rule.
 */
export function getCombinedNetworkKey(
  names: readonly (string | null | undefined)[],
  disabled: ReadonlySet<string> | readonly string[] | null | undefined,
): string | null {
  let dominantKey: string | null = null
  let hasParamount = false
  let hasShowtime = false
  for (const name of names) {
    if (!name) continue
    const key = getNetworkKey(name)
    if (!key) continue
    // A disabled mark is skipped by the first-match loop too, so it can
    // neither lead the list nor contribute a half of the lockup.
    if (isOtherNetworkMarkDisabled(key, disabled)) continue
    if (dominantKey === null) dominantKey = key
    if (key === "paramount") hasParamount = true
    else if (key === "showtime") hasShowtime = true
  }
  if (dominantKey !== "paramount" && dominantKey !== "showtime") return null
  if (!hasParamount || !hasShowtime) return null
  if (isOtherNetworkMarkDisabled("paramount_showtime", disabled)) return null
  return "paramount_showtime"
}
