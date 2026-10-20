import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FamilyChoiceControl } from "@/components/settings/FamilyChoiceControl";

vi.mock("@/lib/contexts/PosterEditorContext", () => ({
  usePosterEditor: () => ({
    badgePresets: null,
    setFamilyPreset: vi.fn(),
    dropFamilyPreset: vi.fn(),
    posterShape: "poster",
    legacyPresetTarget: null,
    defaultBadgePresets: null,
    setDefaultFamilyPreset: vi.fn(),
    landscape: {},
    setLandscape: vi.fn(),
  }),
}));
vi.mock("@/lib/context", () => ({
  usePSelector: (sel: (v: Record<string, unknown>) => unknown) =>
    sel({ selected: { id: 1, media_type: "movie" }, mappingsMap: new Map(), currentUserId: "123e4567-e89b-12d3-a456-426614174000" }),
}));
vi.mock("@/lib/contexts/TranslationContext", () => ({
  useT: () => ({ t: (k: string) => k, lang: "en" }),
}));
vi.mock("@/lib/presets-client", () => ({
  listMyPresets: vi.fn(async () => ({ presets: [] })),
  getCachedLegacyPresetTarget: vi.fn(() => undefined),
}));

beforeEach(() => { vi.restoreAllMocks(); });

describe("FamilyChoiceControl row carries no leave links", () => {
  it("hasUnsavedEdits is accepted (panel entry owns the guard) and no row Lab link exists", async () => {
    render(<FamilyChoiceControl scope="title" family="genre" hasUnsavedEdits />);
    await screen.findByTestId("family-choice-title-genre-select");
    expect(screen.queryByTestId("family-choice-title-genre-lab")).toBeNull();
    expect(screen.queryByTestId("family-choice-title-genre-community")).toBeNull();
  });
  it("clean render carries no row leave links either", async () => {
    render(<FamilyChoiceControl scope="title" family="genre" />);
    await screen.findByTestId("family-choice-title-genre-select");
    expect(screen.queryByTestId("family-choice-title-genre-lab")).toBeNull();
    expect(screen.queryByTestId("family-choice-title-genre-community")).toBeNull();
  });
});
