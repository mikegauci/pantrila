"use client"

import { Camera, Link2, PenLine, Plus, Sparkles, Trash2, TriangleAlert, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { AiBadge, AllergenBadge, DietBadge, Panel, PanelTitle, ProblemAlert } from "@/components/bits"
import { MacroRing } from "@/components/macro-ring"
import { NativeSelect } from "@/components/native-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, send } from "@/lib/api"
import { label, MEAL_ORDER } from "@/lib/format"
import { useFoods, useProfile } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import type {
  Allergen, CookbookDetail, CookbookPreview, CookbookRecipeIn, EstimateView, FoodEstimate, RecipeLine,
  RecipeSource, Unit,
} from "@/lib/types"

export const RECIPE_SOURCE: Record<RecipeSource, { icon: typeof Camera; text: string }> = {
  photo: { icon: Camera, text: "From a photo" },
  link: { icon: Link2, text: "From a link" },
  manual: { icon: PenLine, text: "Typed in" },
}

const UNITS: Unit[] = ["g", "kg", "ml", "l", "tsp", "tbsp", "cup", "piece", "pinch"]

export const BLANK_RECIPE: CookbookRecipeIn = {
  title: "", summary: "", cuisine: "", meal_types: ["dinner"], total_minutes: 30, servings: 2,
  ingredients: [{ name: "", quantity: 1, unit: "g", food: null, estimate: null }],
  steps: [], source: "manual", source_url: null,
}

/** sessionStorage key: a recipe the assistant wrote, handed to the new-recipe page (read once). */
export const CHAT_DRAFT = "pantrio-chat-draft"

const toKey = (text: string) => text.trim().toLowerCase().replaceAll("-", " ").split(/\s+/).join("_")

/** The table food a typed name means, if it is one exactly (or its plural/singular). */
function matchFood(text: string, keys: Set<string>): string | null {
  const k = toKey(text)
  for (const c of [k, `${k}s`, k.replace(/es$/, ""), k.replace(/s$/, "")]) if (keys.has(c)) return c
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
        <AiBadge>Estimated</AiBadge>
        {e.description}: about {Math.round(e.kcal)} kcal and {Math.round(e.protein_g)} g protein per 100 g.
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
      list="pantrio-foods"
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
  line, n, keys, onChange, onRemove,
}: {
  line: RecipeLine; n: number; keys: Set<string>
  onChange: (l: RecipeLine) => void; onRemove: () => void
}) {
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
            onChange={(e) => onChange({ ...line, quantity: e.target.valueAsNumber })}
            className="tabular h-10 bg-surface"
          />
          <NativeSelect aria-label={`Unit for ingredient ${n}`} value={line.unit}
                        onChange={(e) => onChange({ ...line, unit: e.target.value as Unit })}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </NativeSelect>
          <FoodField line={line} keys={keys}
                     onChange={(food) => onChange({ ...line, food, estimate: food ? null : line.estimate })} />
        </div>
      </div>
      {!line.food && line.estimate && (
        <EstimateNote estimate={line.estimate} n={n}
                      onChange={(estimate) => onChange({ ...line, estimate })} />
      )}
      {!line.food && !line.estimate && (
        <p className="inline-flex items-center gap-1.5 text-[12px] text-[#a65a00]">
          <TriangleAlert className="size-3.5" aria-hidden />
          Not matched. Pick a food from the list, or estimate it.
        </p>
      )}
    </li>
  )
}

function Preview({ recipe }: { recipe: CookbookRecipeIn }) {
  const [preview, setPreview] = useState<CookbookPreview | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const { data: profile } = useProfile()
  const body = JSON.stringify(recipe)

  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      try {
        const p = await send<CookbookPreview>("/me/recipes/preview", "POST", JSON.parse(body))
        if (live) { setPreview(p); setProblems([]) }
      } catch (e) {
        if (live && e instanceof ApiError) setProblems(e.problems.length ? e.problems : [e.message])
      }
    }, 500)
    return () => { live = false; clearTimeout(t) }
  }, [body])

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
              ? "Some foods are estimated by AI, so these numbers and allergens are a best guess. Check the label of anything you buy."
              : "Computed in code from the ingredients with USDA FoodData Central values."}
          </p>
        </>
      )}
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
  const { data: foods } = useFoods()
  const keys = useMemo(() => new Set(foods?.map((f) => f.key) ?? []), [foods])
  const [r, setR] = useState<CookbookRecipeIn>(initial)
  const [stepsText, setStepsText] = useState(initial.steps.join("\n\n"))
  const [busy, setBusy] = useState<"save" | "estimate" | null>(null)

  const recipe: CookbookRecipeIn = { ...r, steps: stepsText.split("\n").map((s) => s.trim()).filter(Boolean) }
  const unmatched = r.ingredients.filter((l) => !l.food && !l.estimate && l.name.trim())
  const setLine = (i: number, l: RecipeLine) =>
    setR({ ...r, ingredients: r.ingredients.map((x, j) => (j === i ? l : x)) })

  async function estimate() {
    setBusy("estimate")
    try {
      const names = unmatched.map((l) => l.name.trim())
      const out = await send<EstimateView>("/me/recipes/estimate", "POST", { names })
      const byName = new Map(out.estimates.map((e) => [e.name, e.estimate]))
      setR({
        ...r,
        ingredients: r.ingredients.map((l) =>
          !l.food && !l.estimate && byName.get(l.name.trim()) ? { ...l, estimate: byName.get(l.name.trim())! } : l),
      })
      const failed = out.estimates.filter((e) => !e.estimate).map((e) => e.name)
      if (failed.length) toast.error(`Could not estimate ${failed.join(", ")}. Pick a food instead.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not estimate those foods.")
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    setBusy("save")
    try {
      const saved = recipeId
        ? await send<CookbookDetail>(`/me/recipes/${recipeId}`, "PUT", recipe)
        : await send<CookbookDetail>("/me/recipes", "POST", recipe)
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
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
      <datalist id="pantrio-foods">
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
            action={unmatched.length > 0 && (
              <Button variant="outline" size="sm" onClick={estimate} disabled={busy !== null}>
                <Sparkles /> {busy === "estimate" ? "Estimating…" : `Estimate ${unmatched.length} with AI`}
              </Button>
            )}
          >
            Ingredients
          </PanelTitle>
          <p className="text-[12px] text-muted-foreground">
            Each ingredient is matched to a food in Pantrio&apos;s table, which is how nutrition and
            allergens are worked out. Foods not in the table can be estimated by AI.
          </p>
          <ul>
            {r.ingredients.map((l, i) => (
              <LineRow key={i} line={l} n={i + 1} keys={keys} onChange={(x) => setLine(i, x)}
                       onRemove={() => setR({ ...r, ingredients: r.ingredients.filter((_, j) => j !== i) })} />
            ))}
          </ul>
          <Button variant="ghost" size="sm" className="mt-2"
                  onClick={() => setR({ ...r, ingredients: [...r.ingredients, { ...BLANK_RECIPE.ingredients[0] }] })}>
            <Plus /> Add ingredient
          </Button>
        </Panel>

        <Panel className="grid gap-2">
          <PanelTitle className="mb-0">Method</PanelTitle>
          <Label htmlFor="steps" className="text-muted-foreground">One step per paragraph</Label>
          <Textarea id="steps" value={stepsText} rows={8} className="min-h-40 bg-surface"
                    onChange={(e) => setStepsText(e.target.value)} />
        </Panel>
      </div>

      <div className="grid gap-3 lg:sticky lg:top-[96px]">
        <Preview recipe={recipe} />
        <div className="flex gap-2">
          <Button size="lg" className="flex-1" onClick={save} disabled={busy !== null || !recipe.title.trim()}>
            {busy === "save" ? "Saving…" : recipeId ? "Save changes" : "Save to my recipes"}
          </Button>
          {onCancel && <Button size="lg" variant="outline" onClick={onCancel}>Cancel</Button>}
        </div>
      </div>
    </div>
  )
}
