import { describe, expect, it } from "vitest"
import { isGradientDirty, isGradientDirtyForShape, isArtworkDirty, isMappingDirty, type GradientTuning, type FullMappingCheckState } from "@/lib/gradient-dirty"
import { KNOWN_VIDEO_FORMATS, type VideoFormat } from "@/lib/av-specs"
import type { Mapping } from "@/lib/types"

const DEFAULTS: GradientTuning = {
  gradientHeight: 30,
  blurEnabled: true,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  tintStrength: 20,
  topShade: 50,
  topShadeHeight: 25,
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
    expect(isGradientDirty({ ...DEFAULTS, topShadeHeight: 60 }, null, DEFAULTS, "poster")).toBe(true)
    expect(isGradientDirty({ ...DEFAULTS, blurEnabled: false }, null, DEFAULTS, "poster")).toBe(true)
  })

  it("false quando corrente e mapping congelato coincidono", () => {
    const m = mapping({ gradientHeight: 40, blurIntensity: 20, blurFade: 60, blurDarkness: 0, tintStrength: 100, topShade: 70, blurEnabled: true })
    expect(isGradientDirty(
      { gradientHeight: 40, blurEnabled: true, blurIntensity: 20, blurFade: 60, blurDarkness: 0, tintStrength: 100, topShade: 70, topShadeHeight: 25 },
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

  it("true quando la scala separati cambia (flat e profilo landscape)", () => {
    const m = mapping({ ...baseArtwork, ...DEFAULTS, separateBadgeScale: 100 });
    expect(isMappingDirty({ ...baseState, separateBadgeScale: 100 }, m, DEFAULTS, "poster")).toBe(false);
    expect(isMappingDirty({ ...baseState, separateBadgeScale: 150 }, m, DEFAULTS, "poster")).toBe(true);
    // Mapping senza campo (default 130 implicito): 130 pulito, 100/150 dirty.
    const mLegacy = mapping({ ...baseArtwork, ...DEFAULTS });
    expect(isMappingDirty({ ...baseState, separateBadgeScale: 130 }, mLegacy, DEFAULTS, "poster")).toBe(false);
    expect(isMappingDirty({ ...baseState, separateBadgeScale: 100 }, mLegacy, DEFAULTS, "poster")).toBe(true);
    expect(isMappingDirty({ ...baseState, separateBadgeScale: 150 }, mLegacy, DEFAULTS, "poster")).toBe(true);
  });

  it("scala separati in landscape confrontata contro il profilo landscape", () => {
    const m = mapping({
      ...baseArtwork,
      ...DEFAULTS,
      posterShape: "landscape",
      separateBadgeScale: 100,
      landscape: { separateBadgeScale: 150 },
    });
    const landscapeArtwork = { ...baseArtwork, posterShape: "landscape" as const };
    expect(isMappingDirty({ ...baseState, artwork: landscapeArtwork, separateBadgeScale: 150 }, m, DEFAULTS, "poster")).toBe(false);
    expect(isMappingDirty({ ...baseState, artwork: landscapeArtwork, separateBadgeScale: 100 }, m, DEFAULTS, "poster")).toBe(true);
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

/**
 * Audit Task 4 F1: `isMappingDirty` omitted per-title persisted keys that move
 * pixels (age badge/country/style, A/V formats, rating sources, seasonal
 * frame). A false "Saved" state let those edits ship silently. The comparisons
 * use the SAME chain the editor opens with (`effective mapping ?? shape
 * default`), so a global default is never mistaken for an unsaved edit.
 */
describe("isMappingDirty — per-title visual keys (audit F1)", () => {
  const baseArtwork = { posterPath: "/p.jpg", backdropPath: "/b.jpg", posterShape: "poster" as const, logoPath: "/l.png" };
  const baseState: FullMappingCheckState = { artwork: baseArtwork, gradient: { ...DEFAULTS } };
  // Fully "frozen" mapping: only the key under test can make it dirty.
  const saved = (partial: Partial<Mapping> = {}) => mapping({ ...baseArtwork, ...DEFAULTS, ...partial });

  it("badge età: OFF di default pulito, cambio ON dirty, default globale ON pulito", () => {
    const m = saved();
    const defaults = { ageBadge: false, ageCountry: "IT", ageBadgeStyle: "standard" };
    expect(isMappingDirty({ ...baseState, ageBadge: false }, m, DEFAULTS, "poster", defaults)).toBe(false);
    expect(isMappingDirty({ ...baseState, ageBadge: true }, m, DEFAULTS, "poster", defaults)).toBe(true);
    // Default globale ON: senza chiave nel mapping l'apertura parte da ON.
    expect(isMappingDirty({ ...baseState, ageBadge: true }, m, DEFAULTS, "poster", { ...defaults, ageBadge: true })).toBe(false);
    // Mapping che congela OFF vince sul default ON.
    expect(isMappingDirty({ ...baseState, ageBadge: true }, saved({ ageBadge: false }), DEFAULTS, "poster", { ...defaults, ageBadge: true })).toBe(true);
  });

  it("paese età: default globale non è una modifica, il cambio sì (normalizzato)", () => {
    const m = saved();
    expect(isMappingDirty({ ...baseState, ageCountry: "US" }, m, DEFAULTS, "poster", { ageCountry: "US" })).toBe(false);
    expect(isMappingDirty({ ...baseState, ageCountry: "IT" }, m, DEFAULTS, "poster", { ageCountry: "US" })).toBe(true);
    expect(isMappingDirty({ ...baseState, ageCountry: "US" }, saved({ ageCountry: "US" }), DEFAULTS, "poster", { ageCountry: "IT" })).toBe(false);
    // Valore legacy invalido = fallback fail-closed, mai falso positivo.
    expect(isMappingDirty({ ...baseState, ageCountry: "IT" }, saved({ ageCountry: "GLOBAL" }), DEFAULTS, "poster", { ageCountry: "IT" })).toBe(false);
  });

  it("stile pill età: standard di default pulito, stile diverso dirty", () => {
    const m = saved();
    expect(isMappingDirty({ ...baseState, ageBadgeStyle: "standard" }, m, DEFAULTS, "poster")).toBe(false);
    expect(isMappingDirty({ ...baseState, ageBadgeStyle: "mono" }, m, DEFAULTS, "poster")).toBe(true);
    expect(isMappingDirty({ ...baseState, ageBadgeStyle: "mono" }, saved({ ageBadgeStyle: "mono" }), DEFAULTS, "poster")).toBe(false);
    expect(isMappingDirty({ ...baseState, ageBadgeStyle: "standard" }, saved({ ageBadgeStyle: "mono" }), DEFAULTS, "poster")).toBe(true);
  });

  it("formati A/V: selezione (ordine irrilevante), null segue il default effettivo", () => {
    const all: VideoFormat[] = [...KNOWN_VIDEO_FORMATS];
    const m = saved();
    const defaults = { videoFormats: all };
    // Mapping senza chiave e live null: stessa resa (segue il default) → pulito.
    expect(isMappingDirty({ ...baseState, videoFormats: null }, m, DEFAULTS, "poster", defaults)).toBe(false);
    // La selezione intera esplicita equivale al default senza restrizione.
    expect(isMappingDirty({ ...baseState, videoFormats: all }, m, DEFAULTS, "poster", defaults)).toBe(false);
    // Restrizione non salvata → dirty.
    expect(isMappingDirty({ ...baseState, videoFormats: ["dv", "hdr"] }, m, DEFAULTS, "poster", defaults)).toBe(true);
    // Mapping ristretto: ordine diverso non conta.
    const mDv = saved({ videoFormats: ["dv"] });
    expect(isMappingDirty({ ...baseState, videoFormats: ["dv"] }, mDv, DEFAULTS, "poster", defaults)).toBe(false);
    expect(isMappingDirty({ ...baseState, videoFormats: ["dv", "hdr"] }, mDv, DEFAULTS, "poster", defaults)).toBe(true);
    // "nessun formato" salvato ([]) è diverso da null (segue il default).
    expect(isMappingDirty({ ...baseState, videoFormats: null }, saved({ videoFormats: [] }), DEFAULTS, "poster", defaults)).toBe(true);
    expect(isMappingDirty({ ...baseState, videoFormats: [] }, saved({ videoFormats: [] }), DEFAULTS, "poster", defaults)).toBe(false);
  });

  it("fonti voto: default globale non è una modifica, ordine significativo", () => {
    const m = saved();
    const defaults = { ratingSources: ["imdb", "tmdb"] };
    expect(isMappingDirty({ ...baseState, ratingSources: ["imdb", "tmdb"] }, m, DEFAULTS, "poster", defaults)).toBe(false);
    expect(isMappingDirty({ ...baseState, ratingSources: ["imdb"] }, m, DEFAULTS, "poster", defaults)).toBe(true);
    expect(isMappingDirty({ ...baseState, ratingSources: ["tmdb"] }, saved({ ratingSources: ["tmdb"] }), DEFAULTS, "poster", defaults)).toBe(false);
    // Stessa selezione, ordine diverso = ordine delle pill diverso → dirty.
    expect(isMappingDirty({ ...baseState, ratingSources: ["tmdb", "imdb"] }, saved({ ratingSources: ["imdb", "tmdb"] }), DEFAULTS, "poster", defaults)).toBe(true);
  });

  it("cornice stagionale: Automatico vs scelta esplicita (none compreso)", () => {
    const m = saved();
    expect(isMappingDirty({ ...baseState, seasonalTheme: null }, m, DEFAULTS, "poster")).toBe(false);
    expect(isMappingDirty({ ...baseState, seasonalTheme: "halloween" }, m, DEFAULTS, "poster")).toBe(true);
    expect(isMappingDirty({ ...baseState, seasonalTheme: "halloween" }, saved({ seasonalTheme: "halloween" }), DEFAULTS, "poster")).toBe(false);
    // "none" esplicito sopprime un tema ereditato: diverso da Automatico.
    expect(isMappingDirty({ ...baseState, seasonalTheme: null }, saved({ seasonalTheme: "none" }), DEFAULTS, "poster")).toBe(true);
    expect(isMappingDirty({ ...baseState, seasonalTheme: "none" }, saved({ seasonalTheme: "none" }), DEFAULTS, "poster")).toBe(false);
  });

  it("profilo landscape: badge età e formati letti dal profilo di forma", () => {
    const m = saved({
      posterShape: "landscape",
      landscape: { ageBadge: true, ageCountry: "GB", ageBadgeStyle: "mono", videoFormats: ["dv"] },
    });
    const state: FullMappingCheckState = {
      ...baseState,
      artwork: { ...baseArtwork, posterShape: "landscape" },
      ageBadge: true,
      ageCountry: "GB",
      ageBadgeStyle: "mono",
      videoFormats: ["dv"],
    };
    expect(isMappingDirty(state, m, DEFAULTS, "poster")).toBe(false);
    expect(isMappingDirty({ ...state, ageCountry: "IT" }, m, DEFAULTS, "poster")).toBe(true);
    expect(isMappingDirty({ ...state, videoFormats: ["hdr"] }, m, DEFAULTS, "poster")).toBe(true);
  });
});

/**
 * Audit Task 1b follow-up: accent manuale, logo testuale e base portrait
 * (crop backdrop) erano persistiti e muovono pixel ma restavano fuori dal
 * dirty tracking. Stessa catena dell'apertura (`mapping effettivo ?? default
 * di forma`), nessun valore auto-rilevato trattato come edit.
 */
describe("isMappingDirty — accent / logo testuale / base portrait (audit F1 follow-up)", () => {
  const baseArtwork = { posterPath: "/p.jpg", backdropPath: "/b.jpg", posterShape: "poster" as const, logoPath: null };
  const saved = (partial: Partial<Mapping> = {}) => mapping({ ...baseArtwork, ...DEFAULTS, ...partial });
  const state = (partial: Partial<FullMappingCheckState> = {}): FullMappingCheckState => ({
    artwork: baseArtwork,
    gradient: { ...DEFAULTS },
    ...partial,
  });

  it("accent: manuale salvato uguale è pulito, cambio è dirty, auto mai dirty", () => {
    const m = saved({ accentColor: "#E67E22" });
    const auto = "#E50914";
    expect(isMappingDirty(state({ accentColor: "#E67E22", autoAccentColor: auto }), m, DEFAULTS, "poster")).toBe(false);
    // Hex case-insensitive (il mapping può arrivare con maiuscole diverse).
    expect(isMappingDirty(state({ accentColor: "#e67e22", autoAccentColor: auto }), m, DEFAULTS, "poster")).toBe(false);
    expect(isMappingDirty(state({ accentColor: "#123456", autoAccentColor: auto }), m, DEFAULTS, "poster")).toBe(true);
    // Nessun manuale salvato → scelta manuale non ancora salvata.
    expect(isMappingDirty(state({ accentColor: "#123456", autoAccentColor: auto }), saved(), DEFAULTS, "poster")).toBe(true);
    // Auto = mai un edit, nemmeno senza chiave nel mapping.
    expect(isMappingDirty(state({ accentColor: auto, autoAccentColor: auto }), saved(), DEFAULTS, "poster")).toBe(false);
    // Hex salvato == auto-rilevato: la provenance manuale è indistinguibile,
    // quindi mai un falso "non salvato".
    expect(isMappingDirty(state({ accentColor: auto, autoAccentColor: auto }), saved({ accentColor: auto }), DEFAULTS, "poster")).toBe(false);
    // Reset ad auto di un manuale DIVERSO: il save sgancerebbe il mapping.
    expect(isMappingDirty(state({ accentColor: auto, autoAccentColor: auto }), m, DEFAULTS, "poster")).toBe(true);
  });

  it("accent: in landscape legge il profilo Orizzontale (null = automatico)", () => {
    const m = saved({ posterShape: "landscape", accentColor: "#ff0000", landscape: { accentColor: "#00ff00" } });
    const landArt = { ...baseArtwork, posterShape: "landscape" as const };
    const auto = "#0000ff";
    expect(isMappingDirty(state({ artwork: landArt, accentColor: "#00ff00", autoAccentColor: auto }), m, DEFAULTS, "poster")).toBe(false);
    expect(isMappingDirty(state({ artwork: landArt, accentColor: "#ff0000", autoAccentColor: auto }), m, DEFAULTS, "poster")).toBe(true);
    // Profilo con null esplicito = automatico: il flat manuale non resuscita.
    const mLandAuto = saved({ posterShape: "landscape", accentColor: "#ff0000", landscape: { accentColor: null } });
    expect(isMappingDirty(state({ artwork: landArt, accentColor: null, autoAccentColor: auto }), mLandAuto, DEFAULTS, "poster")).toBe(false);
  });

  it("logo testuale: testo normalizzato, font solo con testo, vuoto = nessun logo", () => {
    const m = saved({ logoText: "The Title", logoFont: "oswald" });
    expect(isMappingDirty(state({ logoText: "The Title", logoFont: "oswald" }), m, DEFAULTS, "poster")).toBe(false);
    // Spazi/newline extra: il renderer normalizza, nessuna differenza.
    expect(isMappingDirty(state({ logoText: "  The   Title ", logoFont: "oswald" }), m, DEFAULTS, "poster")).toBe(false);
    // Testo nuovo non salvato → dirty.
    expect(isMappingDirty(state({ logoText: "Other", logoFont: "oswald" }), m, DEFAULTS, "poster")).toBe(true);
    expect(isMappingDirty(state({ logoText: "Other", logoFont: "oswald" }), saved(), DEFAULTS, "poster")).toBe(true);
    // Svuotato (o soli spazi) = nessun logo → dirty contro un testo salvato.
    expect(isMappingDirty(state({ logoText: "   ", logoFont: "oswald" }), m, DEFAULTS, "poster")).toBe(true);
    expect(isMappingDirty(state({ logoText: "", logoFont: "inter" }), saved(), DEFAULTS, "poster")).toBe(false);
    // Il font conta solo quando un testo è mostrato.
    expect(isMappingDirty(state({ logoText: "The Title", logoFont: "inter" }), m, DEFAULTS, "poster")).toBe(true);
    expect(isMappingDirty(state({ logoText: "", logoFont: "oswald" }), saved(), DEFAULTS, "poster")).toBe(false);
  });

  it("logo testuale: flat condiviso, il profilo landscape non lo sovrascrive", () => {
    const m = saved({ posterShape: "landscape", logoText: "The Title", landscape: { logoScale: 120 } });
    const landArt = { ...baseArtwork, posterShape: "landscape" as const };
    expect(isMappingDirty(state({ artwork: landArt, logoText: "The Title" }), m, DEFAULTS, "poster")).toBe(false);
    expect(isMappingDirty(state({ artwork: landArt, logoText: "Other" }), m, DEFAULTS, "poster")).toBe(true);
  });

  it("base portrait: path del crop confrontato solo sul canvas verticale", () => {
    const m = saved({ portraitBackdropPath: "/bd.jpg" });
    expect(isMappingDirty(state({ portraitBackdropPath: "/bd.jpg" }), m, DEFAULTS, "poster")).toBe(false);
    // Nuova scelta dal picker / ritorno al poster → dirty.
    expect(isMappingDirty(state({ portraitBackdropPath: "/other.jpg" }), m, DEFAULTS, "poster")).toBe(true);
    expect(isMappingDirty(state({ portraitBackdropPath: null }), m, DEFAULTS, "poster")).toBe(true);
    // Nessuna base salvata e nessuna scelta → pulito.
    expect(isMappingDirty(state({ portraitBackdropPath: null }), saved(), DEFAULTS, "poster")).toBe(false);
    // Landscape: il save preserva la base portrait verbatim e il canvas 16:9
    // non la usa → mai un edit di quel formato.
    const mLand = saved({ posterShape: "landscape", portraitBackdropPath: "/bd.jpg" });
    const landArt = { ...baseArtwork, posterShape: "landscape" as const };
    expect(isMappingDirty(state({ artwork: landArt, portraitBackdropPath: null }), mLand, DEFAULTS, "poster")).toBe(false);
  });
});

/**
 * Task 4b: legacy mappings written before the quality offsets were frozen have
 * no `qualityBadgeOffsetX/Y`. The editor opens such a title at the shape
 * defaults (-4/+6 portrait, 0/0 landscape), so the dirty baseline must be the
 * same chain — comparing against 0 flagged every legacy title as unsaved.
 */
describe("isMappingDirty — legacy quality offsets follow the shape defaults", () => {
  const portraitArt = { posterPath: "/p.jpg", backdropPath: "/b.jpg", posterShape: "poster" as const, logoPath: null };
  const landscapeArt = { ...portraitArt, posterShape: "landscape" as const };
  const state = (art: FullMappingCheckState["artwork"], offsets: Partial<FullMappingCheckState>): FullMappingCheckState => ({
    artwork: art,
    gradient: { ...DEFAULTS },
    ...offsets,
  });

  it("portrait legacy mapping: live -4/+6 (factory defaults) is clean", () => {
    const legacy = mapping({ posterPath: "/p.jpg", backdropPath: "/b.jpg", logoPath: null });
    expect(isMappingDirty(state(portraitArt, { qualityBadgeOffsetX: -4, qualityBadgeOffsetY: 6 }), legacy, DEFAULTS, "poster")).toBe(false);
    // A real edit (or the retired 0 default) is still dirty.
    expect(isMappingDirty(state(portraitArt, { qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0 }), legacy, DEFAULTS, "poster")).toBe(true);
    expect(isMappingDirty(state(portraitArt, { qualityBadgeOffsetX: -10, qualityBadgeOffsetY: 6 }), legacy, DEFAULTS, "poster")).toBe(true);
  });

  it("landscape legacy profile: 0/0 is clean, portrait defaults are not", () => {
    const legacy = mapping({ posterPath: "/p.jpg", backdropPath: "/b.jpg", logoPath: null, posterShape: "landscape" });
    expect(isMappingDirty(state(landscapeArt, { qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0 }), legacy, DEFAULTS, "poster")).toBe(false);
    expect(isMappingDirty(state(landscapeArt, { qualityBadgeOffsetX: -4, qualityBadgeOffsetY: 6 }), legacy, DEFAULTS, "poster")).toBe(true);
  });

  it("an offset frozen in the mapping still wins over the shape fallback", () => {
    const frozen = mapping({ posterPath: "/p.jpg", backdropPath: "/b.jpg", logoPath: null, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0 });
    expect(isMappingDirty(state(portraitArt, { qualityBadgeOffsetX: -4, qualityBadgeOffsetY: 6 }), frozen, DEFAULTS, "poster")).toBe(true);
    expect(isMappingDirty(state(portraitArt, { qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0 }), frozen, DEFAULTS, "poster")).toBe(false);
  });

  it("the space default (visualDefaults) wins over the factory shape fallback", () => {
    const legacy = mapping({ posterPath: "/p.jpg", backdropPath: "/b.jpg", logoPath: null });
    expect(isMappingDirty(
      state(portraitArt, { qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0 }),
      legacy, DEFAULTS, "poster",
      { qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0 },
    )).toBe(false);
    expect(isMappingDirty(
      state(portraitArt, { qualityBadgeOffsetX: -4, qualityBadgeOffsetY: 6 }),
      legacy, DEFAULTS, "poster",
      { qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0 },
    )).toBe(true);
  });
});
