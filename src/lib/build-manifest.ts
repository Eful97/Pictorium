import crypto from "node:crypto"
import { NextRequest } from "next/server"
import { APP_VERSION } from "@/generated/app-version"
import { PICTORIUM_CATALOGS, PICTORIUM_PEOPLE_SEARCH_CATALOGS, regionJwName } from "@/lib/catalog-definitions"
import { getOriginFromRequest } from "@/lib/poster-public-url"
import { decodeConfig, type PictoriumUserConfig } from "@/lib/config-token"
import { normalizeCatalogIdKeys, normalizeCatalogIdList } from "@/lib/catalog-definitions"
import { rankingSourceCatalogName } from "@/lib/ranking-source"
import { pictoriumExtraForAddon } from "@/lib/stremio-addon"
import { getServerDefaultsChecked, getServerDefaultsForUser } from "@/lib/server-defaults"
import { getScopedUserId } from "@/lib/user-auth"
import { getRegionDef, normalizeRegion, parseRegion } from "@/lib/regions"

const MOVIE_GENRES = [
  "Tutti", "Azione", "Avventura", "Animazione", "Commedia", "Crime",
  "Documentario", "Dramma", "Famiglia", "Fantascienza", "Fantasy",
  "Guerra", "Horror", "Mistero", "Musica", "Romance", "Storia",
  "Thriller", "Western",
]

const SERIES_GENRES = [
  "Tutti", "Action & Adventure", "Animazione", "Commedia", "Crime",
  "Documentario", "Dramma", "Family", "Kids", "Mistero", "News",
  "Reality", "Sci-Fi & Fantasy", "Soap", "Talk", "War & Politics", "Western",
]

const ANIME_GENRES = [
  "Tutti", "Animazione", "Azione", "Action & Adventure", "Avventura",
  "Commedia", "Dramma", "Fantascienza", "Sci-Fi & Fantasy", "Fantasy",
  "Mistero", "Romance", "Thriller",
]

function getCatalogGenreOptions(type: "movie" | "series", catalogId: string): string[] {
  if (catalogId.includes("anime") || catalogId.includes("crunchyroll")) return ANIME_GENRES
  return type === "movie" ? MOVIE_GENRES : SERIES_GENRES
}

function safeSuffix(value: string | null | undefined): string | null {
  if (!value) return null
  return crypto.createHash("sha256").update(value).digest("base64url").slice(0, 8)
}

export async function buildManifestResponse(req: NextRequest, user?: string | null, config?: string | null): Promise<Response> {
  const domain = getOriginFromRequest(req)

  let userConfig: Partial<PictoriumUserConfig> | null = null
  if (config) {
    userConfig = decodeConfig(config)
  }
  // Namespace manifest (multi-user): null con flag OFF → globale invariato.
  const scopedManifestUser = getScopedUserId(user)
  // Base namespace (una sola lettura): i defaults dell'utente, mai i globali
  // — altrimenti i cataloghi di B seguono i default di A. Con flag OFF o
  // senza uuid → globali invariati (byte-identico).
  const namespaceDefaults = scopedManifestUser ? await getServerDefaultsForUser(scopedManifestUser) : await getServerDefaultsChecked()
  if (!userConfig) {
    // Cataloghi personali (multi-user): i defaults del namespace.
    userConfig = {
      disabledCatalogIds: namespaceDefaults.disabledCatalogIds,
      homeDisabledCatalogIds: namespaceDefaults.homeDisabledCatalogIds,
      customCatalogs: namespaceDefaults.customCatalogs,
      rankingSourceMovie: namespaceDefaults.rankingSourceMovie,
      rankingSourceSeries: namespaceDefaults.rankingSourceSeries,
      catalogRenames: namespaceDefaults.catalogRenames,
      catalogOrder: namespaceDefaults.catalogOrder,
    }
  } else {
    // Config-token + namespace composti (stile AIO): il namespace è la base
    // (regione, cataloghi, chiavi server-side), il token è l'override UI.
    // Prima il token oscurava tutto il namespace (regione/cataloghi di A
    // ignorati quando `?config=` presente). Campi impostati nel token
    // vincono, il resto resta del namespace.
    userConfig = {
      disabledCatalogIds: userConfig.disabledCatalogIds ?? namespaceDefaults.disabledCatalogIds,
      homeDisabledCatalogIds: userConfig.homeDisabledCatalogIds ?? namespaceDefaults.homeDisabledCatalogIds,
      customCatalogs: userConfig.customCatalogs ?? namespaceDefaults.customCatalogs,
      rankingSourceMovie: userConfig.rankingSourceMovie ?? namespaceDefaults.rankingSourceMovie,
      rankingSourceSeries: userConfig.rankingSourceSeries ?? namespaceDefaults.rankingSourceSeries,
      catalogRenames: userConfig.catalogRenames ?? namespaceDefaults.catalogRenames,
      catalogOrder: userConfig.catalogOrder ?? namespaceDefaults.catalogOrder,
      region: userConfig.region ?? namespaceDefaults.region,
      hubMode: userConfig.hubMode,
    }
  }

  // Config salvate prima del rename possono contenere ID `posterium-*`:
  // normalizza al canonico `pictorium-*` così esclusioni/ordini/rinomine restano validi.
  if (userConfig) {
    userConfig.disabledCatalogIds = normalizeCatalogIdList(userConfig.disabledCatalogIds)
    userConfig.homeDisabledCatalogIds = normalizeCatalogIdList(userConfig.homeDisabledCatalogIds)
    userConfig.catalogOrder = normalizeCatalogIdList(userConfig.catalogOrder)
    userConfig.catalogRenames = normalizeCatalogIdKeys(userConfig.catalogRenames)
  }
  let catalogs: Array<{ id: string; name: string; type: "movie" | "series"; customBaseId?: string; addonExtra?: ReturnType<typeof pictoriumExtraForAddon> }> = [...PICTORIUM_CATALOGS]
  if (userConfig?.disabledCatalogIds && userConfig.disabledCatalogIds.length > 0) {
    const disabledSet = new Set(userConfig.disabledCatalogIds)
    catalogs = catalogs.filter(c => !disabledSet.has(c.id))
  }
  if (userConfig?.customCatalogs && userConfig.customCatalogs.length > 0) {
    for (const cc of userConfig.customCatalogs) {
      if (cc.enabled !== false) {
        // Ramo addon: un solo catalogo movie|series con le capacità della
        // fonte (niente split mixed, niente generi generici).
        if (cc.addon) {
          catalogs.push({
            id: `pictorium-custom-${cc.type}-${cc.id}`,
            name: cc.name,
            type: cc.type === "series" ? "series" : "movie",
            customBaseId: cc.id,
            addonExtra: pictoriumExtraForAddon(cc.addon),
          })
          continue
        }
        if (cc.type === "mixed") {
          catalogs.push({
            id: `pictorium-custom-movie-${cc.id}`,
            name: `${cc.name} — Film`,
            type: "movie",
            customBaseId: cc.id,
          })
          catalogs.push({
            id: `pictorium-custom-series-${cc.id}`,
            name: `${cc.name} — Serie TV`,
            type: "series",
            customBaseId: cc.id,
          })
        } else {
          catalogs.push({
            id: `pictorium-custom-${cc.type}-${cc.id}`,
            name: cc.name,
            type: cc.type,
            customBaseId: cc.id,
          })
        }
      }
    }
  }

  // Regione manifest: config-token > default del namespace > IT. I cataloghi Top 20
  // JustWatch mostrano bandiera/nome del paese attivo (le rinomine utente vincono).
  // (namespaceDefaults già risolto sopra: nessuna seconda lettura.)
  const manifestRegion = getRegionDef(parseRegion(userConfig?.region) ?? normalizeRegion(namespaceDefaults.region))

  // Applica rinomine personalizzate dei cataloghi + nomi regione per i Top 20 JW
  catalogs = catalogs.map((cat) => {
    const customName = userConfig?.catalogRenames?.[cat.id]
    if (customName && customName.trim()) {
      return { ...cat, name: customName.trim() }
    }
    // A Top 20 driven by a custom list must not be called JustWatch: the
    // custom list name wins over the regional JW name (renames still first).
    const rankingName = rankingSourceCatalogName(
      cat.id,
      cat.type,
      {
        customCatalogs: userConfig?.customCatalogs,
        rankingSourceMovie: userConfig?.rankingSourceMovie,
        rankingSourceSeries: userConfig?.rankingSourceSeries,
      },
    )
    if (rankingName) return { ...cat, name: rankingName }
    const jwName = regionJwName(cat.id, cat.type, manifestRegion)
    if (jwName) return { ...cat, name: jwName }
    return cat
  })

  // Applica ordinamento / priorità personalizzata
  if (userConfig?.catalogOrder && userConfig.catalogOrder.length > 0) {
    const orderMap = new Map<string, number>()
    userConfig.catalogOrder.forEach((id: string, idx: number) => orderMap.set(id, idx))
    catalogs.sort((a, b) => {
      const orderA = orderMap.has(a.id) ? orderMap.get(a.id)! : 9999
      const orderB = orderMap.has(b.id) ? orderMap.get(b.id)! : 9999
      return orderA - orderB
    })
  }

  const rawMode = req.nextUrl.searchParams.get("mode")
  const hubMode: "all" | "catalogs" | "search" = (rawMode === "search" || rawMode === "catalogs" || rawMode === "all")
    ? rawMode
    : (userConfig?.hubMode || "all")

  const safeConfig = safeSuffix(config || user)
  const suffix = safeConfig ? `.${safeConfig}` : ""
  const modeSuffix = hubMode === "all" ? "" : `.${hubMode}`
  const addonId = `org.pictorium${suffix}${modeSuffix}`

  const homeDisabledSet = new Set(userConfig?.homeDisabledCatalogIds || [])

  const contentCatalogs = catalogs.map((c) => {
    const isHomeHidden = homeDisabledSet.has(c.id) || (c.customBaseId ? homeDisabledSet.has(c.customBaseId) : false)
    // Ramo addon: capacità della fonte, mai filtri generici aggiunti.
    if (c.addonExtra) {
      const extra = c.addonExtra.map((e) => ({ ...e }))
      if (isHomeHidden && !extra.some((e) => e.isRequired)) {
        const skippable = extra.find((e) => e.name === "skip")
        if (skippable) skippable.isRequired = true
        else if (extra.length > 0) extra[0].isRequired = true
        else extra.push({ name: "skip", isRequired: true })
      }
      return { id: c.id, name: c.name, type: c.type, extra }
    }
    const genreOptions = getCatalogGenreOptions(c.type, c.id)
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      extra: isHomeHidden
        ? [{ name: "genre", isRequired: true, options: genreOptions }, { name: "skip", isRequired: false }]
        : [{ name: "genre", isRequired: false, options: genreOptions }, { name: "skip", isRequired: false }],
    }
  })

  const searchCatalogs = [
    {
      id: "pictorium-search-movies",
      name: "🔍 Pictorium — Cerca Film",
      type: "movie" as const,
      extra: [{ name: "search", isRequired: true }, { name: "skip", isRequired: false }],
    },
    {
      id: "pictorium-search-series",
      name: "🔍 Pictorium — Cerca Serie TV",
      type: "series" as const,
      extra: [{ name: "search", isRequired: true }, { name: "skip", isRequired: false }],
    },
  ]

  const peopleSearchCatalogs = PICTORIUM_PEOPLE_SEARCH_CATALOGS.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    extra: [{ name: "search", isRequired: true }, { name: "skip", isRequired: false }] as const,
  }))

  let manifestCatalogs: typeof contentCatalogs = []
  if (hubMode === "search") {
    manifestCatalogs = [...searchCatalogs, ...peopleSearchCatalogs] as typeof contentCatalogs
  } else if (hubMode === "catalogs") {
    manifestCatalogs = contentCatalogs
  } else {
    manifestCatalogs = [...contentCatalogs, ...searchCatalogs, ...peopleSearchCatalogs] as typeof contentCatalogs
  }

  // Solo prefissi che il resolver /meta sa davvero risolvere (meta-handler:
  // tt/tmdb:/tvdb:/tvdbc:/numerici). Dichiarare kitsu:/mal:/anilist:/anidb:
  // faceva instradare a noi meta di altri provider per poi rispondere null,
  // oscurando gli addon che li servono davvero (C3).
  const ID_PREFIXES = [
    "tmdb:",
    "tt",
    "tvdb:",
    "tvdbc:",
  ]

  const TYPES = ["movie", "series", "anime.movie", "anime.series", "anime"]

  let manifestName = safeConfig ? `Pictorium (${safeConfig})` : "Pictorium"
  if (hubMode === "search") {
    manifestName += " (Ricerca)"
  } else if (hubMode === "catalogs") {
    manifestName += " (Cataloghi)"
  }

  return Response.json({
    id: addonId,
    version: APP_VERSION,
    name: manifestName,
    description: "Custom poster manager for Stremio — loghi, badge trend, premi e rating",
    resources: [
      "catalog",
      {
        name: "meta",
        types: TYPES,
        idPrefixes: ID_PREFIXES,
      },
    ],
    types: TYPES,
    idPrefixes: ID_PREFIXES,
    logo: `${domain}/App.png`,
    addonCatalogs: [],
    manifestVersion: 1,
    behaviorHints: {
      adult: false,
      configurable: true,
      configurationRequired: false,
      configurationUrl: user ? `${domain}/u/${encodeURIComponent(user)}/configure` : (config ? `${domain}/c/${encodeURIComponent(config)}/configure` : `${domain}/configure`),
    },
    catalogs: manifestCatalogs,
  }, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache, max-age=0, must-revalidate",
    },
  })
}
