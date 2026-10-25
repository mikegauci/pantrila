"use client"

import { ChefHat, CircleSlash, CopyPlus, EllipsisVertical, Repeat2, Shuffle, Undo2, UtensilsCrossed } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"

import { label } from "@pantrila/core/format"
import { cookPortions, EATING_OUT_SIZES, leftoverSources, leftoversOf, mealHref } from "@pantrila/core/plan"
import type { MealType, Plan, PlanMeal, SlotKind } from "@pantrila/core/types"

import { RepeatMealSheet } from "@/components/repeat-meal"
import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ApiError, send } from "@/lib/api"
import { useSavePlan } from "@/lib/hooks"

const MAX_LEFTOVER_CHOICES = 4 // the most recent earlier meals; older leftovers are rare

interface SlotChange {
  kind: SlotKind
  out_kcal?: number
  from_day?: number
  from_meal?: MealType
}

/** The "⋯" menu on a plan meal: swap it, add its recipe back, eat out, eat leftovers of an
 * earlier day's meal, or skip it. The server checks every change against the person's rules. */
export function MealMenu({ plan, day, meal, onSwap }: {
  plan: Plan; day: number; meal: PlanMeal; onSwap: () => void
}) {
  const save = useSavePlan()
  const { mutate } = useSWRConfig()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [repeating, setRepeating] = useState(false)
  const href = mealHref(meal)
  const portions = cookPortions(plan, day, meal.meal_type)
  // Cooking mode takes whole servings; round up so the leftovers are never short.
  const cookServings = Math.max(1, Math.ceil(portions.total - 1e-9))
  const slot = `day ${day} ${meal.meal_type}`
  const sources = leftoverSources(plan, day).reverse().slice(0, MAX_LEFTOVER_CHOICES)
  const dependents = leftoversOf(plan, day, meal.meal_type)
  const locked = dependents.length > 0

  async function change(body: SlotChange, done: string) {
    setBusy(true)
    try {
      const updated = await send<Plan>(`/plans/latest/meals/${day}/${meal.meal_type}/slot`, "PUT",
        { plan_id: plan.id, ...body })
      save(updated)
      toast.success(done)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not reach Pantrila. Try again.")
      if (e instanceof ApiError && e.status === 409) mutate("/plans/latest")
    } finally {
      setBusy(false)
    }
  }

  const Slot = label(meal.meal_type)
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        className={buttonVariants({ variant: "ghost", size: "icon-lg", className: "shrink-0" })}
        aria-label={`Change ${slot}`} title="Change this meal" disabled={busy}
      >
        <EllipsisVertical aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onClick={onSwap}>
          <Shuffle /> {meal.kind === "recipe" ? "Swap recipe" : "Pick a recipe"}
        </DropdownMenuItem>
        {meal.kind === "recipe" && (
          <DropdownMenuItem onClick={() => setRepeating(true)}>
            <CopyPlus /> Repeat on other days
          </DropdownMenuItem>
        )}
        {meal.kind === "recipe" && href && (
          <DropdownMenuItem onClick={() => router.push(
            `${href}/cook?servings=${cookServings}${portions.later ? `&later=${Math.ceil(portions.later - 1e-9)}` : ""}`)}>
            <ChefHat /> Start cooking
            <span className="tabular ml-auto text-[12px] text-muted-foreground">
              {cookServings} serving{cookServings === 1 ? "" : "s"}
            </span>
          </DropdownMenuItem>
        )}
        {meal.kind !== "recipe" && meal.recipe && (
          <DropdownMenuItem onClick={() => change({ kind: "recipe" }, `${meal.recipe!.title} is back on ${slot}`)}>
            <Undo2 /> <span className="truncate">Add back {meal.recipe.title}</span>
          </DropdownMenuItem>
        )}
        {locked && (
          <p className="px-1.5 py-1 text-[12px] text-muted-foreground">
            {dependents.join(", ").replace(/^./, (c) => c.toUpperCase())} {dependents.length === 1 ? "is" : "are"} leftovers
            of this meal, so it stays cooked.
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Eating out</DropdownMenuLabel>
          {EATING_OUT_SIZES.map((size) => (
            <DropdownMenuItem key={size.kcal} disabled={locked}
              onClick={() => change({ kind: "eating_out", out_kcal: size.kcal }, `${Slot} on day ${day}: eating out`)}>
              <UtensilsCrossed /> {size.label}
              <span className="tabular ml-auto text-[12px] text-muted-foreground">~{size.kcal} kcal</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem disabled={locked}
            onClick={() => change({ kind: "eating_out" }, `${Slot} on day ${day}: eating out`)}>
            <UtensilsCrossed /> Don&apos;t count it
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {sources.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Leftovers of</DropdownMenuLabel>
              {sources.map((s) => (
                <DropdownMenuItem key={`${s.day}-${s.meal}`} disabled={locked}
                  onClick={() => change({ kind: "leftovers", from_day: s.day, from_meal: s.meal },
                    `${Slot} on day ${day} is leftovers of ${s.title}`)}>
                  <Repeat2 />
                  <span className="min-w-0">
                    <span className="block truncate">{s.title}</span>
                    <span className="block text-[12px] text-muted-foreground">Day {s.day} {s.meal}</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
        {meal.kind !== "skipped" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={locked}
              onClick={() => change({ kind: "skipped" }, `Skipped ${slot}`)}>
              <CircleSlash /> Skip this meal
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    {meal.kind === "recipe" && (
      <RepeatMealSheet plan={plan} day={day} meal={meal} open={repeating} onClose={() => setRepeating(false)} />
    )}
    </>
  )
}
