import { router } from "expo-router"
import {
  ChefHat, ChevronRight, CircleSlash, CopyPlus, Repeat2, Shuffle, Undo2, UtensilsCrossed, type LucideIcon,
} from "lucide-react-native"
import { useState } from "react"
import { ActivityIndicator, Pressable, Text, View } from "react-native"
import { useSWRConfig } from "swr"

import { label } from "@pantrila/core/format"
import { cookHref, EATING_OUT_SIZES, leftoverSources, leftoversOf } from "@pantrila/core/plan"
import type { MealType, Plan, PlanMeal, SlotKind } from "@pantrila/core/types"

import { Icon } from "@/components/icon"
import { RepeatMeal } from "@/components/repeat-meal"
import { Sheet } from "@/components/sheet"
import { SwapMeal } from "@/components/swap-meal"
import { ApiError, send } from "@/lib/api"
import { useSavePlan } from "@/lib/hooks"
import { toast } from "@/lib/toast"

const MAX_LEFTOVER_CHOICES = 4 // the most recent earlier meals; older leftovers are rare

export interface MealTarget {
  day: number
  meal: MealType
}

interface SlotChange {
  kind: SlotKind
  out_kcal?: number
  from_day?: number
  from_meal?: MealType
}

type View_ = "menu" | "swap" | "repeat"

/** Everything a plan meal can do, in one sheet (the web's "⋯" menu, swap and repeat sheets):
 * swap it, repeat it on later days, start cooking, add its recipe back, eat out, eat leftovers
 * of an earlier meal, or skip it. The server checks every change against the person's rules. */
export function MealSheet({ plan, target, onClose }: { plan: Plan; target: MealTarget | null; onClose: () => void }) {
  const [view, setView] = useState<View_>("menu")
  const meal = target && plan.days.find((d) => d.day === target.day)?.meals.find((m) => m.meal_type === target.meal)

  function close() {
    setView("menu")
    onClose()
  }

  const slot = target ? `day ${target.day} ${label(target.meal).toLowerCase()}` : ""
  const title = view === "swap" ? `Swap ${slot}`
    : view === "repeat" ? `Repeat ${meal?.recipe?.title ?? slot}` : `Change ${slot}`
  // One sheet whose content changes, so moving from the menu to swap or repeat never stacks modals.
  return (
    <Sheet open={!!target && !!meal} onClose={close} title={title}
           description={view === "menu" ? meal?.recipe?.title : undefined}>
      {target && meal && (
        view === "swap" ? <SwapMeal day={target.day} meal={meal} onDone={close} />
        : view === "repeat" ? <RepeatMeal plan={plan} day={target.day} meal={meal} onDone={close} />
        : <Menu plan={plan} day={target.day} meal={meal} slot={slot} onView={setView} onDone={close} />
      )}
    </Sheet>
  )
}

function Menu({ plan, day, meal, slot, onView, onDone }: {
  plan: Plan; day: number; meal: PlanMeal; slot: string; onView: (v: View_) => void; onDone: () => void
}) {
  const save = useSavePlan()
  const { mutate } = useSWRConfig()
  const [busy, setBusy] = useState<string | null>(null)
  const cook = cookHref(plan, day, meal)
  const sources = leftoverSources(plan, day).reverse().slice(0, MAX_LEFTOVER_CHOICES)
  const dependents = leftoversOf(plan, day, meal.meal_type)
  const locked = dependents.length > 0
  const Slot = label(meal.meal_type)

  async function change(key: string, body: SlotChange, done: string) {
    setBusy(key)
    try {
      const updated = await send<Plan>(`/plans/latest/meals/${day}/${meal.meal_type}/slot`, "PUT",
        { plan_id: plan.id, ...body })
      save(updated)
      toast.success(done)
      onDone()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not reach Pantrila. Try again.")
      if (e instanceof ApiError && e.status === 409) {
        mutate("/plans/latest")
        onDone()
      }
    } finally {
      setBusy(null)
    }
  }

  const row = (key: string, icon: LucideIcon, text: string, onPress: () => void,
               opts: { detail?: string; disabled?: boolean; more?: boolean } = {}) => (
    <Row key={key} icon={icon} text={text} detail={opts.detail} more={opts.more}
         disabled={opts.disabled || busy !== null} busy={busy === key} onPress={onPress} />
  )

  return (
    <>
      <Group>
        {row("swap", Shuffle, meal.kind === "recipe" ? "Swap recipe" : "Pick a recipe", () => onView("swap"), { more: true })}
        {meal.kind === "recipe" && row("repeat", CopyPlus, "Repeat on other days", () => onView("repeat"), { more: true })}
        {cook && row("cook", ChefHat, "Start cooking", () => { onDone(); router.push(cook.href as never) },
                     { detail: `${cook.servings} serving${cook.servings === 1 ? "" : "s"}` })}
        {meal.kind !== "recipe" && meal.recipe &&
          row("back", Undo2, `Add back ${meal.recipe.title}`,
              () => change("back", { kind: "recipe" }, `${meal.recipe!.title} is back on ${slot}`))}
      </Group>
      {locked && (
        <Text className="font-sans text-xs text-muted-foreground">
          {dependents.join(", ").replace(/^./, (c) => c.toUpperCase())} {dependents.length === 1 ? "is" : "are"} leftovers
          of this meal, so it stays cooked.
        </Text>
      )}
      <Group title="Eating out">
        {EATING_OUT_SIZES.map((size) => row(`out-${size.kcal}`, UtensilsCrossed, size.label,
          () => change(`out-${size.kcal}`, { kind: "eating_out", out_kcal: size.kcal }, `${Slot} on day ${day}: eating out`),
          { detail: `~${size.kcal} kcal`, disabled: locked }))}
        {row("out", UtensilsCrossed, "Don't count it",
             () => change("out", { kind: "eating_out" }, `${Slot} on day ${day}: eating out`), { disabled: locked })}
      </Group>
      {sources.length > 0 && (
        <Group title="Leftovers of">
          {sources.map((s) => row(`left-${s.day}-${s.meal}`, Repeat2, s.title,
            () => change(`left-${s.day}-${s.meal}`, { kind: "leftovers", from_day: s.day, from_meal: s.meal },
                         `${Slot} on day ${day} is leftovers of ${s.title}`),
            { detail: `Day ${s.day} ${s.meal}`, disabled: locked }))}
        </Group>
      )}
      {meal.kind !== "skipped" && (
        <Group>
          {row("skip", CircleSlash, "Skip this meal", () => change("skip", { kind: "skipped" }, `Skipped ${slot}`),
               { disabled: locked })}
        </Group>
      )}
    </>
  )
}

function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View className="gap-1">
      {title && <Text className="px-1 font-sans-semibold text-xs text-muted-foreground">{title}</Text>}
      <View className="overflow-hidden rounded-2xl border border-border bg-surface">{children}</View>
    </View>
  )
}

function Row({ icon, text, detail, more, disabled, busy, onPress }: {
  icon: LucideIcon; text: string; detail?: string; more?: boolean; disabled?: boolean; busy?: boolean; onPress: () => void
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} accessibilityLabel={text}
               disabled={disabled} onPress={onPress}
               className={`min-h-12 flex-row items-center gap-3 border-b border-border px-4 py-2.5 ${disabled ? "opacity-50" : ""}`}>
      {busy ? <ActivityIndicator size="small" /> : <Icon icon={icon} tone="muted-foreground" size={18} />}
      <Text numberOfLines={1} className="flex-1 font-sans text-base text-foreground">{text}</Text>
      {detail && <Text className="font-sans text-xs text-muted-foreground">{detail}</Text>}
      {more && <Icon icon={ChevronRight} tone="muted-foreground" size={16} />}
    </Pressable>
  )
}
