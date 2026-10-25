import { ChevronDown, Plus, Sparkles, Trash2, TriangleAlert, X } from "lucide-react-native"
import { useEffect, useMemo, useRef, useState } from "react"
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native"
import { useSWRConfig } from "swr"

import { convertAmount } from "@pantrila/core/amounts"
import { ALLERGENS, matchFood, PLATFORM, UNITS } from "@pantrila/core/cookbook"
import { label, MEAL_ORDER } from "@pantrila/core/format"
import { groupLines, stepsToText, textToSteps } from "@pantrila/core/sections"
import type {
  Allergen, CookbookDetail, CookbookPreview, CookbookRecipeIn, EstimateView, Food, FoodEstimate, RecipeLine,
  SourcePlatform, Unit,
} from "@pantrila/core/types"

import { AllergenBadge, Button, DietBadge, Panel, PanelTitle, ProblemAlert } from "@/components/bits"
import { Icon } from "@/components/icon"
import { MacroRing } from "@/components/macro-ring"
import { OptionSheet } from "@/components/option-sheet"
import { ApiError, send } from "@/lib/api"
import { useFoods, useMe, useProfile } from "@/lib/hooks"
import { saveNewRecipe } from "@/lib/photo-jobs"
import { toast } from "@/lib/toast"

export const NUTRITION_SOURCE =
  "Nutrition calculated from ingredient weights using USDA FoodData Central and, for some foods, the Ciqual French " +
  "food composition table. Values are estimates."
export const ESTIMATED_NOTE =
  "Some amounts or foods are estimated, so nutrition is approximate. Estimated amounts are noted beside the " +
  "ingredients. Check product labels for allergens."

const INPUT = "rounded-xl border border-border bg-surface px-3 font-sans text-base text-foreground"

function Field({ name, hint, className = "", ...input }: TextInputProps & { name: string; hint?: string }) {
  return (
    <View className={`gap-1.5 ${className}`}>
      <Text className="font-sans-medium text-sm text-foreground">{name}</Text>
      {hint && <Text className="font-sans text-xs text-muted-foreground">{hint}</Text>}
      <TextInput accessibilityLabel={name} placeholderTextColorClassName="accent-muted-foreground"
                 className={`${INPUT} ${input.multiline ? "min-h-24 py-2.5" : "h-11"}`}
                 textAlignVertical={input.multiline ? "top" : undefined} {...input} />
    </View>
  )
}

/** A number box that keeps what is typed ("1." on the way to "1.5") and reports the number. */
function NumberInput({ value, onChange, label: name, className = "" }: {
  value: number; onChange: (n: number) => void; label: string; className?: string
}) {
  const shown = Number.isFinite(value) ? String(value) : ""
  const [text, setText] = useState(shown)
  if (Number(text.replace(",", ".")) !== value && !(text === "" && !Number.isFinite(value))) {
    setText(shown)  // changed from outside (a new unit converts the amount)
  }
  return (
    <TextInput accessibilityLabel={name} keyboardType="decimal-pad" value={text}
               onChangeText={(t) => {
                 setText(t)
                 onChange(t.trim() === "" ? Number.NaN : Number(t.replace(",", ".")))
               }}
               className={`h-11 ${INPUT} ${className}`} />
  )
}

/** A field that opens an `OptionSheet`. */
function SelectButton({ text, label: name, onPress, className = "" }: {
  text: string; label: string; onPress: () => void; className?: string
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={onPress}
               className={`h-11 flex-row items-center justify-between gap-1 rounded-xl border border-border bg-surface px-3 ${className}`}>
      <Text numberOfLines={1} className="flex-1 font-sans text-base text-foreground">{text}</Text>
      <Icon icon={ChevronDown} tone="muted-foreground" size={16} />
    </Pressable>
  )
}

/** An AI estimate, with allergens the person can correct from the label of what they buy. */
function EstimateNote({ estimate: e, n, onChange }: { estimate: FoodEstimate; n: number; onChange: (e: FoodEstimate) => void }) {
  const [adding, setAdding] = useState(false)
  const missing = ALLERGENS.filter((a) => !e.allergens.includes(a))
  return (
    <View className="gap-1.5">
      <Text className="font-sans text-xs text-muted-foreground">
        Estimated: {e.description}: about {Math.round(e.kcal)} kcal and {Math.round(e.protein_g)} g protein per 100 g.
      </Text>
      <View className="flex-row flex-wrap items-center gap-1.5">
        <Text className="font-sans-medium text-xs text-muted-foreground">Allergens:</Text>
        {e.allergens.length === 0 && <Text className="font-sans text-xs text-muted-foreground">none estimated</Text>}
        {e.allergens.map((a) => (
          <Pressable key={a} accessibilityRole="button" accessibilityLabel={`Remove ${label(a).toLowerCase()} from ingredient ${n}`}
                     onPress={() => onChange({ ...e, allergens: e.allergens.filter((x) => x !== a) })}
                     className="h-7 flex-row items-center gap-1 rounded-full bg-surface-muted px-2.5">
            <Text className="font-sans-medium text-xs text-foreground">{label(a)}</Text>
            <Icon icon={X} size={12} />
          </Pressable>
        ))}
        {missing.length > 0 && (
          <Pressable accessibilityRole="button" accessibilityLabel={`Add an allergen to ingredient ${n}`}
                     onPress={() => setAdding(true)} className="h-7 flex-row items-center gap-1 rounded-full border border-border px-2.5">
            <Icon icon={Plus} size={12} />
            <Text className="font-sans-medium text-xs text-foreground">Add allergen</Text>
          </Pressable>
        )}
      </View>
      <OptionSheet open={adding} title="Add an allergen" onClose={() => setAdding(false)}
                   options={missing.map((a) => ({ value: a, label: label(a) }))}
                   onPick={(a: Allergen) => onChange({ ...e, allergens: [...e.allergens, a] })} />
    </View>
  )
}

/** The table food a line is matched to: typed, with the closest table foods offered as chips. */
function FoodField({ line, keys, foods, onChange }: {
  line: RecipeLine; keys: Set<string>; foods: Food[]; onChange: (food: string | null) => void
}) {
  const [text, setText] = useState(line.food ? label(line.food).toLowerCase() : "")
  const [seen, setSeen] = useState(line.food)
  const [focused, setFocused] = useState(false)
  if (line.food !== seen) {  // set from outside (auto-match from the name)
    setSeen(line.food)
    setText(line.food ? label(line.food).toLowerCase() : "")
  }
  const typed = text.trim().toLowerCase()
  const offers = focused && typed.length >= 2 && !line.food
    ? foods.filter((f) => f.name.toLowerCase().includes(typed)).slice(0, 6)
    : []
  return (
    <View className="flex-1 gap-1.5">
      <TextInput accessibilityLabel={`Food for ${line.name || "this ingredient"}`} placeholder="Match a food"
                 placeholderTextColorClassName="accent-muted-foreground" value={text} autoCapitalize="none"
                 onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                 onChangeText={(t) => {
                   setText(t)
                   const food = matchFood(t, keys)
                   setSeen(food)
                   onChange(food)
                 }}
                 className={`h-11 ${INPUT} ${!line.food && !line.estimate ? "border-warning" : ""}`} />
      {offers.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5">
          {offers.map((f) => (
            <Pressable key={f.key} accessibilityRole="button" accessibilityLabel={`Use ${f.name}`}
                       onPress={() => { setText(f.name.toLowerCase()); setSeen(f.key); onChange(f.key) }}
                       className="h-8 justify-center rounded-full border border-border bg-surface-muted px-3">
              <Text className="font-sans-medium text-[13px] text-foreground">{f.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}

function LineRow({ line, n, keys, foods, byKey, onChange, onRemove }: {
  line: RecipeLine; n: number; keys: Set<string>; foods: Food[]; byKey: Map<string, Food>
  onChange: (l: RecipeLine) => void; onRemove: () => void
}) {
  const [picking, setPicking] = useState(false)
  // A new unit keeps the amount: 1 cup of rice becomes 185 g (an estimate stays one). A food
  // with no density or piece weight for that unit keeps the number for the person to fix.
  function changeUnit(unit: Unit) {
    const food = line.food ? byKey.get(line.food) : null
    const measure = food ?? (!line.food ? line.estimate : null)
    const quantity = convertAmount(line.quantity, line.unit, unit, measure?.grams_per_ml, measure?.grams_per_piece)
    onChange(quantity === null ? { ...line, unit, amount_estimate: null } : { ...line, unit, quantity })
  }
  return (
    <View className="gap-2 border-b border-border py-3">
      <View className="flex-row items-center gap-2">
        <TextInput accessibilityLabel={`Ingredient ${n}`} placeholder="e.g. red onion, sliced"
                   placeholderTextColorClassName="accent-muted-foreground" value={line.name}
                   onChangeText={(name) => onChange({ ...line, name })}
                   onBlur={() => {
                     if (!line.food && !line.estimate) {
                       const food = matchFood(line.name.replace(/,.*$/, ""), keys)
                       if (food) onChange({ ...line, food })
                     }
                   }}
                   className={`h-11 flex-1 ${INPUT}`} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ingredient ${n}`} onPress={onRemove}
                   hitSlop={6} className="size-11 items-center justify-center">
          <Icon icon={Trash2} tone="muted-foreground" size={18} />
        </Pressable>
      </View>
      <View className="flex-row items-start gap-2">
        <NumberInput label={`Amount for ingredient ${n}`} value={line.quantity} className="w-20"
                     onChange={(quantity) => onChange({ ...line, quantity, amount_estimate: null })} />
        <SelectButton label={`Unit for ingredient ${n}`} text={line.unit} className="w-24" onPress={() => setPicking(true)} />
        <FoodField line={line} keys={keys} foods={foods}
                   onChange={(food) => onChange({ ...line, food, estimate: food ? null : line.estimate })} />
      </View>
      <OptionSheet open={picking} title={`Unit for ${line.name || `ingredient ${n}`}`} value={line.unit}
                   options={UNITS.map((u) => ({ value: u, label: u }))} onPick={changeUnit} onClose={() => setPicking(false)} />
      {line.amount_estimate && (
        <Text className="font-sans text-xs text-muted-foreground">Estimated amount: {line.amount_estimate}</Text>
      )}
      {!line.food && line.estimate && (
        <EstimateNote estimate={line.estimate} n={n} onChange={(estimate) => onChange({ ...line, estimate })} />
      )}
      {!line.food && !line.estimate && (
        <View className="flex-row items-center gap-1.5">
          <TriangleAlert size={14} color="#a65a00" />
          <Text className="flex-1 font-sans text-xs text-[#a65a00]">
            Not matched. Pick a food from the list; it will be estimated if left.
          </Text>
        </View>
      )}
    </View>
  )
}

/** Nutrition, diets, allergens and the person's rules for the recipe as it stands, checked by the
 * server half a second after the last change. */
function Preview({ recipe }: { recipe: CookbookRecipeIn }) {
  const [checked, setChecked] = useState<{ key: string; preview: CookbookPreview } | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const { data: profile } = useProfile()
  const body = JSON.stringify(recipe)
  const key = `${body}:${JSON.stringify(profile)}`
  const preview = checked?.key === key ? checked.preview : null

  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      try {
        const p = await send<CookbookPreview>("/me/recipes/preview", "POST", JSON.parse(body))
        if (live) { setChecked({ key, preview: p }); setProblems([]) }
      } catch (e) {
        if (live && e instanceof ApiError) setProblems(e.problems.length ? e.problems : [e.message])
      }
    }, 500)
    return () => { live = false; clearTimeout(t) }
  }, [body, key])

  const allergies = new Set(profile?.allergies ?? [])
  return (
    <Panel className="gap-4">
      <Text accessibilityRole="header" className="font-sans-semibold text-lg text-foreground">Per serving</Text>
      {problems.length > 0 && (
        <View accessibilityRole="alert" className="rounded-2xl bg-orange-soft p-3">
          <Text className="font-sans-semibold text-[13px] text-foreground">To fix before saving</Text>
          {problems.map((p) => <Text key={p} className="mt-1 font-sans text-[13px] text-foreground">• {p}</Text>)}
        </View>
      )}
      {preview && (
        <>
          <ProblemAlert title="This recipe does not suit you" items={preview.problems} />
          <MacroRing nutrition={preview.nutrition} />
          {preview.diet_tags.length > 0 && (
            <View className="flex-row flex-wrap gap-1.5">{preview.diet_tags.map((d) => <DietBadge key={d} diet={d} />)}</View>
          )}
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Text className="font-sans-medium text-xs text-muted-foreground">Allergens:</Text>
            {preview.allergens.length
              ? preview.allergens.map((a) => <AllergenBadge key={a} allergen={a} danger={allergies.has(a)} />)
              : <Text className="font-sans text-xs text-foreground">none of the 14 EU allergens</Text>}
          </View>
          <Text className="font-sans text-xs text-muted-foreground">
            {preview.estimated ? ESTIMATED_NOTE : NUTRITION_SOURCE}
          </Text>
        </>
      )}
    </Panel>
  )
}

/** Who the recipe is from: the post, its creator and the recipe site it linked to. */
function CreditFields({ r, onChange }: { r: CookbookRecipeIn; onChange: (r: CookbookRecipeIn) => void }) {
  const [picking, setPicking] = useState(false)
  const text = (v: string) => v.trim() || null
  const platforms: { value: SourcePlatform | ""; label: string }[] = [
    { value: "", label: "Not set" },
    ...(Object.keys(PLATFORM) as SourcePlatform[]).map((p) => ({ value: p, label: PLATFORM[p] })),
  ]
  return (
    <Panel className="gap-4">
      <Text accessibilityRole="header" className="font-sans-semibold text-lg text-foreground">Credit</Text>
      <Field name="Creator" value={r.source_author ?? ""} maxLength={31} autoCapitalize="none" autoCorrect={false}
             placeholder="@handle" onChangeText={(v) => onChange({ ...r, source_author: text(v.replace(/^@/, "")) })} />
      <View className="gap-1.5">
        <Text className="font-sans-medium text-sm text-foreground">Posted on</Text>
        <SelectButton label="Posted on" text={r.source_platform ? PLATFORM[r.source_platform] : "Not set"}
                      onPress={() => setPicking(true)} />
      </View>
      <OptionSheet open={picking} title="Posted on" value={r.source_platform ?? ""} options={platforms}
                   onClose={() => setPicking(false)}
                   onPick={(p) => onChange({ ...r, source_platform: (p || null) as SourcePlatform | null })} />
      <Field name="Post link" value={r.source_url ?? ""} maxLength={2000} keyboardType="url" autoCapitalize="none"
             autoCorrect={false} placeholder="https://" onChangeText={(v) => onChange({ ...r, source_url: text(v) })} />
      <Field name="Recipe site (if the post linked one)" value={r.recipe_url ?? ""} maxLength={2000} keyboardType="url"
             autoCapitalize="none" autoCorrect={false} placeholder="https://"
             onChangeText={(v) => onChange({ ...r, recipe_url: text(v) })} />
    </Panel>
  )
}

/** The review and edit form for one of the person's recipes (the web's `cookbook-form.tsx`):
 * about, ingredients matched to table foods (in groups), credit, method with `## Heading`
 * lines, notes and a live check of nutrition and the person's rules. Unmatched foods are
 * estimated by AI on their own, once per name. */
export function CookbookForm({ initial, recipeId, onSaved, onCancel }: {
  initial: CookbookRecipeIn
  recipeId?: number
  onSaved: (saved: CookbookDetail) => void
  onCancel?: () => void
}) {
  const { mutate } = useSWRConfig()
  const { data: foodList } = useFoods()
  const { data: me } = useMe()
  const foods = useMemo(() => foodList ?? [], [foodList])
  const keys = useMemo(() => new Set(foods.map((f) => f.key)), [foods])
  const byKey = useMemo(() => new Map(foods.map((f) => [f.key, f])), [foods])
  const [r, setR] = useState<CookbookRecipeIn>(initial)
  const [stepsText, setStepsText] = useState(stepsToText(initial.steps, initial.step_sections))
  const [saving, setSaving] = useState(false)
  const [estimating, setEstimating] = useState(false)
  /** Names already sent for estimating, so a failed one is not retried in a loop. */
  const tried = useRef(new Set<string>())

  const recipe: CookbookRecipeIn = { ...r, ...textToSteps(stepsText) }
  const unmatched = r.ingredients.filter((l) => !l.food && !l.estimate && l.name.trim())
  const setLine = (i: number, l: RecipeLine) => setR((cur) => ({ ...cur, ingredients: cur.ingredients.map((x, j) => (j === i ? l : x)) }))
  /** Rename (or, with an empty name, remove) the group whose first line is `first`. */
  const renameGroup = (first: number, name: string) => {
    const old = r.ingredients[first].section ?? ""
    let end = first
    while (end < r.ingredients.length && (r.ingredients[end].section ?? "") === old) end += 1
    setR({ ...r, ingredients: r.ingredients.map((x, j) => (j >= first && j < end ? { ...x, section: name } : x)) })
  }
  const addLine = (section: string) =>
    setR({ ...r, ingredients: [...r.ingredients, { name: "", quantity: 1, unit: "g", food: null, estimate: null, section }] })

  // Lines whose name matches a table food (after dropping words like "melted") get it at once.
  useEffect(() => {
    if (!keys.size) return
    const t = setTimeout(() => setR((cur) => {
      let changed = false
      const ingredients = cur.ingredients.map((l) => {
        if (l.food || l.estimate) return l
        const food = matchFood(l.name.replace(/,.*$/, ""), keys)
        if (!food) return l
        changed = true
        return { ...l, food }
      })
      return changed ? { ...cur, ingredients } : cur
    }), 0)
    return () => clearTimeout(t)
  }, [keys, r.ingredients])

  // Whatever is still unmatched is estimated by AI without a button press, once per name.
  const pendingKey = [...new Set(unmatched.map((l) => l.name.trim()))].join("\n")
  useEffect(() => {
    if (!keys.size || !pendingKey) return
    let live = true
    const t = setTimeout(async () => {
      const names = pendingKey.split("\n").filter((n) => !tried.current.has(n))
      if (!names.length) return
      names.forEach((n) => tried.current.add(n))
      setEstimating(true)
      try {
        const out = await send<EstimateView>("/me/recipes/estimate", "POST", { names })
        const found = new Map(out.estimates.map((e) => [e.name, e.estimate]))
        setR((cur) => ({
          ...cur,
          ingredients: cur.ingredients.map((l) => {
            const estimate = !l.food && !l.estimate ? found.get(l.name.trim()) : null
            return estimate ? { ...l, estimate } : l
          }),
        }))
        const failed = out.estimates.filter((e) => !e.estimate).map((e) => e.name)
        if (failed.length) toast.error(`Could not estimate ${failed.join(", ")}. Pick a food instead.`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not estimate those foods.")
      } finally {
        if (live) setEstimating(false)
      }
    }, 800)
    return () => { live = false; clearTimeout(t) }
  }, [keys, pendingKey])

  async function save() {
    setSaving(true)
    try {
      const saved = recipeId
        ? await send<CookbookDetail>(`/me/recipes/${recipeId}`, "PUT", recipe)
        : await saveNewRecipe(recipe, mutate, me?.limits.photos.left !== 0)
      toast.success(`Saved ${saved.title}`)
      onSaved(saved)
    } catch (e) {
      toast.error(e instanceof ApiError && e.problems.length ? e.problems.join("; ")
                  : e instanceof Error ? e.message : "Could not save.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className="gap-5" pointerEvents={saving ? "none" : "auto"}>
      <Panel className="gap-4">
        <Text accessibilityRole="header" className="font-sans-semibold text-lg text-foreground">About</Text>
        <Field name="Title" value={r.title} maxLength={120} onChangeText={(title) => setR({ ...r, title })} />
        <Field name="Summary" value={r.summary} maxLength={600} multiline onChangeText={(summary) => setR({ ...r, summary })} />
        <View className="flex-row gap-3">
          <View className="flex-1 gap-1.5">
            <Text className="font-sans-medium text-sm text-foreground">Total minutes</Text>
            <NumberInput label="Total minutes" value={r.total_minutes} onChange={(total_minutes) => setR({ ...r, total_minutes })} />
          </View>
          <View className="flex-1 gap-1.5">
            <Text className="font-sans-medium text-sm text-foreground">Servings</Text>
            <NumberInput label="Servings" value={r.servings} onChange={(servings) => setR({ ...r, servings })} />
          </View>
        </View>
        <Field name="Cuisine" value={r.cuisine} maxLength={40} placeholder="e.g. italian" autoCapitalize="none"
               onChangeText={(cuisine) => setR({ ...r, cuisine })} />
        <View className="gap-1.5">
          <Text className="font-sans-medium text-sm text-foreground">Meals it suits</Text>
          <View className="flex-row flex-wrap gap-2">
            {MEAL_ORDER.map((m) => {
              const on = r.meal_types.includes(m)
              return (
                <Pressable key={m} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label(m)}
                           onPress={() => setR({ ...r, meal_types: on ? r.meal_types.filter((x) => x !== m) : [...r.meal_types, m] })}
                           className={`h-8 justify-center rounded-full border px-3 ${on ? "border-primary bg-primary-soft" : "border-border bg-surface"}`}>
                  <Text className={`font-sans-medium text-[13px] ${on ? "text-primary-text" : "text-muted-foreground"}`}>{label(m)}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      </Panel>

      <Panel>
        <PanelTitle action={estimating ? (
          <View className="flex-row items-center gap-1.5">
            <Sparkles size={14} color="#b7860b" />
            <Text className="font-sans text-xs text-muted-foreground">Estimating new foods…</Text>
          </View>
        ) : undefined}>
          Ingredients
        </PanelTitle>
        <Text className="font-sans text-xs text-muted-foreground">
          Each ingredient is matched to a food in Pantrila&apos;s table, which is how nutrition and allergens are worked
          out. Foods not in the table are estimated by AI.
        </Text>
        {groupLines(r.ingredients).map((g, n) => (
          <View key={n}>
            {g.title !== "" && (
              <TextInput accessibilityLabel={`Group name, ${g.title}`} value={g.title} maxLength={80}
                         placeholder="Group name (clear it to remove the group)"
                         placeholderTextColorClassName="accent-muted-foreground"
                         onChangeText={(name) => renameGroup(g.items[0].index, name)}
                         className="mt-4 h-10 rounded-xl bg-surface-muted px-3 font-sans-semibold text-base text-foreground" />
            )}
            {g.items.map(({ item: l, index: i }) => (
              <LineRow key={i} line={l} n={i + 1} keys={keys} foods={foods} byKey={byKey} onChange={(x) => setLine(i, x)}
                       onRemove={() => setR({ ...r, ingredients: r.ingredients.filter((_, j) => j !== i) })} />
            ))}
          </View>
        ))}
        <View className="mt-2 flex-row flex-wrap gap-2">
          <Button variant="ghost" size="sm" icon={Plus} text="Add ingredient"
                  onPress={() => addLine(r.ingredients.at(-1)?.section ?? "")} />
          <Button variant="ghost" size="sm" icon={Plus} text="Add group" onPress={() => addLine("New group")} />
        </View>
      </Panel>

      {r.source === "post" && <CreditFields r={r} onChange={setR} />}

      <Panel>
        <Field name="Method" hint="One step per paragraph. Start a line with ## to add a heading, like ## For the sauce."
               value={stepsText} multiline onChangeText={setStepsText} style={{ minHeight: 160 }} />
      </Panel>

      <Panel>
        <Field name="Notes" hint="Optional. Substitutions, storage, tips. One note per line." value={r.notes ?? ""}
               maxLength={3000} multiline onChangeText={(notes) => setR({ ...r, notes })} />
      </Panel>

      <Preview recipe={recipe} />
      {!recipeId && (
        <Text className="font-sans text-xs text-muted-foreground">
          Saving also makes a photo of your recipe while you look it over.
        </Text>
      )}
      <View className="flex-row gap-2">
        <Button className="flex-1" onPress={save} busy={saving} disabled={estimating || !recipe.title.trim()}
                text={saving ? "Saving…" : recipeId ? "Save changes" : "Save to my recipes"} />
        {onCancel && <Button variant="outline" text="Cancel" onPress={onCancel} disabled={saving} />}
      </View>
    </View>
  )
}
