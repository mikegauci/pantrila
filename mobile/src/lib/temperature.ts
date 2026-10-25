import AsyncStorage from "@react-native-async-storage/async-storage"
import { useCallback, useEffect, useSyncExternalStore } from "react"

import type { TempUnit } from "@pantrila/core/temperature"

import { useAuth } from "@/components/auth-provider"
import { userKey } from "@/lib/auth"

/** The °C/°F choice for recipe methods, kept on this phone for the signed-in person (as the web
 * keeps it in the browser); °C until they pick. Every screen showing a method shares it. */
let unit: TempUnit = "C"
let loadedFor: string | null = null
const listeners = new Set<() => void>()

function set(next: TempUnit) {
  unit = next
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTempUnit(): [TempUnit, (unit: TempUnit) => void] {
  const userId = useAuth().session?.user.id ?? null
  const key = userId ? userKey(userId, "temp-unit") : null
  const current = useSyncExternalStore(subscribe, () => unit)

  useEffect(() => {
    if (!key || loadedFor === key) return
    loadedFor = key
    set("C")
    AsyncStorage.getItem(key).then((v) => set(v === "F" ? "F" : "C"), () => {})
  }, [key])

  const choose = useCallback((next: TempUnit) => {
    set(next)
    if (key) AsyncStorage.setItem(key, next).catch(() => {})
  }, [key])
  return [current, choose]
}
