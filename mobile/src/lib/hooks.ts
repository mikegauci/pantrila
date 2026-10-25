import useSWR, { type SWRConfiguration } from "swr"
import useSWRInfinite from "swr/infinite"

import type {
  ChatThreadSummary, CookbookCard, Meta, Profile, RecipeDetail, RecipeList,
} from "@pantrila/core/types"

import { api, type ApiError } from "@/lib/api"

const fetcher = <T,>(path: string) => api<T>(path)

export function useApi<T>(path: string | null, config?: SWRConfiguration<T, ApiError>) {
  return useSWR<T, ApiError>(path, fetcher, config)
}

const STATIC = { revalidateOnFocus: false, revalidateIfStale: false, dedupingInterval: 3_600_000 }

export const useMeta = () => useApi<Meta>("/meta", STATIC)
export const useProfile = () => useApi<Profile>("/me/profile")
export const useRecipe = (id: string | null) => useApi<RecipeDetail>(id ? `/recipes/${id}` : null)
export const useChats = () => useApi<ChatThreadSummary[]>("/me/chats")
export const useCookbook = () => useApi<CookbookCard[]>("/me/recipes")

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
