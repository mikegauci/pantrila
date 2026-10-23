"use client"

import { Camera, Compass, Save, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { UserAvatar } from "@/components/app-shell"
import { useAuth } from "@/components/auth-provider"
import { Panel, PanelTitle } from "@/components/bits"
import { GoogleMark } from "@/components/google-mark"
import { useTour } from "@/components/tour"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, send } from "@/lib/api"
import { label } from "@/lib/format"
import { useFoods, useMe, useMeta, useProfile, useRefreshKitchen } from "@/lib/hooks"
import { toAvatarDataUrl } from "@/lib/images"
import { googlePicture, linkGoogle, supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { hasKcalRange, kcalGoal } from "@/lib/plan"
import type { Allergen, DietTag, MealType, Me, NutritionTargets, Profile } from "@/lib/types"

const DIET_HELP: Partial<Record<DietTag, string>> = {
  low_carb: "at most 20 g carbs per serving",
  high_protein: "at least 25 g protein per serving",
}

const PRESETS: { name: string; patch: Partial<Profile> }[] = [
  { name: "Vegan, high protein", patch: { diets: ["vegan"], allergies: [], targets: { kcal: 2200, min_protein_g: 110, max_carbs_g: null } } },
  { name: "Coeliac", patch: { diets: ["gluten_free"], allergies: ["gluten"], targets: { kcal: 2000, min_protein_g: null, max_carbs_g: null } } },
  { name: "Nut allergy, family", patch: { diets: [], allergies: ["peanuts", "tree_nuts"], targets: { kcal: 2100, min_protein_g: 80, max_carbs_g: null } } },
]

function HelpCard() {
  const tour = useTour()
  return (
    <Panel>
      <PanelTitle>Help</PanelTitle>
      <p className="mb-4 text-muted-foreground">A one-minute walk through the Assistant, recipes, your cookbook and the meal plan.</p>
      <Button variant="outline" onClick={tour.start}>
        <Compass /> Replay the tour
      </Button>
    </Panel>
  )
}

/** Forget what this browser kept for the person: drafts, cooking progress, tour, import jobs. */
function forgetLocal(userId: string) {
  for (const store of [localStorage, sessionStorage]) {
    try {
      for (const key of Object.keys(store)) if (key.includes(userId)) store.removeItem(key)
      store.removeItem("pantrila-photo-jobs")
    } catch {
      // storage blocked: nothing to forget
    }
  }
}

function DeleteAccountCard() {
  const { session } = useAuth()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const user = session?.user
  if (!user) return null

  async function remove() {
    if (!user) return
    setBusy(true)
    try {
      await send("/me", "DELETE")
    } catch (e) {
      setBusy(false)
      toast.error(e instanceof ApiError ? e.message : "Your account could not be deleted. Try again.")
      return
    }
    forgetLocal(user.id)
    await supabase().auth.signOut({ scope: "local" })  // the sign-in is already gone on the server
    toast.success("Your account and everything in it are deleted.")
    router.replace("/login")
  }

  return (
    <Panel>
      <PanelTitle>Delete account</PanelTitle>
      <p className="mb-4 text-muted-foreground">
        Deletes your profile, pantry, meal plans, chats, cookbook recipes and their photos, your
        picture and your sign-in, straight away. This cannot be undone.
      </p>
      {!open ? (
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 /> Delete my account
        </Button>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (typed.trim().toLowerCase() === "delete") remove()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-delete">Type <strong>delete</strong> to confirm</Label>
            <Input id="confirm-delete" autoComplete="off" autoCapitalize="none" className="h-10" value={typed}
                   onChange={(e) => setTyped(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={busy || typed.trim().toLowerCase() !== "delete"}>
              <Trash2 /> {busy ? "Deleting…" : "Delete everything"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { setOpen(false); setTyped("") }}>
              Keep my account
            </Button>
          </div>
        </form>
      )}
    </Panel>
  )
}

function AccountCard() {
  const { session } = useAuth()
  const [busy, setBusy] = useState(false)
  const user = session?.user
  if (!user) return null
  const google = user.identities?.some((i) => i.provider === "google")

  if (!user.is_anonymous) {
    return (
      <Panel>
        <PanelTitle>Account</PanelTitle>
        <p className="flex items-center gap-2 text-muted-foreground">
          {google && <GoogleMark className="size-4" />}
          Signed in{google ? " with Google" : ""} as <strong className="text-foreground">{user.email}</strong>
        </p>
      </Panel>
    )
  }
  return (
    <Panel>
      <PanelTitle>Keep your data</PanelTitle>
      <p className="mb-4 text-muted-foreground">
        You are a guest, so everything lives in this browser session. Add Google to keep your
        profile, pantry, plans, cookbook and chats and open them on any device.
      </p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          const error = await linkGoogle()
          // On success the browser is leaving for Google.
          if (error) {
            setBusy(false)
            toast.error(`Could not add Google: ${error}`)
          }
        }}
      >
        <GoogleMark /> {busy ? "Opening Google…" : "Continue with Google"}
      </Button>
    </Panel>
  )
}

function Toggle<T extends string>({ value, on, onToggle, danger }: { value: T; on: boolean; onToggle: (v: T) => void; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onToggle(value)}
      className={cn(
        "h-8 rounded-full border px-3 text-[13px] font-medium transition-colors duration-150",
        on ? (danger ? "border-danger bg-danger text-white" : "border-primary bg-primary-soft text-primary-text")
           : "bg-surface text-muted-foreground hover:text-foreground",
      )}
    >
      {label(value)}
    </button>
  )
}

const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
const num = (s: string) => (s.trim() === "" ? null : Number(s))

/** Daily energy as one number (met within ±10%) or a range (met anywhere inside it; either
 * end may be left open). Switching keeps the person's numbers: ±10% becomes the range. */
function EnergyTarget({ t, range, onRange, onChange }: {
  t: NutritionTargets; range: boolean; onRange: (range: boolean) => void
  onChange: (t: NutritionTargets) => void
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
    <div className="grid gap-1.5">
      <Label htmlFor={k} className="text-[12px]">{name}</Label>
      <Input id={k} type="number" min="1" inputMode="numeric" className="tabular h-10"
             value={t[k] ?? ""} onChange={(e) => onChange({ ...t, [k]: num(e.target.value) })} />
    </div>
  )
  return (
    <fieldset className="grid gap-2" aria-labelledby="energy-label">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id="energy-label" className="text-[13px] font-medium">Energy per day</span>
        <div role="radiogroup" aria-label="Energy target" className="flex gap-1 rounded-full bg-surface-muted p-1">
          {([[false, "One number"], [true, "A range"]] as const).map(([value, name]) => (
            <button key={name} type="button" role="radio" aria-checked={range === value} onClick={() => pick(value)}
              className={cn("h-7 rounded-full px-3 text-[12px] font-medium transition-colors",
                range === value ? "bg-surface shadow-soft" : "text-muted-foreground hover:text-foreground")}>
              {name}
            </button>
          ))}
        </div>
      </div>
      {range ? (
        <div className="grid grid-cols-2 gap-3">
          {field("min_kcal", "At least (kcal)")}
          {field("max_kcal", "At most (kcal)")}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">{field("kcal", "Energy (kcal)")}</div>
      )}
      <p className="text-[12px] text-muted-foreground">
        {range
          ? "Any day inside the range meets it. Leave one end blank for only a floor or a ceiling."
          : "A day within 10% of it meets it."}
      </p>
    </fieldset>
  )
}

function PictureCard() {
  const { session } = useAuth()
  const { data: me, mutate, isLoading } = useMe()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function change(call: () => Promise<Me>, done: string) {
    setBusy(true)
    try {
      await mutate(await call(), { revalidate: false })
      toast.success(done)
    } catch (e) {
      toast.error(e instanceof ApiError || e instanceof Error ? e.message : "Could not update the picture")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel>
      <PanelTitle>Profile picture</PanelTitle>
      <div className="flex items-center gap-4">
        <UserAvatar userId={session?.user.id ?? null} email={session?.user.email ?? null} size="xl" url={me?.avatar_url ?? googlePicture(session?.user)} pending={isLoading && !googlePicture(session?.user)} />
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy || !me} onClick={() => input.current?.click()}>
              <Camera /> {me?.avatar_url ? "Change picture" : "Upload picture"}
            </Button>
            {me?.avatar_url && (
              <Button variant="ghost" size="sm" disabled={busy}
                      onClick={() => change(() => send<Me>("/me/avatar", "DELETE"), "Picture removed")}>
                <Trash2 /> Remove
              </Button>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground">
            Cropped to a square and shrunk on your device first. Without one you get your Google picture or a food emoji.
          </p>
        </div>
        <input
          ref={input} type="file" accept="image/*" className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (file) change(async () => send<Me>("/me/avatar", "PUT", { image: await toAvatarDataUrl(file) }), "Picture saved")
          }}
        />
      </div>
    </Panel>
  )
}

export default function ProfilePage() {
  const { data, isLoading, mutate } = useProfile()
  const { data: meta } = useMeta()
  const { data: foods } = useFoods()
  const refreshKitchen = useRefreshKitchen()
  const [draft, setP] = useState<Profile | null>(null)
  const [exclude, setExclude] = useState("")
  const [saving, setSaving] = useState(false)
  const [kcalRange, setKcalRange] = useState<boolean | null>(null) // null: follow the saved profile
  const p = draft ?? data ?? null

  if (isLoading || !p || !meta) return <Skeleton className="h-96 rounded-[20px]" />
  const set = (patch: Partial<Profile>) => setP({ ...p, ...patch })

  async function save() {
    setSaving(true)
    try {
      const saved = await send<Profile>("/me/profile", "PUT", p)
      await mutate(saved, { revalidate: false })
      setP(null)
      await refreshKitchen()
      toast.success("Profile saved")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted-foreground">Start from an example:</span>
        {PRESETS.map((x) => (
          <Button key={x.name} variant="outline" size="sm" onClick={() => { setKcalRange(null); set(x.patch) }}>{x.name}</Button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="grid gap-5 lg:col-span-2">
          <AccountCard />
          <PictureCard />
        </div>
        <Panel>
          <PanelTitle>Allergies</PanelTitle>
          <p className="mb-3 text-[13px] text-muted-foreground">
            The 14 allergens EU law requires on labels. Pantrila never shows a recipe or plan with
            one of yours without a red warning; it checks the ingredients in code, not the AI&apos;s word.
          </p>
          <div className="flex flex-wrap gap-2">
            {meta.allergens.map((a) => (
              <Toggle<Allergen> key={a} value={a} danger on={p.allergies.includes(a)} onToggle={(v) => set({ allergies: flip(p.allergies, v) })} />
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelTitle>Diet</PanelTitle>
          <div className="flex flex-wrap gap-2">
            {meta.diets.map((d) => (
              <Toggle<DietTag> key={d} value={d} on={p.diets.includes(d)} onToggle={(v) => set({ diets: flip(p.diets, v) })} />
            ))}
          </div>
          {p.diets.some((d) => DIET_HELP[d]) && (
            <p className="mt-3 text-[12px] text-muted-foreground">
              {p.diets.filter((d) => DIET_HELP[d]).map((d) => `${label(d)} means ${DIET_HELP[d]}.`).join(" ")}
            </p>
          )}
          <div className="mt-5 grid gap-1.5">
            <Label htmlFor="exclude">Foods you never eat</Label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const key = foods?.find((f) => f.name === exclude.trim().toLowerCase())?.key ?? exclude.trim()
                if (key) set({ exclude_foods: [...new Set([...p.exclude_foods, key])] })
                setExclude("")
              }}
            >
              <Input id="exclude" list="exclude-foods" placeholder="e.g. mushroom" value={exclude}
                     onChange={(e) => setExclude(e.target.value)} className="h-10" />
              <datalist id="exclude-foods">{foods?.map((f) => <option key={f.key} value={f.name} />)}</datalist>
              <Button type="submit" variant="outline">Add</Button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {p.exclude_foods.map((f) => (
                <span key={f} className="inline-flex h-7 items-center gap-1 rounded-full bg-surface-muted pr-1 pl-3 text-[12px] font-medium">
                  {label(f)}
                  <button type="button" aria-label={`Remove ${label(f)}`} className="grid size-5 place-items-center rounded-full hover:bg-border"
                          onClick={() => set({ exclude_foods: p.exclude_foods.filter((x) => x !== f) })}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelTitle>Daily targets</PanelTitle>
          <p className="mb-3 text-[13px] text-muted-foreground">
            Goals, not rules: the planner sets portions to hit your energy target and reports any
            day it misses. Leave blank for no target.
          </p>
          <EnergyTarget t={p.targets} range={kcalRange ?? hasKcalRange(p.targets)} onRange={setKcalRange}
            onChange={(targets) => set({ targets })} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            {([
              ["min_protein_g", "Protein at least (g)"],
              ["max_carbs_g", "Carbs at most (g)"],
            ] as const).map(([k, name]) => (
              <div key={k} className="grid gap-1.5">
                <Label htmlFor={k} className="text-[12px]">{name}</Label>
                <Input id={k} type="number" min="1" inputMode="numeric" className="tabular h-10"
                       value={p.targets[k] ?? ""}
                       onChange={(e) => set({ targets: { ...p.targets, [k]: num(e.target.value) } })} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelTitle>Planning</PanelTitle>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="days">Days to plan</Label>
                <Input id="days" type="number" min="1" max="7" className="tabular h-10" value={p.days}
                       onChange={(e) => set({ days: Math.min(7, Math.max(1, Number(e.target.value) || 1)) })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="minutes">Longest recipe (min)</Label>
                <Input id="minutes" type="number" min="5" className="tabular h-10" placeholder="no limit"
                       value={p.max_minutes ?? ""} onChange={(e) => set({ max_minutes: num(e.target.value) })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Meals each day</span>
              <div className="flex flex-wrap gap-2">
                {meta.meal_types.map((m) => (
                  <Toggle<MealType> key={m} value={m} on={p.meals.includes(m)}
                                    onToggle={(v) => { const next = flip(p.meals, v); if (next.length) set({ meals: next }) }} />
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Favourite cuisines</span>
              <div className="flex flex-wrap gap-2">
                {meta.cuisines.map((c) => (
                  <Toggle<string> key={c} value={c} on={p.cuisines.includes(c)} onToggle={(v) => set({ cuisines: flip(p.cuisines, v) })} />
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="notes">Tastes</Label>
              <Textarea id="notes" maxLength={300} placeholder="e.g. loves spicy food, no fiddly baking"
                        value={p.notes} onChange={(e) => set({ notes: e.target.value })} />
            </div>
          </div>
        </Panel>

        <HelpCard />
        <DeleteAccountCard />
      </div>

      <div className="sticky bottom-20 flex justify-end md:bottom-6">
        <Button size="lg" onClick={save} disabled={saving} className="shadow-soft">
          <Save /> {saving ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </div>
  )
}
