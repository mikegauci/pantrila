import useSWR, { useSWRConfig, type SWRConfiguration } from "swr"
import useSWRInfinite from "swr/infinite"

import type {
  ChatThread, ChatThreadSummary, CookbookCard, CookbookDetail, Food, GroceryList, Me, Meta, PantryItem, Plan, Profile, RecipeDetail, RecipeList,
} from "@pantrila/core/types"

import { api, ApiError } from "@/lib/api"

const fetcher = <T,>(path: string) => api<T>(path)

export function useApi<T>(path: string | null, config?: SWRConfiguration<T, ApiError>) {
  return useSWR<T, ApiError>(path, fetcher, config)
}

const STATIC = { revalidateOnFocus: false, revalidateIfStale: false, dedupingInterval: 3_600_000 }

export const useMe = () => useApi<Me>("/me")
export const useMeta = () => useApi<Meta>("/meta", STATIC)
export const useFoods = () => useApi<Food[]>("/foods", STATIC)
export const useProfile = () => useApi<Profile>("/me/profile")
export const usePantry = () => useApi<PantryItem[]>("/me/pantry")
export const useRecipe = (id: string | null) => useApi<RecipeDetail>(id ? `/recipes/${id}` : null)
export const useChats = () => useApi<ChatThreadSummary[]>("/me/chats")
export const useChat = (id: number | null) => useApi<ChatThread>(id ? `/me/chats/${id}` : null)
export const useCookbook = () => useApi<CookbookCard[]>("/me/recipes")
export const useCookbookRecipe = (id: string | null) => useApi<CookbookDetail>(id ? `/me/recipes/${id}` : null)

/** Refresh what a kitchen change touches (pantry, recipes' pantry marks, plans, the grocery list). */
export function useRefreshKitchen() {
  const { mutate } = useSWRConfig()
  return () => mutate(
    (key) => typeof key === "string" && (
      key.startsWith("/recipes") || key.startsWith("/plans") || key.startsWith("/me/recipes") ||
      key === "/me/pantry" || key === "/me/cooked"
    ),
  )
}

/** The latest plan; a 404 (no plan yet) comes back as null, not an error. */
export function usePlan() {
  return useSWR<Plan | null, ApiError>("/plans/latest", async (p: string) => {
    try {
      return await api<Plan>(p)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  })
}

export function useGrocery(people: number, enabled = true) {
  return useApi<GroceryList>(enabled ? `/plans/latest/grocery?people=${people}` : null)
}

/** Store a changed plan and refresh what depends on it (grocery list, swap options). */
export function useSavePlan() {
  const { mutate } = useSWRConfig()
  return (plan: Plan) => {
    mutate("/plans/latest", plan, { revalidate: false })
    mutate((key) => typeof key === "string" && (
      key.startsWith("/plans/latest/grocery") || key.startsWith("/plans/latest/meals")
    ))
  }
}

export const PAGE = 24

/** Recipes page by page (`offset`), for a list that loads more as it scrolls. A search is one
 * page: its best matches come first and each further page would count as another search. */
export function useRecipePages(params: URLSearchParams) {
  const searching = Boolean(params.get("q"))
  const pages = useSWRInfinite<RecipeList, ApiError>(
    (index, previous: RecipeList | null) => {
      if (previous && (searching || previous.recipes.length < PAGE)) return null
      const page = new URLSearchParams(params)
      page.set("limit", String(searching ? 36 : PAGE))
      page.set("offset", String(index * PAGE))
      return `/recipes?${page}`
    },
    fetcher,
    { revalidateFirstPage: false },
  )
  const last = pages.data?.at(-1)
  const more = !!last && !searching && last.recipes.length >= PAGE
  return { ...pages, more, recipes: pages.data?.flatMap((p) => p.recipes) ?? [], rules: pages.data?.[0]?.rules }
}
