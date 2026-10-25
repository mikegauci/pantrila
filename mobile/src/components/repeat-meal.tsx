import { Check } from "lucide-react-native"
import { useState } from "react"
import { ActivityIndicator, Pressable, Text, View } from "react-native"
import { useSWRConfig } from "swr"

import { label } from "@pantrila/core/format"
import { repeatChoices } from "@pantrila/core/plan"
import type { Plan, PlanMeal } from "@pantrila/core/types"

import { Icon } from "@/components/icon"
import { ApiError, send } from "@/lib/api"
import { useSavePlan } from "@/lib/hooks"
import { toast } from "@/lib/toast"

/** Cook once, eat again: pick meals on later days that become this meal's leftovers. The
 * server changes all of them or none, and buys for them on the grocery list. */
export function RepeatMeal({ plan, day, meal, onDone }: { plan: Plan; day: number; meal: PlanMeal; onDone: () => void }) {
  const save = useSavePlan()
  const { mutate } = useSWRConfig()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const choices = repeatChoices(plan, day, meal.meal_type)
  const title = meal.recipe?.title ?? label(meal.meal_type)
  const key = (d: number, m: string) => `${d}-${m}`
  const total = 1 + choices.filter((c) => c.already).length + picked.size

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
      onDone()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not reach Pantrila. Try again.")
      if (e instanceof ApiError && e.status === 409) {
        mutate("/plans/latest")
        onDone()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Text className="font-sans text-sm text-muted-foreground">
        Cook it once on day {day} and eat the leftovers later. The grocery list buys enough for every meal you pick.
      </Text>
      {choices.length === 0 ? (
        <Text className="font-sans text-sm text-muted-foreground">
          This is the last day of your plan, so there is nothing later to repeat it on.
        </Text>
      ) : (
        <View className="gap-1">
          {choices.map((c) => {
            const k = key(c.day, c.meal)
            const on = c.already || picked.has(k)
            const disabled = c.already || c.blocked !== null || saving
            return (
              <Pressable key={k} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled }}
                         accessibilityLabel={`Day ${c.day} ${c.meal}`} disabled={disabled} onPress={() => toggle(k)}
                         className={`flex-row items-center gap-3 rounded-xl border border-border bg-surface p-3 ${disabled && !c.already ? "opacity-60" : ""}`}>
                <View className={`size-5 items-center justify-center rounded-md border ${on ? "border-primary bg-primary" : "border-border"}`}>
                  {on && <Icon icon={Check} tone="primary-foreground" size={14} strokeWidth={3} />}
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="font-sans-medium text-base text-foreground">Day {c.day} {c.meal}</Text>
                  <Text numberOfLines={1} className="font-sans text-xs text-muted-foreground">
                    {c.already ? "Already leftovers of this meal" : c.blocked ? `Not now: ${c.blocked}` : `Instead of ${c.now}`}
                  </Text>
                </View>
              </Pressable>
            )
          })}
        </View>
      )}
      <Text className="font-sans text-sm text-muted-foreground">Cook once, eat {total} time{total === 1 ? "" : "s"}.</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: picked.size === 0 || saving }}
                 disabled={picked.size === 0 || saving} onPress={submit}
                 className={`h-12 flex-row items-center justify-center gap-2 rounded-xl bg-primary ${picked.size === 0 || saving ? "opacity-50" : ""}`}>
        {saving && <ActivityIndicator size="small" color="white" />}
        <Text className="font-sans-semibold text-base text-primary-foreground">
          Repeat on {picked.size || "no"} meal{picked.size === 1 ? "" : "s"}
        </Text>
      </Pressable>
    </>
  )
}
