import { ChefHat, Search, ShieldCheck } from "lucide-react-native"
import { useState } from "react"
import { ActivityIndicator, FlatList, RefreshControl, Switch, Text, TextInput, View } from "react-native"

import { label } from "@pantrila/core/format"

import { EmptyState, ErrorState } from "@/components/bits"
import { ChipRow } from "@/components/chips"
import { Icon } from "@/components/icon"
import { RecipeCard } from "@/components/recipe-card"
import { useMeta, useRecipePages } from "@/lib/hooks"
import { DIETS, MEALS, recipeParams, rulesText, TIMES, type RecipeFilters } from "@/lib/recipes"

/** Pantrila's recipes: search, Meal / Time / Diet / Cuisine chips, the "Only what suits me"
 * switch, then cards that load more as the list scrolls. */
export default function Recipes() {
  const { data: meta } = useMeta()
  const [text, setText] = useState("")
  const [f, setF] = useState<RecipeFilters>({ q: "", meal: [], time: null, diets: [], cuisine: [], safe: true })
  const pages = useRecipePages(recipeParams(f))
  const { recipes, rules, error, isLoading, isValidating, more, size, setSize, mutate } = pages
  const [refreshing, setRefreshing] = useState(false)
  const loadingMore = isValidating && !!pages.data && pages.data.length < size
  const shown = rules ? rulesText(rules) : []
  const change = (patch: Partial<RecipeFilters>) => setF((old) => ({ ...old, ...patch }))

  async function refresh() {
    setRefreshing(true)
    await mutate()
    setRefreshing(false)
  }

  const header = (
    <View className="gap-3 pb-4">
      <View className="h-12 flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3">
        <Icon icon={Search} tone="muted-foreground" size={16} />
        <TextInput
          accessibilityLabel="Search recipes"
          placeholder="Try “chickpea dinner”"
          placeholderTextColorClassName="accent-muted-foreground"
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => change({ q: text.trim() })}
          returnKeyType="search"
          clearButtonMode="while-editing"
          className="flex-1 font-sans text-[15px] text-foreground"
        />
      </View>
      <ChipRow name="Meal" options={MEALS.map((m) => ({ value: m, label: label(m) }))}
               selected={f.meal} onChange={(meal) => change({ meal })} />
      <ChipRow name="Time" single options={TIMES.map((t) => ({ value: String(t), label: `≤ ${t} min` }))}
               selected={f.time ? [String(f.time)] : []}
               onChange={(next) => change({ time: next[0] ? Number(next[0]) : null })} />
      <ChipRow name="Diet" options={DIETS.map((d) => ({ value: d, label: label(d) }))}
               selected={f.diets} onChange={(diets) => change({ diets })} />
      <ChipRow name="Cuisine" options={(meta?.cuisines ?? []).map((c) => ({ value: c, label: label(c) }))}
               selected={f.cuisine} onChange={(cuisine) => change({ cuisine })} />
      <View className="flex-row items-center gap-3 rounded-2xl bg-primary-soft px-4 py-3">
        <Icon icon={ShieldCheck} tone="primary-text" size={20} />
        <Text className="flex-1 font-sans text-[13px] text-foreground">
          {f.safe ? (
            shown.length
              ? <>Showing only recipes that suit you: <Text className="font-sans-bold">{shown.join("; ")}</Text>.</>
              : "No allergies or diets set, nothing hidden."
          ) : "Showing every recipe. Ones that break your rules are marked in red."}
        </Text>
        <Switch accessibilityLabel="Only what suits me" value={f.safe} onValueChange={(safe) => change({ safe })}
                thumbColorClassName="accent-surface" trackColorOnClassName="accent-primary" />
      </View>
      {f.q !== "" && (
        <Text className="font-sans text-xs text-muted-foreground">
          Hybrid search (meaning + keywords) for “{f.q}”, best match first.
        </Text>
      )}
    </View>
  )

  return (
    <FlatList
      testID="recipe-list"
      className="flex-1 bg-background"
      contentContainerClassName="px-4 pt-2 pb-10"
      data={error ? [] : recipes}
      keyExtractor={(r) => r.id}
      renderItem={({ item }) => <RecipeCard recipe={item} />}
      ItemSeparatorComponent={() => <View className="h-3" />}
      ListHeaderComponent={header}
      ListEmptyComponent={
        error ? <ErrorState message={error.message} onRetry={() => mutate()} />
        : isLoading ? <ActivityIndicator className="my-10" />
        : <EmptyState icon={ChefHat} title="No recipes match">Try fewer filters or different words.</EmptyState>
      }
      ListFooterComponent={loadingMore ? <ActivityIndicator className="my-6" /> : undefined}
      onEndReached={() => { if (more && !isValidating) setSize(size + 1) }}
      onEndReachedThreshold={0.6}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    />
  )
}
