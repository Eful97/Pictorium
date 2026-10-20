import { z } from "zod"
import { badgeDesignSchema, houseBadgeSchema, BADGE_PRESET_ID_RE, BADGE_PRESET_REV_RE, BADGE_TARGETS } from "./badge-preset"

// A draft can contain an unfinished text/color input; saved presets still
// use the strict public schema. Drafts never contain credentials.
const colorInput = z.string().max(9)
const design = badgeDesignSchema.extend({
  text: badgeDesignSchema.shape.text.extend({ template: z.string().max(80), color: colorInput }),
  background: badgeDesignSchema.shape.background.extend({
    color: colorInput.optional(),
    gradient: badgeDesignSchema.shape.background.shape.gradient.unwrap().extend({ from: colorInput, to: colorInput }).optional(),
  }),
  border: badgeDesignSchema.shape.border.unwrap().extend({ color: colorInput }).optional(),
})

export const badgeLabDraftSchema = z.strictObject({
  version: z.literal(1),
  editor: z.strictObject({
    design,
    house: houseBadgeSchema.extend({
      accent: colorInput.optional(), textColor: colorInput.optional(),
      appearance: houseBadgeSchema.shape.appearance.unwrap().extend({ background: design.shape.background.optional(), border: design.shape.border }).optional(),
    }),
    variant: z.enum(["custom", "house"]),
    meta: z.strictObject({
      name: z.string().max(60), description: z.string().max(300), tagsCsv: z.string().max(500),
      target: z.enum(BADGE_TARGETS), visibility: z.enum(["private", "public"]),
    }),
  }),
  editingId: z.string().regex(BADGE_PRESET_ID_RE).nullable(),
  forkedFrom: z.string().regex(BADGE_PRESET_ID_RE).nullable(),
  savedId: z.string().regex(BADGE_PRESET_ID_RE).nullable(),
  savedRev: z.string().regex(BADGE_PRESET_REV_RE).nullable(),
  baseline: z.string().max(20000).nullable(),
  workspaceKey: z.string().max(100).optional(),
})

export type BadgeLabDraft = z.infer<typeof badgeLabDraftSchema>
export function badgeLabDraftKey(uuid: string | null): string {
  return `pictorium:badge-lab:draft:v1:${uuid ?? "anonymous"}`
}

export function readBadgeLabDraft(raw: string | null): BadgeLabDraft | null {
  if (!raw || raw.length > 20000) return null
  try {
    const result = badgeLabDraftSchema.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch { return null }
}

/** Independent drafts for starters and saved presets, isolated by space. */
export function readBadgeLabWorkspaces(raw: string | null): Record<string, BadgeLabDraft> {
  if (!raw || raw.length > 20_000_000) return {}
  try {
    const result = z.record(z.string().max(100), badgeLabDraftSchema).refine((v) => Object.keys(v).length <= 1000).safeParse(JSON.parse(raw))
    return result.success ? result.data : {}
  } catch { return {} }
}
