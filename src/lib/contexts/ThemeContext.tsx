"use client"

import React, { createContext, useContext, useEffect, useState, useTransition, useCallback } from "react"

export type ThemeSetting = "system" | "light" | "dark"
export type ResolvedTheme = "light" | "dark"

interface ThemeContextValue {
  theme: ThemeSetting
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemeSetting) => void
}

const STORAGE_KEY = "pictorium_ui_theme"

const ThemeContext = createContext<ThemeContextValue | null>(null)

function parseTheme(value: string | null): ThemeSetting {
  return value === "light" || value === "dark" ? value : "system"
}

function readTheme(): ThemeSetting {
  try { return parseTheme(localStorage.getItem(STORAGE_KEY)) } catch { return "system" }
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function applyThemeToDOM(resolved: ResolvedTheme, setting: ThemeSetting) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.setAttribute("data-theme", resolved)
  root.setAttribute("data-theme-setting", setting)
  if (resolved === "dark") {
    root.classList.add("dark")
    root.classList.remove("light")
  } else {
    root.classList.add("light")
    root.classList.remove("dark")
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [, startTransition] = useTransition()
  const [theme, setThemeState] = useState<ThemeSetting>("system")
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark")

  const setTheme = useCallback((newTheme: ThemeSetting) => {
    try {
      localStorage.setItem(STORAGE_KEY, newTheme)
    } catch {}
    const resolved = newTheme === "system" ? getSystemTheme() : newTheme
    applyThemeToDOM(resolved, newTheme)
    startTransition(() => {
      setThemeState(newTheme)
      setResolvedTheme(resolved)
    })
  }, [])

  // Ascolta cambi preferenze OS e sincronizzazione multi-tab
  useEffect(() => {
    if (typeof window === "undefined") return

    let media: MediaQueryList | null = null
    let handleMediaChange: ((e: MediaQueryListEvent) => void) | null = null

    if (typeof window.matchMedia === "function") {
      media = window.matchMedia("(prefers-color-scheme: dark)")
      handleMediaChange = (e: MediaQueryListEvent) => {
        const stored = document.documentElement.getAttribute("data-theme-setting")
        if (stored === "system") {
          const nextResolved = e.matches ? "dark" : "light"
          applyThemeToDOM(nextResolved, "system")
          setResolvedTheme(nextResolved)
        }
      }
      media.addEventListener("change", handleMediaChange)
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) {
        const nextSetting = parseTheme(e.newValue)
        const nextResolved = nextSetting === "system" ? getSystemTheme() : nextSetting
        applyThemeToDOM(nextResolved, nextSetting)
        setThemeState(nextSetting)
        setResolvedTheme(nextResolved)
      }
    }

    window.addEventListener("storage", handleStorageChange)

    // Allineamento iniziale sicuro al mount
    const currentStored = readTheme()
    const targetResolved = currentStored === "system" ? getSystemTheme() : currentStored
    applyThemeToDOM(targetResolved, currentStored)
    setThemeState(currentStored)
    setResolvedTheme(targetResolved)

    return () => {
      if (media && handleMediaChange) {
        media.removeEventListener("change", handleMediaChange)
      }
      window.removeEventListener("storage", handleStorageChange)
    }
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    // Fallback sicuro se chiamato fuori da ThemeProvider (es. test isolati)
    return {
      theme: "system",
      resolvedTheme: "dark",
      setTheme: () => {},
    }
  }
  return ctx
}
