import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { envWithFallback } from "@/lib/env-compat"
import { createLogger } from "@/lib/logger"
import { getKv, getStorageMode } from "@/lib/kv"

const log = createLogger("kofi-goal")

export interface KofiGoalData {
  current: number
  target: number
  percentage: number
  currency: string
  updatedAt?: string
}

const DEFAULT_TARGET = 6
const DEFAULT_CURRENT = 0
const GOAL_FILE_NAME = "kofi-goal.json"
const KV_KEY = "kofi_goal"

// Lettura live (mai a module level): i test mutano le env + resetModules.
// Nome senza prefisso `use`: la regola react-hooks lo scambierebbe per un Hook.
function isKvMode(): boolean {
  return getStorageMode() === "kv"
}

function getGoalFile(): string {
  const dir = envWithFallback("DATA_DIR") || DATA_DIR
  return path.join(dir, GOAL_FILE_NAME)
}

export async function getKofiGoal(): Promise<KofiGoalData> {
  const envTarget = Number(envWithFallback("KOFI_VPS_TARGET") || process.env.KOFI_VPS_TARGET)
  const envCurrent = Number(envWithFallback("KOFI_VPS_CURRENT") || process.env.KOFI_VPS_CURRENT)

  let target = Number.isFinite(envTarget) && envTarget > 0 ? envTarget : DEFAULT_TARGET
  let current = Number.isFinite(envCurrent) && envCurrent >= 0 ? envCurrent : DEFAULT_CURRENT
  let updatedAt: string | undefined

  if (isKvMode()) {
    try {
      const data = await getKv().get<{ current?: number; target?: number; updatedAt?: string }>(KV_KEY)
      if (data) {
        if (typeof data.target === "number" && data.target > 0) target = data.target
        if (typeof data.current === "number" && data.current >= 0) current = data.current
        if (data.updatedAt) updatedAt = data.updatedAt
      }
    } catch (err) {
      log.error("Failed to read kofi goal from KV", { err })
    }
  } else {
    try {
      const file = getGoalFile()
      if (existsSync(file)) {
        const raw = await fs.readFile(file, "utf-8")
        const parsed = JSON.parse(raw) as { current?: number; target?: number; updatedAt?: string }
        if (typeof parsed.target === "number" && parsed.target > 0) target = parsed.target
        if (typeof parsed.current === "number" && parsed.current >= 0) current = parsed.current
        if (parsed.updatedAt) updatedAt = parsed.updatedAt
      }
    } catch (err) {
      log.error("Failed to read kofi goal from file", { err })
    }
  }

  const percentage = target > 0 ? Math.min(100, Math.max(0, Math.round((current / target) * 100))) : 0

  return {
    current,
    target,
    percentage,
    currency: "EUR",
    ...(updatedAt ? { updatedAt } : {}),
  }
}
