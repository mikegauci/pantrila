import { useLocalSearchParams } from "expo-router"
import { ActivityIndicator, View } from "react-native"

import { ErrorState } from "@/components/bits"
import { CookingScreen } from "@/components/cooking-mode"
import { useRecipe } from "@/lib/hooks"

/** Cooking mode for a Pantrila recipe; `?servings=` and `&later=` come from the plan. */
export default function Cook() {
  const { id, servings, later } = useLocalSearchParams<{ id: string; servings?: string; later?: string }>()
  const { data: r, error, mutate } = useRecipe(id ?? null)

  if (error) {
    return (
      <View className="flex-1 bg-background p-4 pt-16">
        <ErrorState message={error.status === 404 ? "No such recipe." : error.message}
                    onRetry={error.status === 404 ? undefined : () => mutate()} />
      </View>
    )
  }
  if (!r) return <ActivityIndicator className="flex-1 bg-background" />
  return (
    <CookingScreen servings={Number(servings) || undefined} later={Number(later) || 0} recipe={{
      key: `corpus:${r.id}`, title: r.title, servings: r.servings, ingredients: r.ingredients,
      steps: r.steps, source: { recipe_id: r.id }, backHref: `/recipes/${r.id}`,
    }} />
  )
}
