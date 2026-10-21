import { Bookmark, BookmarkCheck, Clock, Flame, Refrigerator, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { useSWRConfig } from "swr"
import { toast } from "sonner"

import { DietBadge, RecipeArt } from "@/components/bits"
import { api, send } from "@/lib/api"
import { useCookbook } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import type { CookbookRecipeIn, RecipeCard as Recipe, RecipeDetail } from "@/lib/types"

const myRecipes = (
  <Link href="/recipes/mine" className="font-bold underline underline-offset-2">My Recipes</Link>
)

/** Copies a corpus recipe into the person's cookbook (its photo is copied, none is generated); tap again to remove it. */
function SaveButton({ recipe }: { recipe: Recipe }) {
  const { mutate } = useSWRConfig()
  const { data: cookbook } = useCookbook()
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState<number | null>(null)
  const [removed, setRemoved] = useState(false)
  const existing = cookbook?.find((c) => c.title === recipe.title)?.id ?? null
  const id = removed ? savedId : (savedId ?? existing)
  const saved = id !== null

  async function remove(id: number) {
    await send(`/me/recipes/${id}`, "DELETE")
    setSavedId(null)
    setRemoved(true)
    await mutate("/me/recipes")
    toast(<span><strong>{recipe.title}</strong> removed from {myRecipes}</span>)
  }

  async function add() {
    const full = await api<RecipeDetail>(`/recipes/${recipe.id}`)
    const body: CookbookRecipeIn = {
      title: recipe.title,
      summary: recipe.summary,
      cuisine: recipe.cuisine,
      meal_types: recipe.meal_types,
      total_minutes: recipe.total_minutes,
      servings: recipe.servings,
      ingredients: full.ingredients.map((i) => ({
        name: i.name, quantity: i.quantity, unit: i.unit, food: i.food, estimate: null,
      })),
      steps: full.steps,
      source: "manual",
      source_url: null,
      source_platform: null,
      source_author: null,
      recipe_url: null,
    }
    const created = await send<{ id: number }>("/me/recipes", "POST", body)
    if (recipe.photo_url) {
      // Best effort: the recipe is saved either way, and its page can still make a photo.
      await send(`/me/recipes/${created.id}/photo/from/${recipe.id}`, "POST").catch(() => {})
    }
    setSavedId(created.id)
    setRemoved(false)
    await mutate("/me/recipes")
    toast.success(<span><strong>{recipe.title}</strong> saved to {myRecipes}</span>)
  }

  async function toggle() {
    if (busy) return
    setBusy(true)
    try {
      if (id !== null) await remove(id)
      else await add()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update My Recipes")
    } finally {
      setBusy(false)
    }
  }

  const Icon = saved ? BookmarkCheck : Bookmark
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-label={saved ? `Remove ${recipe.title} from My Recipes` : `Save ${recipe.title} to My Recipes`}
      aria-pressed={saved}
      className={cn(
        "absolute top-5 right-5 z-10 grid size-9 place-items-center rounded-full bg-surface/90 shadow-soft backdrop-blur transition-colors duration-150 hover:bg-surface disabled:opacity-60",
        saved ? "text-primary-text" : "text-foreground",
      )}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  )
}

export function RecipeCard({ recipe, className }: { recipe: Recipe; className?: string }) {
  const unsafe = recipe.problems.length > 0
  return (
    <div className="relative flex">
    <Link
      href={`/recipes/${recipe.id}`}
      className={cn(
        "group flex w-full flex-col rounded-[20px] border bg-surface p-3 transition-shadow duration-150 ease-out hover:shadow-soft",
        unsafe && "border-danger/50",
        className,
      )}
    >
      <RecipeArt
        meal={recipe.meal_types[0]} cuisine={recipe.cuisine} photo={recipe.photo_url}
        sizes="(min-width: 1280px) 280px, (min-width: 768px) 33vw, (min-width: 420px) 50vw, 100vw"
        className="aspect-[4/3] w-full"
      />
      <div className="flex flex-1 flex-col gap-2 px-1 pt-3 pb-1">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-[22px] group-hover:text-primary-text">
          {recipe.title}
        </h3>
        <p className="tabular flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-4 text-muted-foreground">
          <span className="inline-flex items-center gap-1 whitespace-nowrap"><Clock className="size-3.5" aria-hidden />{recipe.total_minutes} min</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap"><Flame className="size-3.5" aria-hidden />{Math.round(recipe.nutrition.kcal)} kcal</span>
          <span className="whitespace-nowrap">{Math.round(recipe.nutrition.protein_g)} g protein</span>
        </p>
        {unsafe && (
          <p className="inline-flex items-center gap-1 rounded-full bg-danger px-2.5 py-0.5 text-[12px] font-medium text-white">
            <TriangleAlert className="size-3" aria-hidden /> Not for you: {recipe.problems.join("; ")}
          </p>
        )}
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {recipe.pantry_foods.length > 0 && (
            <span className="inline-flex min-h-6 items-center gap-1 rounded-2xl bg-primary-soft px-2.5 py-0.5 text-[12px] leading-4 font-medium text-primary-text">
              <Refrigerator className="size-3" aria-hidden />
              Uses {recipe.pantry_foods.length} of your pantry items
            </span>
          )}
          {recipe.diet_tags.slice(0, 3).map((d) => <DietBadge key={d} diet={d} />)}
        </div>
      </div>
    </Link>
    <SaveButton recipe={recipe} />
    </div>
  )
}
