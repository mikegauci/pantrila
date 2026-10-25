import { Camera, ImageIcon, Save, Trash2, X } from "lucide-react-native"
import { useMemo, useState } from "react"
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { label } from "@pantrila/core/format"
import { hasKcalRange, kcalGoal } from "@pantrila/core/plan"
import type { DietTag, Me, NutritionTargets, Profile } from "@pantrila/core/types"

import { UserAvatar } from "@/components/avatar"
import { Button, ErrorState, Panel, PanelTitle, Stepper } from "@/components/bits"
import { Field, INPUT, Segmented, Toggle } from "@/components/form"
import { Icon } from "@/components/icon"
import { ApiError, send } from "@/lib/api"
import { useFoods, useMe, useMeta, useProfile, useRefreshKitchen } from "@/lib/hooks"
import { PhotoAccessError, pickAvatar } from "@/lib/images"
import { toast } from "@/lib/toast"

/** The web's Profile page on the phone: picture, allergies, diet, foods never eaten, daily targets
 * and planning. Nothing is saved until "Save profile". */

const DIET_HELP: Partial<Record<DietTag, string>> = {
  low_carb: "at most 20 g carbs per serving",
  high_protein: "at least 25 g protein per serving",
}

const PRESETS: { name: string; patch: Partial<Profile> }[] = [
  { name: "Vegan, high protein", patch: { diets: ["vegan"], allergies: [], targets: { kcal: 2200, min_protein_g: 110, max_carbs_g: null } } },
  { name: "Coeliac", patch: { diets: ["gluten_free"], allergies: ["gluten"], targets: { kcal: 2000, min_protein_g: null, max_carbs_g: null } } },
  { name: "Nut allergy, family", patch: { diets: [], allergies: ["peanuts", "tree_nuts"], targets: { kcal: 2100, min_protein_g: 80, max_carbs_g: null } } },
]

const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")) || null)
const shown = (n: number | null | undefined) => (n == null ? "" : String(n))

export default function ProfileScreen() {
  const { data, error, mutate } = useProfile()
  const { data: meta } = useMeta()
  const refreshKitchen = useRefreshKitchen()
  const insets = useSafeAreaInsets()
  const [draft, setDraft] = useState<Profile | null>(null)
  const [range, setRange] = useState<boolean | null>(null)  // null: follow the saved profile
  const [saving, setSaving] = useState(false)
  const p = draft ?? data ?? null

  if (error) return <View className="flex-1 bg-background p-4"><ErrorState message={error.message} onRetry={() => mutate()} /></View>
  if (!p || !meta) return <View className="flex-1 bg-background" />
  const set = (patch: Partial<Profile>) => setDraft({ ...p, ...patch })
  const t = p.targets

  async function save() {
    setSaving(true)
    try {
      const saved = await send<Profile>("/me/profile", "PUT", p)
      await mutate(saved, { revalidate: false })
      setDraft(null)
      await refreshKitchen()
      toast.success("Profile saved")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="gap-4 p-4 pb-6" keyboardShouldPersistTaps="handled">
        <PictureCard />

        <View className="gap-2">
          <Text className="font-sans text-[13px] text-muted-foreground">Start from an example:</Text>
          <View className="flex-row flex-wrap gap-2">
            {PRESETS.map((x) => (
              <Button key={x.name} text={x.name} variant="outline" size="sm" onPress={() => { setRange(null); set(x.patch) }} />
            ))}
          </View>
        </View>

        <Panel>
          <PanelTitle>Allergies</PanelTitle>
          <Text className="mb-3 font-sans text-[13px] text-muted-foreground">
            The 14 allergens EU law requires on labels. Pantrila never shows a recipe or plan with one of yours without
            a red warning; it checks the ingredients in code, not the AI&apos;s word.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {meta.allergens.map((a) => (
              <Toggle key={a} text={label(a)} label={`Allergy: ${label(a)}`} danger on={p.allergies.includes(a)}
                      onPress={() => set({ allergies: flip(p.allergies, a) })} />
            ))}
          </View>
        </Panel>

        <Panel>
          <PanelTitle>Diet</PanelTitle>
          <View className="flex-row flex-wrap gap-2">
            {meta.diets.map((d) => (
              <Toggle key={d} text={label(d)} label={`Diet: ${label(d)}`} on={p.diets.includes(d)}
                      onPress={() => set({ diets: flip(p.diets, d) })} />
            ))}
          </View>
          {p.diets.some((d) => DIET_HELP[d]) && (
            <Text className="mt-3 font-sans text-xs text-muted-foreground">
              {p.diets.filter((d) => DIET_HELP[d]).map((d) => `${label(d)} means ${DIET_HELP[d]}.`).join(" ")}
            </Text>
          )}
          <ExcludeFoods foods={p.exclude_foods} onChange={(exclude_foods) => set({ exclude_foods })} />
        </Panel>

        <Panel>
          <PanelTitle>Daily targets</PanelTitle>
          <Text className="mb-3 font-sans text-[13px] text-muted-foreground">
            Goals, not rules: the planner sets portions to hit your energy target and reports any day it misses. Leave
            blank for no target.
          </Text>
          <EnergyTarget t={t} range={range ?? hasKcalRange(t)} onRange={setRange} onChange={(targets) => set({ targets })} />
          <View className="mt-4 flex-row gap-3">
            <Field className="flex-1" name="Protein at least (g)" keyboardType="number-pad" value={shown(t.min_protein_g)}
                   onChangeText={(v) => set({ targets: { ...t, min_protein_g: num(v) } })} />
            <Field className="flex-1" name="Carbs at most (g)" keyboardType="number-pad" value={shown(t.max_carbs_g)}
                   onChangeText={(v) => set({ targets: { ...t, max_carbs_g: num(v) } })} />
          </View>
        </Panel>

        <Panel>
          <PanelTitle>Planning</PanelTitle>
          <View className="gap-4">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="font-sans-medium text-sm text-foreground">Days to plan</Text>
              <Stepper name="Days" value={p.days} text={p.days === 1 ? "1 day" : `${p.days} days`} min={1} max={7}
                       onChange={(days) => set({ days })} />
            </View>
            <Field name="Longest recipe (min)" keyboardType="number-pad" placeholder="no limit"
                   value={shown(p.max_minutes)} onChangeText={(v) => set({ max_minutes: num(v) })} />
            <View className="gap-1.5">
              <Text className="font-sans-medium text-sm text-foreground">Meals each day</Text>
              <View className="flex-row flex-wrap gap-2">
                {meta.meal_types.map((m) => (
                  <Toggle key={m} text={label(m)} label={`Meal: ${label(m)}`} on={p.meals.includes(m)}
                          onPress={() => { const next = flip(p.meals, m); if (next.length) set({ meals: next }) }} />
                ))}
              </View>
            </View>
            <View className="gap-1.5">
              <Text className="font-sans-medium text-sm text-foreground">Favourite cuisines</Text>
              <View className="flex-row flex-wrap gap-2">
                {meta.cuisines.map((c) => (
                  <Toggle key={c} text={label(c)} label={`Cuisine: ${label(c)}`} on={p.cuisines.includes(c)}
                          onPress={() => set({ cuisines: flip(p.cuisines, c) })} />
                ))}
              </View>
            </View>
            <Field name="Tastes" multiline maxLength={300} placeholder="e.g. loves spicy food, no fiddly baking"
                   value={p.notes} onChangeText={(notes) => set({ notes })} />
          </View>
        </Panel>
      </ScrollView>
      <View className="border-t border-border bg-background px-4 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
        <Button text={saving ? "Saving…" : draft ? "Save profile" : "Saved"} icon={Save} busy={saving} disabled={!draft}
                onPress={save} />
      </View>
    </View>
  )
}

/** Daily energy as one number (met within ±10%) or a range (met anywhere inside it; either end may
 * be left open). Switching keeps the person's numbers: ±10% becomes the range. */
function EnergyTarget({ t, range, onRange, onChange }: {
  t: NutritionTargets; range: boolean; onRange: (range: boolean) => void; onChange: (t: NutritionTargets) => void
}) {
  function pick(toRange: boolean) {
    if (toRange === range) return
    const goal = kcalGoal(t)
    onRange(toRange)
    onChange(toRange
      ? { ...t, kcal: null, min_kcal: goal ? Math.round(goal * 0.9) : null, max_kcal: goal ? Math.round(goal * 1.1) : null }
      : { ...t, kcal: goal ? Math.round(goal) : null, min_kcal: null, max_kcal: null })
  }
  const field = (k: "kcal" | "min_kcal" | "max_kcal", name: string) => (
    <Field className="flex-1" name={name} keyboardType="number-pad" value={shown(t[k])}
           onChangeText={(v) => onChange({ ...t, [k]: num(v) })} />
  )
  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="font-sans-medium text-[13px] text-foreground">Energy per day</Text>
        <Segmented name="Energy target" value={range ? "range" : "one"} onChange={(v) => pick(v === "range")}
                   options={[{ value: "one", label: "One number" }, { value: "range", label: "A range" }]} />
      </View>
      <View className="flex-row gap-3">
        {range ? <>{field("min_kcal", "At least (kcal)")}{field("max_kcal", "At most (kcal)")}</> : field("kcal", "Energy (kcal)")}
        {!range && <View className="flex-1" />}
      </View>
      <Text className="font-sans text-xs text-muted-foreground">
        {range
          ? "Any day inside the range meets it. Leave one end blank for only a floor or a ceiling."
          : "A day within 10% of it meets it."}
      </Text>
    </View>
  )
}

/** Foods the planner and search leave out, matched to the ingredient table as they are typed. */
function ExcludeFoods({ foods: excluded, onChange }: { foods: string[]; onChange: (foods: string[]) => void }) {
  const { data: foods } = useFoods()
  const [text, setText] = useState("")
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    if (q.length < 2 || !foods) return []
    return foods.filter((f) => f.name.toLowerCase().includes(q) && !excluded.includes(f.key)).slice(0, 6)
  }, [text, foods, excluded])

  function add(key: string) {
    if (key) onChange([...new Set([...excluded, key])])
    setText("")
  }
  const typed = () => {
    const q = text.trim().toLowerCase()
    add(foods?.find((f) => f.name.toLowerCase() === q)?.key ?? text.trim())
  }

  return (
    <View className="mt-5 gap-1.5">
      <Text className="font-sans-medium text-sm text-foreground">Foods you never eat</Text>
      <View className="flex-row gap-2">
        <TextInput accessibilityLabel="Foods you never eat" placeholder="e.g. mushroom" autoCapitalize="none"
                   placeholderTextColorClassName="accent-muted-foreground" value={text} onChangeText={setText}
                   returnKeyType="done" onSubmitEditing={typed} className={`${INPUT} h-11 flex-1`} />
        <Button text="Add" variant="outline" size="sm" className="h-11" onPress={typed} disabled={!text.trim()} />
      </View>
      {matches.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5">
          {matches.map((f) => (
            <Pressable key={f.key} accessibilityRole="button" accessibilityLabel={`Never eat ${label(f.name)}`}
                       onPress={() => add(f.key)} className="h-8 justify-center rounded-full border border-border px-3">
              <Text className="font-sans-medium text-[13px] text-foreground">{label(f.name)}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View className="flex-row flex-wrap gap-1.5">
        {excluded.map((f) => (
          <View key={f} className="h-8 flex-row items-center gap-1 rounded-full bg-surface-muted pr-1 pl-3">
            <Text className="font-sans-medium text-xs text-foreground">{label(f)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label(f)}`} hitSlop={6}
                       onPress={() => onChange(excluded.filter((x) => x !== f))}
                       className="size-6 items-center justify-center rounded-full">
              <Icon icon={X} size={12} />
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  )
}

/** The picture beside the person's name: taken or picked, cut square and shrunk on the phone. */
function PictureCard() {
  const { data: me, mutate } = useMe()
  const [busy, setBusy] = useState(false)

  async function change(call: () => Promise<Me | null>, done: string) {
    setBusy(true)
    try {
      const next = await call()
      if (next) {
        await mutate(next, { revalidate: false })
        toast.success(done)
      }
    } catch (e) {
      if (e instanceof PhotoAccessError) Alert.alert("Allow access", e.message)
      else toast.error(e instanceof Error ? e.message : "Could not update the picture")
    } finally {
      setBusy(false)
    }
  }
  const upload = (from: "camera" | "library") => change(async () => {
    const image = await pickAvatar(from)
    return image ? send<Me>("/me/avatar", "PUT", { image }) : null
  }, "Picture saved")

  return (
    <Panel>
      <PanelTitle>Profile picture</PanelTitle>
      <View className="flex-row items-center gap-4">
        <UserAvatar size={72} />
        <View className="flex-1 gap-2">
          <View className="flex-row flex-wrap gap-2">
            <Button text="Choose" icon={ImageIcon} variant="outline" size="sm" disabled={busy || !me} label="Choose a picture"
                    onPress={() => upload("library")} />
            <Button text="Take" icon={Camera} variant="outline" size="sm" disabled={busy || !me} label="Take a picture"
                    onPress={() => upload("camera")} />
            {me?.avatar_url && (
              <Button text="Remove" icon={Trash2} variant="ghost" size="sm" disabled={busy} label="Remove the picture"
                      onPress={() => change(() => send<Me>("/me/avatar", "DELETE"), "Picture removed")} />
            )}
          </View>
          <Text className="font-sans text-xs text-muted-foreground">
            Cropped to a square and shrunk on your phone first. Without one you get your Google picture or a food emoji.
          </Text>
        </View>
      </View>
    </Panel>
  )
}
