"use client"

import { useEffect, useSyncExternalStore } from "react"

import { send } from "@/lib/api"
import type { CookbookDetail } from "@/lib/types"

/**
 * Recipe photos being made. The request runs here, outside any page, so saving a new recipe
 * can open it at once while its photo is made. Ids also go to sessionStorage with their start
 * time: after a reload the server still finishes the photo, so the recipe page keeps showing
 * the slot as "being made" and polls the recipe until the photo lands (or LIMIT_MS passes).
 */
const KEY = "pantrila-photo-jobs"
const EVENT = "pantrila-photo-jobs"
const LIMIT_MS = 90_000
const POLL_MS = 3_000
const running = new Set<number>()

function stored(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, number>
  } catch {
    return {}
  }
}

function mark(id: number, on: boolean) {
  const jobs = stored()
  if (on) jobs[id] = Date.now()
  else delete jobs[id]
  try {
    sessionStorage.setItem(KEY, JSON.stringify(jobs))
  } catch {}
  if (on) running.add(id)
  else running.delete(id)
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  return () => window.removeEventListener(EVENT, onChange)
}

const isPending = (id: number) => running.has(id) || Date.now() - (stored()[id] ?? 0) < LIMIT_MS

/** Make the recipe's photo; resolves with the recipe carrying it. One request per recipe at a time. */
export function makePhoto(id: number): Promise<CookbookDetail> {
  mark(id, true)
  return send<CookbookDetail>(`/me/recipes/${id}/photo`, "POST").finally(() => mark(id, false))
}

/**
 * Whether this recipe's photo is being made. After a reload (no request on this page) it calls
 * `refresh` every few seconds and stops once the recipe has a photo or the wait runs out.
 */
export function usePhotoPending(id: number, hasPhoto: boolean, refresh: () => void): boolean {
  const pending = useSyncExternalStore(subscribe, () => isPending(id), () => false)
  const polling = pending && !running.has(id)
  useEffect(() => {
    if (!polling) return
    if (hasPhoto) {
      mark(id, false)
      return
    }
    const timer = window.setInterval(() => {
      if (isPending(id)) refresh()
      else mark(id, false)
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [id, polling, hasPhoto, refresh])
  return pending
}
