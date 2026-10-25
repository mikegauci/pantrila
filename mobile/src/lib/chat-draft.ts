import type { CookbookRecipeIn } from "@pantrila/core/types"

/**
 * A recipe the assistant wrote, on its way from the chat to the new-recipe form (the web keeps it
 * in sessionStorage). Only the latest is held: the chat opens `recipes/mine/new?from=chat&draft=<id>`
 * right after handing it over.
 */
let held: { id: number; draft: CookbookRecipeIn } | null = null
let next = 1

export function holdChatDraft(draft: CookbookRecipeIn): number {
  held = { id: next++, draft }
  return held.id
}

export const chatDraft = (id: string | undefined): CookbookRecipeIn | null =>
  held && String(held.id) === id ? held.draft : null
