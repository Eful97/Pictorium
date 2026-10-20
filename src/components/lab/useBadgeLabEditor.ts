"use client"

import { useCallback, useReducer, type SetStateAction } from "react"
import type { BadgeDesign, BadgePresetVariant, BadgeTarget, HouseBadge } from "@/lib/badge-preset"

export interface LabMetadata {
  name: string
  description: string
  tagsCsv: string
  target: BadgeTarget
  visibility: "public" | "private"
}

export interface LabEditorState {
  design: BadgeDesign
  house: HouseBadge
  variant: BadgePresetVariant
  meta: LabMetadata
}

interface History {
  present: LabEditorState
  past: LabEditorState[]
  future: LabEditorState[]
  group?: string
  time?: number
}

type Action =
  | { type: "edit"; field: keyof LabEditorState; value: SetStateAction<LabEditorState[keyof LabEditorState]>; time: number; separate?: boolean }
  | { type: "reset"; value: LabEditorState }
  | { type: "undo" }
  | { type: "redo" }

function changedPaths(before: unknown, after: unknown, path: string): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  if (before && after && typeof before === "object" && typeof after === "object") {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) => changedPaths(a[key], b[key], `${path}.${key}`))
  }
  return [path]
}

export function labEditorReducer(state: History, action: Action): History {
  if (action.type === "reset") return { present: action.value, past: [], future: [] }
  if (action.type === "undo") {
    const previous = state.past.at(-1)
    return previous ? { present: previous, past: state.past.slice(0, -1), future: [state.present, ...state.future] } : state
  }
  if (action.type === "redo") {
    const next = state.future[0]
    return next ? { present: next, past: [...state.past, state.present].slice(-100), future: state.future.slice(1) } : state
  }
  const value = typeof action.value === "function" ? action.value(state.present[action.field]) : action.value
  const present = { ...state.present, [action.field]: value }
  if (JSON.stringify(present) === JSON.stringify(state.present)) return state
  // Consecutive keystrokes and slider movements are one undo step.
  const group = action.separate ? undefined : changedPaths(state.present[action.field], value, action.field).join(",")
  const grouped = !action.separate && state.group === group && action.time - (state.time ?? 0) < 500
  return { present, past: grouped ? state.past : [...state.past, state.present].slice(-100), future: [], group, time: action.time }
}

export function useBadgeLabEditor(initial: LabEditorState) {
  const [history, dispatch] = useReducer(labEditorReducer, { present: initial, past: [], future: [] })
  const reset = useCallback((value: LabEditorState) => dispatch({ type: "reset", value }), [])
  function setField<K extends keyof LabEditorState>(field: K, value: SetStateAction<LabEditorState[K]>, separate = false) {
    dispatch({ type: "edit", field, value: value as SetStateAction<LabEditorState[keyof LabEditorState]>, time: Date.now(), separate })
  }
  return {
    ...history.present,
    setDesign: (value: SetStateAction<BadgeDesign>, separate = false) => setField("design", value, separate),
    setHouse: (value: SetStateAction<HouseBadge>, separate = false) => setField("house", value, separate),
    setVariant: (value: SetStateAction<BadgePresetVariant>) => setField("variant", value),
    setMeta: (value: SetStateAction<LabMetadata>) => setField("meta", value),
    reset,
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  }
}
