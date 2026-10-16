"use client"

import { BookOpen, ChefHat, Search, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { EmptyState } from "@/components/bits"
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

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-8 rounded-full border px-3 text-[13px] font-medium transition-colors duration-150",
        on ? "border-primary bg-primary-soft text-primary-text" : "bg-surface text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

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
  const [meal, setMeal] = useState<MealType | null>(null)
  const [time, setTime] = useState<number | null>(null)
  const [cuisine, setCuisine] = useState<string | null>(null)
  const [diets, setDiets] = useState<DietTag[]>([])
  const [safe, setSafe] = useState(true)

  const params = new URLSearchParams({ q, safe: String(safe), limit: "36" })
  if (meal) params.set("meal", meal)
  if (time) params.set("max_minutes", String(time))
  if (cuisine) params.set("cuisine", cuisine)
  diets.forEach((d) => params.append("diet", d))
  const { data, isLoading, error } = useApi<RecipeList>(`/recipes?${params}`, { keepPreviousData: true })
  const rules = data ? rulesText(data.rules) : []

  return (
    <div className="grid gap-5">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          setQ(text.trim())
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search recipes"
            placeholder="Try “quick dinner with chickpeas and spinach”"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-12 rounded-xl bg-surface pl-10 text-[15px]"
          />
        </div>
        <Button type="submit" size="lg" className="h-12">Search</Button>
        <Link href="/recipes/mine" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 bg-surface")}>
          <BookOpen /> <span className="hidden sm:inline">My recipes</span>
          <span className="sr-only sm:hidden">My recipes</span>
        </Link>
      </form>

      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Meal">
          {MEALS.map((m) => (
            <Chip key={m} on={meal === m} onClick={() => setMeal(meal === m ? null : m)}>{label(m)}</Chip>
          ))}
          <span className="mx-1 w-px bg-border" />
          {TIMES.map((t) => (
            <Chip key={t} on={time === t} onClick={() => setTime(time === t ? null : t)}>≤ {t} min</Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Diet and cuisine">
          {DIETS.map((d) => (
            <Chip key={d} on={diets.includes(d)}
                  onClick={() => setDiets(diets.includes(d) ? diets.filter((x) => x !== d) : [...diets, d])}>
              {label(d)}
            </Chip>
          ))}
          <span className="mx-1 w-px bg-border" />
          {meta?.cuisines.map((c) => (
            <Chip key={c} on={cuisine === c} onClick={() => setCuisine(cuisine === c ? null : c)}>{label(c)}</Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-primary-soft px-4 py-3">
        <ShieldCheck className="size-5 text-primary-text" aria-hidden />
        <p className="flex-1 text-[13px]">
          {safe ? (
            rules.length ? <>Showing only recipes that suit you: <strong>{rules.join("; ")}</strong>.</>
                         : <>Your profile has no allergies or diets yet, so nothing is hidden.</>
          ) : (
            <>Showing every recipe. Ones that break your rules are marked in red.</>
          )}
        </p>
        <label className="flex items-center gap-2 text-[13px] font-medium">
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
