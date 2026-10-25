import { renderRouter } from "expo-router/testing-library"
import { SWRConfig } from "swr"

import TabsLayout from "@/app/(tabs)/_layout"
import Assistant from "@/app/(tabs)/assistant"
import Grocery from "@/app/(tabs)/grocery"
import Home from "@/app/(tabs)/index"
import Plan from "@/app/(tabs)/plan"
import Recipes from "@/app/(tabs)/recipes"
import Account from "@/app/account"
import Cook from "@/app/recipes/[id]/cook"
import RecipePage from "@/app/recipes/[id]/index"
import CookMine from "@/app/recipes/mine/[id]/cook"
import MyRecipe from "@/app/recipes/mine/[id]/index"
import MyRecipes from "@/app/recipes/mine/index"
import NewRecipe from "@/app/recipes/mine/new"

/** The signed-in app's routes (no fonts, splash or sign-in guard) at `url`, each test with a fresh
 * SWR cache. */
export function showApp(url: string) {
  return renderRouter(
    {
      "(tabs)/_layout": TabsLayout,
      "(tabs)/index": Home,
      "(tabs)/assistant": Assistant,
      "(tabs)/recipes": Recipes,
      "(tabs)/plan": Plan,
      "(tabs)/grocery": Grocery,
      "recipes/[id]/index": RecipePage,
      "recipes/[id]/cook": Cook,
      "recipes/mine/index": MyRecipes,
      "recipes/mine/[id]/index": MyRecipe,
      "recipes/mine/[id]/cook": CookMine,
      "recipes/mine/new": NewRecipe,
      account: Account,
    },
    {
      initialUrl: url,
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}>
          {children}
        </SWRConfig>
      ),
    } as Parameters<typeof renderRouter>[1],
  )
}

/** A fake API: each request's path is looked up in `routes` (exact path first, then the path
 * without its query); a function gets the full path. Unknown paths are a 404. */
export function fakeApi(routes: Record<string, unknown | ((path: string) => unknown)>) {
  const { ApiError } = jest.requireActual("@pantrila/core/api")
  return jest.fn(async (path: string) => {
    const found = path in routes ? routes[path] : routes[path.split("?")[0]]
    if (found === undefined) throw new ApiError(404, `Not found: ${path}`)
    const value = typeof found === "function" ? (found as (p: string) => unknown)(path) : found
    if (value instanceof Error) throw value
    return value
  })
}
