/**
 * Glifi film/serie (viewBox 24, inchiostro x 3..21, y 4..20), path unici
 * condivisi dal badge genere (glifo inline) e dal fallback standalone.
 */
export type TypeIconKind = "movie" | "tv"

export const TYPE_ICON_PATHS: Record<TypeIconKind, string> = {
  // pellicola: rettangolo con fori laterali
  movie: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v2h2V6H5Zm0 4v2h2v-2H5Zm0 4v2h2v-2H5Zm12-8v2h2V6h-2Zm0 4v2h2v-2h-2Zm0 4v2h2v-2h-2ZM9 6v12h6V6H9Z",
  // schermo con piedistallo
  tv: "M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm4 14h8v2H8v-2Z",
}

/** Larghezza dell'inchiostro nel viewBox (x 3..21). */
export const TYPE_ICON_INK_W = 18
