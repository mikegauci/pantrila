import { router } from "expo-router"
import { BookOpen, Refrigerator, Search, Shuffle } from "lucide-react-native"
import { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native"
import { useSWRConfig } from "swr"

import type { MealOption, MealOptions, MealType, Plan, PlanMeal } from "@pantrila/core/types"

import { EmptyState, ProblemAlert, RecipeArt } from "@/components/bits"
import { Icon } from "@/components/icon"
import { ApiError, send } from "@/lib/api"
import { useApi, useSavePlan } from "@/lib/hooks"
import { toast } from "@/lib/toast"

type Source = "corpus" | "mine"

const PAGE = 6
const MAX_SHOWN = 24 // the API's largest page; past it, searching narrows the list
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n))}`

function describe(current: PlanMeal, day: number, meal: MealType) {
  const slot = `Day ${day} ${meal}`
  if (current.kind === "skipped") return `${slot} is skipped. Pick a recipe for it. `
  if (current.kind === "eating_out") return `${slot} is eating out. Pick a recipe to cook instead. `
  return current.recipe ? `Replacing ${current.recipe.title}. ` : ""
}

/** Pick another recipe for one meal of the plan: Pantrila's, best fit first, or one of the
 * person's own. The server lists only recipes that pass the person's rules and checks the
 * chosen one again before saving it. */
export function SwapMeal({ day, meal, onDone }: { day: number; meal: PlanMeal; onDone: () => void }) {
  const { mutate } = useSWRConfig()
  const save = useSavePlan()
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; problems: string[] } | null>(null)
  const [source, setSource] = useState<Source>("corpus")
  const [typed, setTyped] = useState("")
  const [query, setQuery] = useState("")
  const [quick, setQuick] = useState(false)
  const [pantry, setPantry] = useState(false)
  // "Show more" grows the page for the current search only; a new search starts at one page.
  const [more, setMore] = useState({ key: "", limit: PAGE })

  useEffect(() => {
    const t = setTimeout(() => setQuery(typed.trim()), 300)
    return () => clearTimeout(t)
  }, [typed])
  const searchKey = JSON.stringify([source, query, quick, pantry])
  const limit = more.key === searchKey ? more.limit : PAGE

  const params = new URLSearchParams({ source, limit: String(limit) })
  if (query) params.set("q", query)
  if (quick) params.set("quick", "true")
  if (pantry) params.set("pantry", "true")
  const { data, error: loadError, isLoading } = useApi<MealOptions>(
    `/plans/latest/meals/${day}/${meal.meal_type}/options?${params}`,
    { revalidateOnFocus: false, keepPreviousData: true },
  )

  async function pick(o: MealOption) {
    if (!data) return
    setSaving(o.recipe.id)
    setError(null)
    try {
      const plan = await send<Plan>(`/plans/latest/meals/${day}/${meal.meal_type}`, "PUT", {
        plan_id: data.plan_id, recipe_id: o.recipe.id,
      })
      save(plan)
      toast.success(`Day ${day} ${meal.meal_type} is now ${o.recipe.title}`)
      onDone()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(e.message)
        mutate("/plans/latest")
        onDone()
      } else {
        setError({
          message: e instanceof ApiError ? e.message : "Could not reach Pantrila. Try again.",
          problems: e instanceof ApiError ? e.problems : [],
        })
      }
    } finally {
      setSaving(null)
    }
  }

  const filtered = Boolean(query || quick || pantry)
  const options = data?.options ?? []
  return (
    <>
      <Text className="font-sans text-sm text-muted-foreground">
        {describe(meal, day, meal.meal_type)}Every recipe here passes your allergies, diets and time limit.
      </Text>
      <View accessibilityRole="tablist" className="flex-row gap-1 rounded-full bg-surface-muted p-1">
        {(["corpus", "mine"] as const).map((s) => (
          <Pressable key={s} accessibilityRole="tab" accessibilityState={{ selected: source === s }} onPress={() => setSource(s)}
                     className={`h-8 flex-1 items-center justify-center rounded-full ${source === s ? "bg-surface" : ""}`}>
            <Text className={`font-sans-medium text-[13px] ${source === s ? "text-foreground" : "text-muted-foreground"}`}>
              {s === "corpus" ? "Pantrila's recipes" : "My recipes"}
            </Text>
          </Pressable>
        ))}
      </View>
      <View className="h-11 flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3">
        <Icon icon={Search} tone="muted-foreground" size={16} />
        <TextInput value={typed} onChangeText={setTyped} maxLength={80} accessibilityLabel="Search recipes"
                   placeholder="Search by name, cuisine or food" placeholderTextColorClassName="accent-muted-foreground"
                   className="flex-1 font-sans text-base text-foreground" />
      </View>
      <View className="flex-row gap-2">
        <Chip on={quick} onPress={() => setQuick(!quick)} text="30 min or less" />
        <Chip on={pantry} onPress={() => setPantry(!pantry)} text="Uses my pantry" />
      </View>

      {error && (error.problems.length
        ? <ProblemAlert title={error.message} items={error.problems} />
        : <Text accessibilityRole="alert" className="font-sans text-sm text-danger">{error.message}</Text>)}

      {isLoading && !data ? (
        <ActivityIndicator className="my-8" />
      ) : loadError ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-danger">{loadError.message}</Text>
      ) : data && options.length === 0 ? (
        source === "mine" && !filtered ? (
          <EmptyState icon={BookOpen} title="None of your recipes fit"
                      action={<Text accessibilityRole="link" onPress={() => { onDone(); router.push("/recipes/mine/new") }}
                                    className="font-sans-medium text-sm text-foreground underline">Add a recipe</Text>}>
            Recipes you save show here when they pass your allergies, diets and time limit.
          </EmptyState>
        ) : (
          <EmptyState icon={Shuffle} title={filtered ? "No recipes match" : "No other recipes fit"}>
            {filtered
              ? "Try other words, or turn off a filter."
              : "Nothing else passes your rules for this meal. Loosen a rule in your profile, or plan a new week."}
          </EmptyState>
        )
      ) : (
        <>
          {options.map((o) => (
            <Option key={o.recipe.id} o={o} meal={meal.meal_type} busy={saving !== null}
                    saving={saving === o.recipe.id} onPick={() => pick(o)} />
          ))}
          {data && (
            <View className="items-center gap-2 pb-2">
              <Text className="font-sans text-xs text-muted-foreground">Showing {options.length} of {data.total}</Text>
              {options.length < data.total && (limit < MAX_SHOWN ? (
                <Pressable accessibilityRole="button" disabled={isLoading}
                           onPress={() => setMore({ key: searchKey, limit: Math.min(limit + PAGE, MAX_SHOWN) })}
                           className="h-9 flex-row items-center gap-2 rounded-lg border border-border bg-surface px-4">
                  {isLoading && <ActivityIndicator size="small" />}
                  <Text className="font-sans-medium text-sm text-foreground">Show more</Text>
                </Pressable>
              ) : (
                <Text className="font-sans text-xs text-muted-foreground">Search to find the rest.</Text>
              ))}
            </View>
          )}
        </>
      )}
    </>
  )
}

function Chip({ on, onPress, text }: { on: boolean; onPress: () => void; text: string }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={text} onPress={onPress}
               className={`h-8 justify-center rounded-full border px-3 ${on ? "border-primary bg-primary-soft" : "border-border bg-surface"}`}>
      <Text className={`font-sans-medium text-[13px] ${on ? "text-primary-text" : "text-muted-foreground"}`}>{text}</Text>
    </Pressable>
  )
}

function Option({ o, meal, busy, saving, onPick }: {
  o: MealOption; meal: MealType; busy: boolean; saving: boolean; onPick: () => void
}) {
  const n = o.recipe.nutrition
  return (
    <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-surface p-2">
      <RecipeArt meal={meal} size="sm" photo={o.recipe.photo_url} className="size-14 rounded-xl" />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={2} className="font-sans-medium text-base text-foreground">{o.recipe.title}</Text>
        <Text className="font-sans text-xs text-muted-foreground">
          {Math.round(n.kcal * o.portions)} kcal · {Math.round(n.protein_g * o.portions)} g protein · ×{o.portions}
        </Text>
        <Text className="font-sans text-xs text-muted-foreground">
          Day total {Math.round(o.day_nutrition.kcal)} kcal ({signed(o.kcal_change)}) · protein {signed(o.protein_change)} g
        </Text>
        {o.recipe.pantry_foods.length > 0 && (
          <View className="mt-1 flex-row items-center gap-1">
            <Icon icon={Refrigerator} tone="primary-text" size={12} />
            <Text className="font-sans-medium text-xs text-primary-text">{o.recipe.pantry_foods.length} from your pantry</Text>
          </View>
        )}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Use ${o.recipe.title}`} disabled={busy} onPress={onPick}
                 className={`h-9 min-w-[76px] items-center justify-center rounded-lg border border-border bg-surface px-3 ${busy ? "opacity-60" : ""}`}>
        {saving ? <ActivityIndicator size="small" /> : <Text className="font-sans-medium text-sm text-foreground">Use this</Text>}
      </Pressable>
    </View>
  )
}
