import { useSyncExternalStore } from "react"

/** How many requests are waiting on a server that has not answered for a while (Render's free
 * instance sleeps when idle). The API client counts them (`onSlow` in `createApi`: after 3 s, and
 * only when nothing has come back in the last 10 minutes) and `WakeNotice` shows while any wait. */
let waiting = 0
const listeners = new Set<() => void>()

function changed(by: number) {
  waiting = Math.max(0, waiting + by)
  listeners.forEach((l) => l())
}

/** A slow request started; the function it returns runs when that request ends. */
export function slowRequest(): () => void {
  changed(1)
  let done = false
  return () => {
    if (!done) changed(-1)
    done = true
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useWaking = () => useSyncExternalStore(subscribe, () => waiting > 0)
