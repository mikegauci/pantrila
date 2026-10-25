import type { ShareIntent } from "expo-share-intent"
import { useSyncExternalStore } from "react"

import { POST_LINK } from "@pantrila/core/cookbook"

/**
 * What someone shared to Pantrila from another app (Instagram, TikTok, Facebook, a browser, the
 * photo library), held here until the new-recipe screen starts its import. It waits through
 * signing in: a share that arrives signed out is imported once the person is in.
 */
export type Shared =
  | { kind: "link" | "post"; url: string }
  | { kind: "text"; text: string }
  | { kind: "photos"; photos: { uri: string; width: number | null; height: number | null }[] }

export type SharedRecipe = Shared & { id: number }

const MAX_PHOTOS = 4
const MIN_TEXT = 20  // shorter than this is not a recipe ("Look at this!")

/** The import a share asks for, or the reason it cannot be read. */
export function fromShareIntent(intent: ShareIntent): Shared | { error: string } {
  const url = intent.webUrl?.trim()
  if (url) return { kind: POST_LINK.test(url) ? "post" : "link", url }
  const images = (intent.files ?? []).filter((f) => f.mimeType?.startsWith("image/"))
  if (images.length) {
    return { kind: "photos", photos: images.slice(0, MAX_PHOTOS).map((f) => ({ uri: f.path, width: f.width, height: f.height })) }
  }
  if (intent.files?.some((f) => f.mimeType?.startsWith("video/"))) {
    return { error: "Pantrila reads a post from its link. Share the post itself (or copy its link) instead of the video." }
  }
  const text = intent.text?.trim() ?? ""
  if (text.length >= MIN_TEXT) return { kind: "text", text }
  return { error: "That share has no link, photo or recipe text for Pantrila to read." }
}

let current: SharedRecipe | null = null
let next = 1
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

export function holdShare(shared: Shared) {
  current = { ...shared, id: next++ } as SharedRecipe
  changed()
}

/** The new-recipe screen takes the share when it starts its import. */
export function takeShare(id: number) {
  if (current?.id !== id) return
  current = null
  changed()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const useSharedRecipe = () => useSyncExternalStore(subscribe, () => current)
