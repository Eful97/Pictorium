import { describe, expect, test } from "vitest"

// Harness regression (see setup.ts): Node >=25 without --localstorage-file
// exposes a global `localStorage` accessor returning undefined, and
// the Vitest jsdom environment does not forward the real Storage because the key
// is already an own-property of globalThis. These tests fail if the rebinding
// to the real jsdom Storages is missing or replaced by a mock/fake.
describe("test-env web storage", () => {
  test("localStorage is the real jsdom Storage, identical on globalThis and window", () => {
    expect(typeof localStorage).toBe("object")
    expect(localStorage).toBe(window.localStorage)
    expect(localStorage).toBe(
      (globalThis as unknown as { jsdom?: { window: Window } }).jsdom?.window.localStorage,
    )
    expect(localStorage.constructor.name).toBe("Storage")
  })

  test("localStorage has full DOM semantics (get/set/remove/clear/key/length)", () => {
    localStorage.clear()
    expect(localStorage.length).toBe(0)
    expect(localStorage.getItem("missing")).toBeNull()
    localStorage.setItem("k", "v")
    expect(localStorage.length).toBe(1)
    expect(localStorage.key(0)).toBe("k")
    expect(localStorage.getItem("k")).toBe("v")
    localStorage.removeItem("k")
    expect(localStorage.getItem("k")).toBeNull()
    localStorage.setItem("a", "1")
    localStorage.clear()
    expect(localStorage.length).toBe(0)
  })

  test("sessionStorage is the real jsdom Storage, identical on globalThis and window", () => {
    expect(typeof sessionStorage).toBe("object")
    expect(sessionStorage).toBe(window.sessionStorage)
    expect(sessionStorage).toBe(
      (globalThis as unknown as { jsdom?: { window: Window } }).jsdom?.window.sessionStorage,
    )
    expect(sessionStorage.constructor.name).toBe("Storage")
    sessionStorage.clear()
    sessionStorage.setItem("s", "1")
    expect(sessionStorage.getItem("s")).toBe("1")
    sessionStorage.removeItem("s")
    expect(sessionStorage.getItem("s")).toBeNull()
  })
})
