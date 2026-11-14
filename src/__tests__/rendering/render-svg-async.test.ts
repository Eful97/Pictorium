/**
 * renderSVG rasterizza sul threadpool libuv (`renderAsync`), non sull'event
 * loop. Il confronto con il render sincrono non vive qui: solo svg-badge.ts può
 * importare resvg (regola depcruise `resvg-single-renderer`); i pixel restano
 * coperti dai test di rendering e visual.
 */
import { describe, expect, it } from "vitest"
import { renderSVG } from "@/lib/svg-badge"

const TEXT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80"><rect width="320" height="80" rx="40" fill="rgba(0,0,0,0.6)"/><text x="160" y="52" font-family="Inter" font-size="34" font-weight="600" fill="#fff" text-anchor="middle">Drama • 7.5 • 2024</text></svg>`

describe("renderSVG", () => {
  it("does not rasterize on the event loop", async () => {
    await renderSVG(TEXT_SVG, 320) // engine loaded, fonts warm
    let macrotaskRan = false
    let renderedBeforeMacrotask = false
    setImmediate(() => { macrotaskRan = true })
    await Promise.all(Array.from({ length: 12 }, () => renderSVG(TEXT_SVG, 1000))).then(() => {
      renderedBeforeMacrotask = !macrotaskRan
    })
    // A synchronous render would finish the whole batch in microtasks, before
    // the pending setImmediate; off-thread rendering lets the loop turn.
    expect(renderedBeforeMacrotask).toBe(false)
  })
})
