/**
 * Dedicated preset transfer file: "I miei preset" (server visual presets)
 * + custom gradient presets (local shortcuts). No Badge Lab, no built-ins,
 * no defaults/mappings/keys — see `parsePresetFileData` for the exact
 * unknown-key rules (top/entry-level ignored, values-level strict).
 *
 * Client-safe: zod + visual-presets + gradient-presets constant only.
 * No `node:` imports, no storage, no routes, no render params.
 */

import { z } from "zod";
import {
  MAX_VISUAL_PRESETS,
  captureVisualPreset,
  visualPresetInputSchema,
  visualPresetShapeSchema,
  type VisualPresetShape,
  type VisualPresetValues,
} from "./visual-presets";
import {
  MAX_CUSTOM_GRADIENT_PRESETS,
  type CustomGradientPreset,
  type GradientPresetValues,
} from "./gradient-presets";

export const PRESET_FILE_KIND = "pictorium-presets" as const;
export const PRESET_FILE_FORMAT_VERSION = 1 as const;
/** Client-side pre-check: never JSON.parse (or upload) a bigger payload. */
export const MAX_PRESET_FILE_BYTES = 256 * 1024;
/** Section caps mirror the stores (see module doc for skip-not-error). */
export const MAX_PRESET_FILE_VISUAL = MAX_VISUAL_PRESETS;
export const MAX_PRESET_FILE_GRADIENT = MAX_CUSTOM_GRADIENT_PRESETS;

export interface VisualFileEntry {
  name: string;
  /** Orientation list. Absent in legacy v1 files = portrait. */
  shape: VisualPresetShape;
  values: VisualPresetValues;
}

export interface GradientFileEntry {
  name: string;
  values: GradientPresetValues;
}

export interface PresetFileSkipped {
  visual: number;
  visualOverCap: number;
  gradient: number;
  gradientOverCap: number;
}

export interface PresetFileData {
  kind: typeof PRESET_FILE_KIND;
  formatVersion: typeof PRESET_FILE_FORMAT_VERSION;
  exportedAt: string;
  visualPresets: VisualFileEntry[];
  gradientPresets: GradientFileEntry[];
}

export type PresetFileError =
  | "invalid-json"
  | "invalid-shape"
  | "unsupported-kind"
  | "unsupported-version"
  | "file-too-large";

export type ParsePresetFileResult =
  | {
      ok: true;
      visual: VisualFileEntry[];
      gradient: GradientFileEntry[];
      skipped: PresetFileSkipped;
    }
  | { ok: false; error: PresetFileError };

/**
 * File-entry gradient values. Bounds mirror `isValidPresetValues` in
 * `gradient-presets.ts` (height 5-100, intensity 1-100, rest 0-100,
 * blurEnabled boolean). `.strict()` so secret/unknown keys inside values
 * reject the entry instead of leaking through.
 */
const gradientValuesSchema = z
  .object({
    gradientHeight: z.number().finite().min(5).max(100),
    blurIntensity: z.number().finite().min(1).max(100),
    blurFade: z.number().finite().min(0).max(100),
    blurDarkness: z.number().finite().min(0).max(100),
    tintStrength: z.number().finite().min(0).max(100),
    blurEnabled: z.boolean(),
  })
  .strict();

/** File-entry gradient preset: id-less, name max 24 like the store. */
const gradientFileEntrySchema = z
  .object({
    name: z.string().trim().min(1).max(24),
    values: gradientValuesSchema,
  })
  .strict();

const EMPTY_SKIPPED: PresetFileSkipped = {
  visual: 0,
  visualOverCap: 0,
  gradient: 0,
  gradientOverCap: 0,
};

/** Pick ONLY the transfer keys; entry-level extras (id, owner, ...) drop here. */
function pickNameValues(item: unknown): { name: unknown; values: unknown } {
  if (typeof item !== "object" || item === null) return { name: undefined, values: undefined };
  const raw = item as Record<string, unknown>;
  return { name: raw.name, values: raw.values };
}

/** Visual entries additionally carry the optional orientation shape. */
function pickNameValuesShape(item: unknown): { name: unknown; shape: unknown; values: unknown } {
  if (typeof item !== "object" || item === null) return { name: undefined, shape: undefined, values: undefined };
  const raw = item as Record<string, unknown>;
  return { name: raw.name, shape: raw.shape, values: raw.values };
}

export function presetFileTextSizeBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Parse + validate raw (already JSON-parsed) data. Never throws. */
export function parsePresetFileData(data: unknown): ParsePresetFileResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "invalid-shape" };
  }
  const rec = data as Record<string, unknown>;
  if (rec.kind !== PRESET_FILE_KIND) return { ok: false, error: "unsupported-kind" };
  if (rec.formatVersion !== PRESET_FILE_FORMAT_VERSION) {
    return { ok: false, error: "unsupported-version" };
  }
  const visualRaw = rec.visualPresets === undefined ? [] : rec.visualPresets;
  const gradientRaw = rec.gradientPresets === undefined ? [] : rec.gradientPresets;
  if (!Array.isArray(visualRaw) || !Array.isArray(gradientRaw)) {
    return { ok: false, error: "invalid-shape" };
  }

  const visual: VisualFileEntry[] = [];
  const gradient: GradientFileEntry[] = [];
  const skipped: PresetFileSkipped = { ...EMPTY_SKIPPED };
  // Section cap is per orientation list (20 portrait + 20 landscape).
  const shapeCounts: Record<VisualPresetShape, number> = { portrait: 0, landscape: 0 };

  for (const item of visualRaw) {
    // Absent shape defaults to portrait (legacy v1); invalid shape fails
    // the strict schema and counts as skipped, like bad values.
    const parsed = visualPresetInputSchema.safeParse(pickNameValuesShape(item));
    if (!parsed.success) {
      skipped.visual += 1;
      continue;
    }
    const shape = parsed.data.shape;
    if (shapeCounts[shape] >= MAX_PRESET_FILE_VISUAL) {
      skipped.visualOverCap += 1;
      continue;
    }
    shapeCounts[shape] += 1;
    visual.push({ name: parsed.data.name, shape, values: parsed.data.values });
  }

  for (const item of gradientRaw) {
    const parsed = gradientFileEntrySchema.safeParse(pickNameValues(item));
    if (!parsed.success) {
      skipped.gradient += 1;
      continue;
    }
    if (gradient.length >= MAX_PRESET_FILE_GRADIENT) {
      skipped.gradientOverCap += 1;
      continue;
    }
    gradient.push(parsed.data);
  }

  return { ok: true, visual, gradient, skipped };
}

/**
 * Byte-cap pre-check, then JSON.parse, then `parsePresetFileData`.
 * Oversize text is rejected BEFORE parsing (no giant alloc). Never throws.
 */
export function parsePresetFileText(text: string): ParsePresetFileResult {
  if (typeof text !== "string") return { ok: false, error: "invalid-shape" };
  if (presetFileTextSizeBytes(text) > MAX_PRESET_FILE_BYTES) {
    return { ok: false, error: "file-too-large" };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid-json" };
  }
  return parsePresetFileData(data);
}

export interface BuildPresetFileInput {
  /** Live visual presets (store shape with id+shape, or bare {name, values[, shape]}). */
  visual?: ReadonlyArray<{ name: string; shape?: unknown; values: unknown }>;
  /** Live custom gradient presets (store shape with id, or bare {name, values}). */
  gradient?: ReadonlyArray<{ name: string; values: unknown }>;
}

const visualNameSchema = z.string().trim().min(1).max(40);
const gradientNameSchema = z.string().trim().min(1).max(24);

/**
 * Build a transfer file from live data. Allowlist picks only:
 * visual -> trimmed name + shape (absent/invalid = portrait, never fails
 * the entry) + `captureVisualPreset(values)` (stray secrets stripped,
 * preset preserved); gradient -> trimmed name + the 6 slider keys
 * (validated). Invalid entries are skipped. Builtins are NEVER
 * added here — the caller passes exactly what to export (all or one).
 */
export function buildPresetFile(input: BuildPresetFileInput = {}): PresetFileData {
  const visualPresets: VisualFileEntry[] = [];
  const visualCounts: Record<VisualPresetShape, number> = { portrait: 0, landscape: 0 };
  for (const item of input.visual ?? []) {
    if (typeof item !== "object" || item === null) continue;
    const name = visualNameSchema.safeParse((item as { name?: unknown }).name);
    if (!name.success) continue;
    const shape = visualPresetShapeSchema.safeParse((item as { shape?: unknown }).shape);
    const entryShape = shape.success ? shape.data : "portrait";
    if (visualCounts[entryShape] >= MAX_PRESET_FILE_VISUAL) continue;
    try {
      visualPresets.push({
        name: name.data,
        shape: entryShape,
        values: captureVisualPreset((item as { values?: VisualPresetValues }).values as VisualPresetValues),
      });
      visualCounts[entryShape] += 1;
    } catch {
      continue;
    }
  }

  const gradientPresets: GradientFileEntry[] = [];
  for (const item of input.gradient ?? []) {
    if (gradientPresets.length >= MAX_PRESET_FILE_GRADIENT) break;
    if (typeof item !== "object" || item === null) continue;
    const raw = item as { name?: unknown; values?: Record<string, unknown> | null };
    const name = gradientNameSchema.safeParse(raw.name);
    if (!name.success) continue;
    const v = (typeof raw.values === "object" && raw.values !== null ? raw.values : {}) as Record<string, unknown>;
    const parsed = gradientValuesSchema.safeParse({
      gradientHeight: v.gradientHeight,
      blurIntensity: v.blurIntensity,
      blurFade: v.blurFade,
      blurDarkness: v.blurDarkness,
      tintStrength: v.tintStrength,
      blurEnabled: v.blurEnabled,
    });
    if (!parsed.success) continue;
    gradientPresets.push({ name: name.data, values: parsed.data });
  }

  return {
    kind: PRESET_FILE_KIND,
    formatVersion: PRESET_FILE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    visualPresets,
    gradientPresets,
  };
}

export interface PresetImportPlan<T> {
  /** Entries to persist, in file order (caller owns id generation / POST). */
  toAdd: T[];
  skippedDuplicate: number;
  skippedQuota: number;
}

function normalizePresetName(name: string): string {
  return name.trim().toLowerCase();
}

function existingNameSet(existing: ReadonlyArray<string | { name: string }>): Set<string> {
  const set = new Set<string>();
  for (const e of existing) {
    const n = typeof e === "string" ? e : e?.name;
    if (typeof n === "string" && n.trim()) set.add(normalizePresetName(n));
  }
  return set;
}

function planImport<T extends { name: string }>(
  existing: ReadonlyArray<string | { name: string }>,
  incoming: ReadonlyArray<T>,
  maxTotal: number,
): PresetImportPlan<T> {
  const seen = existingNameSet(existing);
  const toAdd: T[] = [];
  let skippedDuplicate = 0;
  let skippedQuota = 0;
  // Slot occupati = righe esistenti (anche quasi-duplicate tra loro:
  // lo store non dedupplica, ogni riga conta per la quota).
  const baseCount = existing.length;
  for (const entry of incoming) {
    const norm = normalizePresetName(entry.name);
    if (seen.has(norm)) {
      skippedDuplicate += 1;
      continue;
    }
    if (baseCount + toAdd.length >= maxTotal) {
      skippedQuota += 1;
      continue;
    }
    seen.add(norm);
    toAdd.push(entry);
  }
  return { toAdd, skippedDuplicate, skippedQuota };
}

/**
 * Additive visual import plan, namespaced PER orientation list: same name is
 * allowed across shapes, quota is 20 per shape. Incoming entries without a
 * resolved shape count as portrait (legacy v1). File order is preserved
 * across shapes (single pass). Counts existing rows, not deduped names.
 */
export function planVisualImport(
  existingByShape: Record<VisualPresetShape, ReadonlyArray<string | { name: string }>>,
  incoming: ReadonlyArray<{ name: string; shape?: VisualPresetShape; values: VisualPresetValues }>,
): PresetImportPlan<VisualFileEntry> {
  const seen: Record<VisualPresetShape, Set<string>> = {
    portrait: existingNameSet(existingByShape.portrait),
    landscape: existingNameSet(existingByShape.landscape ?? []),
  };
  const baseCount: Record<VisualPresetShape, number> = {
    portrait: existingByShape.portrait.length,
    landscape: (existingByShape.landscape ?? []).length,
  };
  const added: Record<VisualPresetShape, number> = { portrait: 0, landscape: 0 };
  const toAdd: VisualFileEntry[] = [];
  let skippedDuplicate = 0;
  let skippedQuota = 0;
  for (const item of incoming) {
    const shape = item.shape ?? "portrait";
    const norm = normalizePresetName(item.name);
    if (seen[shape].has(norm)) {
      skippedDuplicate += 1;
      continue;
    }
    if (baseCount[shape] + added[shape] >= MAX_PRESET_FILE_VISUAL) {
      skippedQuota += 1;
      continue;
    }
    seen[shape].add(norm);
    added[shape] += 1;
    toAdd.push({ name: item.name, shape, values: item.values });
  }
  return { toAdd, skippedDuplicate, skippedQuota };
}

/**
 * Additive gradient import plan. Same collision rule; quota is 3 total
 * custom slots. Returned entries are id-less — the caller persists them
 * via `addCustomGradientPreset(name, values)` (which mints ids).
 */
export function planGradientImport(
  existing: ReadonlyArray<string | { name: string } | CustomGradientPreset>,
  incoming: ReadonlyArray<GradientFileEntry>,
): PresetImportPlan<GradientFileEntry> {
  return planImport(existing, incoming, MAX_PRESET_FILE_GRADIENT);
}
