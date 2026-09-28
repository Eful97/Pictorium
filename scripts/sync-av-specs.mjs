#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dataFile = path.join(rootDir, "src", "data", "av-specs.json")

async function main() {
  console.log("=== Pictorium AV Specs Sync Tool ===")
  const current = JSON.parse(await fs.readFile(dataFile, "utf8"))
  const keys = Object.keys(current)
  console.log(`Current entries: ${keys.length}`)

  let dvCount = 0
  let atmosCount = 0
  let imaxCount = 0
  let fourKCount = 0

  for (const entry of Object.values(current)) {
    if (entry.quality === "4K") fourKCount++
    if (entry.formats?.includes("dv")) dvCount++
    if (entry.formats?.includes("atmos")) atmosCount++
    if (entry.formats?.includes("imax")) imaxCount++
  }

  console.log(`- 4K titles: ${fourKCount}`)
  console.log(`- Dolby Vision titles: ${dvCount}`)
  console.log(`- Dolby Atmos titles: ${atmosCount}`)
  console.log(`- IMAX titles: ${imaxCount}`)
  console.log("Sync check OK.")
}

main().catch((err) => {
  console.error("Error syncing AV specs:", err)
  process.exit(1)
})
