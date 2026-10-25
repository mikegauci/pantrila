import AsyncStorage from "@react-native-async-storage/async-storage"
import { randomUUID } from "expo-crypto"
import { useEffect, useState } from "react"
import { AppState } from "react-native"

import type { ImportStep } from "@pantrila/core/cookbook"
import type { ImportView } from "@pantrila/core/types"

import { userKey } from "@/lib/auth"
import { ApiError, api, send } from "@/lib/api"

/**
 * Imports run as jobs on the server (as on the web, `web/src/lib/import-jobs.ts`), so closing the
 * app or locking the phone does not lose them: the screen starts one, polls for the result, and
 * picks the same job up again when the app comes back (the id is kept on the phone under
 * `userKey`, so sign-out forgets it).
 */
export type ImportRequest =
  | { kind: "link"; url: string }
  | { kind: "post"; url: string }
  | { kind: "text"; text: string }
  | { kind: "photos"; images: string[] }

export type { ImportStep }

interface JobView {
  id: string
  status: "running" | "done" | "failed"
  steps?: ImportStep[]
  result: ImportView | null
  error: { status: number; message: string } | null
}

const POLL_MS = 2000
const GIVE_UP_MS = 15 * 60 * 1000
const storageKey = (userId: string) => userKey(userId, "import-job")

// Who wants to hear a job's steps as they arrive: the screen that started it, or one that resumed it.
const listeners = new Map<string, Set<(steps: ImportStep[]) => void>>()
// One watcher per job, so the screen that started it and one that resumes it share a result.
const watching = new Map<string, Promise<ImportView>>()
// Jobs a screen in this run of the app started: that screen delivers their result.
const startedHere = new Set<string>()

export const wasStartedHere = (id: string) => startedHere.has(id)

async function saved(userId: string): Promise<{ id: string; at: number } | null> {
  try {
    const value = JSON.parse((await AsyncStorage.getItem(storageKey(userId))) ?? "null")
    return value?.id ? value : null
  } catch {
    return null
  }
}

/** The job this person left running, if it is recent enough to still matter. */
export async function pendingImport(userId: string): Promise<string | null> {
  const job = await saved(userId)
  return job && Date.now() - job.at < GIVE_UP_MS ? job.id : null
}

/** Clears the saved job, but only if it is still this one: a newer import keeps its own id. */
export async function forgetImport(userId: string, id: string) {
  try {
    if ((await saved(userId))?.id === id) await AsyncStorage.removeItem(storageKey(userId))
  } catch {}
}

/** Waits one poll interval, or less when the app comes back to the foreground. */
function pause(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      sub.remove()
      resolve()
    }
    const timer = setTimeout(done, POLL_MS)
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") done() })
  })
}

async function poll(id: string, startedAt: number): Promise<ImportView> {
  for (;;) {
    let job: JobView | null = null
    try {
      job = await api<JobView>(`/me/recipes/import/jobs/${id}`)
    } catch (e) {
      // A dropped connection (phone just woke up) or a gateway hiccup is not a failed import.
      const transient = e instanceof ApiError && (e.status === 0 || e.status >= 502)
      if (!transient) throw e
    }
    if (job?.steps) for (const hear of listeners.get(id) ?? []) hear(job.steps)
    if (job?.status === "done" && job.result) return job.result
    if (job?.status === "failed") throw new ApiError(job.error?.status ?? 500, job.error?.message ?? "The import failed.")
    if (Date.now() - startedAt > GIVE_UP_MS) throw new ApiError(504, "The import is taking too long. Try again.")
    await pause()
  }
}

/** Follow a job to its result; the saved id is cleared once the person has been told.
 * `onSteps` hears the steps it has taken at each poll. */
export function watchImport(userId: string, id: string, startedAt = Date.now(),
                            onSteps?: (steps: ImportStep[]) => void): Promise<ImportView> {
  if (onSteps) listeners.set(id, (listeners.get(id) ?? new Set()).add(onSteps))
  const existing = watching.get(id)
  if (existing) return existing
  const promise = poll(id, startedAt).finally(() => {
    watching.delete(id)
    listeners.delete(id)
    startedHere.delete(id)
    forgetImport(userId, id)
  })
  watching.set(id, promise)
  return promise
}

export async function importRecipe(userId: string, request: ImportRequest,
                                   onSteps?: (steps: ImportStep[]) => void): Promise<ImportView> {
  // The id is chosen and saved before sending: if the app is closed while a large upload is in
  // flight, the server may still have started the job, and the next open can pick it up.
  const id = randomUUID().replaceAll("-", "")
  startedHere.add(id)
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify({ id, at: Date.now() }))
  } catch {}
  try {
    await send<JobView>("/me/recipes/import/jobs", "POST", { id, ...request })
  } catch (e) {
    startedHere.delete(id)
    forgetImport(userId, id)
    throw e
  }
  return watchImport(userId, id, Date.now(), onSteps)
}

/** Whether this person has an import running from an earlier visit (checked on mount and each
 * time the app comes back), for Home to say so. */
export function usePendingImport(userId: string): boolean {
  const [pending, setPending] = useState(false)
  useEffect(() => {
    let live = true
    const check = () => pendingImport(userId).then((id) => { if (live) setPending(!!id && !watching.has(id)) })
    check()
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") check() })
    return () => { live = false; sub.remove() }
  }, [userId])
  return pending
}
