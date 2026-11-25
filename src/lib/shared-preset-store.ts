import fsp from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { DATA_DIR } from "./data-dir"
import { atomicWriteFile } from "./atomic-write"
import { getKv, getStorageMode } from "./kv"
import { sanitizeUserId } from "./user-auth"
import { stripRemovedFreshFontKeys, visualPresetInputSchema, visualPresetSchema, type VisualPresetShape } from "./visual-presets"
import { createLogger } from "./logger"
import { READY_PRESET_ENTRIES } from "./ready-visual-presets"
import { isPresetNameAllowed } from "./preset-name-filter"

const log = createLogger("shared-presets")

/**
 * Instance-wide community gallery of published visual presets (MULTI_USER only).
 *
 * Publishing stores a COPY of the values: later edits/deletes of the author's
 * personal preset never change the gallery entry. Author and likers are kept
 * server-side as userIds (unpublish/rename rights, quota, one like per user)
 * and are never returned to clients: only `mine`, `likeCount`, `likedByMe`.
 *
 * Likes live inside the entry (one read-modify-write, serialized in-process).
 * On multi-instance KV deployments two simultaneous likes on different
 * instances can lose one update: accepted, likes are low-stakes.
 */

// Every gallery tile renders a real preview through an authenticated fetch
// (eager, not lazy): keep the total near the personal list budget (20/shape).
export const MAX_SHARED_PRESETS = 24
export const MAX_SHARED_PRESETS_PER_AUTHOR = 5
export const MAX_AUTHOR_NAME = 24

const KEY = "shared-presets"
const FILE = path.join(DATA_DIR, "shared-presets.json")

/**
 * Built-in ready looks join the ranking as fixed entries (`ready:<shape>:<id>`):
 * likeable by everyone, never renamed/removed, values resolved client-side
 * from READY_PRESET_ENTRIES (applied through the ready path). Their likes
 * live in a separate record keyed `<shape>:<id>`.
 */
const READY_IDS = READY_PRESET_ENTRIES.map((entry) => entry.id)
const READY_KEY = "shared-presets-ready-likes"
const READY_FILE = path.join(DATA_DIR, "shared-presets-ready-likes.json")
const READY_ID_RE = /^ready:(portrait|landscape):([a-z-]+)$/

function parseReadyId(id: string): { field: string; shape: VisualPresetShape } | null {
  const match = READY_ID_RE.exec(id)
  if (!match || !READY_IDS.includes(match[2])) return null
  return { field: `${match[1]}:${match[2]}`, shape: match[1] as VisualPresetShape }
}

type ReadyLikes = Record<string, string[]>
const readyLikesSchema = z.record(z.string(), z.array(z.string().uuid()))

async function loadReadyLikes(): Promise<ReadyLikes> {
  let raw: unknown
  if (getStorageMode() === "kv") {
    raw = (await getKv().hgetall<ReadyLikes>(READY_KEY)) ?? {}
  } else {
    try { raw = JSON.parse(await fsp.readFile(READY_FILE, "utf8")) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
      throw error
    }
  }
  const parsed = readyLikesSchema.safeParse(raw)
  if (!parsed.success) {
    log.warn("Ignoring invalid ready-preset likes record")
    return {}
  }
  return parsed.data
}

async function persistReadyLikes(next: ReadyLikes, changed: string[]) {
  if (getStorageMode() === "kv") {
    if (changed.length) await getKv().hset(READY_KEY, Object.fromEntries(changed.map((field) => [field, next[field] ?? []])))
    return
  }
  await fsp.mkdir(path.dirname(READY_FILE), { recursive: true })
  await atomicWriteFile(READY_FILE, JSON.stringify(next))
}

const sharedPresetSchema = visualPresetSchema.omit({ mode: true }).extend({
  author: z.string().uuid(),
  publishedAt: z.number().int().nonnegative(),
  // Default: entries published before likes existed stay valid.
  likes: z.array(z.string().uuid()).default([]),
  // Optional public credit chosen by the author at publish time; null = anonymous.
  authorName: z.string().max(MAX_AUTHOR_NAME).nullable().default(null),
})
type SharedPreset = z.infer<typeof sharedPresetSchema>

/** Display name: trimmed, whitespace collapsed, control chars dropped; empty = anonymous. */
const authorNameSchema = z.string().transform((raw) => raw.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim())
  .pipe(z.string().max(MAX_AUTHOR_NAME)).nullish().transform((name) => name || null)

const publishSchema = visualPresetInputSchema.omit({ id: true, mode: true }).extend({ authorName: authorNameSchema })
const unpublishSchema = z.object({ id: z.string().uuid() }).strict()
const updateSchema = z.union([
  z.object({ id: z.string().uuid(), name: visualPresetInputSchema.shape.name }).strict(),
  z.object({ id: z.union([z.string().uuid(), z.string().regex(READY_ID_RE)]), like: z.boolean() }).strict(),
])

export interface PublicSharedPreset {
  id: string
  name: string
  shape: VisualPresetShape
  /** null for built-in ready looks (resolved client-side from `builtin`). */
  values: SharedPreset["values"] | null
  /** Ready-look id for built-in entries; absent for user-published ones. */
  builtin?: string
  /** Credit chosen by the author; null/absent = anonymous (and always for built-ins). */
  authorName: string | null
  mine: boolean
  /** Author or admin (moderation): the caller may unpublish this entry. */
  canRemove: boolean
  likeCount: number
  likedByMe: boolean
}

function owner(userId: string) {
  if (sanitizeUserId(userId) !== userId) throw new Error("Invalid user")
  return userId
}

async function loadAll(): Promise<SharedPreset[]> {
  let raw: unknown
  if (getStorageMode() === "kv") {
    raw = Object.values((await getKv().hgetall<Record<string, SharedPreset>>(KEY)) ?? {})
  } else {
    try { raw = JSON.parse(await fsp.readFile(FILE, "utf8")) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
  }
  // Per-entry parse: one stale/invalid entry must not take the whole
  // instance gallery down (list AND unpublish) for every user.
  if (!Array.isArray(raw)) throw new Error("Invalid shared preset storage")
  const out: SharedPreset[] = []
  for (const item of raw) {
    const parsed = sharedPresetSchema.safeParse(stripRemovedFreshFontKeys(item))
    if (parsed.success) out.push(parsed.data)
    else log.warn("Skipping invalid shared preset entry")
  }
  return out
}

async function persist(next: SharedPreset[], changed: { set?: SharedPreset[]; del?: string[] }) {
  if (getStorageMode() === "kv") {
    if (changed.set?.length) await getKv().hset(KEY, Object.fromEntries(changed.set.map((entry) => [entry.id, entry])))
    if (changed.del?.length) await getKv().hdel(KEY, ...changed.del)
    return
  }
  await fsp.mkdir(path.dirname(FILE), { recursive: true })
  await atomicWriteFile(FILE, JSON.stringify(next))
}

function toPublic(entry: SharedPreset, userId: string, isAdmin: boolean): PublicSharedPreset {
  const mine = entry.author === userId
  return {
    id: entry.id, name: entry.name, shape: entry.shape, values: entry.values, authorName: entry.authorName,
    mine, canRemove: mine || isAdmin,
    likeCount: entry.likes.length, likedByMe: entry.likes.includes(userId),
  }
}

/**
 * Ranking: most liked first; ties: user entries newest first, then built-ins
 * in their canonical gallery order (rank key `-index`, below any timestamp).
 */
function listFor(all: SharedPreset[], readyLikes: ReadyLikes, userId: string, shape: VisualPresetShape, isAdmin: boolean): PublicSharedPreset[] {
  const users = all
    .filter((entry) => entry.shape === shape)
    .map((entry) => ({ order: entry.publishedAt, item: toPublic(entry, userId, isAdmin) }))
  const builtins = READY_PRESET_ENTRIES.map((ready, index) => {
    const likes = readyLikes[`${shape}:${ready.id}`] ?? []
    return {
      order: -index,
      item: {
        id: `ready:${shape}:${ready.id}`, name: ready.label, shape, values: null, builtin: ready.id, authorName: null,
        mine: false, canRemove: false, likeCount: likes.length, likedByMe: likes.includes(userId),
      } satisfies PublicSharedPreset,
    }
  })
  return [...users, ...builtins]
    .sort((a, b) => b.item.likeCount - a.item.likeCount || b.order - a.order || a.item.id.localeCompare(b.item.id))
    .map(({ item }) => item)
}

export async function listSharedPresets(userId: string, shape: VisualPresetShape, isAdmin: boolean): Promise<PublicSharedPreset[]> {
  const [all, readyLikes] = await Promise.all([loadAll(), loadReadyLikes()])
  return listFor(all, readyLikes, owner(userId), shape, isAdmin)
}

let queue: Promise<unknown> = Promise.resolve()

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.catch(() => {}).then(task)
  queue = run
  return run
}

export function publishSharedPreset(userId: string, body: unknown): Promise<PublicSharedPreset[]> {
  const author = owner(userId)
  return serialized(async () => {
    const input = publishSchema.parse(stripRemovedFreshFontKeys(body))
    if (!isPresetNameAllowed(input.name) || (input.authorName && !isPresetNameAllowed(input.authorName))) throw new Error("Name not allowed")
    const all = await loadAll()
    if (all.length >= MAX_SHARED_PRESETS || all.filter((entry) => entry.author === author).length >= MAX_SHARED_PRESETS_PER_AUTHOR) {
      throw new Error("Shared preset limit reached")
    }
    const entry: SharedPreset = { id: randomUUID(), name: input.name, shape: input.shape, values: input.values, author, publishedAt: Date.now(), likes: [], authorName: input.authorName }
    const next = [...all, entry]
    await persist(next, { set: [entry] })
    return listFor(next, await loadReadyLikes(), author, input.shape, false)
  })
}

/**
 * Rename (author only) or like/unlike (anyone but the author). `like` is an
 * idempotent target state, never a toggle: a retry cannot flip it back.
 */
export function updateSharedPreset(userId: string, body: unknown, isAdmin: boolean): Promise<PublicSharedPreset[]> {
  const requester = owner(userId)
  return serialized(async () => {
    const input = updateSchema.parse(body)
    if ("name" in input && !isPresetNameAllowed(input.name)) throw new Error("Name not allowed")
    const [all, readyLikes] = await Promise.all([loadAll(), loadReadyLikes()])
    const ready = parseReadyId(input.id)
    if (ready) {
      // Built-in: like/unlike only (the union admits only `like` for ready ids).
      if (!("like" in input)) throw new Error("Forbidden")
      const others = (readyLikes[ready.field] ?? []).filter((liker) => liker !== requester)
      const next = { ...readyLikes, [ready.field]: input.like ? [...others, requester] : others }
      await persistReadyLikes(next, [ready.field])
      return listFor(all, next, requester, ready.shape, isAdmin)
    }
    if (READY_ID_RE.test(input.id)) throw new Error("Preset not found")
    const entry = all.find((candidate) => candidate.id === input.id)
    if (!entry) throw new Error("Preset not found")
    let updated: SharedPreset
    if ("name" in input) {
      if (entry.author !== requester) throw new Error("Forbidden")
      updated = { ...entry, name: input.name }
    } else {
      if (entry.author === requester) throw new Error("Forbidden")
      const others = entry.likes.filter((liker) => liker !== requester)
      updated = { ...entry, likes: input.like ? [...others, requester] : others }
    }
    const next = all.map((candidate) => candidate.id === updated.id ? updated : candidate)
    await persist(next, { set: [updated] })
    return listFor(next, readyLikes, requester, entry.shape, isAdmin)
  })
}

/** Author removes own entry; `isAdmin` (admin token) may remove any entry (moderation). */
export function unpublishSharedPreset(userId: string, body: unknown, isAdmin: boolean): Promise<PublicSharedPreset[]> {
  const requester = owner(userId)
  return serialized(async () => {
    const { id } = unpublishSchema.parse(body)
    const all = await loadAll()
    const entry = all.find((candidate) => candidate.id === id)
    if (!entry) throw new Error("Preset not found")
    if (entry.author !== requester && !isAdmin) throw new Error("Forbidden")
    const next = all.filter((candidate) => candidate.id !== id)
    await persist(next, { del: [id] })
    return listFor(next, await loadReadyLikes(), requester, entry.shape, isAdmin)
  })
}

/** User wipe: drop the user's published entries and their likes on others' entries. */
export function removeUserFromSharedPresets(userId: string): Promise<void> {
  const user = owner(userId)
  return serialized(async () => {
    const [all, readyLikes] = await Promise.all([loadAll(), loadReadyLikes()])
    const gone = all.filter((entry) => entry.author === user).map((entry) => entry.id)
    const unliked = all
      .filter((entry) => entry.author !== user && entry.likes.includes(user))
      .map((entry) => ({ ...entry, likes: entry.likes.filter((liker) => liker !== user) }))
    if (gone.length > 0 || unliked.length > 0) {
      const next = all
        .filter((entry) => entry.author !== user)
        .map((entry) => unliked.find((u) => u.id === entry.id) ?? entry)
      await persist(next, { set: unliked, del: gone })
    }
    const readyChanged = Object.keys(readyLikes).filter((field) => readyLikes[field].includes(user))
    if (readyChanged.length > 0) {
      const nextReady = { ...readyLikes }
      for (const field of readyChanged) nextReady[field] = nextReady[field].filter((liker) => liker !== user)
      await persistReadyLikes(nextReady, readyChanged)
    }
  })
}
