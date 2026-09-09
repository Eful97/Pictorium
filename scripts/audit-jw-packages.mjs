// Script offline una tantum: verifica che i package JustWatch usati da
// Posterium (PLATFORM_JW_PACKAGES in catalog-handler.ts) esistano davvero in
// ognuna delle 12 regioni supportate, includendo gli add-on/channel
// (includeAddons: true — senza, HBO Max/Crunchyroll/AMC+ via Amazon Channel
// risultano invisibili).
//
// Uso: node scripts/audit-jw-packages.mjs [COUNTRY...]
// Esempi:
//   node scripts/audit-jw-packages.mjs            # tutte le 12 regioni
//   node scripts/audit-jw-packages.mjs IT US      # solo queste
// Non tocca il codice di produzione: output solo report su stdout.

const JW_API = process.env.JUSTWATCH_API_URL || "https://apis.justwatch.com/graphql"

const EXPECTED = {
  netflix: ["nfx"],
  prime: ["prv"],
  disney: ["dnp"],
  now: ["ntv", "skg"],
  apple: ["atp"],
  hbo: ["mxx"],
  paramount: ["pmp"],
  crunchyroll: ["cru"],
}

const REGIONS = ["IT", "US", "GB", "FR", "DE", "ES", "JP", "KR", "BR", "IN", "CA", "AU"]

const GET_PACKAGES_QUERY = `query GetPackages($country: Country!, $platform: Platform! = WEB, $includeAddons: Boolean! = true) {
  packages(country: $country, platform: $platform, includeAddons: $includeAddons) {
    shortName
    clearName
    addonParent(country: $country, platform: $platform) { shortName clearName }
  }
}`

async function fetchPackages(country) {
  const res = await fetch(JW_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Origin: "https://www.justwatch.com",
      Referer: "https://www.justwatch.com/",
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      operationName: "GetPackages",
      query: GET_PACKAGES_QUERY,
      variables: { country, platform: "WEB", includeAddons: true },
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  return json?.data?.packages || []
}

async function main() {
  const only = process.argv.slice(2).map((c) => c.toUpperCase())
  const regions = only.length > 0 ? only : REGIONS
  let failures = 0
  for (const country of regions) {
    let pkgs
    try {
      pkgs = await fetchPackages(country)
    } catch (err) {
      console.log(`${country}: ERRORE fetch (${err.message})`)
      failures++
      continue
    }
    const available = new Set(pkgs.map((p) => p.shortName))
    for (const [platform, codes] of Object.entries(EXPECTED)) {
      const missing = codes.filter((c) => !available.has(c))
      if (missing.length === 0) {
        console.log(`${country} ${platform}: OK (${codes.join(",")})`)
      } else {
        failures++
        console.log(`${country} ${platform}: MANCANTE [${missing.join(",")}] — attesi [${codes.join(",")}]`)
        const addonHits = pkgs.filter((p) => codes.includes(p.addonParent?.shortName))
        for (const h of addonHits) {
          console.log(`    ↳ canale add-on: ${h.shortName} (${h.clearName}) ← parent ${h.addonParent.shortName}`)
        }
      }
    }
  }
  if (failures > 0) {
    console.log(`\n${failures} controlli falliti — valuta aggiornamento PLATFORM_JW_PACKAGES`)
    process.exitCode = 1
  } else {
    console.log("\nTutti i package attesi sono disponibili in tutte le regioni")
  }
}

main()
