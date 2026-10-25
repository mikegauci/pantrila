"use client"

import { Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"

import { label } from "@pantrila/core/format"
import { repeatChoices } from "@pantrila/core/plan"
import type { Plan, PlanMeal } from "@pantrila/core/types"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ApiError, send } from "@/lib/api"
import { useSavePlan } from "@/lib/hooks"

/** Cook once, eat again: pick meals on later days that become this meal's leftovers. The
 * server changes all of them or none, and buys for them on the grocery list. */
export function RepeatMealSheet({ plan, day, meal, open, onClose }: {
  plan: Plan; day: number; meal: PlanMeal; open: boolean; onClose: () => void
}) {
  const save = useSavePlan()
  const { mutate } = useSWRConfig()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const choices = repeatChoices(plan, day, meal.meal_type)
  const title = meal.recipe?.title ?? label(meal.meal_type)
  const key = (d: number, m: string) => `${d}-${m}`
  const already = choices.filter((c) => c.already).length
  const total = 1 + already + picked.size

  function close() {
    setPicked(new Set())
    onClose()
  }

  function toggle(k: string) {
    const next = new Set(picked)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setPicked(next)
  }

  async function submit() {
    setSaving(true)
    try {
      const on = choices.filter((c) => picked.has(key(c.day, c.meal))).map((c) => ({ day: c.day, meal_type: c.meal }))
      const updated = await send<Plan>(`/plans/latest/meals/${day}/${meal.meal_type}/repeat`, "PUT", { plan_id: plan.id, on })
      save(updated)
      toast.success(`${title}: cook once, eat ${total} times`)
      close()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not reach Pantrila. Try again.")
      if (e instanceof ApiError && e.status === 409) {
        mutate("/plans/latest")
        close()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="gap-3 overflow-y-auto p-4 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>Repeat {title}</SheetTitle>
          <SheetDescription>
            Cook it once on day {day} and eat the leftovers later. The grocery list buys enough for every meal you pick.
          </SheetDescription>
        </SheetHeader>
        {choices.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">This is the last day of your plan, so there is nothing later to repeat it on.</p>
        ) : (
          <ul className="grid gap-1">
            {choices.map((c) => {
              const k = key(c.day, c.meal)
              const id = `repeat-${k}`
              return (
                <li key={k} className="flex items-center gap-3 rounded-xl border p-3">
                  <Checkbox id={id} checked={c.already || picked.has(k)} disabled={c.already || c.blocked !== null || saving}
                    onCheckedChange={() => toggle(k)} />
                  <label htmlFor={id} className="min-w-0 flex-1">
                    <span className="block font-medium">Day {c.day} {c.meal}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {c.already ? "Already leftovers of this meal" : c.blocked ? `Not now: ${c.blocked}` : `Instead of ${c.now}`}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
        <div className="mt-auto grid gap-2">
          <p className="tabular text-[13px] text-muted-foreground">
            Cook once, eat {total} time{total === 1 ? "" : "s"}.
          </p>
          <Button disabled={picked.size === 0 || saving} onClick={submit}>
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            Repeat on {picked.size || "no"} meal{picked.size === 1 ? "" : "s"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
