"use client"

import { useCallback, useSyncExternalStore } from "react"

import type { TempUnit } from "@pantrila/core/temperature"

// --- The person's choice, kept in this browser ---------------------------------------------

const KEY = "pantrila-temp-unit"
const EVENT = "pantrila-temp-unit"

function read(): TempUnit {
  try {
    return localStorage.getItem(KEY) === "F" ? "F" : "C"
  } catch {
    return "C"
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(EVENT, onChange)
  }
}

export function useTempUnit(): [TempUnit, (unit: TempUnit) => void] {
  const unit = useSyncExternalStore(subscribe, read, () => "C" as TempUnit)
  const set = useCallback((next: TempUnit) => {
    try {
      localStorage.setItem(KEY, next)
    } catch {}
    window.dispatchEvent(new Event(EVENT))
  }, [])
  return [unit, set]
}
