"use client"
import React, { createContext } from "react"
import type { MetaInfo } from "@/lib/context"

interface MetaStore {
  value: MetaInfo
  listeners: Set<() => void>
}

const MetaCtx = createContext<MetaStore | null>(null)

export function MetaInfoProvider({ value, children }: { value: MetaInfo; children: React.ReactNode }) {
  const storeRef = React.useRef<MetaStore | null>(null)
  if (!storeRef.current) storeRef.current = { value, listeners: new Set() }
  const store = storeRef.current
  store.value = value
  React.useEffect(() => { store.listeners.forEach((l) => l()) }, [value, store])
  return <MetaCtx.Provider value={store}>{children}</MetaCtx.Provider>
}

