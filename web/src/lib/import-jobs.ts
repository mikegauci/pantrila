import type { ImportView } from "@pantrila/core/types"

import { ApiError, api, send } from "@/lib/api"

/**
 * Imports run as jobs on the server, so a locked phone or a tab in the background does not
 * lose them: the page starts one, polls for the result, and can pick the same job up again
 * after a reload (the id is kept in localStorage).
 */
export type ImportRequest =
  | { kind: "link"; url: string }
  | { kind: "post"; url: string }
  | { kind: "text"; text: string }
  | { kind: "photos"; images: string[] }

/** A step the import took ("Reading the caption"); the last one is under way. */
export interface ImportStep {
  key: string
  label: string
}

interface JobView {
  id: string
  status: "running" | "done" | "failed"
  steps?: ImportStep[]
  result: ImportView | null
  error: { status: number; message: string } | null
}

// Who wants to hear a job's steps as they arrive: the form that started it, or a resumed page.
const listeners = new Map<string, Set<(steps: ImportStep[]) => void>>()

function listen(id: string, onSteps?: (steps: ImportStep[]) => void) {
  if (!onSteps) return
  const set = listeners.get(id) ?? new Set()
  set.add(onSteps)
  listeners.set(id, set)
}

const POLL_MS = 2000
const GIVE_UP_MS = 15 * 60 * 1000
const storageKey = (userId: string) => `pantrila-import-job:${userId}`

// One watcher per job, so the form that started it and a page that resumes it share a result.
const watching = new Map<string, Promise<ImportView>>()

// Jobs a form on this page started: that form delivers their result, so the page need not resume them.
const startedHere = new Set<string>()

export const wasStartedHere = (id: string) => startedHere.has(id)

function remember(userId: string, id: string) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify({ id, at: Date.now() }))
  } catch {}
}

function saved(userId: string): { id: string; at: number } | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "null")
    return value?.id ? value : null
  } catch {
    return null
  }
}

/** The job this person left running, if it is recent enough to still matter. */
export function pendingImport(userId: string): string | null {
  const job = saved(userId)
  return job && Date.now() - job.at < GIVE_UP_MS ? job.id : null
}

/** Clears the saved job, but only if it is still this one: a newer import keeps its own id. */
export function forgetImport(userId: string, id: string) {
  try {
    if (saved(userId)?.id === id) localStorage.removeItem(storageKey(userId))
  } catch {}
}

/** Waits one poll interval, or less when the page comes back to the foreground. */
function pause(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisible)
      resolve()
    }
    const onVisible = () => { if (document.visibilityState === "visible") done() }
    const timer = setTimeout(done, POLL_MS)
    document.addEventListener("visibilitychange", onVisible)
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
  listen(id, onSteps)
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
  // The id is chosen and saved before sending: if the page dies while a large upload is in
  // flight, the server may still have started the job, and a reload can pick it up.
  const id = crypto.randomUUID().replaceAll("-", "")
  remember(userId, id)
  startedHere.add(id)
  try {
    await send<JobView>("/me/recipes/import/jobs", "POST", { id, ...request })
  } catch (e) {
    startedHere.delete(id)
    forgetImport(userId, id)
    throw e
  }
  return watchImport(userId, id, Date.now(), onSteps)
}
