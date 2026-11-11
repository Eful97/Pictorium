"use client"


/** Unified advanced workspace element (Phase 1 settings consolidation).
 *  Groups appearance/content + geometry together per poster element instead
 *  of the legacy Badge-vs-Transform split. UI-only: selecting an element
 *  never persists defaults, delivery shape, or storage — it only filters
 *  which existing detail cards + geometry groups are visible and which
 *  preview-only family sample is shown. */
export type PosterElementId =
  | "logo"
  | "ratings"
  | "genre"
  | "rank"
  | "info"
  | "quality"
  | "background"
  | "sources"



