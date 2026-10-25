import { Link, router } from "expo-router"
import { BookOpen, Clock, Flame, Plus, TriangleAlert, type LucideIcon } from "lucide-react-native"
import { useState } from "react"
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native"

import { origins, SOURCE_TEXT } from "@pantrila/core/cookbook"
import type { CookbookCard } from "@pantrila/core/types"

import { Button, DietBadge, EmptyState, ErrorState, Panel, RecipeArt } from "@/components/bits"
import { Icon } from "@/components/icon"
import { SOURCE_ICON } from "@/components/recipe-source"
import { useCookbook } from "@/lib/hooks"

/** My recipes: every recipe the person saved, imported or typed in, newest first. */
export default function MyRecipes() {
  const { data, error, isLoading, mutate } = useCookbook()
  const [refreshing, setRefreshing] = useState(false)

  async function refresh() {
    setRefreshing(true)
    await mutate()
    setRefreshing(false)
  }

  const add = <Button icon={Plus} text="Add a recipe" onPress={() => router.push("/recipes/mine/new")} />
  if (error) {
    return (
      <View className="flex-1 bg-background p-4">
        <ErrorState message={error.message} onRetry={() => mutate()} />
      </View>
    )
  }
  if (isLoading || !data) return <ActivityIndicator className="flex-1 bg-background" />
  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="gap-3 px-4 pt-2 pb-12"
      data={data}
      keyExtractor={(r) => String(r.id)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      ListHeaderComponent={data.length ? (
        <View className="gap-3 pb-1">
          {add}
          <Panel className="p-4">
            <Text className="font-sans text-[13px] text-muted-foreground">Where they came from: {origins(data)}.</Text>
          </Panel>
        </View>
      ) : undefined}
      ListEmptyComponent={(
        <EmptyState icon={BookOpen} title="No recipes of your own yet" action={add}>
          Snap a cookbook page, paste a link from a recipe site or a post, or type a family favourite.
        </EmptyState>
      )}
      renderItem={({ item }) => <Card r={item} />}
    />
  )
}

function Card({ r }: { r: CookbookCard }) {
  const unsafe = r.problems.length > 0
  return (
    <Link href={{ pathname: "/recipes/mine/[id]", params: { id: String(r.id) } }} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={r.title}
                 className={`flex-row gap-3 rounded-[20px] border bg-surface p-3 ${unsafe ? "border-danger/50" : "border-border"}`}>
        <RecipeArt meal={r.meal_types[0]} photo={r.photo_url} size="sm" className="aspect-[4/3] w-28" />
        <View className="flex-1 gap-1.5">
          <Text numberOfLines={2} className="font-sans-semibold text-[15px] leading-[22px] text-foreground">{r.title}</Text>
          <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
            <Meta icon={Clock} text={`${r.total_minutes} min`} />
            {r.nutrition && <Meta icon={Flame} text={`${Math.round(r.nutrition.kcal)} kcal`} />}
            <Meta icon={SOURCE_ICON[r.source]} text={SOURCE_TEXT[r.source]} />
          </View>
          {unsafe && (
            <View className="flex-row items-center gap-1 self-start rounded-full bg-danger px-2.5 py-0.5">
              <TriangleAlert size={12} color="white" />
              <Text className="font-sans-medium text-xs text-white">Not for you: {r.problems.join("; ")}</Text>
            </View>
          )}
          {r.invalid.length > 0 && (
            <Text className="font-sans text-xs text-[#a65a00]">Needs a fix before nutrition can be shown.</Text>
          )}
          {r.diet_tags.length > 0 && (
            <View className="flex-row flex-wrap gap-1.5">{r.diet_tags.slice(0, 3).map((d) => <DietBadge key={d} diet={d} />)}</View>
          )}
        </View>
      </Pressable>
    </Link>
  )
}

function Meta({ icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <Icon icon={icon} tone="muted-foreground" size={14} />
      <Text className="font-sans text-xs text-muted-foreground">{text}</Text>
    </View>
  )
}
