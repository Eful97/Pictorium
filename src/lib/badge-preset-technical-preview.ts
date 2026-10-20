// ---------------------------------------------------------------------------
// Server-only async previews for Badge Lab technical families.
//
// The sync shared builder (`buildHousePresetSvg`) covers the pure-SVG
// technical starters (quality standard/knockout, age). Fixed-geometry and
// raster recipes (comingSoon ribbon, quality mono/color icons,
// the network pill, separate/custom rows) render here through the SAME
// native builders the poster uses, fed with deterministic fixtures
// (zero upstream fetch). Results are wrapped as SVG (`<image>` data URI)
// so the preview API keeps its `image/svg+xml` contract with genuine native
// pixels — never approximate clones, never blank thumbs.
//
// Live poster renders never touch this module (they pass real dynamic
// values through the service); fixtures never leak into the poster path.
// ---------------------------------------------------------------------------

import sharp from "sharp"
import {
  buildComingSoonRibbonSvg,
  buildHousePresetSvg,
  type HousePresetScene,
} from "./badge-svg-shared"
import {
  renderAgeKnockoutBadge,
  renderQualityBadge,
  renderQualityKnockoutBadge,
  renderQualityTierBadge,
} from "./svg-badge"
import { renderQualityIconBadge } from "./poster-service"
import { renderFirstMatchingNetworkLogoBadgeHybrid } from "./network-svgs"
import {
  renderSeparateRatingStack,
  renderSeparateRatingsBottom,
} from "./separate-rating-renderer"
import { renderMultiRatings } from "./multi-rating-renderer"
import { DEMO_SAMPLE_NETWORK } from "./demo-samples"
import {
  TECHNICAL_PREVIEW_FIXTURES,
  isTechnicalFamilyId,
  resolveTechnicalHouseStyle,
  technicalPresetAppearance,
  technicalPresetPolarity,
  technicalPresetScale,
  technicalPresetSide,
  technicalPresetTypography,
  technicalTypographyForStyle,
} from "./badge-preset-technical"
import { qualityBadgeIconPath } from "./quality-badge-styles"
import { resolveBadgeText } from "./badge-variables"
import type { BadgePreset } from "./badge-preset"
import { isQualityBadgeStyle, isSeparateRatingsStyle } from "./badge-styles"
import { applyHouseAppearance } from "./badge-house-appearance"
import type { TechnicalBadgeFinish } from "./svg-badge"
import type { SeparateRatingsFinish } from "./separate-rating-renderer"
import { wrapBitmapWithAppearance } from "./poster-service"

const PREVIEW_PW = 380

/** Dark mock scene (same as the existing preset preview route). */
const PREVIEW_SCENE: HousePresetScene = {
  topLight: false,
  bottomLight: false,
  accentColor: "#555555",
}

function pngToSvg(png: Buffer, w: number, h: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<image href="data:image/png;base64,${png.toString("base64")}" x="0" y="0" width="${w}" height="${h}"/></svg>`
  )
}

async function applyPreviewScale(
  bitmap: { png: Buffer; w: number; h: number } | null,
  scalePct: number,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  if (!bitmap || scalePct === 100) return bitmap
  const w = Math.max(1, Math.round((bitmap.w * scalePct) / 100))
  const h = Math.max(1, Math.round((bitmap.h * scalePct) / 100))
  if (w === bitmap.w && h === bitmap.h) return bitmap
  const png = await sharp(bitmap.png).resize(w, h).toBuffer()
  return { png, w, h }
}

/**
 * Render a technical-family preset to SVG with deterministic fixtures.
 * Returns null only when the native recipe has no live content either
 * (fail-open: the caller serves the transparent placeholder, never 500).
 */
export async function renderTechnicalPresetPreviewSvg(
  preset: BadgePreset,
): Promise<string | null> {
  if (!isTechnicalFamilyId(preset.target)) return null
  const family = preset.target
  const context = {
    rating: "8.5",
    year: "2024",
    genre: "Drama",
    rank: "3",
    imdb: "tt1234567",
    tmdb: "12345",
    quality: TECHNICAL_PREVIEW_FIXTURES.quality,
    age: TECHNICAL_PREVIEW_FIXTURES.age,
    network: DEMO_SAMPLE_NETWORK.name,
    comingSoon: TECHNICAL_PREVIEW_FIXTURES.comingSoon,
  }
  const polarity = technicalPresetPolarity(preset)
  const scene: HousePresetScene = {
    ...PREVIEW_SCENE,
    topLight: polarity === "light" ? true : polarity === "dark" ? false : PREVIEW_SCENE.topLight,
    bottomLight: polarity === "light" ? true : polarity === "dark" ? false : PREVIEW_SCENE.bottomLight,
  }

  // Sync pure-SVG starters first (same builder as the poster service path
  // for these styles — quality standard/knockout, age). House scale rides
  // inside via effPw; custom variants go through the async native wrappers
  // below (same recipes, sharp post-scale like the service).
  if (preset.variant === "house" && (family === "quality" || family === "age")) {
    const style = resolveTechnicalHouseStyle(family, preset)
    if (family === "quality" && style !== "standard" && style !== "knockout") {
      // Mono/color need the icon files (async below); sync would be blank.
    } else {
      const r = buildHousePresetSvg(preset, context, PREVIEW_PW, scene)
      if (r) return r.svg
      return null
    }
  }
  // ComingSoon (both variants): the live fixture label unless the house
  // preset carries explicit user text; side from the house preset. Scale is
  // inert like the service (fixed corner geometry) — preview == poster.
  // Typography + material ride the same builder as the poster.
  if (family === "comingSoon") {
    const overrideLabel =
      preset.variant === "house" && preset.house?.label?.trim()
        ? resolveBadgeText(preset.house.label, context)
        : ""
    const side =
      (preset.variant === "house" ? technicalPresetSide(preset) : null) ?? "left"
    const typo = technicalPresetTypography(preset)
    const appearance = technicalPresetAppearance("comingSoon", preset)
    const badge = buildComingSoonRibbonSvg(
      overrideLabel || TECHNICAL_PREVIEW_FIXTURES.comingSoon,
      PREVIEW_PW,
      side,
      "inter",
      {
        fontSize: typo?.fontSize,
        textColor: typo?.textColor ?? undefined,
        textOpacity: typo?.textOpacity ?? undefined,
        uppercase: typo?.uppercase,
      },
    )
    return (appearance ? applyHouseAppearance(badge, appearance, PREVIEW_PW / 380) : badge).svg
  }

  // Raster/native recipes (same builders as the poster service): quality
  // mono/color icons, age pills for custom variants, network pill, separate
  // rows, custom rows. Custom-variant presets keep the native content (never
  // generic text) with the preset scale applied like the service post-scale.
  // House material/typography rides the same finish objects as the poster.
  const finishFor = (familyId: "quality" | "age", style: string | null): TechnicalBadgeFinish => ({
    appearance: technicalPresetAppearance(familyId, preset) ?? undefined,
    typography: technicalTypographyForStyle(familyId, style, technicalPresetTypography(preset)),
  })
  const scalePct = technicalPresetScale(preset)
  if (family === "quality") {
    const style = preset.variant === "house"
      ? resolveTechnicalHouseStyle("quality", preset)
      : "standard"
    const effStyle = style && isQualityBadgeStyle(style) ? style : "standard"
    const finish = finishFor("quality", effStyle)
    if (effStyle === "knockout") {
      const tag = await renderQualityKnockoutBadge(
        TECHNICAL_PREVIEW_FIXTURES.quality,
        PREVIEW_PW,
        "inter",
        finish,
      ).catch(() => null)
      const scaled = await applyPreviewScale(tag, scalePct).catch(() => tag)
      return scaled ? pngToSvg(scaled.png, scaled.w, scaled.h) : null
    }
    if (effStyle === "standard") {
      const tier = await renderQualityTierBadge(
        TECHNICAL_PREVIEW_FIXTURES.quality,
        PREVIEW_PW,
        scene.topLight,
        "inter",
        finish,
      ).catch(() => null)
      const scaled = await applyPreviewScale(tier, scalePct).catch(() => tier)
      return scaled ? pngToSvg(scaled.png, scaled.w, scaled.h) : null
    }
    const iconPath = qualityBadgeIconPath(effStyle, TECHNICAL_PREVIEW_FIXTURES.quality)
    if (!iconPath) return null
    const icon = await renderQualityIconBadge(iconPath, PREVIEW_PW, scene.topLight).catch(() => null)
    const plated = icon && finish.appearance
      ? await wrapBitmapWithAppearance(icon, finish.appearance, PREVIEW_PW / 380).catch(() => icon)
      : icon
    const scaled = await applyPreviewScale(plated, scalePct).catch(() => plated)
    return scaled ? pngToSvg(scaled.png, scaled.w, scaled.h) : null
  }
  if (family === "age") {
    const style = preset.variant === "house"
      ? resolveTechnicalHouseStyle("age", preset)
      : "standard"
    const effStyle = style === "knockout" ? "knockout" : "standard"
    const finish = finishFor("age", effStyle)
    const pill = effStyle === "knockout"
      ? await renderAgeKnockoutBadge(TECHNICAL_PREVIEW_FIXTURES.age, PREVIEW_PW, "inter", finish).catch(() => null)
      : await renderQualityBadge(TECHNICAL_PREVIEW_FIXTURES.age, PREVIEW_PW, scene.topLight, "inter", finish).catch(() => null)
    const scaled = await applyPreviewScale(pill, scalePct).catch(() => pill)
    return scaled ? pngToSvg(scaled.png, scaled.w, scaled.h) : null
  }
  if (family === "network") {
    const mark = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: DEMO_SAMPLE_NETWORK.name, logoPath: DEMO_SAMPLE_NETWORK.logoPath }],
      PREVIEW_PW,
      scene.topLight,
    ).catch(() => null)
    const plated = mark && preset.variant === "house"
      ? await wrapBitmapWithAppearance(mark, technicalPresetAppearance("network", preset), PREVIEW_PW / 380).catch(() => mark)
      : mark
    const scaled = await applyPreviewScale(plated, scalePct).catch(() => plated)
    return scaled ? pngToSvg(scaled.png, scaled.w, scaled.h) : null
  }
  if (family === "separateRatings") {
    const style = preset.variant === "house"
      ? resolveTechnicalHouseStyle("separateRatings", preset)
      : "column"
    const effStyle = style && isSeparateRatingsStyle(style) ? style : "column"
    const finish: SeparateRatingsFinish = {
      appearance: technicalPresetAppearance("separateRatings", preset) ?? undefined,
      typography: technicalPresetTypography(preset),
    }
    const items = [...TECHNICAL_PREVIEW_FIXTURES.separateRatings]
    if (effStyle === "column") {
      const stack = await renderSeparateRatingStack(
        items,
        PREVIEW_PW,
        scene.topLight,
        "inter",
        scalePct,
        finish,
      ).catch(() => null)
      return stack ? pngToSvg(stack.png, stack.w, stack.h) : null
    }
    const bottom = await renderSeparateRatingsBottom(
      items,
      PREVIEW_PW,
      effStyle,
      "inter",
      scalePct,
      effStyle === "bottom-bar" ? PREVIEW_PW : PREVIEW_PW - 36,
      scene.bottomLight,
      finish,
    ).catch(() => null)
    return bottom ? pngToSvg(bottom.png, bottom.w, bottom.h) : null
  }
  if (family === "customRatings") {
    const finish: SeparateRatingsFinish = {
      appearance: technicalPresetAppearance("customRatings", preset) ?? undefined,
      typography: technicalPresetTypography(preset),
    }
    const row = await renderMultiRatings(
      [...TECHNICAL_PREVIEW_FIXTURES.customRatings],
      PREVIEW_PW - 40,
      scene.bottomLight,
      "inter",
      finish,
    ).catch(() => null)
    const scaled = await applyPreviewScale(row, scalePct).catch(() => row)
    return scaled ? pngToSvg(scaled.png, scaled.w, scaled.h) : null
  }
  // comingSoon is handled by the unified branch above; unknown families here
  // are not technical (guarded at entry) — fail-closed null.
  return null
}
