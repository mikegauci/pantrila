"use client"

import { Loader2, Refrigerator, Shuffle } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"

import { EmptyState, ProblemAlert, RecipeArt } from "@/components/bits"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, send } from "@/lib/api"
import { label } from "@/lib/format"
import { useApi } from "@/lib/hooks"
import type { MealOption, MealOptions, MealType, Plan } from "@/lib/types"

export interface SwapTarget {
  day: number
  meal: MealType
}

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n))}`

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
          Day total {Math.round(o.day_nutrition.kcal)} kcal ({signed(o.kcal_change)})
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

/** Pick another recipe for one meal of the plan. The server lists only recipes that pass the
 * person's rules and checks the chosen one again before saving it. */
export function SwapMealSheet({ target, onClose }: { target: SwapTarget | null; onClose: () => void }) {
  const { mutate } = useSWRConfig()
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; problems: string[] } | null>(null)
  const { data, error: loadError, isLoading } = useApi<MealOptions>(
    target ? `/plans/latest/meals/${target.day}/${target.meal}/options` : null,
    { revalidateOnFocus: false },
  )

  function close() {
    setError(null)
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
      mutate("/plans/latest", plan, { revalidate: false })
      mutate((key) => typeof key === "string" && (
        key.startsWith("/plans/latest/grocery") || key.startsWith("/plans/latest/meals")
      ))
      toast.success(`Day ${target.day} ${target.meal} is now ${o.recipe.title}`)
      close()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(e.message)
        mutate("/plans/latest")
        close()
      } else {
        setError({
          message: e instanceof ApiError ? e.message : "Could not reach Pantrio. Try again.",
          problems: e instanceof ApiError ? e.problems : [],
        })
      }
    } finally {
      setSaving(null)
    }
  }

  const current = data?.current
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
            {current ? `Replacing ${current.recipe.title}. ` : ""}
            Every recipe here passes your allergies, diets and time limit.
          </SheetDescription>
        </SheetHeader>

        {error && <ProblemAlert title={error.message} items={error.problems} />}
        {error && error.problems.length === 0 && (
          <p role="alert" className="text-[13px] text-danger">{error.message}</p>
        )}

        {isLoading ? (
          <div className="grid gap-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px] rounded-2xl" />)}
          </div>
        ) : loadError ? (
          <p role="alert" className="text-[13px] text-danger">{loadError.message}</p>
        ) : data && data.options.length === 0 ? (
          <EmptyState icon={Shuffle} title="No other recipes fit">
            Nothing else passes your rules for this meal. Loosen a rule in your profile, or plan a new week.
          </EmptyState>
        ) : (
          <ul className="grid gap-2">
            {data?.options.map((o) => (
              <Option key={o.recipe.id} o={o} meal={data.meal_type} busy={saving !== null}
                saving={saving === o.recipe.id} onPick={() => pick(o)} />
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  )
}
