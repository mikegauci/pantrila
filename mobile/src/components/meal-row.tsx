import { Link } from "expo-router"
import { CircleSlash, CopyPlus, Repeat2, UtensilsCrossed } from "lucide-react-native"
import { Pressable, Text, View } from "react-native"

import { mealHref } from "@pantrila/core/plan"
import type { PlanMeal } from "@pantrila/core/types"

import { RecipeArt } from "@/components/bits"
import { Icon } from "@/components/icon"

/** One meal of a day: a recipe (Pantrila's or the person's own), leftovers, skipped or eating
 * out. Skipped and eating-out meals are quiet rows; the menu can add their recipe back. */
export function MealRow({ m, bad, laterDays }: { m: PlanMeal; bad: boolean; laterDays: number[] }) {
  const href = mealHref(m)
  if (m.kind === "skipped" || m.kind === "eating_out" || !m.recipe || !href) {
    const out = m.kind === "eating_out"
    return (
      <View className="min-w-0 flex-1 flex-row items-center gap-3 rounded-2xl border border-dashed border-border p-2">
        <View className="size-12 items-center justify-center rounded-xl bg-surface-muted">
          <Icon icon={out ? UtensilsCrossed : CircleSlash} tone="muted-foreground" size={20} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="font-sans-medium text-[11px] uppercase text-muted-foreground">{m.meal_type}</Text>
          <Text className="font-sans-medium text-base text-foreground">{out ? "Eating out" : "Skipped"}</Text>
          {m.recipe && <Text numberOfLines={1} className="font-sans text-xs text-muted-foreground">Was {m.recipe.title}</Text>}
        </View>
        <Text className="font-sans text-xs text-muted-foreground">
          {out ? (m.out_kcal ? `~${Math.round(m.out_kcal)} kcal` : "Not counted") : "0 kcal"}
        </Text>
      </View>
    )
  }
  return (
    <Link href={href as never} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`${m.meal_type}: ${m.recipe.title}`}
                 className={`min-w-0 flex-1 flex-row items-center gap-3 rounded-2xl border p-2 ${bad ? "border-danger bg-danger-soft" : "border-border"}`}>
        <RecipeArt meal={m.meal_type} size="sm" photo={m.recipe.photo_url} className="size-12 rounded-xl" />
        <View className="min-w-0 flex-1">
          <Text className="font-sans-medium text-[11px] uppercase text-muted-foreground">{m.meal_type}</Text>
          <Text numberOfLines={1} className="font-sans-medium text-base text-foreground">{m.recipe.title}</Text>
          {m.kind === "leftovers" ? (
            <Note icon={Repeat2} text={`Leftovers from day ${m.from_day}`} />
          ) : laterDays.length > 0 ? (
            <Note icon={CopyPlus} text={`Leftovers for day ${laterDays.join(", ")}`} />
          ) : m.cookbook_id != null ? (
            <Text className="font-sans-medium text-xs text-primary-text">Your recipe</Text>
          ) : null}
        </View>
        <View className="items-end">
          <Text className="font-sans text-xs text-muted-foreground">{Math.round(m.recipe.nutrition.kcal * m.portions)} kcal</Text>
          <Text className="font-sans text-xs text-muted-foreground">×{m.portions}</Text>
        </View>
      </Pressable>
    </Link>
  )
}

function Note({ icon, text }: { icon: typeof Repeat2; text: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <Icon icon={icon} tone="primary-text" size={12} />
      <Text className="font-sans-medium text-xs text-primary-text">{text}</Text>
    </View>
  )
}
