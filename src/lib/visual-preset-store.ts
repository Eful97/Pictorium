import fsp from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { DATA_DIR } from "./data-dir"
import { atomicWriteFile } from "./atomic-write"
import { getKv, getStorageMode } from "./kv"
import { sanitizeUserId } from "./user-auth"
import { MAX_VISUAL_PRESETS, visualPresetInputSchema, visualPresetSchema, type VisualPreset } from "./visual-presets"

function location(userId: string | null) {
  if (userId !== null && sanitizeUserId(userId) !== userId) throw new Error("Invalid user")
  return {
    key: `visual-presets:${userId ?? "global"}`,
    file: path.join(DATA_DIR, ...(userId ? ["users", userId] : []), "visual-presets.json"),
  }
}

export async function listVisualPresets(userId: string | null): Promise<VisualPreset[]> {
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
  return visualPresetSchema.array().parse(raw).sort((a, b) => a.name.localeCompare(b.name))
}

const queues = new Map<string, Promise<unknown>>()

/** File read/modify/write is serialized per owner; KV updates only the affected hash field. */
export async function mutateVisualPreset(userId: string | null, operation: "save" | "delete", body: unknown) {
  const { key, file } = location(userId)
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const presets = await listVisualPresets(userId)
    const input = operation === "save" ? visualPresetInputSchema.parse(body) : null
    const id = input
      ? presets.find((preset) => preset.name === input.name)?.id ?? randomUUID()
      : visualPresetSchema.pick({ id: true }).strict().parse(body).id
    let next = presets.filter((preset) => preset.id !== id && (!input || preset.name !== input.name))
    if (input) {
      if (next.length >= MAX_VISUAL_PRESETS) throw new Error("Preset limit reached")
      next = [...next, { id, ...input }]
    }
    if (getStorageMode() === "kv") {
      if (operation === "delete") await getKv().hdel(key, id)
      else {
        await getKv().hset(key, { [id]: next.find((preset) => preset.id === id)! })
        const duplicates = presets.filter((preset) => preset.name === input!.name && preset.id !== id).map((preset) => preset.id)
        if (duplicates.length) await getKv().hdel(key, ...duplicates)
      }
    } else {
      await fsp.mkdir(path.dirname(file), { recursive: true })
      await atomicWriteFile(file, JSON.stringify(next))
    }
    return next.sort((a, b) => a.name.localeCompare(b.name))
  })
  queues.set(key, run)
  try { return await run }
  finally { if (queues.get(key) === run) queues.delete(key) }
}
