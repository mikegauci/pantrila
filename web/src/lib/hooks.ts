"use client"

import useSWR, { useSWRConfig, type SWRConfiguration } from "swr"

import { api, ApiError } from "@/lib/api"
import type {
  ChatThread, ChatThreadSummary, CookbookCard, CookbookDetail, Food, GroceryList, Me, Meta, PantryItem, Plan, Profile, RecipeDetail,
  Usage,
} from "@/lib/types"

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
export const useUsage = () => useApi<Usage>("/me/usage")
export const useRecipe = (id: string | null) => useApi<RecipeDetail>(id ? `/recipes/${id}` : null)
export const useChats = () => useApi<ChatThreadSummary[]>("/me/chats")
export const useChat = (id: number | null) => useApi<ChatThread>(id ? `/me/chats/${id}` : null)
export const useCookbook = () => useApi<CookbookCard[]>("/me/recipes")
export const useCookbookRecipe = (id: string | null) =>
  useApi<CookbookDetail>(id ? `/me/recipes/${id}` : null)

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

/** Clear derived views as well as refreshing mounted readers after a kitchen change. */
export function useRefreshKitchen() {
  const { mutate } = useSWRConfig()
  return () => mutate(
    (key) => typeof key === "string" && (
      key.startsWith("/recipes") || key.startsWith("/plans") ||
      key.startsWith("/me/recipes") || key.startsWith("/me/chats") ||
      key === "/me/pantry" || key === "/me/profile"
    ),
    undefined,
    { revalidate: true },
  )
}
