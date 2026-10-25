import { router, Stack, useLocalSearchParams } from "expo-router"
import { Camera, Check, ChevronDown, Clock, ExternalLink, ImageOff, MessageCircle, Pencil, Trash2, Users } from "lucide-react-native"
import { useState } from "react"
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useSWRConfig } from "swr"

import { niceFractions } from "@pantrila/core/amounts"
import { postCredit, siteOf, SOURCE_TEXT } from "@pantrila/core/cookbook"
import { label } from "@pantrila/core/format"
import { groupLines, groupSteps } from "@pantrila/core/sections"
import { leftText } from "@pantrila/core/subscription"
import { hasTemp, showTemps } from "@pantrila/core/temperature"
import type { CookbookDetail } from "@pantrila/core/types"

import { AllergenBadge, Button, DietBadge, ErrorState, Panel, PanelTitle, ProblemAlert, RecipeArt } from "@/components/bits"
import { CookbookForm, ESTIMATED_NOTE, NUTRITION_SOURCE } from "@/components/cookbook-form"
import { Icon } from "@/components/icon"
import { MacroRing } from "@/components/macro-ring"
import { MeasuredLine } from "@/components/measured-line"
import { SOURCE_ICON } from "@/components/recipe-source"
import { StartCooking } from "@/components/start-cooking"
import { TemperatureToggle } from "@/components/temperature-toggle"
import { send } from "@/lib/api"
import { useCookbookRecipe, useMe, useProfile } from "@/lib/hooks"
import { makePhoto, usePhotoPending } from "@/lib/photo-jobs"
import { useTempUnit } from "@/lib/temperature"
import { toast } from "@/lib/toast"

const confirm = (title: string, action: string) => new Promise<boolean>((resolve) => {
  Alert.alert(title, undefined, [
    { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
    { text: action, style: "destructive", onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) })
})

/** One of the person's own recipes: photo (made in the background after saving), credit to the
 * creator or site, the rules it breaks, allergens, grouped ingredients, nutrition, the method
 * under its headings, notes, edit and delete. `?chat=` (saved from an assistant chat) leads
 * back to that thread. */
export default function MyRecipe() {
  const { id, chat } = useLocalSearchParams<{ id: string; chat?: string }>()
  const { mutate } = useSWRConfig()
  const { data: r, error, isLoading, mutate: refresh } = useCookbookRecipe(id ?? null)
  const { data: profile } = useProfile()
  const { data: me, mutate: refreshMe } = useMe()
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [unit] = useTempUnit()
  const making = usePhotoPending(Number(id))

  if (error) {
    return (
      <View className="flex-1 bg-background p-4">
        <ErrorState message={error.status === 404 ? "No such recipe in your cookbook." : error.message}
                    onRetry={error.status === 404 ? undefined : () => refresh()} />
      </View>
    )
  }
  if (isLoading || !r) return <ActivityIndicator className="flex-1 bg-background" />

  if (editing) {
    return (
      <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === "ios" ? "padding" : undefined}
                            keyboardVerticalOffset={100}>
        <Stack.Screen options={{ title: `Edit ${r.title}` }} />
        <ScrollView contentContainerClassName="gap-5 px-4 pt-2 pb-12" keyboardShouldPersistTaps="handled">
          <CookbookForm initial={r.recipe} recipeId={r.id} onCancel={() => setEditing(false)}
                        onSaved={(saved) => {
                          refresh(saved, { revalidate: false })
                          mutate("/me/recipes")
                          setEditing(false)
                        }} />
        </ScrollView>
      </KeyboardAvoidingView>
    )
  }

  async function reload() {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  async function remove() {
    if (!r || !(await confirm(`Delete ${r.title} from your recipes?`, "Delete"))) return
    try {
      await send(`/me/recipes/${r.id}`, "DELETE")
      toast.success(`Deleted ${r.title}`)
      mutate("/me/recipes")
      if (router.canGoBack()) router.back()
      else router.replace("/recipes/mine")  // opened from a link: no screen to go back to
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete.")
    }
  }

  async function photo(action: "make" | "remove") {
    if (!r) return
    if (action === "remove" && !(await confirm("Remove this photo?", "Remove"))) return
    if (action === "remove") setRemoving(true)
    try {
      const saved = action === "make" ? await makePhoto(r.id) : await send<CookbookDetail>(`/me/recipes/${r.id}/photo`, "DELETE")
      refresh(saved, { revalidate: false })
      mutate("/me/recipes")
      refreshMe()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the photo.")
    } finally {
      setRemoving(false)
    }
  }

  const photos = me?.limits.photos
  const photosStopped = photos?.left === 0
  const allergies = new Set(profile?.allergies ?? [])
  const have = r.ingredients.filter((i) => i.in_pantry).length
  const cook = { pathname: "/recipes/mine/[id]/cook", params: { id: String(r.id) } } as const
  const notes = (r.recipe.notes ?? "").split("\n").filter((l) => l.trim())
  const thread = chat && /^\d+$/.test(chat) ? chat : null

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-4 pt-2 pb-12"
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}>
      <Stack.Screen options={{ title: r.title }} />
      <View className="flex-row flex-wrap gap-2">
        {thread && (
          <Button variant="outline" size="sm" icon={MessageCircle} text="Back to the chat"
                  onPress={() => router.navigate({ pathname: "/assistant", params: { thread } })} />
        )}
        <Button variant="outline" size="sm" icon={Pencil} text="Edit" onPress={() => setEditing(true)} />
        <Button variant="outline" size="sm" icon={Trash2} text="Delete" onPress={remove} />
      </View>

      <ProblemAlert title="This recipe does not suit you" items={r.problems} />
      <ProblemAlert title="This recipe needs a fix (edit it)" items={r.invalid} />

      <Panel className="gap-3">
        <View>
          <RecipeArt meal={r.meal_types[0]} cuisine={r.cuisine || undefined} size="lg" photo={r.photo_url}
                     className="aspect-[4/3] w-full" />
          {making && (
            <View accessibilityLiveRegion="polite"
                  className="absolute inset-0 flex-row items-center justify-center gap-2 rounded-2xl bg-surface/80">
              <ActivityIndicator size="small" />
              <Text className="font-sans-semibold text-sm text-foreground">Making the photo…</Text>
            </View>
          )}
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" icon={Camera} busy={making} disabled={removing || photosStopped}
                  text={making ? "Making a photo…" : r.photo_url ? "New photo" : "Generate photo"}
                  onPress={() => photo("make")} />
          {r.photo_url && (
            <Button variant="ghost" size="sm" icon={ImageOff} text="Remove" disabled={making || removing}
                    onPress={() => photo("remove")} />
          )}
        </View>
        <Text className="font-sans text-xs text-muted-foreground">
          An AI photo made from this recipe&apos;s own ingredients, about 15 seconds.
          {photos && (photos.limit ? ` ${leftText("photo", photos)}.` : " Comes with Pantrila Pro.")}
        </Text>

        <Text accessibilityRole="header" className="font-sans-bold text-2xl text-foreground">{r.title}</Text>
        {r.summary !== "" && <Text className="font-sans text-base text-muted-foreground">{r.summary}</Text>}
        <View className="flex-row flex-wrap gap-4">
          <Fact icon={Clock} text={`${r.total_minutes} min`} />
          <Fact icon={Users} text={`Serves ${r.servings}`} />
          <Text className="font-sans text-[13px] text-muted-foreground">{r.meal_types.map(label).join(", ")}</Text>
        </View>
        <Credit r={r} />
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
        <Text className="mb-2 font-sans text-xs text-muted-foreground">
          You have {have} of {r.ingredients.length} in your pantry.
        </Text>
        {groupLines(r.ingredients).map((g, n) => (
          <View key={n}>
            {g.title !== "" && (
              <Text accessibilityRole="header"
                    className="mt-4 mb-1 font-sans-semibold text-[13px] uppercase tracking-wide text-muted-foreground">
                {g.title}
              </Text>
            )}
            {g.items.map(({ item: ing, index: i }) => (
              <View key={i} className="border-b border-border py-2.5">
                <View className="flex-row items-center gap-3">
                  <View accessibilityLabel={ing.in_pantry ? "In your pantry" : "Not in your pantry"}
                        className={`size-5 items-center justify-center rounded-full border ${ing.in_pantry ? "border-primary bg-primary" : "border-border"}`}>
                    {ing.in_pantry && <Icon icon={Check} tone="primary-foreground" size={12} strokeWidth={3} />}
                  </View>
                  <MeasuredLine line={ing} />
                </View>
                {ing.amount_estimate && (
                  <Text className="mt-1 pl-8 font-sans text-xs text-muted-foreground">
                    Estimated amount: {ing.amount_estimate}
                  </Text>
                )}
              </View>
            ))}
          </View>
        ))}
      </Panel>

      <Panel>
        <PanelTitle>Per serving</PanelTitle>
        {r.nutrition
          ? <MacroRing nutrition={r.nutrition} />
          : <Text className="font-sans text-base text-muted-foreground">Fix the recipe to see nutrition.</Text>}
        <Text className="mt-4 font-sans text-xs text-muted-foreground">
          {r.estimated ? ESTIMATED_NOTE : NUTRITION_SOURCE} Macros means protein, carbs and fat.
        </Text>
      </Panel>

      <Panel>
        <PanelTitle action={hasTemp(r.steps) ? <TemperatureToggle /> : undefined}>Method</PanelTitle>
        {groupSteps(r.steps, r.step_sections).map((g, n) => (
          <View key={n} className={`gap-4 ${n > 0 ? "mt-6" : ""}`}>
            {g.title !== "" && (
              <Text accessibilityRole="header" className="font-sans-semibold text-base text-foreground">{g.title}</Text>
            )}
            {g.items.map(({ item: step, index: i }) => (
              <View key={i} className="flex-row gap-4">
                <View className="size-8 items-center justify-center rounded-full bg-primary-soft">
                  <Text className="font-sans-semibold text-base text-primary-text">{i + 1}</Text>
                </View>
                <Text className="flex-1 pt-1 font-sans text-base text-foreground">{showTemps(niceFractions(step), unit)}</Text>
              </View>
            ))}
          </View>
        ))}
      </Panel>

      <StartCooking href={cook} />

      {notes.length > 0 && (
        <Panel>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: notesOpen }} onPress={() => setNotesOpen(!notesOpen)}
                     className="min-h-9 flex-row items-center justify-between">
            <Text accessibilityRole="header" className="font-sans-semibold text-lg text-foreground">Notes</Text>
            <View style={{ transform: [{ rotate: notesOpen ? "180deg" : "0deg" }] }}>
              <Icon icon={ChevronDown} size={20} />
            </View>
          </Pressable>
          {notesOpen && (
            <View className="mt-3 gap-3">
              {notes.map((line, i) => (
                <Text key={i} className="font-sans text-base text-foreground">{showTemps(niceFractions(line), unit)}</Text>
              ))}
            </View>
          )}
        </Panel>
      )}
    </ScrollView>
  )
}

/** Where the recipe is from: the post and its creator (and the site it linked), or the page. */
function Credit({ r }: { r: CookbookDetail }) {
  const link = (url: string, text: string) => (
    <Pressable accessibilityRole="link" accessibilityLabel={`${text}, opens in the browser`}
               onPress={() => Linking.openURL(url)} className="flex-row items-center gap-1">
      <Text className="font-sans-medium text-[13px] text-primary-text">{text}</Text>
      <Icon icon={ExternalLink} tone="primary-text" size={14} />
    </Pressable>
  )
  if (r.source === "post") {
    const credit = postCredit(r)
    return (
      <View className="gap-1">
        <View className="flex-row flex-wrap items-center gap-1.5">
          <Icon icon={SOURCE_ICON.post} tone="muted-foreground" size={16} />
          {r.source_url ? link(r.source_url, credit) : <Text className="font-sans text-[13px] text-muted-foreground">{credit}</Text>}
        </View>
        {r.recipe_url && (
          <View className="flex-row flex-wrap items-center gap-1.5 pl-[22px]">
            <Text className="font-sans text-[13px] text-muted-foreground">Recipe from</Text>
            {link(r.recipe_url, siteOf(r.recipe_url))}
          </View>
        )}
      </View>
    )
  }
  return (
    <View className="flex-row flex-wrap items-center gap-1.5">
      <Icon icon={SOURCE_ICON[r.source]} tone="muted-foreground" size={16} />
      <Text className="font-sans text-[13px] text-muted-foreground">{SOURCE_TEXT[r.source]}</Text>
      {r.source_url && link(r.source_url, siteOf(r.source_url))}
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
