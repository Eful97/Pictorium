// ---------------------------------------------------------------------------
// Famiglie di stile per i selettori (solo UI): la griglia mostra una voce per
// famiglia e, sotto, le varianti della famiglia attiva. I valori salvati, gli
// URL e il render non cambiano: ogni variante È uno stile esistente.
// Uno stile non elencato in nessuna famiglia resta una voce singola; una
// famiglia ridotta a un solo membro (dopo il filtro sulle opzioni del
// selettore) si mostra come quel membro, senza riga varianti.
// ---------------------------------------------------------------------------

export interface StyleGroup {
  readonly id: string
  /** Etichetta della voce famiglia. */
  readonly labelKey: string
  readonly members: readonly string[]
}

/** Notch: una famiglia per badge, i materiali sono le sue varianti (scelta indipendente per famiglia). */
const NOTCH_GROUP: StyleGroup = { id: "notch", labelKey: "ui.notch", members: ["notch-crema", "notch-vetro", "notch-inchiostro", "notch-sfumato"] }

/** Genere/rating (`bs`). `bar` resta singolo. */
export const GENRE_STYLE_GROUPS: readonly StyleGroup[] = [
  { id: "text", labelKey: "ui.styleGroupText", members: ["shadow", "minimal", "ink", "editoriale"] },
  { id: "pill", labelKey: "ui.styleGroupPill", members: ["pill", "colored", "tinta", "split"] },
  { id: "frame", labelKey: "ui.styleGroupFrame", members: ["bordo", "vetro", "sfumato"] },
  NOTCH_GROUP,
]

/** Extra (`xbs`). `corner` ed `editoriale` restano singoli. */
export const EXTRA_STYLE_GROUPS: readonly StyleGroup[] = [
  { id: "plate", labelKey: "ui.styleGroupPlate", members: ["default", "colored"] },
  { id: "pill", labelKey: "ui.styleGroupPill", members: ["pill", "tinta"] },
  { id: "frame", labelKey: "ui.styleGroupFrame", members: ["bordo", "vetro", "sfumato"] },
  NOTCH_GROUP,
]

/** Varianti Badge della classifica (`RANK_BADGE_VARIANTS`, `standard` = placca centrata). */
export const RANK_VARIANT_GROUPS: readonly StyleGroup[] = [
  { id: "plate", labelKey: "ui.styleGroupPlate", members: ["standard", "colored"] },
  { id: "pill", labelKey: "ui.styleGroupPill", members: ["pill", "tinta", "split"] },
  { id: "frame", labelKey: "ui.styleGroupFrame", members: ["bordo", "vetro", "sfumato"] },
  NOTCH_GROUP,
]

/** Etichette delle varianti notch (il materiale). */
export const NOTCH_VARIANT_LABELS: Readonly<Record<string, string>> = {
  "notch-crema": "ui.notchCrema",
  "notch-vetro": "ui.notchVetro",
  "notch-inchiostro": "ui.notchInchiostro",
  "notch-sfumato": "ui.notchSfumato",
}

/** Qualità (`qbs`) ed età (`agebs`): i membri assenti dalle opzioni vengono filtrati. */
export const QUALITY_STYLE_GROUPS: readonly StyleGroup[] = [
  { id: "textPill", labelKey: "ui.styleGroupTextPill", members: ["standard", "outline", "strip"] },
  { id: "icons", labelKey: "ui.styleGroupIcons", members: ["color", "premium", "mono"] },
  { id: "plates", labelKey: "ui.styleGroupPlates", members: ["nova", "gradient", "knockout"] },
  { id: "bare", labelKey: "ui.styleGroupBare", members: ["naked", "editoriale"] },
]

/** Rating separati (`sepstyle`): la scelta vera è la posizione. */
export const SEPARATE_STYLE_GROUPS: readonly StyleGroup[] = [
  { id: "column", labelKey: "ui.sepGroupColumn", members: ["column", "rings"] },
  { id: "bottom", labelKey: "ui.sepGroupBottom", members: ["bottom-bar", "bottom-pills", "bottom-mono", "bottom-color"] },
]

/** Etichetta della variante dentro la famiglia, quando quella dello stile ripeterebbe la famiglia. */
export const SEPARATE_VARIANT_LABELS: Readonly<Record<string, string>> = {
  column: "ui.sepVariantPills",
  "bottom-bar": "ui.sepVariantBar",
  "bottom-pills": "ui.sepVariantPills",
}

export type GroupedEntry =
  | { kind: "single"; value: string }
  | { kind: "group"; group: StyleGroup; members: readonly string[] }

/**
 * Voci di primo livello nell'ordine delle opzioni: ogni famiglia compare al
 * posto del suo primo membro presente; i membri filtrati sulle opzioni.
 */
export function groupStyleOptions(options: readonly string[], groups: readonly StyleGroup[]): GroupedEntry[] {
  const out: GroupedEntry[] = []
  const seen = new Set<string>()
  for (const o of options) {
    const g = groups.find((gr) => gr.members.includes(o))
    if (!g) { out.push({ kind: "single", value: o }); continue }
    if (seen.has(g.id)) continue
    seen.add(g.id)
    const members = g.members.filter((m) => options.includes(m))
    out.push(members.length > 1 ? { kind: "group", group: g, members } : { kind: "single", value: members[0] })
  }
  return out
}

/** Famiglia che contiene `value` (null se singolo o assente). */
export function groupOf(value: string | null | undefined, groups: readonly StyleGroup[]): StyleGroup | null {
  return value ? groups.find((g) => g.members.includes(value)) ?? null : null
}
