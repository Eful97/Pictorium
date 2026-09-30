import { NextRequest } from "next/server"
import { importMappings, setImdbAlias, QuotaExceededError } from "@/lib/store"
import type { Mapping } from "@/lib/types"
import { aliasSchema, mappingSchema } from "@/lib/validation"
import { getServerDefaults, getStoredUserDefaults, setServerDefaults, setServerDefaultsForUser, type ServerDefaults } from "@/lib/server-defaults"
import { listUserPresets, savePreset, PresetQuotaError, PresetValidationError } from "@/lib/badge-preset-store"
import { MAX_PRESETS_PER_USER } from "@/lib/badge-preset"
import {
  MAX_BACKUP_ALIASES,
  MAX_BACKUP_BODY_BYTES,
  MAX_BACKUP_DEFAULTS_BYTES,
  MAX_BACKUP_MAPPINGS,
  MAX_BACKUP_PRESETS,
  coerceBackupPreset,
  parseBackupBody,
  stripBackupSecrets,
} from "@/lib/backup-schema"
import { checkAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { extractUserParam, checkUserAuth, getScopedUserId, invalidUserResponse, isMultiUserEnabled, userAuthResponse, userRateLimitKey } from "@/lib/user-auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { readJsonBody, BodyTooLargeError, InvalidJsonBodyError } from "@/lib/read-body"
import { cacheInvalidatePosterData } from "@/lib/cache"
import { bumpCatalogEpoch } from "@/lib/catalog-epoch"

// Il body cap deve stare sopra al massimo payload legittimo: MAX_MAPPINGS
// mapping completi (decine di campi ciascuno) possono pesare centinaia di KB,
// più preset privati/default/alias del backup v2. 2.5MB lascia spazio a 1000
// mapping pieni + 100 preset mantenendo un limite di memoria rigoroso.
const MAX_BODY_BYTES = MAX_BACKUP_BODY_BYTES
const MAX_MAPPINGS = MAX_BACKUP_MAPPINGS

export async function POST(req: NextRequest) {
  const rawUser = extractUserParam(req)
  const rawInvalid = !!rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)
  const scoped = getScopedUserId(rawUser)
  const rl = await rateLimit(rawInvalid ? rateLimitKey(req) : (scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req)), "mappings")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (rawInvalid) return invalidUserResponse()
  if (scoped) {
    if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
    if (!isSameOrigin(req)) return originMismatchResponse()
  } else {
    if (!checkAdminToken(req)) return adminAuthResponse()
    if (!isSameOrigin(req)) return originMismatchResponse()
  }

  // Cap sulla dimensione del body: l'import è un'operazione in blocco e un
  // body enorme può saturare memoria + disco. Il check content-length è un
  // fast-path; readJsonBody applica il cap reale anche in chunked encoding.
  const contentLength = Number(req.headers.get("content-length") || "0")
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Request body too large" }, { status: 413 })
  }

  let body: unknown
  try {
    body = await readJsonBody(req, MAX_BODY_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    if (e instanceof InvalidJsonBodyError) return Response.json({ error: "Invalid JSON body" }, { status: 400 })
    throw e
  }
  const parsed = parseBackupBody(body)
  if (parsed.kind === "invalid") {
    return Response.json({ error: parsed.error }, { status: 400 })
  }
  if (parsed.kind === "local-only") {
    // Solo sezione `local` (preferenze browser): niente da fare sul server.
    return Response.json({
      ok: true,
      count: 0,
      imported: { mappings: 0, aliases: 0, defaults: 0, presets: 0 },
    })
  }
  if (parsed.kind === "v1") {
    return importMappingsSection(scoped, parsed.mappings)
  }
  return importBackupV2(scoped, parsed.sections.mappings, parsed.sections.aliases, parsed.sections.defaults, parsed.sections.presets)
}

/**
 * Normalizza il valore grezzo dei mapping (array o, per compatibilità
 * storica, oggetto da cui si prendono i valori) e valida ogni voce.
 * Il chiamante ha già estratto `body.mappings` (v1) o la sezione (v2).
 */
function validateMappingsList(rawInput: unknown): { valid: Mapping[]; errors: Record<number, unknown>; raw: unknown } {
  let raw: unknown = rawInput
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    raw = Object.values(raw)
  }
  const valid: Mapping[] = []
  const errors: Record<number, unknown> = {}
  if (Array.isArray(raw)) {
    raw.forEach((item: unknown, i: number) => {
      const parsed = mappingSchema.safeParse(item)
      if (parsed.success) {
        valid.push({
          ...parsed.data,
          updatedAt: (parsed.data as { updatedAt?: string }).updatedAt || new Date().toISOString(),
        } as Mapping)
      } else {
        errors[i] = parsed.error.flatten()
      }
    })
  }
  return { valid, errors, raw }
}

/** Path v1 (solo poster): comportamento storico invariato. */
async function importMappingsSection(scoped: string | null, mappingsValue: unknown): Promise<Response> {
  const { valid, errors, raw } = validateMappingsList(mappingsValue)
  if (!Array.isArray(raw)) {
    return Response.json({ error: "mappings array required" }, { status: 400 })
  }
  if (raw.length > MAX_MAPPINGS) {
    return Response.json({ error: `Too many mappings (max ${MAX_MAPPINGS})` }, { status: 413 })
  }
  if (valid.length === 0) {
    return Response.json({ error: "No valid mappings found", details: errors }, { status: 400 })
  }
  try {
    await importMappings(valid, scoped)
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return Response.json({ error: e.message }, { status: 413 })
    }
    throw e
  }
  if (scoped) {
    // Import nel namespace: niente wipe globale (il save di A non tocca B);
    // l'epoch utente ruota le sue chiavi catalogo/meta.
    await bumpCatalogEpoch(scoped)
    return Response.json({ ok: true, count: valid.length, errors: Object.keys(errors).length > 0 ? errors : undefined })
  }
  // L'import è un'operazione bulk che può toccare migliaia di mapping: invalida
  // tutta la cache poster/badge/catalog/stremio (come DELETE wipe-all). I cache
  // key dei poster includono updatedAt, quindi con la nuova timbratura i vecchi
  // entry non vengono più serviti comunque — questa invalidazione li libera
  // subito invece di lasciarli scadere col TTL.
  cacheInvalidatePosterData()
  await bumpCatalogEpoch()
  return Response.json({ ok: true, count: valid.length, errors: Object.keys(errors).length > 0 ? errors : undefined })
}

/**
 * Path v2 (backup completo): ogni sezione presente si importa in modo
 * indipendente (successo parziale possibile, gli errori finiscono in
 * `errors.<sezione>`). I preset si importano PRIMA dei mapping così i
 * `badgePresetId` del backup si rimappano sui nuovi id generati dal server.
 */
async function importBackupV2(
  scoped: string | null,
  mappingsValue: unknown,
  aliasesValue: unknown,
  defaultsValue: unknown,
  presetsValue: unknown,
): Promise<Response> {
  const imported = { mappings: 0, aliases: 0, defaults: 0, presets: 0 }
  const errors: Record<string, unknown> = {}

  // --- Preset privati (solo con namespace: servono un proprietario). ---
  const presetIdMap = new Map<string, { id: string; revision: string }>()
  if (presetsValue !== undefined) {
    if (!Array.isArray(presetsValue)) {
      errors.presets = "presets array required"
    } else if (presetsValue.length > MAX_BACKUP_PRESETS) {
      return Response.json({ error: `Too many presets (max ${MAX_BACKUP_PRESETS})` }, { status: 413 })
    } else if (!scoped) {
      errors.presets = "presets require a user namespace (?u=)"
    } else {
      const presetErrors: Record<number, unknown> = {}
      const candidates: ReturnType<typeof coerceBackupPreset>[] = []
      presetsValue.forEach((item: unknown, i: number) => {
        const coerced = coerceBackupPreset(item)
        if (coerced) candidates.push(coerced)
        else presetErrors[i] = "invalid preset"
      })
      // Dedup sui già presenti (stesso target + nome): il re-import non duplica.
      const existing = await listUserPresets(scoped)
      const seen = new Set(existing.map((s) => `${s.preset.target}:${s.preset.metadata.name.toLowerCase()}`))
      const fresh = candidates.filter((c) => {
        if (!c) return false
        const key = `${c.target}:${c.metadata.name.toLowerCase()}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      if (existing.length + fresh.length > MAX_PRESETS_PER_USER) {
        return Response.json({ error: `Preset quota exceeded (max ${MAX_PRESETS_PER_USER})` }, { status: 413 })
      }
      for (const c of fresh) {
        if (!c) continue
        try {
          const stored = await savePreset(scoped, {
            target: c.target,
            visibility: "private",
            forkedFrom: null,
            metadata: c.metadata,
            ...(c.variant !== undefined ? { variant: c.variant } : {}),
            ...(c.design !== undefined ? { design: c.design as never } : {}),
            ...(c.house !== undefined ? { house: c.house as never } : {}),
          })
          if (c.backupId) presetIdMap.set(c.backupId, { id: stored.preset.id, revision: stored.preset.revision })
          imported.presets += 1
        } catch (e) {
          if (e instanceof PresetQuotaError) {
            return Response.json({ error: e.message }, { status: 413 })
          }
          if (e instanceof PresetValidationError) {
            presetErrors[candidates.indexOf(c)] = e.message
          } else throw e
        }
      }
      if (Object.keys(presetErrors).length > 0) errors.presets = presetErrors
    }
  }

  // --- Poster salvati (con rimappatura dei preset appena importati). ---
  if (mappingsValue !== undefined) {
    const { valid, errors: mappingErrors, raw } = validateMappingsList(mappingsValue)
    if (!Array.isArray(raw)) {
      errors.mappings = "mappings array required"
    } else if (raw.length > MAX_MAPPINGS) {
      return Response.json({ error: `Too many mappings (max ${MAX_MAPPINGS})` }, { status: 413 })
    } else {
      if (presetIdMap.size > 0) {
        for (const m of valid) {
          const remap = m.badgePresetId ? presetIdMap.get(m.badgePresetId) : undefined
          if (remap) {
            m.badgePresetId = remap.id
            m.badgePresetRev = remap.revision
          }
        }
      }
      if (valid.length > 0) {
        try {
          await importMappings(valid, scoped)
          imported.mappings = valid.length
        } catch (e) {
          if (e instanceof QuotaExceededError) {
            return Response.json({ error: e.message }, { status: 413 })
          }
          throw e
        }
      }
      if (Object.keys(mappingErrors).length > 0) errors.mappings = mappingErrors
      else if (valid.length === 0) errors.mappings = "No valid mappings found"
    }
  }

  // --- Alias IMDb manuali. ---
  if (aliasesValue !== undefined) {
    if (!Array.isArray(aliasesValue)) {
      errors.aliases = "aliases array required"
    } else if (aliasesValue.length > MAX_BACKUP_ALIASES) {
      return Response.json({ error: `Too many aliases (max ${MAX_BACKUP_ALIASES})` }, { status: 413 })
    } else {
      const aliasErrors: Record<number, unknown> = {}
      for (let i = 0; i < aliasesValue.length; i++) {
        const parsed = aliasSchema.safeParse(aliasesValue[i])
        if (!parsed.success) {
          aliasErrors[i] = parsed.error.flatten()
          continue
        }
        try {
          await setImdbAlias({ ...parsed.data, updatedAt: new Date().toISOString() }, scoped)
          imported.aliases += 1
        } catch (e) {
          if (e instanceof QuotaExceededError) {
            return Response.json({ error: e.message }, { status: 413 })
          }
          throw e
        }
      }
      if (Object.keys(aliasErrors).length > 0) errors.aliases = aliasErrors
    }
  }

  // --- Impostazioni (merge, mai replace; segreti sbiancati). ---
  if (defaultsValue !== undefined) {
    const stripped = stripBackupSecrets(defaultsValue)
    const keys = Object.keys(stripped)
    if (keys.length === 0) {
      errors.defaults = "No importable settings found"
    } else if (JSON.stringify(stripped).length > MAX_BACKUP_DEFAULTS_BYTES) {
      errors.defaults = "Settings section too large"
    } else {
      try {
        if (scoped) {
          // Merge sullo STORATO (mai sull'effettivo ENV+storato): come il PUT.
          const stored = await getStoredUserDefaults(scoped)
          await setServerDefaultsForUser(scoped, { ...stored, ...stripped } as ServerDefaults)
        } else {
          // Merge come il PUT: un payload parziale non azzera gli altri default.
          const current = getServerDefaults()
          await setServerDefaults({ ...current, ...stripped } as ServerDefaults)
        }
        imported.defaults = keys.length
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        errors.defaults = `Failed to save: ${message}`
      }
    }
  }

  const total = imported.mappings + imported.aliases + imported.defaults + imported.presets
  if (total > 0) {
    if (scoped) {
      await bumpCatalogEpoch(scoped)
    } else {
      cacheInvalidatePosterData()
      await bumpCatalogEpoch()
    }
  }
  return Response.json({
    ok: true,
    count: imported.mappings,
    imported,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  })
}
