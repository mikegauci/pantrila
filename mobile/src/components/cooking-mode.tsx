import { router } from "expo-router"
import { useKeepAwake } from "expo-keep-awake"
import { ArrowLeft, ArrowRight, Check, ChefHat, ListChecks, Sun, Timer, X } from "lucide-react-native"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import useSWR from "swr"

import { bareName } from "@pantrila/core/amounts"
import { clock, progressKey, stepTimers, stepUses, type CookProgress, type RunningTimer, type StepTimer } from "@pantrila/core/cooking"
import { stepHeading } from "@pantrila/core/sections"
import { hasTemp } from "@pantrila/core/temperature"
import type { CookRequest, CookResult, StepSection } from "@pantrila/core/types"
import type { VoiceCommand } from "@pantrila/core/voice"

import { useAuth } from "@/components/auth-provider"
import { Stepper } from "@/components/bits"
import { amountText, ChangeList, Checklist, StepText, TimerPill, type CookIngredient } from "@/components/cooking-parts"
import { Icon } from "@/components/icon"
import { Sheet } from "@/components/sheet"
import { TemperatureToggle } from "@/components/temperature-toggle"
import { Toaster } from "@/components/toaster"
import { VoiceControl } from "@/components/voice-control"
import { send } from "@/lib/api"
import { chime, loadProgress, ring, saveProgress } from "@/lib/cooking"
import { useRefreshKitchen } from "@/lib/hooks"
import { useTempUnit } from "@/lib/temperature"
import { allowTimerAlerts, useTimerAlerts } from "@/lib/timer-alerts"
import { toast } from "@/lib/toast"

export interface CookRecipe {
  /** Unique per recipe, for the progress kept on the phone: "corpus:<id>" or "mine:<id>". */
  key: string
  title: string
  servings: number
  ingredients: CookIngredient[]
  steps: string[]
  /** Headings of the method, for cookbook recipes. */
  stepSections?: StepSection[]
  source: { recipe_id: string } | { cookbook_id: number }
  backHref: string
}

const MAX_SERVINGS = 24

/** Cooking mode for one recipe: reads the progress kept on the phone (12 hours), then opens it.
 * `servings` and `later` come from the link (the plan's "Start cooking"). */
export function CookingScreen({ recipe, servings, later }: { recipe: CookRecipe; servings?: number; later?: number }) {
  const userId = useAuth().session!.user.id
  const key = progressKey(userId, recipe.key)
  const [initial, setInitial] = useState<Omit<CookProgress, "savedAt"> | null>(null)

  useEffect(() => {
    let live = true
    loadProgress(key).then((p) => {
      if (!live) return
      const fromLink = servings && servings >= 1 && servings <= MAX_SERVINGS ? Math.round(servings) : null
      setInitial(p ?? { page: 0, ticked: [], timers: [], servings: fromLink ?? recipe.servings })
    })
    return () => { live = false }
  }, [key, servings, recipe.servings])

  if (!initial) return <ActivityIndicator className="flex-1 bg-background" />
  return <CookingMode recipe={recipe} progressKey={key} initial={initial} later={Math.max(0, Math.round(later ?? 0))} />
}

/** Full screen, one step at a time: tick ingredients, run timers (they ring with the phone
 * locked), steer it by voice, keep the screen on, and finish with "I cooked this". */
function CookingMode({ recipe, progressKey: key, initial, later }: {
  recipe: CookRecipe; progressKey: string; initial: Omit<CookProgress, "savedAt">; later: number
}) {
  useKeepAwake()
  const insets = useSafeAreaInsets()
  const n = recipe.steps.length
  const [page, setPage] = useState(Math.min(initial.page, n + 1))
  const [ticked, setTicked] = useState(() => new Set(initial.ticked))
  const [servings, setServings] = useState(initial.servings)
  const [timers, setTimers] = useState<RunningTimer[]>(initial.timers)
  const [now, setNow] = useState(() => Date.now())
  const [listOpen, setListOpen] = useState(false)
  const [finished, setFinished] = useState<CookResult | null>(null)
  const [heard, setHeard] = useState<{ text: string; at: number } | null>(null)
  const [unit] = useTempUnit()
  const asked = useRef(false)

  const scale = servings / recipe.servings
  const onStep = page >= 1 && page <= n
  const step = onStep ? recipe.steps[page - 1] : ""
  const found = useMemo(() => (onStep ? stepTimers(step) : []), [onStep, step])
  const allUses = useMemo(
    () => stepUses(recipe.steps, recipe.ingredients, (s) => stepHeading(recipe.stepSections, s)),
    [recipe.steps, recipe.ingredients, recipe.stepSections],
  )
  const uses = onStep ? allUses[page - 1] : []
  useTimerAlerts(timers, recipe.title, !finished)

  // A step of the product funnel (pantrila.analytics); best effort, never shown.
  const source = "recipe_id" in recipe.source ? "corpus" : "mine"
  useEffect(() => {
    send("/me/events", "POST", { name: "cooking_mode_opened", source }).catch(() => {})
  }, [recipe.key, source])

  // Keep progress on the phone; "I cooked this" clears it.
  useEffect(() => {
    if (!finished) saveProgress(key, { page, ticked: [...ticked], servings, timers })
  }, [key, page, ticked, servings, timers, finished])

  // Tick while a timer runs; times are absolute, so a locked phone or a closed app loses nothing.
  const running = timers.some((t) => t.endsAt !== null && !t.rang)
  const latest = useRef(timers)
  useEffect(() => { latest.current = timers }, [timers])
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      const due = latest.current.filter((x) => x.endsAt !== null && !x.rang && x.endsAt <= t)
      if (!due.length) return
      ring()
      due.forEach((x) => toast.error(`Timer done: step ${x.step}, ${x.label}`))
      const ids = new Set(due.map((x) => x.id))
      setTimers((all) => all.map((x) => (ids.has(x.id) ? { ...x, rang: true } : x)))
    }, 500)
    return () => clearInterval(id)
  }, [running])

  const go = useCallback((to: number) => {
    setNow(Date.now())
    setPage(Math.max(0, Math.min(n + 1, to)))
  }, [n])

  const toggle = (i: number) => setTicked((s) => {
    const next = new Set(s)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  })

  const start = useCallback((t: StepTimer) => {
    if (!asked.current) {
      asked.current = true
      allowTimerAlerts()  // the first timer asks to ring with the phone locked
    }
    const at = Date.now()
    setNow(at)
    setTimers((all) => {
      if (all.some((x) => x.step === page && x.label === t.label && !x.rang)) return all
      return [...all, { id: at, step: page, label: t.label, seconds: t.seconds,
                        endsAt: at + t.seconds * 1000, left: t.seconds * 1000, rang: false }]
    })
  }, [page])

  const update = useCallback((id: number, change: (t: RunningTimer, at: number) => RunningTimer | null) => {
    const at = Date.now()
    setNow(at)
    setTimers((all) => all.flatMap((t) => {
      if (t.id !== id) return [t]
      const next = change(t, at)
      return next ? [next] : []
    }))
  }, [])

  // Voice: each command chimes and shows what it did for a moment (the web's rules).
  const onVoice = useCallback((c: VoiceCommand) => {
    const at = Date.now()
    const say = (text: string) => {
      chime()
      setHeard({ text, at })
    }
    if (c === "start") {
      if (page !== 0) return
      go(1)
      return say("Step 1")
    }
    if (c === "next") {
      if (page > n) return say("That was the last step")
      go(page + 1)
      return say(page === 0 ? "Step 1" : page === n ? "Finish" : "Next step")
    }
    if (c === "back") {
      if (page === 0) return say("This is the start")
      go(page - 1)
      return say("Previous step")
    }
    if (c === "stop-timer") {
      const done = timers.filter((t) => t.rang || (t.endsAt !== null && t.endsAt <= at))
      if (done.length) {
        setTimers((all) => all.filter((t) => !done.some((d) => d.id === t.id)))
        return say(done.length === 1 ? "Timer stopped" : "Timers stopped")
      }
      const runs = timers.filter((t) => t.endsAt !== null)
      if (!runs.length) return say("No timer is running")
      const last = runs.reduce((a, b) => (b.id > a.id ? b : a))
      update(last.id, (x, t) => (x.endsAt !== null ? { ...x, endsAt: null, left: x.endsAt - t } : x))
      return say(`Timer paused: ${clock(last.endsAt! - at)} left`)
    }
    // start-timer: resume the latest paused timer, else start this step's next one.
    const paused = timers.filter((t) => t.endsAt === null && !t.rang)
    if (paused.length) {
      const last = paused.reduce((a, b) => (b.id > a.id ? b : a))
      update(last.id, (x, t) => (x.endsAt === null ? { ...x, endsAt: t + x.left } : x))
      return say(`Timer resumed: ${clock(last.left)} left`)
    }
    if (!found.length) return say("No timer in this step")
    const next = found.find((t) => !timers.some((x) => x.step === page && x.label === t.label && !x.rang))
    if (!next) return say("Timer already running")
    start(next)
    say(`Timer started: ${next.label}`)
  }, [page, n, go, timers, found, start, update])

  useEffect(() => {
    if (!heard) return
    const id = setTimeout(() => setHeard(null), 2000)
    return () => clearTimeout(id)
  }, [heard])

  function leave() {
    if (router.canGoBack()) router.back()
    else router.replace(recipe.backHref as never)
  }

  const checklist = <Checklist ingredients={recipe.ingredients} scale={scale} ticked={ticked} onToggle={toggle} />
  const heading = stepHeading(recipe.stepSections, page)

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="h-14 flex-row items-center gap-2 border-b border-border bg-surface px-2">
        <Pressable accessibilityRole="button" accessibilityLabel="Leave cooking mode" onPress={leave}
                   className="size-10 items-center justify-center rounded-xl">
          <Icon icon={X} size={22} />
        </Pressable>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="font-sans-semibold text-[15px] text-foreground">{recipe.title}</Text>
          <Text className="font-sans text-xs text-muted-foreground">
            {page === 0 ? "Get ready" : page > n ? "Done" : `Step ${page} of ${n}`} · {servings} serving{servings === 1 ? "" : "s"}
          </Text>
        </View>
        {hasTemp(recipe.steps) && <TemperatureToggle />}
        <VoiceControl onCommand={onVoice} />
        <View accessible accessibilityLabel="Screen always on while you cook" className="size-8 items-center justify-center rounded-full bg-yellow-soft">
          <Icon icon={Sun} size={16} />
        </View>
      </View>
      <View className="h-1 bg-surface-muted">
        <View className="h-full bg-primary" style={{ width: `${(Math.min(page, n) / Math.max(n, 1)) * 100}%` }} />
      </View>

      {heard && (
        <View pointerEvents="none" className="absolute inset-x-0 z-50 items-center" style={{ top: insets.top + 72 }}>
          <Text accessibilityRole="alert" className="rounded-full bg-foreground px-4 py-2 font-sans-semibold text-[15px] text-background">
            {heard.text}
          </Text>
        </View>
      )}

      <ScrollView className="flex-1" contentContainerClassName="gap-6 px-4 py-6">
        {page === 0 && (
          <>
            <Text accessibilityRole="header" className="font-sans-bold text-2xl text-foreground">Get your ingredients out</Text>
            <Text className="-mt-3 font-sans text-base text-muted-foreground">
              Tick each one off as you set it out. Pantrila will show one step at a time.
            </Text>
            <View className="flex-row items-center justify-between">
              <Stepper name="Servings" value={servings} min={1} max={MAX_SERVINGS} onChange={setServings}
                       text={`${servings} serving${servings === 1 ? "" : "s"}`} />
              {ticked.size > 0 && (
                <Text accessibilityRole="button" onPress={() => setTicked(new Set())}
                      className="font-sans-medium text-sm text-foreground">Clear ticks</Text>
              )}
            </View>
            {later > 0 && (
              <Text className="-mt-3 font-sans text-[13px] text-muted-foreground">
                {later} of these servings {later === 1 ? "is" : "are"} for later in your plan: keep {later === 1 ? "it" : "them"} as leftovers.
              </Text>
            )}
            <View className="rounded-[20px] border border-border bg-surface px-4 py-2">{checklist}</View>
          </>
        )}

        {onStep && (
          <View accessibilityLiveRegion="polite" className="gap-6">
            <View className="flex-row items-center gap-3">
              <View className="size-9 items-center justify-center rounded-full bg-primary-soft">
                <Text className="font-sans-semibold text-[15px] text-primary-text">{page}</Text>
              </View>
              <Text accessibilityRole="header" className="font-sans-semibold text-[13px] uppercase text-primary-text">
                Step {page} of {n}
              </Text>
            </View>
            {heading !== "" && <Text className="-mt-3 font-sans-semibold text-[15px] text-muted-foreground">{heading}</Text>}
            <StepText steps={recipe.steps} index={page - 1} unit={unit} />
            {uses.length > 0 && (
              <View accessibilityLabel="Ingredients for this step">
                <Text className="mb-2 font-sans-medium text-xs text-muted-foreground">For this step (tap when completed)</Text>
                <View className="flex-row flex-wrap gap-2">
                  {uses.map((i) => {
                    const ing = recipe.ingredients[i]
                    const on = ticked.has(i)
                    return (
                      <Pressable key={i} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                                 accessibilityLabel={`${amountText(ing, scale)} ${bareName(ing.name)}`} onPress={() => toggle(i)}
                                 className={`min-h-10 flex-row items-center gap-2 rounded-2xl border px-3 py-2 ${on ? "border-primary bg-primary-soft" : "border-border bg-surface"}`}>
                        {on && <Icon icon={Check} tone="primary-text" size={16} strokeWidth={3} />}
                        <View className="rounded-lg bg-surface-muted px-2 py-0.5">
                          <Text className="font-sans-semibold text-sm text-foreground">{amountText(ing, scale)}</Text>
                        </View>
                        <Text className={`shrink font-sans text-sm ${on ? "text-primary-text" : "text-foreground"}`}>{bareName(ing.name)}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            )}
            {found.length > 0 && (
              <View className="flex-row flex-wrap gap-2">
                {found.map((t, i) => (
                  <Pressable key={i} accessibilityRole="button" onPress={() => start(t)}
                             className="h-12 flex-row items-center gap-2 rounded-xl border border-orange/60 bg-orange-soft px-4">
                    <Icon icon={Timer} size={18} />
                    <Text className="font-sans-semibold text-base text-foreground">Start {t.label} timer</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {page > n && (
          <Finish recipe={recipe} servings={servings} result={finished} onBack={() => go(n)} onLeave={leave}
                  onDone={(r) => {
                    setFinished(r)
                    setTimers([])
                    saveProgress(key, null)
                  }} />
        )}
      </ScrollView>

      {timers.length > 0 && (
        <View accessibilityLabel="Timers" className="border-t border-border bg-surface py-2">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-3">
            {timers.map((t) => <TimerPill key={t.id} timer={t} now={now} onChange={(c) => update(t.id, c)} />)}
          </ScrollView>
        </View>
      )}

      {page <= n && (
        <View className="gap-3 border-t border-border bg-surface px-3 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
          {onStep && (
            <Pressable accessibilityRole="button" onPress={() => setListOpen(true)}
                       className="h-12 flex-row items-center justify-between rounded-xl border border-border px-4">
              <View className="flex-row items-center gap-2">
                <Icon icon={ListChecks} size={18} />
                <Text className="font-sans-medium text-base text-foreground">Check ingredient list</Text>
              </View>
              <Text className="font-sans text-base text-muted-foreground">{ticked.size}/{recipe.ingredients.length}</Text>
            </Pressable>
          )}
          <View className="flex-row gap-3">
            <Pressable accessibilityRole="button" accessibilityLabel="Back" accessibilityState={{ disabled: page === 0 }}
                       disabled={page === 0} onPress={() => go(page - 1)}
                       className={`h-14 flex-row items-center gap-2 rounded-xl border border-border px-5 ${page === 0 ? "opacity-50" : ""}`}>
              <Icon icon={ArrowLeft} size={18} />
              <Text className="font-sans-semibold text-base text-foreground">Back</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => go(page + 1)}
                       className="h-14 flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-primary">
              <Text className="font-sans-semibold text-base text-primary-foreground">
                {page === 0 ? "Start cooking" : page === n ? "Finish" : "Next step"}
              </Text>
              <Icon icon={page === n ? Check : ArrowRight} tone="primary-foreground" size={18} />
            </Pressable>
          </View>
        </View>
      )}

      <Sheet open={listOpen} onClose={() => setListOpen(false)} title="Ingredients">{checklist}</Sheet>
      <Toaster />
    </View>
  )
}

function Finish({ recipe, servings, result, onDone, onBack, onLeave }: {
  recipe: CookRecipe
  servings: number
  result: CookResult | null
  onDone: (r: CookResult) => void
  onBack: () => void
  onLeave: () => void
}) {
  const [updatePantry, setUpdatePantry] = useState(true)
  const [busy, setBusy] = useState(false)
  const refreshKitchen = useRefreshKitchen()
  const body: CookRequest = { ...recipe.source, servings, update_pantry: updatePantry }
  const { data: preview, error } = useSWR(
    result ? null : ["/me/cooked/preview", recipe.key, servings],
    () => send<CookResult>("/me/cooked/preview", "POST", { ...body, update_pantry: true }),
  )

  async function cooked() {
    setBusy(true)
    try {
      const r = await send<CookResult>("/me/cooked", "POST", body)
      onDone(r)
      refreshKitchen()
      toast.success(updatePantry && r.pantry.length ? "Logged, and your pantry is up to date" : "Logged. Enjoy your meal!")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save. Try again.")
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const changed = result.cooked?.pantry_updated && result.pantry.length > 0
    return (
      <View className="items-start gap-4">
        <View className="size-14 items-center justify-center rounded-full bg-primary-soft">
          <Icon icon={Check} tone="primary-text" size={28} strokeWidth={3} />
        </View>
        <Text accessibilityRole="header" className="font-sans-bold text-2xl text-foreground">Enjoy your meal</Text>
        <Text className="font-sans text-base text-muted-foreground">
          Logged {recipe.title}, {servings} serving{servings === 1 ? "" : "s"}.{changed ? " Your pantry now shows what is left." : ""}
        </Text>
        {changed && <ChangeList changes={result.pantry} />}
        <Pressable accessibilityRole="button" onPress={onLeave} className="h-12 justify-center rounded-xl bg-primary px-5">
          <Text className="font-sans-semibold text-base text-primary-foreground">Back to the recipe</Text>
        </Pressable>
      </View>
    )
  }

  const changes = preview?.pantry ?? []
  return (
    <View className="gap-5">
      <View className="size-14 items-center justify-center rounded-full bg-yellow-soft">
        <Icon icon={ChefHat} size={28} />
      </View>
      <Text accessibilityRole="header" className="font-sans-bold text-2xl text-foreground">That is every step</Text>
      <Text className="-mt-3 font-sans text-base text-muted-foreground">
        Tap “I cooked this” to log it. Pantrila can also take what you used out of your pantry, so your grocery list
        stays right.
      </Text>
      <View className="gap-3 rounded-[20px] border border-border bg-surface p-4">
        <View className="flex-row items-center gap-4">
          <View className="flex-1">
            <Text className="font-sans-semibold text-base text-foreground">Take what I used out of my pantry</Text>
            <Text className="font-sans text-xs text-muted-foreground">
              Only items with an amount change; ones without an amount stay as they are.
            </Text>
          </View>
          <Switch accessibilityLabel="Take what I used out of my pantry" value={updatePantry} onValueChange={setUpdatePantry}
                  thumbColorClassName="accent-surface" trackColorOnClassName="accent-primary" />
        </View>
        <View className={updatePantry ? "" : "opacity-50"}>
          {error ? <Text className="font-sans text-[13px] text-danger">{error.message}</Text>
            : !preview ? <Text className="font-sans text-[13px] text-muted-foreground">Checking your pantry…</Text>
            : changes.length ? <ChangeList changes={changes} />
            : <Text className="font-sans text-[13px] text-muted-foreground">No measured pantry item changes.</Text>}
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={cooked}
                 className={`h-14 flex-row items-center justify-center gap-2 rounded-xl bg-primary ${busy ? "opacity-60" : ""}`}>
        {busy ? <ActivityIndicator size="small" color="white" /> : <Icon icon={ChefHat} tone="primary-foreground" size={18} />}
        <Text className="font-sans-semibold text-base text-primary-foreground">I cooked this</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onBack}
                 className="h-12 flex-row items-center justify-center gap-2 rounded-xl border border-border">
        <Icon icon={ArrowLeft} size={18} />
        <Text className="font-sans-semibold text-base text-foreground">Last step</Text>
      </Pressable>
    </View>
  )
}
