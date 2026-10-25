import { Link } from "expo-router"
import { Clock, Flame, Refrigerator, TriangleAlert } from "lucide-react-native"
import { Pressable, Text, View } from "react-native"

import type { RecipeCard as Recipe } from "@pantrila/core/types"

import { DietBadge, RecipeArt } from "@/components/bits"
import { Icon } from "@/components/icon"

/** A corpus recipe in the Recipes list, as on the web: photo, time, energy, protein, a red
 * "Not for you" line for any rule it breaks, pantry use and up to three diets. */
export function RecipeCard({ recipe }: { recipe: Recipe }) {
  const unsafe = recipe.problems.length > 0
  return (
    <Link href={{ pathname: "/recipes/[id]", params: { id: recipe.id } }} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={recipe.title}
                 className={`rounded-[20px] border bg-surface p-3 ${unsafe ? "border-danger/50" : "border-border"}`}>
        <RecipeArt meal={recipe.meal_types[0]} cuisine={recipe.cuisine} photo={recipe.photo_url}
                   className="aspect-[4/3] w-full" />
        <View className="gap-2 px-1 pt-3 pb-1">
          <Text numberOfLines={2} className="font-sans-semibold text-[15px] leading-[22px] text-foreground">
            {recipe.title}
          </Text>
          <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
            <Meta icon={Clock} text={`${recipe.total_minutes} min`} />
            <Meta icon={Flame} text={`${Math.round(recipe.nutrition.kcal)} kcal`} />
            <Text className="font-sans text-xs text-muted-foreground">{Math.round(recipe.nutrition.protein_g)} g protein</Text>
          </View>
          {unsafe && (
            <View className="flex-row items-center gap-1 self-start rounded-full bg-danger px-2.5 py-0.5">
              <TriangleAlert size={12} color="white" />
              <Text className="font-sans-medium text-xs text-white">Not for you: {recipe.problems.join("; ")}</Text>
            </View>
          )}
          <View className="flex-row flex-wrap gap-1.5 pt-1">
            {recipe.pantry_foods.length > 0 && (
              <View className="h-6 flex-row items-center gap-1 rounded-full bg-primary-soft px-2.5">
                <Icon icon={Refrigerator} tone="primary-text" size={12} />
                <Text className="font-sans-medium text-xs text-primary-text">
                  Uses {recipe.pantry_foods.length} of your pantry items
                </Text>
              </View>
            )}
            {recipe.diet_tags.slice(0, 3).map((d) => <DietBadge key={d} diet={d} />)}
          </View>
        </View>
      </Pressable>
    </Link>
  )
}

function Meta({ icon, text }: { icon: typeof Clock; text: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <Icon icon={icon} tone="muted-foreground" size={14} />
      <Text className="font-sans text-xs text-muted-foreground">{text}</Text>
    </View>
  )
}
