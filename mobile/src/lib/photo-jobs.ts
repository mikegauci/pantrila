import { useSyncExternalStore } from "react"
import type { ScopedMutator } from "swr"

import type { CookbookDetail, CookbookRecipeIn } from "@pantrila/core/types"

import { ApiError, send } from "@/lib/api"
import { toast } from "@/lib/toast"

/**
 * Recipe photos being made (the web's `photo-jobs.ts`). The request runs here, outside any
 * screen, so saving a new recipe can open it at once while its photo is made. If the app is
 * closed meanwhile, the server still finishes the photo; pulling the recipe down shows it.
 */
const running = new Set<number>()
const listeners = new Set<() => void>()

function mark(id: number, on: boolean) {
  if (on) running.add(id)
  else running.delete(id)
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Make the recipe's photo; resolves with the recipe carrying it. One request per recipe at a time. */
export function makePhoto(id: number): Promise<CookbookDetail> {
  mark(id, true)
  return send<CookbookDetail>(`/me/recipes/${id}/photo`, "POST").finally(() => mark(id, false))
}

/** Whether this recipe's photo is being made. */
export const usePhotoPending = (id: number) => useSyncExternalStore(subscribe, () => running.has(id))

/** Saves a new recipe; its photo is then made while the person reads it (its page shows it
 * arriving), unless `photo` is false (no AI photos left, as on Free). */
export async function saveNewRecipe(recipe: CookbookRecipeIn, mutate: ScopedMutator, photo = true): Promise<CookbookDetail> {
  const saved = await send<CookbookDetail>("/me/recipes", "POST", recipe)
  mutate("/me/recipes")
  if (!photo) return saved
  makePhoto(saved.id)
    .then((made) => mutate(`/me/recipes/${saved.id}`, made, { revalidate: false }))
    .catch((e) => {
      if (e instanceof ApiError && e.pro) return  // a Free cap: the recipe keeps its meal-type art
      toast.error(`Recipe saved. Its photo could not be generated. ${e instanceof Error ? e.message : ""}`.trim())
    })
    .finally(() => {
      mutate("/me/recipes")
      mutate("/me")
      mutate("/me/usage")
    })
  return saved
}
