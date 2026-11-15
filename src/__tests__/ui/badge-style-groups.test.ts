import { describe, expect, it } from "vitest"
import { AGE_BADGE_STYLES, BADGE_STYLES, EXTRA_BADGE_STYLES, QUALITY_BADGE_STYLES, SEPARATE_RATINGS_STYLES } from "@/lib/badge-styles"
import { RANK_BADGE_VARIANTS } from "@/components/RankingAppearanceSelector"
import { EXTRA_STYLE_GROUPS, GENRE_STYLE_GROUPS, QUALITY_STYLE_GROUPS, RANK_VARIANT_GROUPS, SEPARATE_STYLE_GROUPS, groupStyleOptions, type GroupedEntry } from "@/lib/badge-style-groups"

const ids = (e: GroupedEntry[]) => e.map((x) => (x.kind === "group" ? `${x.group.id}:${x.members.join(",")}` : x.value))

describe("badge style groups", () => {
  it("every group member is a real option of its family", () => {
    const cases = [
      [GENRE_STYLE_GROUPS, BADGE_STYLES],
      [EXTRA_STYLE_GROUPS, EXTRA_BADGE_STYLES],
      [RANK_VARIANT_GROUPS, RANK_BADGE_VARIANTS],
      [QUALITY_STYLE_GROUPS, QUALITY_BADGE_STYLES],
      [SEPARATE_STYLE_GROUPS, SEPARATE_RATINGS_STYLES],
    ] as const
    for (const [groups, options] of cases) for (const g of groups) for (const m of g.members) expect(options as readonly string[]).toContain(m)
  })

  it("genre list collapses to families plus singles", () => {
    const opts = ["shadow", "pill", "bar", "colored", "bordo", "vetro", "minimal", "ink", "tinta", "sfumato", "split", "editoriale", "notch-crema", "notch-vetro", "notch-inchiostro", "notch-sfumato"]
    expect(ids(groupStyleOptions(opts, GENRE_STYLE_GROUPS))).toEqual([
      "text:shadow,minimal,ink,editoriale", "pill:pill,colored,tinta,split", "bar", "frame:bordo,vetro,sfumato", "notch:notch-crema,notch-vetro,notch-inchiostro,notch-sfumato",
    ])
  })

  it("age filters members and degrades a one-member group to a single", () => {
    expect(ids(groupStyleOptions(AGE_BADGE_STYLES, QUALITY_STYLE_GROUPS))).toEqual([
      "textPill:standard,outline", "icons:color,premium,mono", "plates:nova,gradient,knockout", "editoriale",
    ])
  })
})
