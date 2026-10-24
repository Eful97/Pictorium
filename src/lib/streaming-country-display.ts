/**
 * Pure client-safe DISPLAY mapping for chart-country slugs → flag + localized name.
 *
 * Display-only: the chart slug stays the fetch/identity key everywhere
 * (API values, persisted codes, backend RegionDef routing are untouched).
 * This module only answers "which flag emoji and which localized label should
 * the Add Top 10 country picker show for this slug, in the CURRENT UI language".
 *
 * - 118 chart-country slugs map to their factual ISO 3166-1 alpha-2 code
 *   (flag = regional-indicator pair, identical in every language);
 *   `global` is the chart-scope sentinel (🌐, translated name via caller).
 * - Localized names come from `Intl.DisplayNames(locale, { type: "region" })`
 *   with the ACTUAL UI language (live recompute on language change);
 *   alphabetical order via `Intl.Collator(locale)`, global always first.
 * - Unknown future slugs (outside the 119 allowlist) fall back honestly:
 *   prettified slug as label, NO invented flag — never an Italy fallback.
 *
 * No imports: pure leaf, safe for client bundles and offline unit tests.
 */

/** fp-crawler chart slug → factual ISO 3166-1 alpha-2 (fetch identity untouched). */
export const CHART_SLUG_TO_ISO2: Readonly<Record<string, string>> = {
  albania: "AL",
  algeria: "DZ",
  "antigua-and-barbuda": "AG",
  argentina: "AR",
  armenia: "AM",
  australia: "AU",
  austria: "AT",
  azerbaijan: "AZ",
  bahamas: "BS",
  bahrain: "BH",
  bangladesh: "BD",
  belarus: "BY",
  belgium: "BE",
  belize: "BZ",
  bolivia: "BO",
  "bosnia-and-herzegovina": "BA",
  botswana: "BW",
  brazil: "BR",
  bulgaria: "BG",
  cambodia: "KH",
  canada: "CA",
  chile: "CL",
  colombia: "CO",
  "costa-rica": "CR",
  croatia: "HR",
  cyprus: "CY",
  "czech-republic": "CZ",
  denmark: "DK",
  dominica: "DM",
  "dominican-republic": "DO",
  ecuador: "EC",
  egypt: "EG",
  estonia: "EE",
  finland: "FI",
  france: "FR",
  gambia: "GM",
  germany: "DE",
  ghana: "GH",
  greece: "GR",
  guatemala: "GT",
  honduras: "HN",
  "hong-kong": "HK",
  hungary: "HU",
  iceland: "IS",
  india: "IN",
  indonesia: "ID",
  iraq: "IQ",
  ireland: "IE",
  israel: "IL",
  italy: "IT",
  jamaica: "JM",
  japan: "JP",
  jordan: "JO",
  kazakhstan: "KZ",
  kenya: "KE",
  kuwait: "KW",
  laos: "LA",
  latvia: "LV",
  lebanon: "LB",
  libya: "LY",
  lithuania: "LT",
  luxembourg: "LU",
  malaysia: "MY",
  malta: "MT",
  mauritania: "MR",
  mauritius: "MU",
  mexico: "MX",
  moldova: "MD",
  mongolia: "MN",
  montenegro: "ME",
  morocco: "MA",
  mozambique: "MZ",
  namibia: "NA",
  netherlands: "NL",
  "new-zealand": "NZ",
  nicaragua: "NI",
  niger: "NE",
  nigeria: "NG",
  "north-macedonia": "MK",
  norway: "NO",
  oman: "OM",
  pakistan: "PK",
  panama: "PA",
  paraguay: "PY",
  peru: "PE",
  philippines: "PH",
  poland: "PL",
  portugal: "PT",
  qatar: "QA",
  romania: "RO",
  salvador: "SV",
  "saudi-arabia": "SA",
  serbia: "RS",
  singapore: "SG",
  slovakia: "SK",
  slovenia: "SI",
  "south-africa": "ZA",
  "south-korea": "KR",
  spain: "ES",
  "sri-lanka": "LK",
  sweden: "SE",
  switzerland: "CH",
  taiwan: "TW",
  tajikistan: "TJ",
  thailand: "TH",
  "trinidad-and-tobago": "TT",
  tunisia: "TN",
  turkey: "TR",
  uganda: "UG",
  ukraine: "UA",
  "united-arab-emirates": "AE",
  "united-kingdom": "GB",
  "united-states": "US",
  uruguay: "UY",
  venezuela: "VE",
  vietnam: "VN",
  yemen: "YE",
  zimbabwe: "ZW",
};

/** Chart-scope sentinel slug (never a country, always offered first). */
export const GLOBAL_CHART_SLUG = "global";

/** Global chart flag (same in every language, like every other flag). */
export const GLOBAL_CHART_FLAG = "🌐";

/** Flag emoji for an ISO 3166-1 alpha-2 code (regional indicators). */
export function flagForIso2(iso2: string): string {
  const code = iso2.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  const base = 0x1f1e6;
  return String.fromCodePoint(base + code.charCodeAt(0) - 65, base + code.charCodeAt(1) - 65);
}

/** Display fallback for unknown slugs: never a fake flag, never Italy. */
export function prettifyChartSlug(slug: string): string {
  return slug
    .split("-")
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(" ");
}

export interface ChartCountryDisplay {
  /** Fetch identity (unchanged key for API/persisted values). */
  readonly slug: string;
  /** Factual ISO alpha-2, or null for `global`/unknown slugs. */
  readonly iso2: string | null;
  /** Flag emoji (`""` = honestly none, never invented). */
  readonly flag: string;
  /** Localized name in the requested UI language. */
  readonly label: string;
  /** True only for the `global` chart-scope sentinel. */
  readonly isGlobal: boolean;
}

function displayNamesFor(locale: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames(locale, { type: "region" });
  } catch {
    try {
      return new Intl.DisplayNames("en", { type: "region" });
    } catch {
      return null;
    }
  }
}

/**
 * Display row for one chart slug in the given UI language.
 * `globalLabel` is the caller-translated name for the global chart
 * (e.g. `t("ui.regionGlobal")`): this module never hardcodes UI strings.
 */
export function displayCountryForSlug(
  slug: string,
  locale: string,
  globalLabel: string,
): ChartCountryDisplay {
  const key = slug.trim().toLowerCase();
  if (key === GLOBAL_CHART_SLUG) {
    return { slug: key, iso2: null, flag: GLOBAL_CHART_FLAG, label: globalLabel, isGlobal: true };
  }
  const iso2 = CHART_SLUG_TO_ISO2[key] ?? null;
  if (!iso2) {
    return { slug: key, iso2: null, flag: "", label: prettifyChartSlug(key), isGlobal: false };
  }
  let label: string | undefined;
  try {
    label = displayNamesFor(locale)?.of(iso2) ?? undefined;
  } catch {
    label = undefined;
  }
  return {
    slug: key,
    iso2,
    flag: flagForIso2(iso2),
    label: label ?? prettifyChartSlug(key),
    isGlobal: false,
  };
}

/**
 * Sort display rows for the picker: global ALWAYS first, then alphabetical
 * by the CURRENT UI language label (`Intl.Collator`, live on language change).
 * Flags are language-independent by construction (same slug → same flag).
 */
export function sortCountryDisplays(
  rows: readonly ChartCountryDisplay[],
  locale: string,
): ChartCountryDisplay[] {
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator(locale, { sensitivity: "base" });
  } catch {
    collator = new Intl.Collator("en", { sensitivity: "base" });
  }
  return [...rows].sort((a, b) => {
    if (a.isGlobal !== b.isGlobal) return a.isGlobal ? -1 : 1;
    const byName = collator.compare(a.label, b.label);
    if (byName !== 0) return byName;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
}
