import fsp from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { DATA_DIR } from "./data-dir"
import { atomicWriteFile } from "./atomic-write"
import { getKv, getStorageMode } from "./kv"
import { sanitizeUserId } from "./user-auth"
import { MAX_VISUAL_PRESETS, visualPresetDeleteSchema, visualPresetInputSchema, visualPresetSchema, type VisualPreset, type VisualPresetShape } from "./visual-presets"

function location(userId: string | null) {
  if (userId !== null && sanitizeUserId(userId) !== userId) throw new Error("Invalid user")
  return {
    key: `visual-presets:${userId ?? "global"}`,
    file: path.join(DATA_DIR, ...(userId ? ["users", userId] : []), "visual-presets.json"),
  }
}

export async function listVisualPresets(userId: string | null, shape: VisualPresetShape = "portrait"): Promise<VisualPreset[]> {
  return (await loadAllPresets(userId))
    .filter((preset) => preset.shape === shape)
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function loadAllPresets(userId: string | null): Promise<VisualPreset[]> {
  const { key, file } = location(userId)
  let raw: unknown
  if (getStorageMode() === "kv") {
    raw = Object.values((await getKv().hgetall<Record<string, VisualPreset>>(key)) ?? {})
  } else {
    try { raw = JSON.parse(await fsp.readFile(file, "utf8")) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
  }
  // Legacy entries without `shape` default to portrait via the schema.
  return visualPresetSchema.array().parse(raw)
}

const queues = new Map<string, Promise<unknown>>()

/**
 * Storage holds both shapes under one owner key; names and quota are scoped
 * PER shape (same name allowed across shapes). Save/delete return only the
 * target shape list, so legacy callers keep seeing exactly the portrait list.
 * File read/modify/write is serialized per owner; KV updates only the affected hash field.
 */
export async function mutateVisualPreset(userId: string | null, operation: "save" | "delete", body: unknown) {
  const { key, file } = location(userId)
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const all = await loadAllPresets(userId)
    if (operation === "save") {
      const input = visualPresetInputSchema.parse(body)
      const shape = input.shape ?? "portrait"
      const scope = all.filter((preset) => preset.shape === shape)
      const id = scope.find((preset) => preset.name === input.name)?.id ?? randomUUID()
      let nextScope = scope.filter((preset) => preset.id !== id && preset.name !== input.name)
      if (nextScope.length >= MAX_VISUAL_PRESETS) throw new Error("Preset limit reached")
      nextScope = [...nextScope, { id, ...input, shape }]
      const next = [...all.filter((preset) => preset.shape !== shape), ...nextScope]
      if (getStorageMode() === "kv") {
        await getKv().hset(key, { [id]: next.find((preset) => preset.id === id)! })
        const duplicates = scope.filter((preset) => preset.name === input.name && preset.id !== id).map((preset) => preset.id)
        if (duplicates.length) await getKv().hdel(key, ...duplicates)
      } else {
        await fsp.mkdir(path.dirname(file), { recursive: true })
        await atomicWriteFile(file, JSON.stringify(next))
      }
      return nextScope.sort((a, b) => a.name.localeCompare(b.name))
    }
    const { id, shape } = visualPresetDeleteSchema.parse(body)
    if (!all.some((preset) => preset.id === id && preset.shape === shape)) {
      return all.filter((preset) => preset.shape === shape).sort((a, b) => a.name.localeCompare(b.name))
    }
    const next = all.filter((preset) => preset.id !== id)
    if (getStorageMode() === "kv") {
      await getKv().hdel(key, id)
    } else {
      await fsp.mkdir(path.dirname(file), { recursive: true })
      await atomicWriteFile(file, JSON.stringify(next))
    }
    return next.filter((preset) => preset.shape === shape).sort((a, b) => a.name.localeCompare(b.name))
  })
  queues.set(key, run)
  try { return await run }
  finally { if (queues.get(key) === run) queues.delete(key) }
}
