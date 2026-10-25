"use client"

import { BookOpen, Loader2, Refrigerator, Search, Shuffle } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"

import { label } from "@pantrila/core/format"
import type { MealOption, MealOptions, MealType, Plan, PlanMeal } from "@pantrila/core/types"

import { EmptyState, ProblemAlert, RecipeArt } from "@/components/bits"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, send } from "@/lib/api"
import { useApi, useSavePlan } from "@/lib/hooks"
import { cn } from "@/lib/utils"

export interface SwapTarget {
  day: number
  meal: MealType
}

type Source = "corpus" | "mine"

const PAGE = 6
const MAX_SHOWN = 24 // the API's largest page; past it, searching narrows the list
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n))}`

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-8 shrink-0 rounded-full border px-3 whitespace-nowrap text-[13px] font-medium transition-colors duration-150",
        on ? "border-primary bg-primary-soft text-primary-text" : "bg-surface text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function Option({ o, meal, busy, saving, onPick }: {
  o: MealOption; meal: MealType; busy: boolean; saving: boolean; onPick: () => void
}) {
  const n = o.recipe.nutrition
  return (
    <li className="flex items-center gap-3 rounded-2xl border bg-surface p-2">
      <RecipeArt meal={meal} size="sm" photo={o.recipe.photo_url} sizes="56px" className="size-14 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 leading-5 font-medium">{o.recipe.title}</p>
        <p className="tabular text-[12px] leading-4 text-muted-foreground">
          {Math.round(n.kcal * o.portions)} kcal · {Math.round(n.protein_g * o.portions)} g protein · ×{o.portions}
        </p>
        <p className="tabular text-[12px] leading-4 text-muted-foreground">
          Day total {Math.round(o.day_nutrition.kcal)} kcal ({signed(o.kcal_change)}) · protein {signed(o.protein_change)} g
        </p>
        {o.recipe.pantry_foods.length > 0 && (
          <p className="mt-1 inline-flex items-center gap-1 text-[12px] leading-4 font-medium text-primary-text">
            <Refrigerator className="size-3" aria-hidden /> {o.recipe.pantry_foods.length} from your pantry
          </p>
        )}
      </div>
      <Button size="sm" variant="outline" className="shrink-0 bg-surface" disabled={busy}
        aria-label={`Use ${o.recipe.title}`} onClick={onPick}>
        {saving ? <Loader2 className="animate-spin" aria-hidden /> : "Use this"}
      </Button>
    </li>
  )
}

function describe(current: PlanMeal | undefined, target: SwapTarget) {
  const slot = `Day ${target.day} ${target.meal}`
  if (!current) return ""
  if (current.kind === "skipped") return `${slot} is skipped. Pick a recipe for it. `
  if (current.kind === "eating_out") return `${slot} is eating out. Pick a recipe to cook instead. `
  return current.recipe ? `Replacing ${current.recipe.title}. ` : ""
}

/** Pick another recipe for one meal of the plan: Pantrila's, best fit first, or one of the
 * person's own. The server lists only recipes that pass the person's rules and checks the
 * chosen one again before saving it. */
export function SwapMealSheet({ target, onClose }: { target: SwapTarget | null; onClose: () => void }) {
  const { mutate } = useSWRConfig()
  const save = useSavePlan()
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; problems: string[] } | null>(null)
  const [source, setSource] = useState<Source>("corpus")
  const [typed, setTyped] = useState("")
  const [query, setQuery] = useState("")
  const [quick, setQuick] = useState(false)
  const [pantry, setPantry] = useState(false)
  // "Show more" grows the page for the current search only; a new search starts at one page.
  const [more, setMore] = useState({ key: "", limit: PAGE })

  useEffect(() => {
    const t = setTimeout(() => setQuery(typed.trim()), 300)
    return () => clearTimeout(t)
  }, [typed])
  const searchKey = JSON.stringify([target, source, query, quick, pantry])
  const limit = more.key === searchKey ? more.limit : PAGE

  const params = new URLSearchParams({ source, limit: String(limit) })
  if (query) params.set("q", query)
  if (quick) params.set("quick", "true")
  if (pantry) params.set("pantry", "true")
  const { data, error: loadError, isLoading } = useApi<MealOptions>(
    target ? `/plans/latest/meals/${target.day}/${target.meal}/options?${params}` : null,
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  function close() {
    setError(null)
    setTyped("")
    setQuery("")
    setQuick(false)
    setPantry(false)
    setSource("corpus")
    onClose()
  }

  async function pick(o: MealOption) {
    if (!target || !data) return
    setSaving(o.recipe.id)
    setError(null)
    try {
      const plan = await send<Plan>(`/plans/latest/meals/${target.day}/${target.meal}`, "PUT", {
        plan_id: data.plan_id, recipe_id: o.recipe.id,
      })
      save(plan)
      toast.success(`Day ${target.day} ${target.meal} is now ${o.recipe.title}`)
      close()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(e.message)
        mutate("/plans/latest")
        close()
      } else {
        setError({
          message: e instanceof ApiError ? e.message : "Could not reach Pantrila. Try again.",
          problems: e instanceof ApiError ? e.problems : [],
        })
      }
    } finally {
      setSaving(null)
    }
  }

  const filtered = Boolean(query || quick || pantry)
  const options = data?.options ?? []
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        className="gap-3 overflow-y-auto p-4 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>
            {target ? `Swap day ${target.day} ${label(target.meal).toLowerCase()}` : "Swap a meal"}
          </SheetTitle>
          <SheetDescription>
            {target && describe(data?.current, target)}
            Every recipe here passes your allergies, diets and time limit.
          </SheetDescription>
        </SheetHeader>

        <div role="tablist" aria-label="Recipes from" className="grid grid-cols-2 gap-1 rounded-full bg-surface-muted p-1">
          {(["corpus", "mine"] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={source === s} onClick={() => setSource(s)}
              className={cn("h-8 rounded-full text-[13px] font-medium transition-colors",
                source === s ? "bg-surface shadow-soft" : "text-muted-foreground hover:text-foreground")}>
              {s === "corpus" ? "Pantrila's recipes" : "My recipes"}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={80}
            placeholder="Search by name, cuisine or food" aria-label="Search recipes" className="pl-9" />
        </div>
        <div className="flex gap-2">
          <Chip on={quick} onClick={() => setQuick(!quick)}>30 min or less</Chip>
          <Chip on={pantry} onClick={() => setPantry(!pantry)}>Uses my pantry</Chip>
        </div>

        {error && <ProblemAlert title={error.message} items={error.problems} />}
        {error && error.problems.length === 0 && (
          <p role="alert" className="text-[13px] text-danger">{error.message}</p>
        )}

        {isLoading && !data ? (
          <div className="grid gap-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px] rounded-2xl" />)}
          </div>
        ) : loadError ? (
          <p role="alert" className="text-[13px] text-danger">{loadError.message}</p>
        ) : data && options.length === 0 ? (
          source === "mine" && !filtered ? (
            <EmptyState icon={BookOpen} title="None of your recipes fit"
              action={<Link href="/recipes/mine/new" className="text-[13px] font-medium underline">Add a recipe</Link>}>
              Recipes you save show here when they pass your allergies, diets and time limit.
            </EmptyState>
          ) : (
            <EmptyState icon={Shuffle} title={filtered ? "No recipes match" : "No other recipes fit"}>
              {filtered
                ? "Try other words, or turn off a filter."
                : "Nothing else passes your rules for this meal. Loosen a rule in your profile, or plan a new week."}
            </EmptyState>
          )
        ) : (
          <>
            <ul className="grid gap-2" aria-busy={isLoading}>
              {options.map((o) => (
                <Option key={o.recipe.id} o={o} meal={data!.meal_type} busy={saving !== null}
                  saving={saving === o.recipe.id} onPick={() => pick(o)} />
              ))}
            </ul>
            {data && (
              <div className="grid justify-items-center gap-2 pb-2 text-[12px] text-muted-foreground">
                <p className="tabular">Showing {options.length} of {data.total}</p>
                {options.length < data.total && (limit < MAX_SHOWN ? (
                  <Button variant="outline" size="sm" disabled={isLoading}
                    onClick={() => setMore({ key: searchKey, limit: Math.min(limit + PAGE, MAX_SHOWN) })}>
                    {isLoading ? <Loader2 className="animate-spin" aria-hidden /> : null} Show more
                  </Button>
                ) : (
                  <p>Search to find the rest.</p>
                ))}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
