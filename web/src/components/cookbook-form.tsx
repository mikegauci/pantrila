"use client"

import { NutritionSource } from "@/components/nutrition-source"
import { Camera, Clapperboard, ClipboardPaste, Link2, PenLine, Plus, Share2, Sparkles, Trash2, TriangleAlert, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { type ScopedMutator, useSWRConfig } from "swr"

import { AllergenBadge, DietBadge, Panel, PanelTitle, ProblemAlert } from "@/components/bits"
import { MacroRing } from "@/components/macro-ring"
import { NativeSelect } from "@/components/native-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { convertAmount } from "@/lib/amounts"
import { ApiError, send } from "@/lib/api"
import { label, MEAL_ORDER } from "@/lib/format"
import { useFoods, useProfile } from "@/lib/hooks"
import { makePhoto } from "@/lib/photo-jobs"
import { groupLines, stepsToText, textToSteps } from "@/lib/sections"
import { cn } from "@/lib/utils"
import type {
  Allergen, CookbookDetail, CookbookPreview, CookbookRecipeIn, EstimateView, Food, FoodEstimate,
  RecipeLine, RecipeSource, SourcePlatform, Unit,
} from "@/lib/types"

export const RECIPE_SOURCE: Record<RecipeSource, { icon: typeof Camera; text: string }> = {
  photo: { icon: Camera, text: "From a photo" },
  link: { icon: Link2, text: "From a link" },
  post: { icon: Share2, text: "From social media" },
  text: { icon: ClipboardPaste, text: "Pasted text" },
  video: { icon: Clapperboard, text: "From a video" },
  manual: { icon: PenLine, text: "Typed in" },
}

/** Saves a new recipe; its photo is then made while the person reads it (its page shows it arriving). */
export async function saveNewRecipe(recipe: CookbookRecipeIn, mutate: ScopedMutator): Promise<CookbookDetail> {
  const saved = await send<CookbookDetail>("/me/recipes", "POST", recipe)
  makePhoto(saved.id)
    .then((photo) => mutate(`/me/recipes/${saved.id}`, photo, { revalidate: false }))
    .catch((e) => toast.warning("Recipe saved. Its photo could not be generated.", {
      description: e instanceof Error ? e.message : "You can try again from the recipe.",
    }))
    .finally(() => {
      mutate("/me/recipes")
      mutate("/me")
      mutate("/me/usage")
    })
  return saved
}

const NO_METHOD_STEP = "Add the method here."  // recipe_import.NO_METHOD_STEP

/** An imported draft that cannot be saved as it is: a food left unknown, or no method. */
export const needsReview = (d: CookbookRecipeIn) =>
  d.ingredients.some((l) => !l.food && !l.estimate) || d.steps.includes(NO_METHOD_STEP)

export const PLATFORM: Record<SourcePlatform, string> = {
  tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook",
}

/** A link's site for display: "bbcgoodfood.com". */
export const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

const UNITS: Unit[] = ["g", "kg", "ml", "l", "tsp", "tbsp", "cup", "piece", "pinch"]

export const BLANK_RECIPE: CookbookRecipeIn = {
  title: "", summary: "", cuisine: "", meal_types: ["dinner"], total_minutes: 30, servings: 2,
  ingredients: [{ name: "", quantity: 1, unit: "g", food: null, estimate: null }],
  steps: [], source: "manual", source_url: null, source_platform: null, source_author: null,
  recipe_url: null,
}

/** sessionStorage key: a recipe the assistant wrote, handed to the new-recipe page (read once). */
export const CHAT_DRAFT = "pantrila-chat-draft"

const toKey = (text: string) => text.trim().toLowerCase().replaceAll("-", " ").split(/\s+/).join("_")

/** Words that describe a food's state, not which food it is (mirrors `PREP_WORDS` in pantry.py). */
const PREP_WORDS = new Set([
  "melted", "softened", "chopped", "diced", "sliced", "minced", "grated", "shredded",
  "sifted", "packed", "plain", "unsweetened", "large", "medium", "small",
])
const ALIASES: Record<string, string> = {
  all_purpose_flour: "plain_flour", whole_wheat_flour: "wholemeal_flour",
  wholewheat_flour: "wholemeal_flour", white_chocolate_chips: "white_chocolate",
  chocolate_chips: "dark_chocolate",
}

/** The table food a typed name means, if it is one exactly (or its plural/singular). */
function matchFood(text: string, keys: Set<string>): string | null {
  const k = toKey(text)
  const bare = k.split("_").filter((w) => !PREP_WORDS.has(w)).join("_")
  for (const n of new Set([k, bare])) {
    for (const c of [n, `${n}s`, n.replace(/es$/, ""), n.replace(/s$/, "")]) {
      if (keys.has(c)) return c
      if (ALIASES[c]) return ALIASES[c]
    }
  }
  return null
}

const ALLERGENS: Allergen[] = [
  "celery", "gluten", "crustaceans", "eggs", "fish", "lupin", "milk", "molluscs", "mustard",
  "tree_nuts", "peanuts", "sesame", "soy", "sulphites",
]

/** An AI estimate, with allergens the person can correct from the label of what they buy. */
function EstimateNote({
  estimate: e, n, onChange,
}: { estimate: FoodEstimate; n: number; onChange: (e: FoodEstimate) => void }) {
  const missing = ALLERGENS.filter((a) => !e.allergens.includes(a))
  return (
    <div className="grid gap-1.5 text-[12px] text-muted-foreground">
      <p className="flex flex-wrap items-center gap-2">
        Estimated: {e.description}: about {Math.round(e.kcal)} kcal and {Math.round(e.protein_g)} g protein per 100 g.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">Allergens:</span>
        {e.allergens.length === 0 && <span>none estimated</span>}
        {e.allergens.map((a) => (
          <button key={a} type="button" aria-label={`Remove ${label(a).toLowerCase()} from ingredient ${n}`}
                  onClick={() => onChange({ ...e, allergens: e.allergens.filter((x) => x !== a) })}
                  className="inline-flex h-6 items-center gap-1 rounded-full bg-surface-muted px-2.5 font-medium text-foreground hover:bg-danger-soft">
            {label(a)} <X className="size-3" aria-hidden />
          </button>
        ))}
        {missing.length > 0 && (
          <NativeSelect aria-label={`Add an allergen to ingredient ${n}`} value=""
                        className="[&_select]:h-7 [&_select]:text-[12px]"
                        onChange={(ev) => onChange({ ...e, allergens: [...e.allergens, ev.target.value as Allergen] })}>
            <option value="" disabled>Add allergen…</option>
            {missing.map((a) => <option key={a} value={a}>{label(a)}</option>)}
          </NativeSelect>
        )}
      </div>
    </div>
  )
}

function FoodField({
  line, keys, onChange,
}: { line: RecipeLine; keys: Set<string>; onChange: (food: string | null) => void }) {
  const [text, setText] = useState(line.food ? label(line.food).toLowerCase() : "")
  const [seen, setSeen] = useState(line.food)
  if (line.food !== seen) {  // set from outside (auto-match from the name)
    setSeen(line.food)
    setText(line.food ? label(line.food).toLowerCase() : "")
  }
  return (
    <Input
      list="pantrila-foods"
      aria-label={`Food for ${line.name || "this ingredient"}`}
      placeholder="Match a food"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const food = matchFood(e.target.value, keys)
        setSeen(food)
        onChange(food)
      }}
      className={cn("h-10 bg-surface", !line.food && !line.estimate && "border-warning")}
    />
  )
}

function LineRow({
  line, n, keys, foods, onChange, onRemove,
}: {
  line: RecipeLine; n: number; keys: Set<string>; foods: Map<string, Food>
  onChange: (l: RecipeLine) => void; onRemove: () => void
}) {
  // A new unit keeps the amount: 1 cup of rice becomes 185 g (an estimate stays one). A food
  // with no density or piece weight for that unit keeps the number for the person to fix.
  function changeUnit(unit: Unit) {
    const food = line.food ? foods.get(line.food) : null
    const measure = food ?? (!line.food ? line.estimate : null)
    const quantity = convertAmount(line.quantity, line.unit, unit,
                                   measure?.grams_per_ml, measure?.grams_per_piece)
    onChange(quantity === null
      ? { ...line, unit, amount_estimate: null }
      : { ...line, unit, quantity })
  }
  return (
    <li className="grid gap-2 border-b py-3 last:border-0">
      <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[minmax(0,2fr)_5rem_6.5rem_minmax(0,1.5fr)_auto]">
        <Input
          aria-label={`Ingredient ${n}`}
          placeholder="e.g. red onion, sliced"
          value={line.name}
          onChange={(e) => onChange({ ...line, name: e.target.value })}
          onBlur={() => {
            if (!line.food && !line.estimate) {
              const food = matchFood(line.name.replace(/,.*$/, ""), keys)
              if (food) onChange({ ...line, food })
            }
          }}
          className="col-span-1 h-10 bg-surface sm:col-span-1"
        />
        <Button variant="ghost" size="icon" aria-label={`Remove ingredient ${n}`} onClick={onRemove}
                className="sm:order-last"><Trash2 /></Button>
        <div className="col-span-2 grid grid-cols-[5rem_6.5rem_1fr] gap-2 sm:contents">
          <Input
            type="number" min={0} step="any" aria-label={`Amount for ingredient ${n}`}
            value={Number.isFinite(line.quantity) ? line.quantity : ""}
            onChange={(e) => onChange({ ...line, quantity: e.target.valueAsNumber, amount_estimate: null })}
            className="tabular h-10 bg-surface"
          />
          <NativeSelect aria-label={`Unit for ingredient ${n}`} value={line.unit}
                        onChange={(e) => changeUnit(e.target.value as Unit)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </NativeSelect>
          <FoodField line={line} keys={keys}
                     onChange={(food) => onChange({ ...line, food, estimate: food ? null : line.estimate })} />
        </div>
      </div>
      {line.amount_estimate && (
        <p className="text-[12px] text-muted-foreground">
          Estimated amount: {line.amount_estimate}
        </p>
      )}
      {!line.food && line.estimate && (
        <EstimateNote estimate={line.estimate} n={n}
                      onChange={(estimate) => onChange({ ...line, estimate })} />
      )}
      {!line.food && !line.estimate && (
        <p className="inline-flex items-center gap-1.5 text-[12px] text-[#a65a00]">
          <TriangleAlert className="size-3.5" aria-hidden />
          Not matched. Pick a food from the list; it will be estimated if left.
        </p>
      )}
    </li>
  )
}

function Preview({ recipe }: { recipe: CookbookRecipeIn }) {
  const [checked, setChecked] = useState<{ key: string; preview: CookbookPreview } | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const { data: profile } = useProfile()
  const body = JSON.stringify(recipe)
  const rules = JSON.stringify(profile)
  const key = `${body}:${rules}`
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
    <Panel className="grid gap-4">
      <PanelTitle className="mb-0">Per serving</PanelTitle>
      {problems.length > 0 && (
        <div className="rounded-2xl bg-orange-soft p-3 text-[13px]">
          <p className="font-semibold">To fix before saving</p>
          <ul className="mt-1 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {preview && (
        <>
          <ProblemAlert title="This recipe does not suit you" items={preview.problems} />
          <MacroRing nutrition={preview.nutrition} size={140} />
          <div className="flex flex-wrap gap-1.5">{preview.diet_tags.map((d) => <DietBadge key={d} diet={d} />)}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">Allergens:</span>
            {preview.allergens.length
              ? preview.allergens.map((a) => <AllergenBadge key={a} allergen={a} danger={allergies.has(a)} />)
              : <span className="text-[12px]">none of the 14 EU allergens</span>}
          </div>
          <p className="text-[12px] text-muted-foreground">
            {preview.estimated
              ? "Some amounts or foods are estimated, so nutrition is approximate. Estimated amounts are noted beside the ingredients. Check product labels for allergens."
              : <NutritionSource />}
          </p>
        </>
      )}
    </Panel>
  )
}

/** Who the recipe is from: the post, its creator and the recipe site it linked to. */
function CreditFields({ r, onChange }: { r: CookbookRecipeIn; onChange: (r: CookbookRecipeIn) => void }) {
  const text = (v: string) => v.trim() || null
  return (
    <Panel className="grid gap-4">
      <PanelTitle className="mb-0">Credit</PanelTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="credit-author">Creator</Label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" aria-hidden>@</span>
            <Input id="credit-author" value={r.source_author ?? ""} maxLength={31} autoCapitalize="none"
                   spellCheck={false} placeholder="handle" className="h-10 bg-surface pl-7"
                   onChange={(e) => onChange({ ...r, source_author: text(e.target.value.replace(/^@/, "")) })} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="credit-platform">Posted on</Label>
          <NativeSelect id="credit-platform" className="w-full" value={r.source_platform ?? ""}
                        onChange={(e) => onChange({ ...r, source_platform: (e.target.value || null) as SourcePlatform | null })}>
            <option value="">Not set</option>
            {(Object.keys(PLATFORM) as SourcePlatform[]).map((p) => <option key={p} value={p}>{PLATFORM[p]}</option>)}
          </NativeSelect>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="credit-post">Post link</Label>
        <Input id="credit-post" type="url" value={r.source_url ?? ""} maxLength={2000} className="h-10 bg-surface"
               placeholder="https://" onChange={(e) => onChange({ ...r, source_url: text(e.target.value) })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="credit-site">Recipe site (if the post linked one)</Label>
        <Input id="credit-site" type="url" value={r.recipe_url ?? ""} maxLength={2000} className="h-10 bg-surface"
               placeholder="https://" onChange={(e) => onChange({ ...r, recipe_url: text(e.target.value) })} />
      </div>
    </Panel>
  )
}

export function CookbookForm({
  initial, recipeId, onSaved, onCancel,
}: {
  initial: CookbookRecipeIn
  recipeId?: number
  onSaved: (saved: CookbookDetail) => void
  onCancel?: () => void
}) {
  const { mutate } = useSWRConfig()
  const { data: foods } = useFoods()
  const keys = useMemo(() => new Set(foods?.map((f) => f.key) ?? []), [foods])
  const byKey = useMemo(() => new Map((foods ?? []).map((f) => [f.key, f])), [foods])
  const [r, setR] = useState<CookbookRecipeIn>(initial)
  const [stepsText, setStepsText] = useState(stepsToText(initial.steps, initial.step_sections))
  const [busy, setBusy] = useState<"save" | null>(null)
  const [estimating, setEstimating] = useState(false)
  /** Names already sent for estimating, so a failed one is not retried in a loop. */
  const tried = useRef(new Set<string>())

  const recipe: CookbookRecipeIn = { ...r, ...textToSteps(stepsText) }
  const unmatched = r.ingredients.filter((l) => !l.food && !l.estimate && l.name.trim())
  const setLine = (i: number, l: RecipeLine) =>
    setR({ ...r, ingredients: r.ingredients.map((x, j) => (j === i ? l : x)) })
  /** Rename (or, with an empty name, remove) the group whose first line is `first`. */
  const renameGroup = (first: number, name: string) => {
    const old = r.ingredients[first].section ?? ""
    let end = first
    while (end < r.ingredients.length && (r.ingredients[end].section ?? "") === old) end += 1
    setR({ ...r, ingredients: r.ingredients.map((x, j) => (j >= first && j < end ? { ...x, section: name } : x)) })
  }
  const addLine = (section: string) =>
    setR({ ...r, ingredients: [...r.ingredients, { ...BLANK_RECIPE.ingredients[0], section }] })

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
        const byName = new Map(out.estimates.map((e) => [e.name, e.estimate]))
        setR((cur) => ({
          ...cur,
          ingredients: cur.ingredients.map((l) =>
            !l.food && !l.estimate && byName.get(l.name.trim()) ? { ...l, estimate: byName.get(l.name.trim())! } : l),
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
    setBusy("save")
    try {
      const saved = recipeId
        ? await send<CookbookDetail>(`/me/recipes/${recipeId}`, "PUT", recipe)
        : await saveNewRecipe(recipe, mutate)
      toast.success(`Saved ${saved.title}`)
      onSaved(saved)
    } catch (e) {
      toast.error(e instanceof ApiError && e.problems.length ? e.problems.join("; ")
                  : e instanceof Error ? e.message : "Could not save.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <fieldset disabled={busy !== null} className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
      <datalist id="pantrila-foods">
        {foods?.map((f) => <option key={f.key} value={f.name} />)}
      </datalist>
      <div className="grid gap-5">
        <Panel className="grid gap-4">
          <PanelTitle className="mb-0">About</PanelTitle>
          <div className="grid gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={r.title} maxLength={120} className="h-10 bg-surface"
                   onChange={(e) => setR({ ...r, title: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="summary">Summary</Label>
            <Textarea id="summary" value={r.summary} maxLength={600} className="bg-surface"
                      onChange={(e) => setR({ ...r, summary: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="minutes">Total minutes</Label>
              <Input id="minutes" type="number" min={1} max={1440} className="tabular h-10 bg-surface"
                     value={Number.isFinite(r.total_minutes) ? r.total_minutes : ""}
                     onChange={(e) => setR({ ...r, total_minutes: e.target.valueAsNumber })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="servings">Servings</Label>
              <Input id="servings" type="number" min={1} max={24} className="tabular h-10 bg-surface"
                     value={Number.isFinite(r.servings) ? r.servings : ""}
                     onChange={(e) => setR({ ...r, servings: e.target.valueAsNumber })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cuisine">Cuisine</Label>
              <Input id="cuisine" value={r.cuisine} maxLength={40} placeholder="e.g. italian" className="h-10 bg-surface"
                     onChange={(e) => setR({ ...r, cuisine: e.target.value })} />
            </div>
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Meals it suits</legend>
            <div className="flex flex-wrap gap-2">
              {MEAL_ORDER.map((m) => {
                const on = r.meal_types.includes(m)
                return (
                  <button key={m} type="button" aria-pressed={on}
                          onClick={() => setR({ ...r, meal_types: on ? r.meal_types.filter((x) => x !== m) : [...r.meal_types, m] })}
                          className={cn("h-8 rounded-full border px-3 text-[13px] font-medium transition-colors duration-150",
                                        on ? "border-primary bg-primary-soft text-primary-text" : "bg-surface text-muted-foreground hover:text-foreground")}>
                    {label(m)}
                  </button>
                )
              })}
            </div>
          </fieldset>
        </Panel>

        <Panel>
          <PanelTitle
            action={estimating && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Sparkles className="size-3.5" aria-hidden /> Estimating new foods…
              </span>
            )}
          >
            Ingredients
          </PanelTitle>
          <p className="text-[12px] text-muted-foreground">
            Each ingredient is matched to a food in Pantrila&apos;s table, which is how nutrition and
            allergens are worked out. Foods not in the table are estimated by AI.
          </p>
          {groupLines(r.ingredients).map((g, n) => (
            <div key={n}>
              {g.title && (
                <Input
                  aria-label={`Group name, ${g.title}`} value={g.title} maxLength={80}
                  placeholder="Group name (clear it to remove the group)"
                  onChange={(e) => renameGroup(g.items[0].index, e.target.value)}
                  className="mt-4 h-9 border-0 bg-surface-muted font-semibold"
                />
              )}
              <ul>
                {g.items.map(({ item: l, index: i }) => (
                  <LineRow key={i} line={l} n={i + 1} keys={keys} foods={byKey} onChange={(x) => setLine(i, x)}
                           onRemove={() => setR({ ...r, ingredients: r.ingredients.filter((_, j) => j !== i) })} />
                ))}
              </ul>
            </div>
          ))}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => addLine(r.ingredients.at(-1)?.section ?? "")}>
              <Plus /> Add ingredient
            </Button>
            <Button variant="ghost" size="sm" onClick={() => addLine("New group")}>
              <Plus /> Add group
            </Button>
          </div>
        </Panel>

        {r.source === "post" && <CreditFields r={r} onChange={setR} />}

        <Panel className="grid gap-2">
          <PanelTitle className="mb-0">Method</PanelTitle>
          <Label htmlFor="steps" className="text-muted-foreground">
            One step per paragraph. Start a line with ## to add a heading, like ## For the sauce.
          </Label>
          <Textarea id="steps" value={stepsText} rows={8} className="min-h-40 bg-surface"
                    onChange={(e) => setStepsText(e.target.value)} />
        </Panel>

        <Panel className="grid gap-2">
          <PanelTitle className="mb-0">Notes</PanelTitle>
          <Label htmlFor="notes" className="text-muted-foreground">
            Optional. Substitutions, storage, tips. One note per line.
          </Label>
          <Textarea id="notes" value={r.notes ?? ""} rows={4} maxLength={3000} className="bg-surface"
                    onChange={(e) => setR({ ...r, notes: e.target.value })} />
        </Panel>
      </div>

      <div className="grid gap-3 lg:sticky lg:top-[96px]">
        <Preview recipe={recipe} />
        {!recipeId && (
          <p className="text-[12px] text-muted-foreground">
            Saving also makes a photo of your recipe while you look it over.
          </p>
        )}
        <div className="flex gap-2">
          <Button size="lg" className="flex-1" onClick={save} disabled={busy !== null || estimating || !recipe.title.trim()}>
            {busy === "save" ? "Saving…" : recipeId ? "Save changes" : "Save to my recipes"}
          </Button>
          {onCancel && <Button size="lg" variant="outline" onClick={onCancel} disabled={busy !== null}>Cancel</Button>}
        </div>
      </div>
    </fieldset>
  )
}
