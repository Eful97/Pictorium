import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fontsDir = path.join(__dirname, "..", "src", "assets", "fonts")
if (!fs.existsSync(fontsDir)) {
  fs.mkdirSync(fontsDir, { recursive: true })
}

const fonts = [
  {
    name: "Inter-Regular.ttf",
    url: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/inter/Inter_400Regular.ttf",
  },
  {
    name: "Inter-Bold.ttf",
    url: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/inter/Inter_700Bold.ttf",
  },
  {
    name: "Inter-Black.ttf",
    url: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/inter/Inter_900Black.ttf",
  },
  {
    name: "NotoSansSymbols2-Regular.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssymbols2/NotoSansSymbols2-Regular.ttf",
  },
  // Rubik (SIL OFL 1.1) copre latino + ebraico: Inter non ha glifi ebraici, e
  // senza questi file ogni badge in ebraico verrebbe rasterizzato come tofu.
  // URL statici (non il .ttf variabile del repo google/fonts): fontdb di resvg
  // 0.36 non seleziona la posizione sull'asse wght di un font variabile e
  // renderizzerebbe tutto a peso regular.
  {
    name: "Rubik-Regular.ttf",
    url: "https://fonts.gstatic.com/s/rubik/v31/iJWZBXyIfDnIV5PNhY1KTN7Z-Yh-B4i1UA.ttf",
  },
  {
    name: "Rubik-Bold.ttf",
    url: "https://fonts.gstatic.com/s/rubik/v31/iJWZBXyIfDnIV5PNhY1KTN7Z-Yh-4I-1UA.ttf",
  },
  {
    name: "Rubik-Black.ttf",
    url: "https://fonts.gstatic.com/s/rubik/v31/iJWZBXyIfDnIV5PNhY1KTN7Z-Yh-ro-1UA.ttf",
  },
  // Barlow Condensed (SIL OFL 1.1, Jake Fleming): condensed grottesca per il
  // selettore "Font dei badge". Pesi statici come Inter (400/700/900): il 600
  // del badge genere risolve sul Bold come già fa Inter. Stessa fonte degli
  // altri (expo-google-fonts via jsDelivr, build google/fonts).
  {
    name: "BarlowCondensed-Regular.ttf",
    url: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/barlow-condensed@0.4.1/400Regular/BarlowCondensed_400Regular.ttf",
  },
  {
    name: "BarlowCondensed-Bold.ttf",
    url: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/barlow-condensed@0.4.1/700Bold/BarlowCondensed_700Bold.ttf",
  },
  {
    name: "BarlowCondensed-Black.ttf",
    url: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/barlow-condensed@0.4.1/900Black/BarlowCondensed_900Black.ttf",
  },
  // Oswald (SIL OFL 1.1, Vernon Adams): condensed per il selettore "Font dei
  // badge". Il variabile upstream arriva a 700: pesi statici 400/600/700
  // (il 900 del nastro risolve sul Bold). Stessa fonte degli altri.
  {
    name: "Oswald-Regular.ttf",
    url: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/oswald@0.4.2/400Regular/Oswald_400Regular.ttf",
  },
  {
    name: "Oswald-SemiBold.ttf",
    url: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/oswald@0.4.2/600SemiBold/Oswald_600SemiBold.ttf",
  },
  {
    name: "Oswald-Bold.ttf",
    url: "https://cdn.jsdelivr.net/npm/@expo-google-fonts/oswald@0.4.2/700Bold/Oswald_700Bold.ttf",
  },
]

async function download(font) {
  const dest = path.join(fontsDir, font.name)
  console.log(`Downloading ${font.name} from ${font.url}...`)
  try {
    const response = await fetch(font.url)
    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(dest, buffer)
    console.log(`Saved ${font.name} to ${dest} (${buffer.length} bytes)`)
  } catch (e) {
    console.error(`Error fetching ${font.name}:`, e)
    throw e
  }
}

async function main() {
  for (const font of fonts) {
    try {
      await download(font)
    } catch {
      process.exit(1)
    }
  }
  console.log("All fonts downloaded successfully!")
}

await main()
