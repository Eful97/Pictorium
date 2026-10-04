import { describe, expect, it } from "vitest"
import { isGradientDirty, isGradientDirtyForShape, isArtworkDirty, isMappingDirty, type GradientTuning, type FullMappingCheckState } from "@/lib/gradient-dirty"
import type { Mapping } from "@/lib/types"

const DEFAULTS: GradientTuning = {
  gradientHeight: 30,
  blurEnabled: true,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  tintStrength: 20,
  topShade: 50,
}

const mapping = (partial: Partial<Mapping> = {}): Mapping => ({
  tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
  logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
  ...partial,
})

describe("isGradientDirty", () => {
  it("false quando lo stato corrente coincide coi default (titolo mai salvato)", () => {
    expect(isGradientDirty({ ...DEFAULTS }, null, DEFAULTS, "poster")).toBe(false)
    expect(isGradientDirty({ ...DEFAULTS }, undefined, DEFAULTS, "poster")).toBe(false)
  })

  it("true quando un preset/slider muove un solo campo", () => {
    expect(isGradientDirty({ ...DEFAULTS, blurFade: 60 }, null, DEFAULTS, "poster")).toBe(true)
    expect(isGradientDirty({ ...DEFAULTS, topShade: 0 }, null, DEFAULTS, "poster")).toBe(true)
    expect(isGradientDirty({ ...DEFAULTS, blurEnabled: false }, null, DEFAULTS, "poster")).toBe(true)
  })

  it("false quando corrente e mapping congelato coincidono", () => {
    const m = mapping({ gradientHeight: 40, blurIntensity: 20, blurFade: 60, blurDarkness: 0, tintStrength: 100, topShade: 70, blurEnabled: true })
    expect(isGradientDirty(
      { gradientHeight: 40, blurEnabled: true, blurIntensity: 20, blurFade: 60, blurDarkness: 0, tintStrength: 100, topShade: 70 },
      m, DEFAULTS, "poster",
    )).toBe(false)
  })

  it("i null del mapping ricadono sui default (mai falsi positivi)", () => {
    const m = mapping({ gradientHeight: null, blurFade: null, topShade: null })
    expect(isGradientDirty({ ...DEFAULTS }, m, DEFAULTS, "poster")).toBe(false)
    expect(isGradientDirty({ ...DEFAULTS, blurFade: 60 }, m, DEFAULTS, "poster")).toBe(true)
  })

  it("rispetta il profilo landscape del mapping", () => {
    const m = mapping({
      posterShape: "landscape",
      blurFade: 10,
      landscape: { blurFade: 70, gradientHeight: null, blurEnabled: null, blurIntensity: null, blurDarkness: null },
    })
    // Profilo orizzontale: fade 70 effettivo, non il flat 10.
    expect(isGradientDirty({ ...DEFAULTS, blurFade: 70 }, m, DEFAULTS, "poster")).toBe(false)
    expect(isGradientDirty({ ...DEFAULTS, blurFade: 10 }, m, DEFAULTS, "poster")).toBe(true)
  })
})

describe("isGradientDirtyForShape", () => {
  it("confronta il profilo del formato visualizzato, non quello salvato", () => {
    // Mapping portrait con profilo landscape diverso: in landscape la
    // preview mostra il profilo, i flat non contano.
    const m = mapping({
      posterShape: "poster",
      blurFade: 10,
      landscape: { blurFade: 70, gradientHeight: null, blurEnabled: null, blurIntensity: null, blurDarkness: null, tintStrength: null, topShade: null },
    })
    const landscapeDefaults: GradientTuning = { ...DEFAULTS, blurFade: 70 }
    expect(isGradientDirtyForShape({ ...DEFAULTS, blurFade: 70 }, m, landscapeDefaults, "landscape")).toBe(false)
    // Stesso stato, formato portrait: fade 10 effettivo contro default 50.
    expect(isGradientDirtyForShape({ ...DEFAULTS, blurFade: 70 }, m, DEFAULTS, "poster")).toBe(true)
  })

  it("una modifica orizzontale attiva l'avviso in landscape", () => {
    const m = mapping({
      posterShape: "landscape",
      topShade: 10,
      landscape: { blurFade: 70, gradientHeight: 20, blurEnabled: true, blurIntensity: 20, blurDarkness: 30, tintStrength: 20, topShade: 80 },
    })
    const landscapeDefaults: GradientTuning = { ...DEFAULTS, blurFade: 70, gradientHeight: 20 }
    // Il profilo landscape congela topShade 80: il flat 10 non conta.
    const current: GradientTuning = { ...DEFAULTS, blurFade: 70, gradientHeight: 20, topShade: 80 }
    expect(isGradientDirtyForShape(current, m, landscapeDefaults, "landscape")).toBe(false)
    expect(isGradientDirtyForShape({ ...current, topShade: 10 }, m, landscapeDefaults, "landscape")).toBe(true)
    expect(isGradientDirtyForShape({ ...current, tintStrength: 90 }, m, landscapeDefaults, "landscape")).toBe(true)
    expect(isGradientDirtyForShape({ ...current, topShade: 0 }, m, landscapeDefaults, "landscape")).toBe(true)
  })
})

describe("isArtworkDirty", () => {
  it("false quando artwork corrente e mapping coincidono", () => {
    const m = mapping({ posterPath: "/p.jpg", backdropPath: "/b.jpg", posterShape: "poster", logoPath: "/l.png" })
    expect(isArtworkDirty(
      { posterPath: "/p.jpg", backdropPath: "/b.jpg", posterShape: "poster", logoPath: "/l.png" },
      m, "poster",
    )).toBe(false)
  })

  it("true quando poster/backdrop/formato/logo divergono dal salvato", () => {
    const m = mapping({ posterPath: "/p.jpg", backdropPath: "/b.jpg", posterShape: "poster", logoPath: "/l.png" })
    expect(isArtworkDirty(
      { posterPath: "/other.jpg", backdropPath: "/b.jpg", posterShape: "poster", logoPath: "/l.png" },
      m, "poster",
    )).toBe(true)
    expect(isArtworkDirty(
      { posterPath: "/p.jpg", backdropPath: "/best.jpg", posterShape: "poster", logoPath: "/l.png" },
      m, "poster",
    )).toBe(true)
    expect(isArtworkDirty(
      { posterPath: "/p.jpg", backdropPath: "/b.jpg", posterShape: "landscape", logoPath: "/l.png" },
      m, "poster",
    )).toBe(true)
    expect(isArtworkDirty(
      { posterPath: "/p.jpg", backdropPath: "/b.jpg", posterShape: "poster", logoPath: "/other.png" },
      m, "poster",
    )).toBe(true)
  })

  it("logo disabilitato equivale a nessun logo", () => {
    const m = mapping({ posterPath: "/p.jpg", logoPath: "/l.png", logoDisabled: true })
    expect(isArtworkDirty(
      { posterPath: "/p.jpg", backdropPath: null, posterShape: "poster", logoPath: "/l.png", logoDisabled: true },
      m, "poster",
    )).toBe(false)
  })

  it("poster custom salvato non viene indicato come modificato", () => {
    const customUrl = "https://images.example.com/custom-poster.jpg"
    const m = mapping({
      posterPath: "/fallback.jpg",
      customPosterUrl: customUrl,
      backdropPath: null,
      posterShape: "poster",
      logoPath: null,
    })
    // In UI previewPoster.file_path è l'URL custom
    expect(isArtworkDirty(
      { posterPath: customUrl, backdropPath: null, posterShape: "poster", logoPath: null },
      m, "poster",
    )).toBe(false)
    expect(isArtworkDirty(
      { posterPath: "/fallback.jpg", customPosterUrl: customUrl, backdropPath: null, posterShape: "poster", logoPath: null },
      m, "poster",
    )).toBe(false)
    // Se torna al poster TMDB o cambia URL custom, diventa dirty
    expect(isArtworkDirty(
      { posterPath: "/fallback.jpg", backdropPath: null, posterShape: "poster", logoPath: null },
      m, "poster",
    )).toBe(true)
    expect(isArtworkDirty(
      { posterPath: "https://images.example.com/other.jpg", backdropPath: null, posterShape: "poster", logoPath: null },
      m, "poster",
    )).toBe(true)
  })

  it("titolo mai salvato: dirty appena c'è una selezione locale", () => {
    expect(isArtworkDirty(
      { posterPath: null, backdropPath: null, posterShape: "poster", logoPath: null },
      null, "poster",
    )).toBe(false)
    // Best Fit orizzontale scelto ma non salvato → Stremio mostra ancora l'auto.
    expect(isArtworkDirty(
      { posterPath: "/p.jpg", backdropPath: "/best.jpg", posterShape: "landscape", logoPath: "/l.png" },
      null, "poster",
    )).toBe(true)
  })
})

describe("isMappingDirty", () => {
  const baseArtwork = { posterPath: "/p.jpg", backdropPath: "/b.jpg", posterShape: "poster" as const, logoPath: "/l.png" };
  const baseState: FullMappingCheckState = {
    artwork: baseArtwork,
    gradient: { ...DEFAULTS },
    logoScale: 100,
    logoOffsetX: 0,
    logoOffsetY: 0,
    globalBadges: true,
  };

  it("false quando lo stato corrisponde esattamente al mapping", () => {
    const m = mapping({
      ...baseArtwork,
      ...DEFAULTS,
      logoScale: 100,
      logoOffsetX: 0,
      logoOffsetY: 0,
      showBadges: true,
    });
    expect(isMappingDirty(baseState, m, DEFAULTS, "poster")).toBe(false);
  });

  it("true quando logoScale o offset cambiano", () => {
    const m = mapping({ ...baseArtwork, ...DEFAULTS, logoScale: 100, logoOffsetX: 0, logoOffsetY: 0, showBadges: true });
    expect(isMappingDirty({ ...baseState, logoScale: 120 }, m, DEFAULTS, "poster")).toBe(true);
    expect(isMappingDirty({ ...baseState, logoOffsetY: 10 }, m, DEFAULTS, "poster")).toBe(true);
  });

  it("true quando impostazioni badge cambiano", () => {
    const m = mapping({ ...baseArtwork, ...DEFAULTS, logoScale: 100, showBadges: true, rankingBadges: false });
    expect(isMappingDirty({ ...baseState, rankingBadges: true }, m, DEFAULTS, "poster")).toBe(true);
  });

  it("true quando customBadge cambia", () => {
    const m = mapping({ ...baseArtwork, ...DEFAULTS, customBadge: "4K UHD" });
    expect(isMappingDirty({ ...baseState, customBadge: "IMAX" }, m, DEFAULTS, "poster")).toBe(true);
  });

  it("in landscape confronta contro il profilo landscape del mapping", () => {
    const m = mapping({
      ...baseArtwork,
      ...DEFAULTS,
      posterShape: "landscape",
      logoScale: 80,
      logoOffsetX: 5,
      landscape: {
        logoScale: 120,
        logoOffsetX: 15,
        logoOffsetY: 0,
      },
    });
    const landscapeArtwork = { ...baseArtwork, posterShape: "landscape" as const };
    // Stato che coincide col profilo orizzontale salvato -> non dirty
    expect(isMappingDirty({
      ...baseState,
      artwork: landscapeArtwork,
      logoScale: 120,
      logoOffsetX: 15,
      logoOffsetY: 0,
    }, m, DEFAULTS, "poster")).toBe(false);

    // Se si modifica logoScale rispetto al profilo landscape salvato -> dirty
    expect(isMappingDirty({
      ...baseState,
      artwork: landscapeArtwork,
      logoScale: 130,
      logoOffsetX: 15,
      logoOffsetY: 0,
    }, m, DEFAULTS, "poster")).toBe(true);
  });

  it("rileva modifiche ai badge anche quando il mapping salvato ha valori di default (undefined)", () => {
    // Mapping salvato senza showBadges (default ON implicito)
    const m = mapping({ ...baseArtwork, ...DEFAULTS, logoScale: 100 });
    // Disabilitare globalBadges deve risultare dirty
    expect(isMappingDirty({ ...baseState, globalBadges: false }, m, DEFAULTS, "poster")).toBe(true);
    // Cambiare badgeStyle deve risultare dirty
    expect(isMappingDirty({ ...baseState, badgeStyle: "glow" }, m, DEFAULTS, "poster")).toBe(true);
    // Cambiare qualità o ranking style deve risultare dirty
    expect(isMappingDirty({ ...baseState, qualityBadgeStyle: "pill" }, m, DEFAULTS, "poster")).toBe(true);
    expect(isMappingDirty({ ...baseState, rankingBadgeStyle: "ribbon" }, m, DEFAULTS, "poster")).toBe(true);
  });

  it("font cambiato → modifiche non salvate; ripristinato → salvato", () => {
    const m = mapping({ ...baseArtwork, ...DEFAULTS, logoScale: 100, showBadges: true });
    // Mapping senza badgeFont (default inter implicito): stato inter = pulito
    expect(isMappingDirty({ ...baseState, badgeFont: "inter" }, m, DEFAULTS, "poster")).toBe(false);
    // Cambio font → dirty
    expect(isMappingDirty({ ...baseState, badgeFont: "oswald" }, m, DEFAULTS, "poster")).toBe(true);
    expect(isMappingDirty({ ...baseState, badgeFont: "barlow-condensed" }, m, DEFAULTS, "poster")).toBe(true);
    // Mapping con font salvato: stato uguale = pulito, diverso = dirty
    const mFont = mapping({ ...baseArtwork, ...DEFAULTS, logoScale: 100, showBadges: true, badgeFont: "oswald" });
    expect(isMappingDirty({ ...baseState, badgeFont: "oswald" }, mFont, DEFAULTS, "poster")).toBe(false);
    expect(isMappingDirty({ ...baseState, badgeFont: "inter" }, mFont, DEFAULTS, "poster")).toBe(true);
  });
});
