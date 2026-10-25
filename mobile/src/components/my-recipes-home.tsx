import { Link } from "expo-router"
import { ArrowRight, BookOpen, Link2, Share2 } from "lucide-react-native"
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native"

import { Panel, RecipeArt } from "@/components/bits"
import { Icon } from "@/components/icon"
import { useCookbook } from "@/lib/hooks"

const SHOWN = 4

/** Home card: the person's latest cookbook recipes and the two imports worth pushing. */
export function MyRecipesHome() {
  const { data: list, isLoading } = useCookbook()
  // A reply that is not a list must not take Home down with it.
  const data = Array.isArray(list) ? list : undefined
  const recent = data?.slice(0, SHOWN) ?? []
  const empty = !isLoading && recent.length === 0

  return (
    <Panel className={empty ? "bg-yellow-soft" : ""}>
      <View className="mb-3 flex-row items-center gap-2">
        <Text accessibilityRole="header" className="font-sans-semibold text-lg text-foreground">My recipes</Text>
        {data && data.length > 0 && (
          <Text className="font-sans text-sm text-muted-foreground">{data.length} saved</Text>
        )}
        {!empty && !isLoading && (
          <Link href="/recipes/mine" asChild>
            <Pressable accessibilityRole="link" className="ml-auto flex-row items-center gap-1 py-1">
              <Text className="font-sans-medium text-sm text-foreground">See all</Text>
              <Icon icon={ArrowRight} size={16} />
            </Pressable>
          </Link>
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator className="my-6" />
      ) : empty ? (
        <View className="mb-4 flex-row items-start gap-3">
          <View className="size-10 items-center justify-center rounded-full bg-surface">
            <BookOpen size={20} color="#b7860b" strokeWidth={1.75} />
          </View>
          <Text className="flex-1 font-sans text-base text-muted-foreground">
            Saw a recipe on TikTok, Instagram or Facebook, or on any recipe site? Paste the link: Pantrila reads the
            ingredients and method, credits the creator and checks it against your allergies and diet.
          </Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-5 mb-4"
                    contentContainerClassName="gap-3 px-5">
          {recent.map((r) => (
            <Link key={r.id} href={{ pathname: "/recipes/mine/[id]", params: { id: String(r.id) } }} asChild>
              <Pressable accessibilityRole="link" className="w-36">
                <RecipeArt meal={r.meal_types[0]} cuisine={r.cuisine || undefined} photo={r.photo_url}
                           className="aspect-[4/3] w-full" />
                <Text numberOfLines={2} className="mt-2 font-sans-semibold text-sm text-foreground">{r.title}</Text>
                <Text className="font-sans text-xs text-muted-foreground">{r.total_minutes} min</Text>
              </Pressable>
            </Link>
          ))}
        </ScrollView>
      )}

      {!isLoading && (
        <View className="gap-2">
          <Link href={{ pathname: "/recipes/mine/new", params: { method: "post" } }} asChild>
            <Pressable accessibilityRole="button" className="h-12 flex-row items-center justify-center gap-2 rounded-xl bg-primary">
              <Icon icon={Share2} tone="primary-foreground" size={18} />
              <Text className="font-sans-semibold text-base text-primary-foreground">Import from social media</Text>
            </Pressable>
          </Link>
          <Link href={{ pathname: "/recipes/mine/new", params: { method: "link" } }} asChild>
            <Pressable accessibilityRole="button"
                       className="h-12 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-surface">
              <Icon icon={Link2} size={18} />
              <Text className="font-sans-semibold text-base text-foreground">From a recipe link</Text>
            </Pressable>
          </Link>
        </View>
      )}
    </Panel>
  )
}
