import { describe, expect, it } from "vitest"
import { labEditorReducer, type LabEditorState } from "@/components/lab/useBadgeLabEditor"
import { badgeLabDraftKey, readBadgeLabDraft } from "@/lib/badge-lab-draft"

const initial: LabEditorState = {
  design: { shape: "pill", padding: { x: 14, y: 7 }, background: { type: "solid", color: "#000000", opacity: 85 }, text: { template: "{{rating}}", color: "#ffffff", opacity: 100, fontSize: 22, fontWeight: 700, uppercase: false, letterSpacing: 0, align: "center" }, scale: 100 },
  house: { style: "pill", scale: 100, polarity: "auto" }, variant: "custom",
  meta: { name: "", description: "", tagsCsv: "", target: "top", visibility: "private" },
}

describe("badge editor history", () => {
  it("keeps restart undoable immediately after changing a single slider", () => {
    const changed = { ...initial.design, scale: 150 }
    let state = labEditorReducer({ present: initial, past: [], future: [] }, { type: "edit", field: "design", value: changed, time: 1000 })
    state = labEditorReducer(state, { type: "edit", field: "design", value: initial.design, time: 1010, separate: true })
    state = labEditorReducer(state, { type: "undo" })
    expect(state.present.design.scale).toBe(150)
    expect(labEditorReducer(state, { type: "redo" }).present.design.scale).toBe(100)
  })
  it("groups typing, separates controls, and discards redo after a new edit", () => {
    let state = labEditorReducer({ present: initial, past: [], future: [] }, { type: "edit", field: "design", value: { ...initial.design, text: { ...initial.design.text, template: "A" } }, time: 1000 })
    state = labEditorReducer(state, { type: "edit", field: "design", value: { ...state.present.design, text: { ...state.present.design.text, template: "AB" } }, time: 1100 })
    expect(state.past).toHaveLength(1)
    state = labEditorReducer(state, { type: "edit", field: "design", value: { ...state.present.design, shape: "rect" }, time: 1200 })
    state = labEditorReducer(state, { type: "undo" })
    expect(state.present.design.shape).toBe("pill")
    expect(state.present.design.text.template).toBe("AB")
    state = labEditorReducer(state, { type: "redo" })
    expect(state.present.design.shape).toBe("rect")
    state = labEditorReducer(state, { type: "undo" })
    state = labEditorReducer(state, { type: "edit", field: "variant", value: "house", time: 1300 })
    expect(state.future).toHaveLength(0)
    expect(labEditorReducer(state, { type: "undo" }).present.variant).toBe("custom")
  })

  it("bounds history and resets it when opening a different preset", () => {
    let state = labEditorReducer({ present: initial, past: [], future: [] }, { type: "reset", value: initial })
    for (let n = 0; n < 120; n++) state = labEditorReducer(state, { type: "edit", field: "meta", value: { ...initial.meta, name: String(n) }, time: n * 1000 })
    expect(state.past).toHaveLength(100)
    expect(labEditorReducer(state, { type: "reset", value: initial })).toEqual({ present: initial, past: [], future: [] })
  })
})

describe("badge drafts", () => {
  const draft = { version: 1, editor: initial, editingId: null, forkedFrom: null, savedId: null, savedRev: null, baseline: null }
  it("keeps spaces and anonymous work separate", () => {
    expect(new Set([badgeLabDraftKey(null), badgeLabDraftKey("space-a"), badgeLabDraftKey("space-b")]).size).toBe(3)
    expect(readBadgeLabDraft(JSON.stringify(draft))?.editor).toEqual(initial)
  })
  it("preserves unfinished text/color inputs without accepting unsafe structure", () => {
    const editor = { ...initial, design: { ...initial.design, text: { ...initial.design.text, template: "", color: "#ff" } } }
    expect(readBadgeLabDraft(JSON.stringify({ ...draft, editor }))?.editor.design.text).toMatchObject({ template: "", color: "#ff" })
    expect(readBadgeLabDraft(JSON.stringify({ ...draft, password: "secret" }))).toBeNull()
    expect(readBadgeLabDraft(JSON.stringify({ ...draft, editor: { ...initial, design: { ...initial.design, scale: 10000 } } }))).toBeNull()
  })
  it("rejects broken, oversized, or unsupported drafts", () => {
    for (const raw of [null, "{", "x".repeat(20001), JSON.stringify({ ...draft, version: 2 }), JSON.stringify({ ...draft, editingId: "../unsafe" })]) expect(readBadgeLabDraft(raw)).toBeNull()
  })
})
