"use client"

import { useEffect, useSyncExternalStore } from "react"
import {
  defaultBlurFadeForPoster,
  defaultGradientHeightForPoster,
} from "./gradient-defaults"
import { currentPathUuid } from "./user-token"

/** Valori degli slider della sezione sfocatura/gradiente toccati da un preset. */
export interface GradientPresetValues {
  gradientHeight: number
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  tintStrength: number
  blurEnabled: boolean
}

type PosterKind = { iso_639_1?: string | null } | null | undefined

/**
 * Look "Colore" (da riferimento concorrenza): banda alta che copre anche il
 * logo, tinta di scena forte, velatura scura media. Valori assoluti dentro i
 * bound degli slider (height 5-100, intensity 1-100, gli altri 0-100).
 */
export const GRADIENT_PRESET_COLOR: GradientPresetValues = {
  gradientHeight: 35,
  blurIntensity: 20,
  blurFade: 10,
  blurDarkness: 30,
  tintStrength: 100,
  blurEnabled: true,
}

/**
 * Look "Nero": banda fonda e intensa, velatura scura piena, nessuna tinta di
 * scena. Valori assoluti dentro i bound degli slider.
 */
export const GRADIENT_PRESET_NERO: GradientPresetValues = {
  gradientHeight: 50,
  blurIntensity: 1,
  blurFade: 100,
  blurDarkness: 100,
  tintStrength: 0,
  blurEnabled: true,
}

/**
 * Look "Naturale" come default globali fissi (= Reset delle Impostazioni).
 * La variante per-titolo dinamica (altezza clean vs non-clean, fade 70 in
 * landscape) resta in naturalGradientForPoster(); questa serve per confronti
 * e apply assoluti.
 */
export const NATURAL_GRADIENT_DEFAULTS: GradientPresetValues = {
  gradientHeight: 35,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  tintStrength: 20,
  blurEnabled: true,
}

/**
 * Factory storiche (pre-preset) di altezza/fade: distinguono "default mai
 * toccato" (ancora soggetto ad auto-calibrazione per tipo poster) da un
 * default personalizzato (assoluto). NON allinearle a NATURAL_GRADIENT_DEFAULTS:
 * il Naturale resta ancorato alle factory solo per il fade (50) — l'altezza
 * Naturale (35) è un valore personalizzato assoluto e non si ricalibra.
 */
const LEGACY_GRADIENT_HEIGHT = 30
const LEGACY_BLUR_FADE = 50
export function naturalGradientForPoster(
  poster: PosterKind,
  posterShape?: string,
): GradientPresetValues {
  return {
    gradientHeight: defaultGradientHeightForPoster(poster),
    blurIntensity: 20,
    blurFade: posterShape === "landscape" ? 70 : 50,
    blurDarkness: 30,
    tintStrength: 20,
    blurEnabled: true,
  }
}

/** True se gli slider correnti corrispondono ai valori attesi (active-state UI). */
export function matchesGradientPreset(
  current: GradientPresetValues,
  expected: GradientPresetValues,
): boolean {
  return (
    current.gradientHeight === expected.gradientHeight &&
    current.blurIntensity === expected.blurIntensity &&
    current.blurFade === expected.blurFade &&
    current.blurDarkness === expected.blurDarkness &&
    current.tintStrength === expected.tintStrength &&
    current.blurEnabled === expected.blurEnabled
  )
}

/**
 * Ricalibrazione altezza/fade al cambio artwork: applica i default di tipo
 * del nuovo poster SOLO se i valori correnti sono ancora quelli di tipo del
 * poster precedente (stato "pristine"). Un preset attivo (Colore) o un tweak
 * manuale sopravvive al cambio poster; torna null quando non c'è nulla da fare.
 */
export function adjustGradientForPosterChange(
  current: { gradientHeight: number; blurFade: number },
  oldPoster: PosterKind,
  newPoster: PosterKind,
): { gradientHeight: number; blurFade: number } | null {
  if (
    current.gradientHeight === defaultGradientHeightForPoster(oldPoster) &&
    current.blurFade === defaultBlurFadeForPoster(oldPoster)
  ) {
    return {
      gradientHeight: defaultGradientHeightForPoster(newPoster),
      blurFade: defaultBlurFadeForPoster(newPoster),
    }
  }
  return null
}

/**
 * Auto-calibrazione per tipo all'apertura titolo: un default personalizzato
 * (es. preset Colore come default globale) è assoluto e non va ricalibrato;
 * solo il default legacy Naturale segue il tipo poster (clean vs non-clean).
 */
export function defaultHeightForPoster(defaultHeight: number, poster: PosterKind): number {
  return defaultHeight === LEGACY_GRADIENT_HEIGHT
    ? defaultGradientHeightForPoster(poster)
    : defaultHeight
}

export function defaultFadeForPoster(defaultFade: number, poster: PosterKind): number {
  return defaultFade === LEGACY_BLUR_FADE
    ? defaultBlurFadeForPoster(poster)
    : defaultFade
}

/** Preset sfumatura creato dall'utente (snapshot nominato dei 5 slider). */
export interface CustomGradientPreset {
  id: string
  name: string
  values: GradientPresetValues
}

/** Slot personali: 3 built-in (Naturale/Colore/Nero) + 3 custom = 6 totali. */
export const MAX_CUSTOM_GRADIENT_PRESETS = 3

export function gradientPresetsStorageKey(): string {
  const uuid = currentPathUuid()
  return uuid ? `gradientPresets:${uuid}` : "gradientPresets"
}

function isValidPresetValues(v: unknown): v is GradientPresetValues {
  if (typeof v !== "object" || v === null) return false
  const o = v as Record<string, unknown>
  const num = (k: string, min: number, max: number): boolean =>
    typeof o[k] === "number" && Number.isFinite(o[k]) && (o[k] as number) >= min && (o[k] as number) <= max
  return (
    num("gradientHeight", 5, 100) &&
    num("blurIntensity", 1, 100) &&
    num("blurFade", 0, 100) &&
    num("blurDarkness", 0, 100) &&
    num("tintStrength", 0, 100) &&
    typeof o.blurEnabled === "boolean"
  )
}

/** Filtra e normalizza preset grezzi dallo storage (mai spazzatura, max 3, id unici). */
export function sanitizeCustomPresets(raw: unknown): CustomGradientPreset[] {
  if (!Array.isArray(raw)) return []
  const out: CustomGradientPreset[] = []
  for (const item of raw) {
    if (out.length >= MAX_CUSTOM_GRADIENT_PRESETS) break
    if (typeof item !== "object" || item === null) continue
    const o = item as Record<string, unknown>
    if (typeof o.id !== "string" || !o.id) continue
    if (typeof o.name !== "string" || !o.name.trim()) continue
    if (!isValidPresetValues(o.values)) continue
    if (out.some((p) => p.id === o.id)) continue
    out.push({ id: o.id, name: o.name.trim().slice(0, 24), values: { ...(o.values as GradientPresetValues) } })
  }
  return out
}

type PresetListener = () => void

const presetListeners = new Set<PresetListener>()
const EMPTY_PRESETS: CustomGradientPreset[] = []
let customPresets: CustomGradientPreset[] = EMPTY_PRESETS
let presetsHydrated = false

function readStoredPresets(): CustomGradientPreset[] {
  try {
    if (typeof window === "undefined" || !window.localStorage) return []
    const raw = window.localStorage.getItem(gradientPresetsStorageKey())
    if (!raw) return []
    return sanitizeCustomPresets(JSON.parse(raw))
  } catch {
    return []
  }
}

function emitPresets() {
  presetListeners.forEach((l) => l())
}

/** Idratazione dallo storage (una volta): dopo, ogni istanza del hook si sincronizza. */
export function hydrateCustomPresets(): void {
  if (presetsHydrated || typeof window === "undefined") return
  presetsHydrated = true
  const stored = readStoredPresets()
  if (stored.length > 0) {
    customPresets = stored
    emitPresets()
  }
}

function writeStoredPresets(next: CustomGradientPreset[]): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false
    window.localStorage.setItem(gradientPresetsStorageKey(), JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

function persistPresets(next: CustomGradientPreset[]) {
  customPresets = next
  if (!writeStoredPresets(next)) {
    /* preset non salvato: resta in memoria per la sessione */
  }
  emitPresets()
}

/** Solo test: azzera store e idratazione tra un caso e l'altro. */
export function resetCustomPresetStore(): void {
  customPresets = EMPTY_PRESETS
  presetsHydrated = false
}

function subscribePresets(l: PresetListener): () => void {
  presetListeners.add(l)
  return () => {
    presetListeners.delete(l)
  }
}

function getPresetsSnapshot(): CustomGradientPreset[] {
  return customPresets
}

/** Live in-memory snapshot for import planning: read AFTER async reads, never a stale closure. No hydration here — mirrors exactly what add() mutates. */
export function getCustomGradientPresets(): CustomGradientPreset[] {
  return [...customPresets]
}

/** Snapshot server: sempre vuoto (niente mismatch hydration, vedi hydrate). */
function getPresetsServerSnapshot(): CustomGradientPreset[] {
  return EMPTY_PRESETS
}

/**
 * Hook condiviso tra editor e Impostazioni: stessa lista, stesso stato.
 * I preset sono scorciatoie locali (localStorage per namespace) — mai
 * sincronizzati al server: sui poster viaggiano solo i numeri risultanti.
 */
export function useCustomGradientPresets(): CustomGradientPreset[] {
  const presets = useSyncExternalStore(subscribePresets, getPresetsSnapshot, getPresetsServerSnapshot)
  useEffect(() => {
    hydrateCustomPresets()
  }, [])
  return presets
}

export function canAddCustomGradientPreset(): boolean {
  return customPresets.length < MAX_CUSTOM_GRADIENT_PRESETS
}

/** Save current values as preset; null on empty name, invalid values or full slots. With `requirePersistence` (import path only) a storage write failure rejects BEFORE touching the in-memory store, so a reported success is really persisted. */
export function addCustomGradientPreset(name: string, values: GradientPresetValues, opts?: { requirePersistence?: boolean }): CustomGradientPreset | null {
  if (typeof window === "undefined") return null
  const clean = name.trim().slice(0, 24)
  if (!clean || !isValidPresetValues(values)) return null
  if (customPresets.length >= MAX_CUSTOM_GRADIENT_PRESETS) return null
  const preset: CustomGradientPreset = {
    id: `${Date.now().toString(36)}${Math.floor(Math.random() * 0xffff).toString(36)}`,
    name: clean,
    values: { ...values },
  }
  const next = [...customPresets, preset]
  if (opts?.requirePersistence) {
    // Single storage write: on success update memory + emit directly,
    // never rewrite via persistPresets (no double setItem).
    if (!writeStoredPresets(next)) return null
    customPresets = next
    emitPresets()
    return preset
  }
  persistPresets(next)
  return preset
}

export function deleteCustomGradientPreset(id: string): boolean {
  if (typeof window === "undefined") return false
  const next = customPresets.filter((p) => p.id !== id)
  if (next.length === customPresets.length) return false
  persistPresets(next)
  return true
}
