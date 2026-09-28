import fsp from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { DATA_DIR } from "@/lib/data-dir"
import { envWithFallback } from "@/lib/env-compat"
import { atomicWriteFile } from "@/lib/atomic-write"
import { createLogger } from "@/lib/logger"
import { getKv, getStorageMode } from "@/lib/kv"
import { sanitizeUserId } from "@/lib/user-auth"
import {
  BADGE_TARGETS,
  MAX_PRESETS_PER_USER,
  MAX_PRESET_JSON_BYTES,
  badgePresetSchema,
  computePresetFullRevision,
  generateBadgePresetId,
  isBadgePresetId,
  normalizeBadgeDesign,
  normalizeBadgePreset,
  normalizeHouseBadge,
  presetJsonSizeBytes,
  type BadgeDesign,
  type BadgePreset,
  type BadgePresetVariant,
  type HouseBadge,
} from "@/lib/badge-preset"

const log = createLogger("badge-preset-store")

// ---------------------------------------------------------------------------
// Badge preset store — M3: KV (Redis/Upstash) + filesystem fallback.
// Chiavi KV: preset JSON, Set indice utente, Sorted Set ranking pubblici,
// chiavi throttle download con TTL 24h. Mai SCAN: solo lookup O(1)/O(log N).
// Letture fail-open (null/vuoto + warn), scritture fail-closed (throw).
// ---------------------------------------------------------------------------

const PRESET_KEY_PREFIX = "pictorium:preset:"
const DOWNLOADS_ZSET = "pictorium:presets:public:downloads"
const CREATED_ZSET = "pictorium:presets:public:created"
const DL_THROTTLE_TTL_S = 86400

const presetKey = (id: string): string => `${PRESET_KEY_PREFIX}${id}`
const userIndexKey = (userUuid: string): string => `pictorium:user:${userUuid}:presets`
const dlThrottleKey = (presetId: string, ipHash: string): string => `pictorium:dl:${presetId}:${ipHash}`

export class PresetQuotaError extends Error {
  constructor(readonly max: number) {
    super(`Preset quota exceeded: max ${max} per user`)
    this.name = "PresetQuotaError"
  }
}

export class PresetNotFoundError extends Error {
  constructor(readonly presetId: string) {
    super(`Preset not found: ${presetId}`)
    this.name = "PresetNotFoundError"
  }
}

export class PresetForbiddenError extends Error {
  constructor() {
    super("Preset belongs to another user")
    this.name = "PresetForbiddenError"
  }
}

export class PresetValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PresetValidationError"
  }
}

export interface PresetCreateInput {
  target: BadgePreset["target"]
  visibility: BadgePreset["visibility"]
  forkedFrom?: string | null
  metadata: { name: string; description?: string; tags: string[] }
  variant?: BadgePresetVariant
  design?: BadgeDesign
  house?: HouseBadge
}

export interface PresetPatch {
  target?: BadgePreset["target"]
  visibility?: BadgePreset["visibility"]
  forkedFrom?: string | null
  metadata?: { name: string; description?: string; tags: string[] }
  variant?: BadgePresetVariant
  design?: BadgeDesign
  house?: HouseBadge
}

/** Preset + contatore download (il conteggio vive negli indici, mai nel JSON). */
export interface StoredPreset {
  preset: BadgePreset
  downloads: number
}

export type PublicPresetSort = "downloads" | "newest"

export interface PublicPresetPage {
  items: StoredPreset[]
  nextCursor: number | null
}

const createInputSchema = z.strictObject({
  target: z.enum(BADGE_TARGETS),
  visibility: z.enum(["public", "private"]),
  forkedFrom: z.string().nullable().optional(),
  metadata: z.strictObject({
    name: z.string().min(1).max(60),
    description: z.string().max(300).optional(),
    tags: z.array(z.string().min(2).max(20)).max(8),
  }),
  variant: z.enum(["custom", "house"]).optional(),
  design: z.unknown().optional(),
  house: z.unknown().optional(),
})

function requireOwner(userUuid: string): string {
  const clean = sanitizeUserId(userUuid)
  if (!clean) throw new PresetValidationError("Invalid owner UUID")
  return clean
}

function requirePresetId(id: string): string {
  if (!isBadgePresetId(id)) throw new PresetValidationError("Invalid preset id")
  return id
}

function isKvMode(): boolean {
  return getStorageMode() === "kv"
}

function assertSize(preset: BadgePreset): void {
  if (presetJsonSizeBytes(preset) > MAX_PRESET_JSON_BYTES) {
    throw new PresetValidationError(`Preset exceeds ${MAX_PRESET_JSON_BYTES} bytes`)
  }
}

// --- Filesystem fallback (single-node): stessa semantica del KV ----------

interface PresetFileDoc {
  version: 1
  presets: Record<string, BadgePreset>
  userIndex: Record<string, string[]>
  downloads: Record<string, number>
  created: Record<string, number>
  dlThrottle: Record<string, number>
}

function emptyFileDoc(): PresetFileDoc {
  return { version: 1, presets: {}, userIndex: {}, downloads: {}, created: {}, dlThrottle: {} }
}

/** Path risolto live (mai a module level): i test mutano DATA_DIR + resetModules. */
function presetFilePath(): string {
  const dir = envWithFallback("DATA_DIR") || DATA_DIR
  return path.join(dir, "presets-store.json")
}

const fileCache = new Map<string, PresetFileDoc>()
let fileMutex: Promise<void> = Promise.resolve()

function withFileLock<T>(run: () => Promise<T>): Promise<T> {
  const next = fileMutex.then(run)
  fileMutex = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/** Solo test: svuota la cache del fallback file. */
export function __resetPresetStoreForTests(): void {
  fileCache.clear()
}

async function loadFileDoc(): Promise<PresetFileDoc> {
  const file = presetFilePath()
  const cached = fileCache.get(file)
  if (cached) return cached
  let doc = emptyFileDoc()
  try {
    const raw = await fsp.readFile(file, "utf-8")
    const parsed = JSON.parse(raw) as Partial<PresetFileDoc>
    if (
      parsed &&
      parsed.version === 1 &&
      parsed.presets &&
      typeof parsed.presets === "object" &&
      parsed.userIndex &&
      typeof parsed.userIndex === "object"
    ) {
      doc = {
        version: 1,
        presets: parsed.presets as Record<string, BadgePreset>,
        userIndex: parsed.userIndex as Record<string, string[]>,
        downloads: (parsed.downloads as Record<string, number>) ?? {},
        created: (parsed.created as Record<string, number>) ?? {},
        dlThrottle: (parsed.dlThrottle as Record<string, number>) ?? {},
      }
    }
  } catch {
    // File assente o corrotto: si parte da doc vuoto (le letture restano fail-open).
  }
  fileCache.set(file, doc)
  return doc
}

async function writeFileDoc(doc: PresetFileDoc): Promise<void> {
  const file = presetFilePath()
  fileCache.set(file, doc)
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteFile(file, JSON.stringify(doc))
}

// --- Letture interne (raw, senza join download) ----------------------------

async function readRawPreset(id: string): Promise<BadgePreset | null> {
  if (isKvMode()) {
    const raw = await getKv().get<BadgePreset>(presetKey(id))
    if (!raw || typeof raw !== "object") return null
    const parsed = badgePresetSchema.safeParse(raw)
    if (!parsed.success) {
      log.warn("preset KV record invalid, treated as missing", { id })
      return null
    }
    return parsed.data
  }
  const doc = await loadFileDoc()
  const raw = doc.presets[id]
  if (!raw) return null
  const parsed = badgePresetSchema.safeParse(raw)
  if (!parsed.success) {
    log.warn("preset file record invalid, treated as missing", { id })
    return null
  }
  return parsed.data
}

async function readDownloadCount(id: string): Promise<number> {
  try {
    if (isKvMode()) return (await getKv().zscore(DOWNLOADS_ZSET, id)) ?? 0
    const doc = await loadFileDoc()
    return doc.downloads[id] ?? 0
  } catch {
    return 0
  }
}

async function userPresetIds(userUuid: string): Promise<string[]> {
  if (isKvMode()) return getKv().smembers(userIndexKey(userUuid))
  const doc = await loadFileDoc()
  return [...(doc.userIndex[userUuid] ?? [])]
}

function toStored(preset: BadgePreset, downloads: number): StoredPreset {
  return { preset, downloads }
}

// --- API pubblica -----------------------------------------------------------

/**
 * Lettura fail-open: preset assente/invalido/KV irraggiungibile → null
 * (il poster-service degrada sul badgeStyle del mapping, mai 500).
 */
export async function getPreset(id: string): Promise<StoredPreset | null> {
  if (!isBadgePresetId(id)) return null
  try {
    const preset = await readRawPreset(id)
    if (!preset) return null
    return toStored(preset, await readDownloadCount(id))
  } catch (e) {
    log.warn("preset read failed, fail-open null", { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

/** Come getPreset ma i privati sono visibili solo al proprietario. */
export async function getPresetForUser(id: string, userUuid: string): Promise<StoredPreset | null> {
  const stored = await getPreset(id)
  if (!stored) return null
  if (stored.preset.visibility === "public") return stored
  const clean = sanitizeUserId(userUuid)
  if (clean && stored.preset.ownerUuid === clean) return stored
  return null
}

/** Preset dell'utente (pubblici + privati), i più recenti prima. */
export async function listUserPresets(userUuid: string): Promise<StoredPreset[]> {
  const owner = requireOwner(userUuid)
  try {
    const ids = await userPresetIds(owner)
    const items: StoredPreset[] = []
    for (const id of ids) {
      const stored = await getPreset(id)
      if (stored) items.push(stored)
    }
    items.sort((a, b) => b.preset.updatedAt - a.preset.updatedAt)
    return items
  } catch (e) {
    log.warn("user presets list failed, fail-open empty", { error: e instanceof Error ? e.message : String(e) })
    return []
  }
}

/** Catalogo pubblico (ranking download o cronologico), paginato a cursore. */
export async function listPublicPresets(
  sort: PublicPresetSort,
  limit = 24,
  cursor = 0,
): Promise<PublicPresetPage> {
  const take = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 100) : 24
  const start = Number.isFinite(cursor) ? Math.max(Math.floor(cursor), 0) : 0
  const key = sort === "downloads" ? DOWNLOADS_ZSET : CREATED_ZSET
  try {
    let ids: string[]
    if (isKvMode()) {
      ids = await getKv().zrevrange(key, start, start + take - 1)
    } else {
      const doc = await loadFileDoc()
      const scores = sort === "downloads" ? doc.downloads : doc.created
      ids = Object.keys(doc.presets)
        .filter((id) => doc.presets[id]?.visibility === "public")
        .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a.localeCompare(b))
        .slice(start, start + take)
    }
    const items: StoredPreset[] = []
    for (const id of ids) {
      const stored = await getPreset(id)
      if (stored && stored.preset.visibility === "public") items.push(stored)
    }
    return { items, nextCursor: ids.length === take ? start + take : null }
  } catch (e) {
    log.warn("public presets list failed, fail-open empty", { error: e instanceof Error ? e.message : String(e) })
    return { items: [], nextCursor: null }
  }
}

/** Creazione: id/timestamp/revision generati dal server, quota 100/utente. */
export async function savePreset(userUuid: string, input: PresetCreateInput): Promise<StoredPreset> {
  const owner = requireOwner(userUuid)
  const parsed = createInputSchema.safeParse(input)
  if (!parsed.success) throw new PresetValidationError("Invalid preset input")
  if (parsed.data.forkedFrom !== undefined && parsed.data.forkedFrom !== null && !isBadgePresetId(parsed.data.forkedFrom)) {
    throw new PresetValidationError("Invalid forkedFrom id")
  }
  const variant = parsed.data.variant ?? "custom"
  const design = variant === "custom" ? normalizeBadgeDesign(parsed.data.design as BadgeDesign) : undefined
  const house = variant === "house" ? normalizeHouseBadge(parsed.data.house as HouseBadge) : undefined
  const now = Date.now()
  if (isKvMode()) {
    const kv = getKv()
    const ids = await kv.smembers(userIndexKey(owner))
    if (ids.length >= MAX_PRESETS_PER_USER) throw new PresetQuotaError(MAX_PRESETS_PER_USER)
    let id = generateBadgePresetId()
    for (let i = 0; i < 3 && (await kv.get(presetKey(id))) !== null; i++) id = generateBadgePresetId()
    const preset = normalizeBadgePreset({
      version: 1,
      id,
      ownerUuid: owner,
      target: parsed.data.target,
      visibility: parsed.data.visibility,
      forkedFrom: parsed.data.forkedFrom ?? null,
      metadata: parsed.data.metadata,
      variant,
      design,
      house,
      createdAt: now,
      updatedAt: now,
      revision: computePresetFullRevision(variant, design, house),
    })
    assertSize(preset)
    await kv.set(presetKey(id), preset)
    await kv.sadd(userIndexKey(owner), id)
    if (preset.visibility === "public") {
      await kv.zadd(DOWNLOADS_ZSET, 0, id)
      await kv.zadd(CREATED_ZSET, preset.createdAt, id)
    }
    return toStored(preset, 0)
  }
  return withFileLock(async () => {
    const doc = await loadFileDoc()
    const ids = doc.userIndex[owner] ?? []
    if (ids.length >= MAX_PRESETS_PER_USER) throw new PresetQuotaError(MAX_PRESETS_PER_USER)
    let id = generateBadgePresetId()
    for (let i = 0; i < 3 && doc.presets[id]; i++) id = generateBadgePresetId()
    const preset = normalizeBadgePreset({
      version: 1,
      id,
      ownerUuid: owner,
      target: parsed.data.target,
      visibility: parsed.data.visibility,
      forkedFrom: parsed.data.forkedFrom ?? null,
      metadata: parsed.data.metadata,
      variant,
      design,
      house,
      createdAt: now,
      updatedAt: now,
      revision: computePresetFullRevision(variant, design, house),
    })
    assertSize(preset)
    doc.presets[id] = preset
    doc.userIndex[owner] = [...ids, id]
    if (preset.visibility === "public") {
      doc.downloads[id] = 0
      doc.created[id] = preset.createdAt
    }
    await writeFileDoc(doc)
    return toStored(preset, 0)
  })
}

/** Aggiornamento (solo proprietario): revision ricalcolata, indici sincronizzati. */
export async function updatePreset(userUuid: string, id: string, patch: PresetPatch): Promise<StoredPreset> {
  const owner = requireOwner(userUuid)
  const cleanId = requirePresetId(id)
  const merge = (current: BadgePreset | null): { preset: BadgePreset; wasPublic: boolean } => {
    if (!current) throw new PresetNotFoundError(cleanId)
    if (current.ownerUuid !== owner) throw new PresetForbiddenError()
    const wasPublic = current.visibility === "public"
    const merged: BadgePreset = {
      ...current,
      ...(patch.target !== undefined ? { target: patch.target } : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
      ...(patch.forkedFrom !== undefined ? { forkedFrom: patch.forkedFrom } : {}),
      ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
      ...(patch.variant !== undefined ? { variant: patch.variant } : {}),
      // Cambio variante: scarta il payload dell'altra (mai design+house
      // stantii insieme — la revision copre solo quello attivo).
      ...(patch.variant !== undefined && patch.variant !== (current.variant ?? "custom")
        ? { design: undefined, house: undefined }
        : {}),
      ...(patch.design !== undefined ? { design: normalizeBadgeDesign(patch.design) } : {}),
      ...(patch.house !== undefined ? { house: normalizeHouseBadge(patch.house) } : {}),
      updatedAt: Date.now(),
    }
    const preset = normalizeBadgePreset({
      ...merged,
      revision: computePresetFullRevision(merged.variant ?? "custom", merged.design, merged.house),
    })
    assertSize(preset)
    return { preset, wasPublic }
  }
  if (isKvMode()) {
    const kv = getKv()
    // Due write sequenziali sulla stessa chiave: l'ultima vince, gli indici
    // restano coerenti (il ranking non è un contatore critico).
    const { preset, wasPublic } = merge(await readRawPreset(cleanId))
    await kv.set(presetKey(cleanId), preset)
    const isPublic = preset.visibility === "public"
    if (isPublic && !wasPublic) {
      await kv.zadd(DOWNLOADS_ZSET, 0, cleanId)
      await kv.zadd(CREATED_ZSET, preset.createdAt, cleanId)
    } else if (!isPublic && wasPublic) {
      await kv.zrem(DOWNLOADS_ZSET, cleanId)
      await kv.zrem(CREATED_ZSET, cleanId)
    }
    return toStored(preset, await readDownloadCount(cleanId))
  }
  return withFileLock(async () => {
    const doc = await loadFileDoc()
    const { preset, wasPublic } = merge(doc.presets[cleanId] ?? null)
    doc.presets[cleanId] = preset
    const isPublic = preset.visibility === "public"
    if (isPublic && !wasPublic) {
      doc.downloads[cleanId] = doc.downloads[cleanId] ?? 0
      doc.created[cleanId] = preset.createdAt
    } else if (!isPublic && wasPublic) {
      delete doc.downloads[cleanId]
      delete doc.created[cleanId]
    }
    await writeFileDoc(doc)
    return toStored(preset, doc.downloads[cleanId] ?? 0)
  })
}

/** Cancellazione (solo proprietario): rimuove preset + indici. False se assente. */
export async function deletePreset(userUuid: string, id: string): Promise<boolean> {
  const owner = requireOwner(userUuid)
  const cleanId = requirePresetId(id)
  if (isKvMode()) {
    const kv = getKv()
    const current = await readRawPreset(cleanId)
    if (!current) return false
    if (current.ownerUuid !== owner) throw new PresetForbiddenError()
    await kv.del(presetKey(cleanId))
    await kv.srem(userIndexKey(owner), cleanId)
    await kv.zrem(DOWNLOADS_ZSET, cleanId)
    await kv.zrem(CREATED_ZSET, cleanId)
    return true
  }
  return withFileLock(async () => {
    const doc = await loadFileDoc()
    const current = doc.presets[cleanId]
    if (!current) return false
    if (current.ownerUuid !== owner) throw new PresetForbiddenError()
    delete doc.presets[cleanId]
    doc.userIndex[owner] = (doc.userIndex[owner] ?? []).filter((v) => v !== cleanId)
    delete doc.downloads[cleanId]
    delete doc.created[cleanId]
    await writeFileDoc(doc)
    return true
  })
}

/** Contatore download (solo per indirizzo unico/24h, mai self-download). */
export async function getDownloadCount(id: string): Promise<number> {
  if (!isBadgePresetId(id)) return 0
  return readDownloadCount(id)
}

/**
 * Incremento protetto: il proprietario non conta mai; ogni ipHash conta al
 * massimo una volta ogni 24h. Ritorna il conteggio corrente.
 * (La coppia check-throttle + incr è best-effort sotto concorrenza: un doppio
 * conteggio simultaneo è benigno per una statistica.)
 */
export async function incrementDownload(
  presetId: string,
  ipHash: string,
  opts?: { isOwner?: boolean },
): Promise<number> {
  if (!isBadgePresetId(presetId)) return 0
  if (!ipHash || ipHash.length > 128) return readDownloadCount(presetId)
  if (opts?.isOwner) return readDownloadCount(presetId)
  if (isKvMode()) {
    const kv = getKv()
    try {
      const preset = await readRawPreset(presetId)
      if (!preset || preset.visibility !== "public") return 0
      const throttle = dlThrottleKey(presetId, ipHash)
      if ((await kv.get(throttle)) !== null) return (await kv.zscore(DOWNLOADS_ZSET, presetId)) ?? 0
      await kv.set(throttle, "1", { ex: DL_THROTTLE_TTL_S })
      return await kv.zincrby(DOWNLOADS_ZSET, 1, presetId)
    } catch (e) {
      log.warn("download increment failed, fail-open count", {
        error: e instanceof Error ? e.message : String(e),
      })
      return 0
    }
  }
  return withFileLock(async () => {
    const doc = await loadFileDoc()
    const preset = doc.presets[presetId]
    if (!preset || preset.visibility !== "public") return 0
    const key = `${presetId}:${ipHash}`
    const now = Date.now()
    if ((doc.dlThrottle[key] ?? 0) > now) return doc.downloads[presetId] ?? 0
    doc.dlThrottle[key] = now + DL_THROTTLE_TTL_S * 1000
    doc.downloads[presetId] = (doc.downloads[presetId] ?? 0) + 1
    await writeFileDoc(doc)
    return doc.downloads[presetId]
  })
}
