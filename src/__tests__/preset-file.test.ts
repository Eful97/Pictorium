import { describe, expect, it } from "vitest";
import {
  BETTER_POSTER_VISUAL_DEFAULTS,
  RPDB_VISUAL_DEFAULTS,
} from "@/lib/default-visual-presets";
import {
  MAX_CUSTOM_GRADIENT_PRESETS,
  NATURAL_GRADIENT_DEFAULTS,
} from "@/lib/gradient-presets";
import { MAX_VISUAL_PRESETS } from "@/lib/visual-presets";
import {
  MAX_PRESET_FILE_BYTES,
  MAX_PRESET_FILE_GRADIENT,
  MAX_PRESET_FILE_VISUAL,
  buildPresetFile,
  parsePresetFileData,
  parsePresetFileText,
  planGradientImport,
  planVisualImport,
  presetFileTextSizeBytes,
} from "@/lib/preset-file";

const GRADIENT = { ...NATURAL_GRADIENT_DEFAULTS };
const VISUAL = BETTER_POSTER_VISUAL_DEFAULTS;

function fileText(body: unknown): string {
  return JSON.stringify(body);
}

describe("preset-file codec (visual + gradient, kind pictorium-presets v1)", () => {
  it("keeps section caps coherent with the stores", () => {
    expect(MAX_PRESET_FILE_VISUAL).toBe(MAX_VISUAL_PRESETS);
    expect(MAX_PRESET_FILE_VISUAL).toBe(20);
    expect(MAX_PRESET_FILE_GRADIENT).toBe(MAX_CUSTOM_GRADIENT_PRESETS);
    expect(MAX_PRESET_FILE_GRADIENT).toBe(3);
    expect(MAX_PRESET_FILE_BYTES).toBe(256 * 1024);
  });

  it("round-trips export-all through JSON text", () => {
    const file = buildPresetFile({
      visual: [
        { name: "Look A", values: VISUAL },
        { name: "Look B", values: RPDB_VISUAL_DEFAULTS },
      ],
      gradient: [{ name: "Mine", values: GRADIENT }],
    });
    expect(file.kind).toBe("pictorium-presets");
    expect(file.formatVersion).toBe(1);
    expect(typeof file.exportedAt).toBe("string");
    const parsed = parsePresetFileText(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.visual.map((v) => v.name)).toEqual(["Look A", "Look B"]);
    expect(parsed.visual[0]?.values).toEqual(VISUAL);
    expect(parsed.gradient).toEqual([{ name: "Mine", values: GRADIENT }]);
    expect(parsed.skipped).toEqual({ visual: 0, visualOverCap: 0, gradient: 0, gradientOverCap: 0 });
  });

  it("accepts missing/empty sections without false success signals", () => {
    const bare = parsePresetFileData({ kind: "pictorium-presets", formatVersion: 1 });
    expect(bare).toMatchObject({ ok: true, visual: [], gradient: [] });
    const empty = parsePresetFileText(fileText({ kind: "pictorium-presets", formatVersion: 1, visualPresets: [], gradientPresets: [] }));
    expect(empty.ok).toBe(true);
  });

  it("rejects shape/kind/version/cap with distinct errors", () => {
    expect(parsePresetFileText("not json{")).toEqual({ ok: false, error: "invalid-json" });
    expect(parsePresetFileData(null)).toEqual({ ok: false, error: "invalid-shape" });
    expect(parsePresetFileData([])).toEqual({ ok: false, error: "invalid-shape" });
    expect(parsePresetFileData({ kind: "pictorium-backup", formatVersion: 1 })).toEqual({ ok: false, error: "unsupported-kind" });
    expect(parsePresetFileData({ formatVersion: 1 })).toEqual({ ok: false, error: "unsupported-kind" });
    expect(parsePresetFileData({ kind: "pictorium-presets", formatVersion: 2 })).toEqual({ ok: false, error: "unsupported-version" });
    expect(
      parsePresetFileData({ kind: "pictorium-presets", formatVersion: 1, visualPresets: "junk" }),
    ).toEqual({ ok: false, error: "invalid-shape" });
    expect(parsePresetFileText("a".repeat(MAX_PRESET_FILE_BYTES + 1))).toEqual({ ok: false, error: "file-too-large" });
    expect(presetFileTextSizeBytes("abc")).toBe(3);
  });

  it("ignores unknown top-level keys and never echoes them (no leak surface)", () => {
    const parsed = parsePresetFileData({
      kind: "pictorium-presets",
      formatVersion: 1,
      appVersion: "9.9.9",
      mappings: [{ tmdbId: 1 }],
      defaults: { tmdbKey: "TOP-SECRET", adminToken: "TOP-SECRET" },
      local: { personalKeys: { tmdb: "TOP-SECRET" } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.visual).toEqual([]);
    expect(parsed.gradient).toEqual([]);
    expect(JSON.stringify(parsed)).not.toContain("TOP-SECRET");
    expect(Object.keys(parsed).sort()).toEqual(["gradient", "ok", "skipped", "visual"]);
  });

  it("ignores entry-level extras (id/owner/revision) but rejects values-level secrets", () => {
    const parsed = parsePresetFileData({
      kind: "pictorium-presets",
      formatVersion: 1,
      visualPresets: [
        {
          id: "device-local-id",
          ownerUuid: "123e4567-e89b-12d3-a456-426614174000",
          revision: "deadbeef",
          name: "  Spaced  ",
          values: { ...VISUAL, tmdbKey: "V-SECRET", adminToken: "V-SECRET", pin: "123456" },
        },
      ],
      gradientPresets: [
        { id: "local-1", name: "G", values: { ...GRADIENT, token: "G-SECRET" } },
      ],
    });
    // Secrets live INSIDE values -> strict values schema rejects the entries.
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.visual).toEqual([]);
    expect(parsed.gradient).toEqual([]);
    expect(parsed.skipped.visual).toBe(1);
    expect(parsed.skipped.gradient).toBe(1);
    expect(JSON.stringify(parsed)).not.toContain("SECRET");
  });

  it("accepts entries with harmless entry-level extras when values are clean", () => {
    const parsed = parsePresetFileData({
      kind: "pictorium-presets",
      formatVersion: 1,
      visualPresets: [{ id: "x", name: "Keep", values: VISUAL }],
      gradientPresets: [{ id: "y", name: "KeepG", values: GRADIENT }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.visual).toEqual([{ name: "Keep", shape: "portrait", values: VISUAL }]);
    expect(parsed.gradient).toEqual([{ name: "KeepG", values: GRADIENT }]);
    expect(JSON.stringify(parsed)).not.toContain('"id"');
  });

  it("export strips stray secrets via allowlist instead of dropping the preset", () => {
    const file = buildPresetFile({
      visual: [{ name: "WithJunk", values: { ...VISUAL, tmdbKey: "V-SECRET", pin: "1234" } }],
      gradient: [{ name: "WithJunkG", values: { ...GRADIENT, token: "G-SECRET", extra: 1 } }],
    });
    expect(file.visualPresets).toHaveLength(1);
    expect(file.gradientPresets).toHaveLength(1);
    expect(JSON.stringify(file)).not.toContain("SECRET");
    expect(Object.keys(file.visualPresets[0]!).sort()).toEqual(["name", "shape", "values"]);
    expect(Object.keys(file.gradientPresets[0]!.values).sort()).toEqual(
      ["blurDarkness", "blurEnabled", "blurFade", "blurIntensity", "gradientHeight", "tintStrength"],
    );
    expect(Object.keys(file.visualPresets[0]!.values)).not.toContain("tmdbKey");
  });

  it("round-trips legacy visual presets via schema defaults (no migration)", () => {
    const legacyValues: Record<string, unknown> = { ...VISUAL };
    for (const k of ["defaultBadgeFont", "defaultSeparateBadgeScale", "defaultSeparateBadgeOffsetX", "defaultSeparateBadgeOffsetY", "defaultSeparateRatingsStyle"]) delete legacyValues[k];
    expect("defaultBadgeFont" in legacyValues).toBe(false);
    const parsed = parsePresetFileText(fileText({
      kind: "pictorium-presets",
      formatVersion: 1,
      visualPresets: [{ name: "Legacy", values: legacyValues }],
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.visual).toHaveLength(1);
    expect(parsed.visual[0]?.values.defaultBadgeFont).toBe("inter");
    expect(parsed.visual[0]?.values.defaultSeparateBadgeScale).toBe(130);
    expect(parsed.visual[0]?.values.defaultSeparateBadgeOffsetX).toBe(0);
    expect(parsed.visual[0]?.values.defaultSeparateBadgeOffsetY).toBe(0);
    expect(parsed.visual[0]?.values.defaultSeparateRatingsStyle).toBe("column");
  });

  it("skips invalid entries with counts and never persists them", () => {
    const parsed = parsePresetFileData({
      kind: "pictorium-presets",
      formatVersion: 1,
      visualPresets: [
        null,
        "junk",
        42,
        { name: "   ", values: VISUAL },
        { name: "NoValues" },
        { name: "BadValues", values: { ...VISUAL, defaultBadgeStyle: "nope" } },
        { name: "OverLong".padEnd(41, "x"), values: VISUAL },
        { name: "Good", values: VISUAL },
      ],
      gradientPresets: [
        null,
        { name: "", values: GRADIENT },
        { name: "Bad", values: { ...GRADIENT, blurIntensity: 101 } },
        { name: "OverLong".padEnd(25, "x"), values: GRADIENT },
        { name: "GoodG", values: GRADIENT },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.visual.map((v) => v.name)).toEqual(["Good"]);
    expect(parsed.gradient.map((g) => g.name)).toEqual(["GoodG"]);
    expect(parsed.skipped.visual).toBe(7);
    expect(parsed.skipped.gradient).toBe(4);
  });

  it("caps section arrays at store quota with over-cap counts (first-wins)", () => {
    const manyVisual = Array.from({ length: 22 }, (_, i) => ({ name: `V${i}`, values: VISUAL }));
    const manyGradient = Array.from({ length: 5 }, (_, i) => ({ name: `G${i}`, values: GRADIENT }));
    const parsed = parsePresetFileData({ kind: "pictorium-presets", formatVersion: 1, visualPresets: manyVisual, gradientPresets: manyGradient });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.visual).toHaveLength(20);
    expect(parsed.visual.map((v) => v.name)).toEqual(Array.from({ length: 20 }, (_, i) => `V${i}`));
    expect(parsed.skipped.visualOverCap).toBe(2);
    expect(parsed.gradient.map((g) => g.name)).toEqual(["G0", "G1", "G2"]);
    expect(parsed.skipped.gradientOverCap).toBe(2);
  });

  it("visual planner skips case-insensitive collisions and quota overflow (no silent overwrite)", () => {
    const incoming = [
      { name: "Look", values: VISUAL },
      { name: "  LOOK  ", values: RPDB_VISUAL_DEFAULTS },
      { name: "Fresh", values: VISUAL },
    ];
    const plan = planVisualImport({ portrait: [{ name: "look" }], landscape: [] }, incoming);
    expect(plan.toAdd.map((v) => v.name)).toEqual(["Fresh"]);
    expect(plan.skippedDuplicate).toBe(2);
    expect(plan.skippedQuota).toBe(0);

    const existing19 = Array.from({ length: 19 }, (_, i) => `E${i}`);
    const quotaPlan = planVisualImport({ portrait: existing19, landscape: [] }, [
      { name: "N1", values: VISUAL },
      { name: "N2", values: VISUAL },
      { name: "N1", values: VISUAL },
    ]);
    expect(quotaPlan.toAdd.map((v) => v.name)).toEqual(["N1"]);
    expect(quotaPlan.skippedQuota).toBe(1);
    expect(quotaPlan.skippedDuplicate).toBe(1);
  });

  it("visual planner counts existing rows (not deduped names) against quota", () => {
    // Due righe quasi-duplicate occupano due slot: con 19 righe di cui due
    // "dup"/"DUP" resta un solo slot libero (non due).
    const existing = [...Array.from({ length: 17 }, (_, i) => `E${i}`), "dup", "DUP"];
    expect(existing).toHaveLength(19);
    const plan = planVisualImport({ portrait: existing, landscape: [] }, [
      { name: "N1", values: VISUAL },
      { name: "N2", values: VISUAL },
    ]);
    expect(plan.toAdd.map((v) => v.name)).toEqual(["N1"]);
    expect(plan.skippedQuota).toBe(1);
  });

  it("gradient merge planner preserves order, skips dupes case-insensitively, quotas at 3", () => {
    const plan = planGradientImport(
      [{ name: "A", id: "1", values: GRADIENT }, { name: "B", id: "2", values: GRADIENT }],
      [
        { name: " a ", values: GRADIENT },
        { name: "C", values: GRADIENT },
        { name: "D", values: GRADIENT },
      ],
    );
    expect(plan.toAdd.map((g) => g.name)).toEqual(["C"]);
    expect(plan.skippedDuplicate).toBe(1);
    expect(plan.skippedQuota).toBe(1);
  });

  it("keeps in-file duplicate names for the planner (parse preserves order, no silent drop)", () => {
    const parsed = parsePresetFileData({
      kind: "pictorium-presets",
      formatVersion: 1,
      visualPresets: [
        { name: "Same", values: VISUAL },
        { name: "Same", values: RPDB_VISUAL_DEFAULTS },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.visual).toHaveLength(2);
    const plan = planVisualImport({ portrait: [], landscape: [] }, parsed.visual);
    expect(plan.toAdd).toHaveLength(1);
    expect(plan.toAdd[0]?.values).toEqual(VISUAL);
    expect(plan.skippedDuplicate).toBe(1);
  });

  it("resolves visual entry shapes: legacy absent is portrait, explicit landscape kept, garbage skipped", () => {
    const parsed = parsePresetFileData({
      kind: "pictorium-presets",
      formatVersion: 1,
      visualPresets: [
        { name: "Legacy", values: VISUAL },
        { name: "Wide", shape: "landscape", values: VISUAL },
        { name: "Flat", shape: "portrait", values: VISUAL },
        { name: "Bogus", shape: "diagonal", values: VISUAL },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.visual.map((v) => [v.name, v.shape])).toEqual([
      ["Legacy", "portrait"],
      ["Wide", "landscape"],
      ["Flat", "portrait"],
    ]);
    expect(parsed.skipped.visual).toBe(1);
  });

  it("caps and namespaces visual entries per orientation list", () => {
    const portrait20 = Array.from({ length: 20 }, (_, i) => ({ name: `P${i}`, values: VISUAL }));
    const landscape20 = Array.from({ length: 20 }, (_, i) => ({ name: `L${i}`, shape: "landscape", values: VISUAL }));
    const parsed = parsePresetFileData({
      kind: "pictorium-presets",
      formatVersion: 1,
      visualPresets: [...portrait20, ...landscape20, { name: "Overflow", values: VISUAL }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // 20 portrait + 20 landscape kept (per-shape quota), only the 21st portrait over cap.
    expect(parsed.visual).toHaveLength(40);
    expect(parsed.skipped.visualOverCap).toBe(1);
    // Same name allowed across shapes, collisions only within a shape.
    const plan = planVisualImport(
      { portrait: [{ name: "Twin" }], landscape: [] },
      [
        { name: "Twin", shape: "portrait", values: VISUAL },
        { name: "Twin", shape: "landscape", values: VISUAL },
      ],
    );
    expect(plan.toAdd.map((v) => v.shape)).toEqual(["landscape"]);
    expect(plan.skippedDuplicate).toBe(1);
  });

  it("build writes explicit shapes and round-trips them", () => {
    const file = buildPresetFile({
      visual: [
        { name: "Look A", values: VISUAL },
        { name: "Look B", shape: "landscape", values: VISUAL },
        { name: "Look C", shape: "sideways", values: VISUAL },
      ],
    });
    expect(file.visualPresets.map((v) => [v.name, v.shape])).toEqual([
      ["Look A", "portrait"],
      ["Look B", "landscape"],
      ["Look C", "portrait"],
    ]);
    const parsed = parsePresetFileText(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.visual.map((v) => [v.name, v.shape])).toEqual([
      ["Look A", "portrait"],
      ["Look B", "landscape"],
      ["Look C", "portrait"],
    ]);
  });
});
