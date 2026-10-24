/**
 * Single client-safe network-mark filename registry (sole owner of the
 * canonical ID → bundled-file mapping for `public/networks/`).
 *
 * - `network-svgs.ts` (server-only: fs/sharp) imports this map for fs path
 *   loading — it never defines its own filename copy.
 * - `network-assets.ts` (client-safe) imports this map for settings
 *   thumbnail public URLs — it never defines its own filename copy.
 * - `network-keys.ts` owns the matcher (`getNetworkKey`), the canonical ID
 *   order (`NETWORK_IDS`, same iteration order as this map), display names
 *   and the disabled-marks sanitizer — but never filenames.
 *
 * Iteration order is canonical: it matches `NETWORK_IDS` entry for entry
 * (75 bundled marks, studios included; PNG/WebP marks included verbatim —
 * never silently dropped). Non-SVG bundled marks (`.png`/`.webp`) are part
 * of this map on purpose: the renderer and the UI must agree on every mark.
 *
 * No `fs`/`path`/node imports here: this file must stay importable from
 * client components.
 */

export const NETWORK_MARK_FILES: Readonly<Record<string, string>> = {
  netflix: "Netflix_2016_N_logo.svg",
  hbo: "HBO_logo.svg",
  disney: "Disney+_logo.svg",
  prime: "Prime_Video_logo_(2024).svg",
  apple: "Apple_TV_logo.svg",
  paramount: "Paramount_Plus.svg",
  rai: "Logo_of_RAI_(2016).svg",
  crunchyroll: "cr_logo_noTagline.svg",
  // Il logo NOW ha sostituito il vecchio Sky Group: entrambi i nomi usano lo stesso file.
  sky: "Now_logo.svg",
  mediaset: "Mediaset_Infinity_logo.svg",
  tubi: "Tubi logo.svg",
  pluto: "Pluto_TV_logo_2024.svg",
  amc: "Amc_logo.svg",
  abc: "American_Broadcasting_Company_Logo.svg",
  cbs: "CBS_logo_(2020).svg",
  fox: "FOX_wordmark.svg",
  fx: "FX_International_logo.svg",
  hulu: "Hulu_logo_(2018).svg",
  natgeo: "National-Geographic-Logo.svg",
  peacock: "peacock.svg",
  nbc: "NBC_logo.svg", // peacock colors updated 2026-08-28
  mbs: "Mainichi_Broadcasting_System_logo.svg",
  showtime: "Showtime_logo.svg",
  warner: "Warner_Bros_logo.svg",
  universal: "Universal_Pictures_logo.svg",
  century: "20th_Century_Studios_(2020) [Recuperato].svg",
  columbia: "Columbia_Pictures.svg",
  sony: "Sony_logo.svg",
  disney_pictures: "Walt_Disney_Pictures_text_logo.svg",
  marvel: "Marvel_Studios_2016_logo.svg",
  pixar: "Pixar_logo.svg",
  a24: "A24_logo.svg",
  legendary: "Legendary_Entertainment_logo.svg",
  lionsgate: "Lionsgate_Logo.svg",
  fandango: "Fandango_logotipo.svg",
  medusa: "Medusa_Film_-_logo_(Italy,_2017-).svg",
  ghibli: "Studio_Ghibli.svg",
  mgm: "metro-goldwyn-mayer.svg",
  amazon_mgm: "Amazon_MGM_Studios_Logo_2.svg",
  mgm_plus: "MGM+_logo.svg",
  lucasfilm: "Lucasfilm_logo.svg",
  miramax: "Miramax_logo.svg",
  castle_rock: "castle-rock-entertainment.svg",
  dreamworks: "dreamworks-animation-logo-vector.svg",
  indiana: "Indiana_Production.svg",
  sky_cinema: "Sky_Cinema_-_Logo_2021.svg",
  taodue: "Taodue_logo.svg",
  bandai: "Bandai_Visual_corporate_logo.svg",
  mappa: "MAPPA_Logo.svg",
  madhouse: "Madhouse Studio logo.svg",
  skydance: "Skydance_Media_2020.svg",
  studiocanal: "Studiocanal_2011_logo.svg",
  dg_cinema: "direzione-generale-cinema-e-audiovisivo-vector-logo.svg",
  dc: "DC_Studios_logo.svg",
  bigtalk: "Big+Talk+Studios+-+Logo+-+Brandmark.webp",
  batinthesun: "12x16-batinthesun.png",
  horrorsection: "ths-logo-300_webp.png",
  new_line: "New_Line_Cinema.svg",
  jagged_edge: "jagged.svg",
  gracie: "Gracie_Films_logo_webp.png",
  deseo: "deseo.svg",
  bellanova: "bellanova-big.png",
  anton: "Anton_United_Kingdom_logo.png",
  comix_wave: "CoMix Wave Films logo.svg",
  filmauro: "cdnlogo.com_filmauro-logo.svg",
  next_ent: "new.svg",
  bones: "Bones_logo.svg",
  discovery_plus: "discovery-plus.svg",
  bbc: "bbc.svg",
  itv: "itv.svg",
  channel4: "channel-4.svg",
  starz: "starz.svg",
  britbox: "britbox.svg",
  argos: "argos.svg",
  real_time: "Real_Time_logo.svg",
}
