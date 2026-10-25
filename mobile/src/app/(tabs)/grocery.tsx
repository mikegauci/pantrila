import { Link } from "expo-router"
import { Check, ShoppingBasket } from "lucide-react-native"
import { useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"

import { label } from "@pantrila/core/format"
import { aisleName, byAisle } from "@pantrila/core/grocery"
import type { GroceryItem } from "@pantrila/core/types"

import { EmptyState, ErrorState, Panel, PanelTitle, Stepper } from "@/components/bits"
import { Icon } from "@/components/icon"
import { useTicked } from "@/lib/grocery"
import { useGrocery, usePlan } from "@/lib/hooks"

/** What to buy for the latest plan, by aisle, minus the pantry; tick foods as they go in the
 * basket. Foods of the person's own recipes that Pantrila estimated are listed apart. */
export default function Grocery() {
  const { data: plan, isLoading: planLoading, error: planError, mutate: refreshPlan } = usePlan()
  const [people, setPeople] = useState(1)
  const { data, isLoading, error, mutate } = useGrocery(people, !!plan)
  const [ticked, toggle] = useTicked(plan?.id ?? null)
  const [refreshing, setRefreshing] = useState(false)
  const titles = new Map(plan?.days.flatMap((d) => d.meals.flatMap((m) => m.recipe ? [[m.recipe.id, m.recipe.title] as const] : [])))

  async function refresh() {
    setRefreshing(true)
    await Promise.all([refreshPlan(), plan ? mutate() : undefined])
    setRefreshing(false)
  }

  let body: React.ReactNode
  if (planError) body = <ErrorState message={planError.message} onRetry={() => refreshPlan()} />
  else if (planLoading) body = <ActivityIndicator className="my-10" />
  else if (!plan) {
    body = (
      <EmptyState icon={ShoppingBasket} title="No grocery list yet"
                  action={<Link href="/plan" className="font-sans-semibold text-base text-primary-text">Plan my week</Link>}>
        Your list is built from your meal plan, minus what is already in your pantry.
      </EmptyState>
    )
  } else {
    body = (
      <>
        <Panel>
          <PanelTitle action={
            <Stepper name="People" value={people} min={1} max={12} onChange={setPeople}
                     text={`${people} ${people === 1 ? "person" : "people"}`} />
          }>
            To buy
          </PanelTitle>
          {error ? (
            <ErrorState message={error.message} onRetry={() => mutate()} />
          ) : isLoading || !data ? (
            <ActivityIndicator className="my-8" />
          ) : !data.items.length ? (
            <Text className="font-sans text-base text-muted-foreground">Your pantry covers the whole plan. Nothing to buy.</Text>
          ) : (
            <View className="gap-5">
              <Text className="font-sans text-xs text-muted-foreground">
                {data.items.length} items for {plan.days.length} days, rounded up to shop amounts.
                {ticked.size > 0 ? ` ${data.items.filter((i) => ticked.has(i.food)).length} in the basket.` : ""}
              </Text>
              {byAisle(data.items).map(([aisle, items]) => (
                <View key={aisle}>
                  <Text accessibilityRole="header" className="mb-1 font-sans-semibold text-[15px] text-foreground">{aisleName(aisle)}</Text>
                  {items.map((i) => (
                    <Item key={i.food} item={i} on={ticked.has(i.food)} onPress={() => toggle(i.food)}
                          recipes={i.recipes.map((r) => titles.get(r) ?? r).join(", ")} />
                  ))}
                </View>
              ))}
              {data.unlisted && data.unlisted.length > 0 && (
                <View>
                  <Text accessibilityRole="header" className="mb-1 font-sans-semibold text-[15px] text-foreground">Also for your recipes</Text>
                  <Text className="mb-2 font-sans text-xs text-muted-foreground">
                    Pantrila estimated these foods, so it cannot say how much to buy. Check the recipe.
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {data.unlisted.map((name) => (
                      <View key={name} className="rounded-full border border-border px-3 py-1">
                        <Text className="font-sans text-[13px] text-foreground">{name}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}
        </Panel>

        <Panel className="bg-primary-soft">
          <PanelTitle>From your pantry</PanelTitle>
          {data?.covered.length ? (
            data.covered.map((i) => (
              <View key={i.food} className="flex-row justify-between gap-3 py-1">
                <Text className="font-sans text-base text-muted-foreground line-through">{label(i.food)}</Text>
                <Text className="font-sans text-base text-muted-foreground line-through">{i.amount}</Text>
              </View>
            ))
          ) : (
            <Text className="font-sans text-base text-muted-foreground">Nothing in your pantry covers this plan yet.</Text>
          )}
        </Panel>
      </>
    )
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-4 pt-2 pb-10"
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {body}
    </ScrollView>
  )
}

function Item({ item: i, on, recipes, onPress }: { item: GroceryItem; on: boolean; recipes: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${label(i.food)}, ${i.amount}`}
               onPress={onPress} className="flex-row items-center gap-3 border-b border-border py-2.5">
      <View className={`size-5 items-center justify-center rounded-md border ${on ? "border-primary bg-primary" : "border-border"}`}>
        {on && <Icon icon={Check} tone="primary-foreground" size={14} strokeWidth={3} />}
      </View>
      <View className="min-w-0 flex-1">
        <Text className={`font-sans-medium text-base ${on ? "text-muted-foreground line-through" : "text-foreground"}`}>{label(i.food)}</Text>
        <Text className="font-sans text-xs text-muted-foreground">
          for {recipes}{i.have_g > 0 ? ` · you have ${Math.round(i.have_g)} g` : ""}
        </Text>
      </View>
      <Text className="font-sans-semibold text-base text-foreground">{i.amount}</Text>
    </Pressable>
  )
}

