import { useSyncExternalStore } from "react"

/** One short message at a time at the bottom of the screen (the web's Sonner toasts). */
export interface Toast {
  id: number
  text: string
  tone: "success" | "error"
}

let current: Toast | null = null
let next = 1
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function show(text: string, tone: Toast["tone"]) {
  current = { id: next++, text, tone }
  listeners.forEach((l) => l())
  clearTimeout(timer)
  timer = setTimeout(() => {
    current = null
    listeners.forEach((l) => l())
  }, tone === "error" ? 5000 : 3000)
}

export const toast = {
  success: (text: string) => show(text, "success"),
  error: (text: string) => show(text, "error"),
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useToast = () => useSyncExternalStore(subscribe, () => current)
