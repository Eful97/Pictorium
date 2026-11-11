"use client"
import React, { createContext } from "react"
import type { Mapping } from "@/lib/types"

interface MappingsStore {
  value: Mapping[]
  mapValue: Map<string, Mapping>
  listeners: Set<() => void>
}

const MappingsCtx = createContext<MappingsStore | null>(null)

export function MappingsProvider({ value, mapValue, children }: { value: Mapping[]; mapValue: Map<string, Mapping>; children: React.ReactNode }) {
  const storeRef = React.useRef<MappingsStore | null>(null)
  if (!storeRef.current) storeRef.current = { value, mapValue, listeners: new Set() }
  const store = storeRef.current
  store.value = value
  store.mapValue = mapValue
  React.useEffect(() => { store.listeners.forEach((l) => l()) }, [value, mapValue, store])
  return <MappingsCtx.Provider value={store}>{children}</MappingsCtx.Provider>
}

