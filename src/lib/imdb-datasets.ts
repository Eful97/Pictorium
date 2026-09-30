import fsp from "node:fs/promises"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { atomicWriteFile } from "@/lib/atomic-write"
import { createLogger } from "@/lib/logger"
import { getKv, getStorageMode, withKvTimeout } from "@/lib/kv"
import { QuotaExceededError } from "@/lib/store"
import { IMDB_CSV_MAX_ITEMS } from "@/lib/imdb-csv"
import type { MDBListEntry } from "@/lib/mdblist"

const log = createLogger("imdb-datasets")

/**
 * Snapshot normalizzato di un import CSV IMDb, salvato nel namespace
 * dell'utente (o globale in single-user). Il config (token + server defaults)
 * porta solo il riferimento `datasetId`: mai centinaia di ID nel token
 * (tetto 32KB) né scraping delle pagine IMDb.
 */
export interface ImdbDataset {
  id: string
  name: string
  sourceUrl?: string
  items: MDBListEntry[]
  itemCount: number
  importedAt: string
}

/** Tetto dataset per namespace: import manuale, niente sync automatica. */
export const MAX_DATASETS_PER_SCOPE = 20

const DATASET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const UUID_RE = /^[0-9a-f-]{36}$/i

function assertValidDatasetId(id: string): void {
  if (!DATASET_ID_RE.test(id)) throw new Error("Invalid dataset id")
}

function assertValidUserId(userId: string): void {
  if (!UUID_RE.test(userId)) throw new Error("Invalid user id")
}

function newDatasetId(): string {
  return `ds_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function isKvMode(): boolean {
  return getStorageMode() === "kv"
}

function scopeOf(userId?: string | null): string {
  return userId ?? "global"
}

function datasetFile(id: string, userId?: string | null): string {
  assertValidDatasetId(id)
  if (userId) {
    assertValidUserId(userId)
    return path.join(DATA_DIR, "users", userId, "imdb-datasets", `${id}.json`)
  }
  return path.join(DATA_DIR, "imdb-datasets", `${id}.json`)
}

function kvKey(id: string, userId?: string | null): string {
  assertValidDatasetId(id)
  if (userId) assertValidUserId(userId)
  return `imdb_dataset:${scopeOf(userId)}:${id}`
}

function sanitizeItems(items: MDBListEntry[]): MDBListEntry[] {
  const seen = new Set<string>()
  const out: MDBListEntry[] = []
  for (const it of items) {
    const imdb = typeof it.imdb === "string" ? it.imdb.trim() : ""
    if (!/^tt\d{7,10}$/i.test(imdb)) continue
    const key = imdb.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const tmdb = typeof it.tmdb === "number" && Number.isFinite(it.tmdb) && it.tmdb > 0 ? it.tmdb : undefined
    out.push({
      imdb,
      tmdb,
      title: typeof it.title === "string" ? it.title.slice(0, 300) : "",
      year: Number(it.year) || 0,
      mediatype: it.mediatype === "movie" || it.mediatype === "tv" ? it.mediatype : undefined,
    })
    if (out.length >= IMDB_CSV_MAX_ITEMS) break
  }
  return out
}

async function countInScope(userId?: string | null): Promise<number> {
  if (isKvMode()) {
    let cursor = 0
    let count = 0
    const match = `imdb_dataset:${scopeOf(userId)}:*`
    for (;;) {
      const [next, keys] = await withKvTimeout(getKv().scan(cursor, { match, count: 100 }))
      count += keys.length
      if (next === 0) break
      cursor = next
    }
    return count
  }
  const dir = userId
    ? path.join(DATA_DIR, "users", userId, "imdb-datasets")
    : path.join(DATA_DIR, "imdb-datasets")
  const names = await fsp.readdir(dir).catch(() => [] as string[])
  return names.filter((n) => n.endsWith(".json")).length
}

export async function saveImdbDataset(
  name: string,
  items: MDBListEntry[],
  options?: { sourceUrl?: string; userId?: string | null },
): Promise<ImdbDataset> {
  const clean = sanitizeItems(items)
  if (clean.length === 0) throw new Error("No valid IMDb entries to save")
  if ((await countInScope(options?.userId)) >= MAX_DATASETS_PER_SCOPE) {
    throw new QuotaExceededError(MAX_DATASETS_PER_SCOPE)
  }
  const dataset: ImdbDataset = {
    id: newDatasetId(),
    name: (typeof name === "string" ? name : "").trim().slice(0, 100) || "IMDb CSV",
    sourceUrl: typeof options?.sourceUrl === "string" ? options.sourceUrl.slice(0, 500) : undefined,
    items: clean,
    itemCount: clean.length,
    importedAt: new Date().toISOString(),
  }
  if (isKvMode()) {
    await withKvTimeout(getKv().set(kvKey(dataset.id, options?.userId), dataset))
    return dataset
  }
  const file = datasetFile(dataset.id, options?.userId)
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteFile(file, JSON.stringify(dataset))
  return dataset
}

export async function getImdbDataset(id: string, userId?: string | null): Promise<ImdbDataset | null> {
  try {
    assertValidDatasetId(id)
    if (userId) assertValidUserId(userId)
  } catch {
    return null
  }
  try {
    if (isKvMode()) {
      return await withKvTimeout(getKv().get<ImdbDataset>(kvKey(id, userId)))
    }
    const raw = await fsp.readFile(datasetFile(id, userId), "utf-8")
    const data = JSON.parse(raw) as ImdbDataset
    if (!data || data.id !== id || !Array.isArray(data.items)) return null
    return data
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") return null
    log.warn("Failed to load IMDb dataset", { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

export async function deleteImdbDataset(id: string, userId?: string | null): Promise<boolean> {
  try {
    assertValidDatasetId(id)
    if (userId) assertValidUserId(userId)
  } catch {
    return false
  }
  if (isKvMode()) {
    const n = await withKvTimeout(getKv().del(kvKey(id, userId))).catch(() => 0)
    return n > 0
  }
  const removed = await fsp.unlink(datasetFile(id, userId)).then(() => true).catch(() => false)
  return removed
}

/** Evict per test: i dataset file non hanno mirror in-process. */
export function __resetImdbDatasetState(): void {}
