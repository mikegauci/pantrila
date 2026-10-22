"use client"

import { BookOpen, ChefHat, Search, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { EmptyState } from "@/components/bits"
import { FilterMenu } from "@/components/filter-menu"
import { RecipeCard } from "@/components/recipe-card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { label } from "@/lib/format"
import { useApi, useMeta } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import type { DietTag, MealType, RecipeList, SearchRules } from "@/lib/types"

const TIMES = [15, 30, 45, 60]
const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack", "dessert"]
const DIETS: DietTag[] = ["vegan", "vegetarian", "gluten_free", "dairy_free", "high_protein", "low_carb"]

function rulesText(r: SearchRules): string[] {
  const out = []
  if (r.exclude_allergens.length) out.push(`no ${r.exclude_allergens.map(label).join(", ").toLowerCase()}`)
  if (r.require_diets.length) out.push(r.require_diets.map(label).join(", ").toLowerCase())
  if (r.exclude_foods.length) out.push(`without ${r.exclude_foods.map(label).join(", ").toLowerCase()}`)
  if (r.max_minutes) out.push(`${r.max_minutes} min or less`)
  return out
}

export default function RecipesPage() {
  const { data: meta } = useMeta()
  const [text, setText] = useState("")
  const [q, setQ] = useState("")
  const [meal, setMeal] = useState<MealType[]>([])
  const [time, setTime] = useState<number | null>(null)
  const [cuisine, setCuisine] = useState<string[]>([])
  const [diets, setDiets] = useState<DietTag[]>([])
  const [safe, setSafe] = useState(true)

  const params = new URLSearchParams({ q, safe: String(safe), limit: "36" })
  meal.forEach((m) => params.append("meal", m))
  if (time) params.set("max_minutes", String(time))
  cuisine.forEach((c) => params.append("cuisine", c))
  diets.forEach((d) => params.append("diet", d))
  const { data, isLoading, error } = useApi<RecipeList>(`/recipes?${params}`, { keepPreviousData: true })
  const rules = data ? rulesText(data.rules) : []

  return (
    <div className="grid gap-5">
      <form
        role="search"
        data-tour="recipe-search"
        onSubmit={(e) => {
          e.preventDefault()
          setQ(text.trim())
        }}
        className="flex flex-wrap gap-2"
      >
        <div className="relative min-w-0 flex-1 basis-full sm:basis-0">
          <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search recipes"
            placeholder="Try “chickpea dinner”"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-12 rounded-xl bg-surface pl-10 text-[15px]"
          />
        </div>
        <Button type="submit" size="lg" className="h-12 flex-1 sm:flex-none">Search</Button>
        <Link href="/recipes/mine" data-tour="my-recipes" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 flex-1 bg-surface sm:flex-none")}>
          <BookOpen /> My recipes
        </Link>
      </form>

      <div className="flex flex-wrap gap-2">
        <FilterMenu name="Meal" options={MEALS.map((m) => ({ value: m, label: label(m) }))} selected={meal} onChange={setMeal} />
        <FilterMenu
          name="Time"
          single
          options={TIMES.map((t) => ({ value: String(t), label: `≤ ${t} min` }))}
          selected={time ? [String(time)] : []}
          onChange={(next) => setTime(next[0] ? Number(next[0]) : null)}
        />
        <FilterMenu name="Diet" options={DIETS.map((d) => ({ value: d, label: label(d) }))} selected={diets} onChange={setDiets} />
        <FilterMenu
          name="Cuisine"
          options={(meta?.cuisines ?? []).map((c) => ({ value: c, label: label(c) }))}
          selected={cuisine}
          onChange={setCuisine}
        />
      </div>

      <div className="flex items-center gap-3 rounded-2xl bg-primary-soft px-4 py-3 sm:flex-wrap">
        <ShieldCheck className="size-5 shrink-0 text-primary-text" aria-hidden />
        <p className="min-w-0 flex-1 text-[13px]">
          {safe ? (
            rules.length ? <>Showing only recipes that suit you: <strong>{rules.join("; ")}</strong>.</>
                         : <>
                             <span className="sm:hidden">No allergies or diets set, nothing hidden.</span>
                             <span className="hidden sm:inline">Your profile has no allergies or diets yet, so nothing is hidden.</span>
                           </>
          ) : (
            <>Showing every recipe. Ones that break your rules are marked in red.</>
          )}
        </p>
        <label data-tour="safety-switch" className="flex shrink-0 items-center gap-2 text-[13px] font-medium">
          <Switch checked={safe} onCheckedChange={setSafe} /> Only what suits me
        </label>
      </div>

      {q && <p className="text-[12px] text-muted-foreground">Hybrid search (meaning + keywords) for “{q}”, best match first.</p>}

      {error ? (
        <p role="alert" className="text-danger">{error.message}</p>
      ) : isLoading && !data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-[20px]" />)}
        </div>
      ) : data?.recipes.length ? (
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 md:gap-5 xl:grid-cols-4">
          {data.recipes.map((r) => <RecipeCard key={r.id} recipe={r} />)}
        </div>
      ) : (
        <EmptyState icon={ChefHat} title="No recipes match">
          Try fewer filters or different words.
        </EmptyState>
      )}
    </div>
  )
}
