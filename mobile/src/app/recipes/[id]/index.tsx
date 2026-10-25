import { Stack, useLocalSearchParams } from "expo-router"
import { Check, Clock, ShoppingBasket, Users } from "lucide-react-native"
import { useState } from "react"
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native"

import { niceFractions } from "@pantrila/core/amounts"
import { label } from "@pantrila/core/format"
import { hasTemp, showTemps } from "@pantrila/core/temperature"
import type { Ingredient } from "@pantrila/core/types"

import { AllergenBadge, DietBadge, ErrorState, Panel, PanelTitle, ProblemAlert, RecipeArt, Stepper } from "@/components/bits"
import { Icon } from "@/components/icon"
import { MacroRing } from "@/components/macro-ring"
import { MeasuredLine } from "@/components/measured-line"
import { StartCooking } from "@/components/start-cooking"
import { TemperatureToggle } from "@/components/temperature-toggle"
import { useProfile, useRecipe } from "@/lib/hooks"
import { useTempUnit } from "@/lib/temperature"

/** A Pantrila recipe: photo, the rules it breaks for the person, allergens, ingredients (servings
 * and a unit per line), nutrition per serving and the method in °C or °F with fan-oven settings. */
export default function RecipePage() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data: r, error, isLoading, mutate } = useRecipe(id ?? null)
  const { data: profile } = useProfile()
  const [servings, setServings] = useState<number | null>(null)
  const [unit] = useTempUnit()
  const [refreshing, setRefreshing] = useState(false)

  async function refresh() {
    setRefreshing(true)
    await mutate()
    setRefreshing(false)
  }

  if (error) {
    return (
      <View className="flex-1 bg-background p-4">
        <ErrorState message={error.status === 404 ? "No such recipe." : error.message}
                    onRetry={error.status === 404 ? undefined : () => mutate()} />
      </View>
    )
  }
  if (isLoading || !r) return <ActivityIndicator className="flex-1 bg-background" />

  const n = servings ?? r.servings
  const scale = n / r.servings
  const have = r.ingredients.filter((i) => i.in_pantry).length
  const allergies = new Set(profile?.allergies ?? [])
  const cook = { pathname: "/recipes/[id]/cook", params: { id: r.id, servings: String(n) } } as const

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-4 pt-2 pb-12"
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <Stack.Screen options={{ title: r.title }} />
      <ProblemAlert title="This recipe does not suit you" items={r.problems} />

      <Panel className="gap-3">
        <RecipeArt meal={r.meal_types[0]} cuisine={r.cuisine} size="lg" photo={r.photo_url}
                   className="aspect-[4/3] w-full" />
        <Text accessibilityRole="header" className="font-sans-bold text-2xl text-foreground">{r.title}</Text>
        <Text className="font-sans text-base text-muted-foreground">{r.summary}</Text>
        <View className="flex-row flex-wrap gap-4">
          <Fact icon={Clock} text={`${r.total_minutes} min`} />
          <Fact icon={Users} text={`Serves ${r.servings}`} />
          <Text className="font-sans text-[13px] text-muted-foreground">
            {label(r.cuisine)} · {r.meal_types.map(label).join(", ")}
          </Text>
        </View>
        {r.diet_tags.length > 0 && (
          <View className="flex-row flex-wrap gap-1.5">{r.diet_tags.map((d) => <DietBadge key={d} diet={d} />)}</View>
        )}
        <View className="flex-row flex-wrap items-center gap-1.5">
          <Text className="font-sans-medium text-xs text-muted-foreground">Allergens:</Text>
          {r.allergens.length
            ? r.allergens.map((a) => <AllergenBadge key={a} allergen={a} danger={allergies.has(a)} />)
            : <Text className="font-sans text-xs text-foreground">none of the 14 EU allergens</Text>}
        </View>
        <StartCooking href={cook} />
      </Panel>

      <Panel>
        <PanelTitle>Ingredients</PanelTitle>
        <View className="mb-3 flex-row items-center justify-between">
          <View className="flex-row items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-0.5">
            <Icon icon={ShoppingBasket} tone="primary-text" size={14} />
            <Text className="font-sans-medium text-xs text-primary-text">
              You have {have} of {r.ingredients.length} in your pantry
            </Text>
          </View>
          <Stepper name="Servings" value={n} min={1} max={24} onChange={setServings}
                   text={`${n} serving${n === 1 ? "" : "s"}`} />
        </View>
        {r.ingredients.map((ing, i) => <IngredientRow key={`${ing.food}-${i}`} ing={ing} scale={scale} />)}
      </Panel>

      <Panel>
        <PanelTitle>Per serving</PanelTitle>
        <MacroRing nutrition={r.nutrition} />
        <Text className="mt-4 font-sans text-xs text-muted-foreground">
          Nutrition calculated from ingredient weights using USDA FoodData Central and, for some foods, the Ciqual
          French food composition table. Values are estimates. Macros means protein, carbs and fat.
        </Text>
      </Panel>

      <Panel>
        <PanelTitle action={hasTemp(r.steps) ? <TemperatureToggle /> : undefined}>Method</PanelTitle>
        <View className="gap-4">
          {r.steps.map((step, i) => (
            <View key={i} className="flex-row gap-4">
              <View className="size-8 items-center justify-center rounded-full bg-primary-soft">
                <Text className="font-sans-semibold text-base text-primary-text">{i + 1}</Text>
              </View>
              <Text className="flex-1 pt-1 font-sans text-base text-foreground">{showTemps(niceFractions(step), unit)}</Text>
            </View>
          ))}
        </View>
      </Panel>

      <StartCooking href={cook} />
    </ScrollView>
  )
}

function IngredientRow({ ing, scale }: { ing: Ingredient; scale: number }) {
  return (
    <View className="flex-row items-center gap-3 border-b border-border py-2.5">
      <View accessibilityLabel={ing.in_pantry ? "In your pantry" : "Not in your pantry"}
            className={`size-5 items-center justify-center rounded-full border ${ing.in_pantry ? "border-primary bg-primary" : "border-border"}`}>
        {ing.in_pantry && <Icon icon={Check} tone="primary-foreground" size={12} strokeWidth={3} />}
      </View>
      <MeasuredLine line={ing} scale={scale} />
    </View>
  )
}

function Fact({ icon, text }: { icon: typeof Clock; text: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <Icon icon={icon} tone="muted-foreground" size={16} />
      <Text className="font-sans text-[13px] text-muted-foreground">{text}</Text>
    </View>
  )
}
