"use client"

import { ArrowLeft, Check, Clock, Minus, Plus, Repeat, ShoppingBasket, Users } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useState } from "react"

import { AllergenBadge, DietBadge, Panel, PanelTitle, ProblemAlert, RecipeArt } from "@/components/bits"
import { MacroRing } from "@/components/macro-ring"
import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { label } from "@/lib/format"
import { useApi, useProfile, useRecipe } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import type { Ingredient, SwapList } from "@/lib/types"

function amount(q: number) {
  return q < 10 ? String(Math.round(q * 100) / 100) : String(Math.round(q))
}

function Swaps({ recipeId, food, onClose }: { recipeId: string; food: string; onClose: () => void }) {
  const { data, error, isLoading } = useApi<SwapList>(
    `/recipes/${recipeId}/swaps?food=${encodeURIComponent(food)}`,
  )
  return (
    <div className="mt-2 rounded-2xl border bg-surface-muted p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-semibold">Swaps for {label(food).toLowerCase()} (same weight)</p>
        <Button variant="ghost" size="xs" onClick={onClose}>Close</Button>
      </div>
      {isLoading && <Skeleton className="h-16 rounded-xl" />}
      {error && <p className="text-[13px] text-danger">{error.message}</p>}
      {data && !data.swaps.length && (
        <p className="text-[13px] text-muted-foreground">No swap that suits your allergies and diet.</p>
      )}
      <ul className="grid gap-2">
        {data?.swaps.map((s) => (
          <li key={s.replacement} className="rounded-xl bg-surface p-3 text-[13px]">
            <p className="font-medium">{label(s.replacement)}</p>
            <p className="tabular text-muted-foreground">
              {s.kcal_change >= 0 ? "+" : ""}{Math.round(s.kcal_change)} kcal,{" "}
              {s.protein_change >= 0 ? "+" : ""}{Math.round(s.protein_change)} g protein per serving
            </p>
            {s.lost_diets.length > 0 && (
              <p className="text-[#a65a00]">No longer {s.lost_diets.map(label).join(", ").toLowerCase()}</p>
            )}
            {s.added_allergens.length > 0 && (
              <p className="text-muted-foreground">Adds {s.added_allergens.map(label).join(", ").toLowerCase()}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Checked in code against your allergies, diets and excluded foods.
      </p>
    </div>
  )
}

function IngredientRow({
  ing, scale, recipeId, open, onToggle,
}: { ing: Ingredient; scale: number; recipeId: string; open: boolean; onToggle: () => void }) {
  return (
    <li className="border-b py-2.5 last:border-0">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full border",
            ing.in_pantry ? "border-primary bg-primary text-primary-foreground" : "border-border",
          )}
          title={ing.in_pantry ? "In your pantry" : "Not in your pantry"}
        >
          {ing.in_pantry && <Check className="size-3" strokeWidth={3} />}
        </span>
        <span className="flex-1">
          <span className="tabular font-semibold">{amount(ing.quantity * scale)} {ing.unit}</span>{" "}
          {ing.name}
          {ing.in_pantry && <span className="sr-only"> (in your pantry)</span>}
        </span>
        <Button variant="ghost" size="xs" onClick={onToggle} aria-expanded={open}>
          <Repeat /> Swap
        </Button>
      </div>
      {open && <Swaps recipeId={recipeId} food={ing.food} onClose={onToggle} />}
    </li>
  )
}

export default function RecipePage() {
  const { id } = useParams<{ id: string }>()
  const { data: r, error, isLoading } = useRecipe(id)
  const { data: profile } = useProfile()
  const [servings, setServings] = useState<number | null>(null)
  const [swapFood, setSwapFood] = useState<string | null>(null)

  if (error) {
    return <p role="alert" className="text-danger">{error.status === 404 ? "No such recipe." : error.message}</p>
  }
  if (isLoading || !r) return <Skeleton className="h-96 rounded-[20px]" />

  const n = servings ?? r.servings
  const scale = n / r.servings
  const have = r.ingredients.filter((i) => i.in_pantry).length
  const allergies = new Set(profile?.allergies ?? [])

  return (
    <div className="grid gap-5">
      <Link href="/recipes" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit")}>
        <ArrowLeft /> Recipes
      </Link>

      <ProblemAlert title="This recipe does not suit you" items={r.problems} />

      <Panel className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <RecipeArt meal={r.meal_types[0]} cuisine={r.cuisine} size="lg" className="aspect-[4/3] w-full" />
        <div className="flex flex-col gap-3">
          <h2 className="text-[24px] font-bold leading-8">{r.title}</h2>
          <p className="text-muted-foreground">{r.summary}</p>
          <p className="tabular flex flex-wrap gap-4 text-[13px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Clock className="size-4" aria-hidden />{r.total_minutes} min</span>
            <span className="inline-flex items-center gap-1.5"><Users className="size-4" aria-hidden />Serves {r.servings}</span>
            <span>{label(r.cuisine)} · {r.meal_types.map(label).join(", ")}</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {r.diet_tags.map((d) => <DietBadge key={d} diet={d} />)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">Allergens:</span>
            {r.allergens.length
              ? r.allergens.map((a) => <AllergenBadge key={a} allergen={a} danger={allergies.has(a)} />)
              : <span className="text-[12px]">none of the 14 EU allergens</span>}
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel>
          <PanelTitle
            action={
              <div className="flex items-center gap-2" aria-label="Servings">
                <Button variant="outline" size="icon-sm" aria-label="Fewer servings"
                        onClick={() => setServings(Math.max(1, n - 1))}><Minus /></Button>
                <span className="tabular w-20 text-center text-[13px] font-semibold">{n} serving{n === 1 ? "" : "s"}</span>
                <Button variant="outline" size="icon-sm" aria-label="More servings"
                        onClick={() => setServings(Math.min(24, n + 1))}><Plus /></Button>
              </div>
            }
          >
            Ingredients
          </PanelTitle>
          <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-0.5 text-[12px] font-medium text-primary-text">
            <ShoppingBasket className="size-3.5" aria-hidden /> You have {have} of {r.ingredients.length} in your pantry
          </p>
          <ul>
            {r.ingredients.map((ing, i) => (
              <IngredientRow key={`${ing.food}-${i}`} ing={ing} scale={scale} recipeId={r.id}
                             open={swapFood === ing.food}
                             onToggle={() => setSwapFood(swapFood === ing.food ? null : ing.food)} />
            ))}
          </ul>
        </Panel>

        <Panel>
          <PanelTitle>Per serving</PanelTitle>
          <MacroRing nutrition={r.nutrition} size={150} />
          <p className="mt-4 text-[12px] text-muted-foreground">
            Computed from the ingredients with USDA FoodData Central values. Macros means protein,
            carbs and fat.
          </p>
        </Panel>
      </div>

      <Panel>
        <PanelTitle>Method</PanelTitle>
        <ol className="grid gap-4">
          {r.steps.map((step, i) => (
            <li key={i} className="flex gap-4">
              <span className="tabular grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary-text">
                {i + 1}
              </span>
              <p className="pt-1">{step}</p>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  )
}
