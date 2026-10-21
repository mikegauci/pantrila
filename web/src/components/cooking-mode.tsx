"use client"

import {
  ArrowLeft, ArrowRight, Check, ChefHat, CookingPot, ListChecks, Loader2, Minus, Pause, Play, Plus,
  Sun, SunDim, Timer, X,
} from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import useSWR from "swr"

import { IngredientText } from "@/components/amount"
import { useAuth } from "@/components/auth-provider"
import { TemperatureToggle } from "@/components/temperature-toggle"
import { Button, buttonVariants } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { send } from "@/lib/api"
import {
  clock, loadProgress, mentioned, progressKey, ring, saveProgress, stepTimers, useWakeLock,
  type RunningTimer, type StepTimer,
} from "@/lib/cooking"
import { ago } from "@/lib/format"
import { useCooked, useRefreshKitchen } from "@/lib/hooks"
import { hasTemp, showTemps, useTempUnit } from "@/lib/temperature"
import { groupLines, stepHeading } from "@/lib/sections"
import type { CookRequest, CookResult, PantryChange, StepSection, Unit } from "@/lib/types"
import { cn } from "@/lib/utils"

export interface CookIngredient {
  name: string
  food: string | null
  quantity: number
  unit: Unit
  in_pantry: boolean
  /** The recipe's group heading for this ingredient ("Broth"); cookbook recipes only. */
  section?: string
}

export interface CookRecipe {
  /** Unique per recipe, for the progress kept in this browser: "corpus:<id>" or "mine:<id>". */
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

function amount(q: number) {
  return q < 10 ? String(Math.round(q * 100) / 100) : String(Math.round(q))
}

const MAX_SERVINGS = 24

// --- Entry point on the recipe pages ----------------------------------------------------------

const noSubscribe = () => () => {}

/** "Start cooking" (or "Resume cooking" with progress saved) and how often it was cooked. */
export function StartCooking({ href, recipeKey, match }: {
  href: string
  recipeKey: string
  match: { recipe_id: string } | { cookbook_id: number }
}) {
  const { session } = useAuth()
  const key = session ? progressKey(session.user.id, recipeKey) : null
  const saved = useSyncExternalStore(
    noSubscribe,
    () => (key ? loadProgress(key)?.page ?? null : null),
    () => null,
  )
  const { data: log } = useCooked()
  const mine = (log ?? []).filter((c) =>
    "recipe_id" in match ? c.recipe_id === match.recipe_id : c.cookbook_id === match.cookbook_id)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link href={href} className={buttonVariants({ size: "lg" })}>
        <CookingPot /> {saved ? "Resume cooking" : "Start cooking"}
      </Link>
      {mine.length > 0 && (
        <span className="text-[12px] text-muted-foreground">
          You cooked this {mine.length === 1 ? "once" : `${mine.length} times`}, last {ago(mine[0].cooked_at)}.
        </span>
      )}
    </div>
  )
}

// --- Cooking mode ---------------------------------------------------------------------------

/** Full-screen, one step at a time: tick ingredients, run timers, keep the screen awake, and
 * finish with "I cooked this". Progress stays in this browser for 12 hours. */
export function CookingMode({ recipe }: { recipe: CookRecipe }) {
  const { session } = useAuth()
  const key = progressKey(session!.user.id, recipe.key)
  // The URL from the hook: on a client-side visit window.location still shows the last page.
  const fromUrl = Number(useSearchParams().get("servings"))
  // Rendered only on the client after sign-in, so localStorage is available here.
  const [initial] = useState(() => {
    return loadProgress(key) ?? {
      page: 0, ticked: [], timers: [],
      servings: fromUrl >= 1 && fromUrl <= MAX_SERVINGS ? Math.round(fromUrl) : recipe.servings,
    }
  })
  const [page, setPage] = useState(Math.min(initial.page, recipe.steps.length + 1))
  const [ticked, setTicked] = useState(() => new Set(initial.ticked))
  const [servings, setServings] = useState(initial.servings)
  const [timers, setTimers] = useState<RunningTimer[]>(initial.timers)
  const [now, setNow] = useState(() => Date.now())
  const [listOpen, setListOpen] = useState(false)
  const [finished, setFinished] = useState<CookResult | null>(null)
  const wake = useWakeLock()
  const heading = useRef<HTMLHeadingElement>(null)

  const n = recipe.steps.length
  const scale = servings / recipe.servings
  const onStep = page >= 1 && page <= n
  const step = onStep ? recipe.steps[page - 1] : ""
  const [unit] = useTempUnit()
  const found = useMemo(() => (onStep ? stepTimers(step) : []), [onStep, step])
  const uses = useMemo(() => (onStep ? mentioned(step, recipe.ingredients) : []), [onStep, step, recipe.ingredients])

  // Keep progress in this browser; "I cooked this" clears it.
  useEffect(() => {
    if (!finished) saveProgress(key, { page, ticked: [...ticked], servings, timers })
  }, [key, page, ticked, servings, timers, finished])

  // The page covers the app, so the page behind it should not scroll.
  useEffect(() => {
    const before = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = before }
  }, [])

  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [page])

  // Tick while a timer runs; times are absolute, so a hidden tab or a reload loses nothing.
  const running = timers.some((t) => t.endsAt !== null && !t.rang)
  const latest = useRef(timers)
  useEffect(() => { latest.current = timers }, [timers])
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      const due = new Set(latest.current
        .filter((x) => x.endsAt !== null && !x.rang && x.endsAt <= t).map((x) => x.id))
      if (!due.size) return
      ring()
      for (const x of latest.current.filter((x) => due.has(x.id))) {
        toast.warning(`Timer done: step ${x.step}, ${x.label}`, { duration: 10_000 })
      }
      setTimers((all) => all.map((x) => (due.has(x.id) ? { ...x, rang: true } : x)))
    }, 500)
    return () => clearInterval(id)
  }, [running])

  const go = useCallback((to: number) => {
    setNow(Date.now())
    setPage(Math.max(0, Math.min(n + 1, to)))
  }, [n])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [role=dialog]")) return
      if (e.key === "ArrowRight") go(page + 1)
      if (e.key === "ArrowLeft") go(page - 1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go, page])

  const toggle = (i: number) => setTicked((s) => {
    const next = new Set(s)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  })

  const start = useCallback((t: StepTimer) => {
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

  const checklist = (
    <IngredientChecklist ingredients={recipe.ingredients} scale={scale} ticked={ticked} onToggle={toggle} />
  )

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background" role="region" aria-label={`Cooking ${recipe.title}`}>
      <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-surface px-3 sm:px-6">
        <Link href={recipe.backHref} className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="Leave cooking mode">
          <X />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-[22px]">{recipe.title}</p>
          <p className="tabular text-[12px] text-muted-foreground">
            {page === 0 ? "Get ready" : page > n ? "Done" : `Step ${page} of ${n}`} · {servings} serving{servings === 1 ? "" : "s"}
          </p>
        </div>
        {hasTemp(recipe.steps) && <TemperatureToggle />}
        <WakeBadge state={wake} />
        {onStep && (
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setListOpen(true)}>
            <ListChecks /> {ticked.size}/{recipe.ingredients.length}
          </Button>
        )}
      </header>
      <div className="h-1 shrink-0 bg-surface-muted" aria-hidden>
        <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${(Math.min(page, n) / Math.max(n, 1)) * 100}%` }} />
      </div>

      <div className="flex min-h-0 flex-1">
        {onStep && (
          <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-r bg-surface p-5 lg:block" aria-label="Ingredients">
            <h2 className="mb-2 text-[15px] font-semibold">Ingredients</h2>
            {checklist}
          </aside>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-4 py-6 sm:px-8 md:py-10">
            {page === 0 && (
              <>
                <h2 ref={heading} tabIndex={-1} className="text-[24px] font-bold leading-8 outline-none">Get your ingredients out</h2>
                <p className="-mt-3 text-muted-foreground">Tick each one off as you set it out. Pantrila will show one step at a time.</p>
                <div className="flex items-center gap-3" aria-label="Servings">
                  <Button variant="outline" size="icon" aria-label="Fewer servings" disabled={servings <= 1}
                          onClick={() => setServings(servings - 1)}><Minus /></Button>
                  <span className="tabular w-24 text-center font-semibold">{servings} serving{servings === 1 ? "" : "s"}</span>
                  <Button variant="outline" size="icon" aria-label="More servings" disabled={servings >= MAX_SERVINGS}
                          onClick={() => setServings(servings + 1)}><Plus /></Button>
                  {ticked.size > 0 && (
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setTicked(new Set())}>Clear ticks</Button>
                  )}
                </div>
                <div className="rounded-[20px] border bg-surface p-4 sm:p-5">{checklist}</div>
              </>
            )}

            {onStep && (
              <div aria-live="polite" className="flex flex-col gap-6">
                <h2 ref={heading} tabIndex={-1}
                    className="inline-flex items-center gap-3 text-[13px] font-semibold uppercase tracking-wide text-primary-text outline-none">
                  <span className="tabular grid size-9 place-items-center rounded-full bg-primary-soft text-[15px]">{page}</span>
                  Step {page} of {n}
                </h2>
                {stepHeading(recipe.stepSections, page) && (
                  <p className="-mt-3 text-[15px] font-semibold text-muted-foreground">
                    {stepHeading(recipe.stepSections, page)}
                  </p>
                )}
                <p className="text-[22px] leading-[34px] font-medium md:text-[28px] md:leading-[42px]">{showTemps(step, unit)}</p>
                {uses.length > 0 && (
                  <div role="group" aria-label="Ingredients for this step">
                    <p className="mb-2 text-[12px] font-medium text-muted-foreground">For this step (tap when it is out)</p>
                    <div className="flex flex-wrap gap-2">
                      {uses.map((i) => {
                        const ing = recipe.ingredients[i]
                        const on = ticked.has(i)
                        return (
                          <button key={i} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(i)}
                                  className={cn("inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-[14px] transition-colors",
                                                on ? "border-primary bg-primary-soft text-primary-text" : "bg-surface hover:bg-surface-muted")}>
                            {on && <Check className="size-4" strokeWidth={3} aria-hidden />}
                            <span><IngredientText line={ing} scale={scale} fixed /></span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {found.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {found.map((t, i) => (
                      <Button key={i} variant="outline" size="lg" onClick={() => start(t)}
                              className="border-orange/60 bg-orange-soft hover:bg-orange-soft/70">
                        <Timer /> Start {t.label} timer
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {page > n && (
              <Finish recipe={recipe} servings={servings} result={finished} heading={heading}
                      onBack={() => go(n)} onDone={(r) => {
                        setFinished(r)
                        setTimers([])
                        saveProgress(key, null)
                      }} />
            )}
          </div>
        </main>
      </div>

      {timers.length > 0 && (
        <section aria-label="Timers" className="shrink-0 border-t bg-surface px-3 py-2 sm:px-6">
          <ul className="no-scrollbar flex gap-2 overflow-x-auto">
            {timers.map((t) => (
              <TimerPill key={t.id} timer={t} now={now} onChange={(change) => update(t.id, change)} />
            ))}
          </ul>
        </section>
      )}

      {page <= n && (
        <footer className="flex shrink-0 gap-3 border-t bg-surface px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <Button variant="outline" size="lg" className="h-14 px-5" onClick={() => go(page - 1)} disabled={page === 0}>
            <ArrowLeft /> Back
          </Button>
          <Button size="lg" className="h-14 flex-1 text-[16px]" onClick={() => go(page + 1)}>
            {page === 0 ? <>Start cooking <ArrowRight /></> : page === n ? <>Finish <Check /></> : <>Next step <ArrowRight /></>}
          </Button>
        </footer>
      )}

      <Sheet open={listOpen} onOpenChange={setListOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] gap-2 overflow-y-auto rounded-t-[20px] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="p-0">
            <SheetTitle>Ingredients</SheetTitle>
          </SheetHeader>
          {checklist}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function WakeBadge({ state }: { state: "on" | "off" | "unsupported" }) {
  const on = state === "on"
  const Icon = on ? Sun : SunDim
  return (
    <span
      className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] font-medium sm:px-2.5",
                    on ? "bg-yellow-soft text-foreground" : "bg-surface-muted text-muted-foreground")}
      title={on ? "Pantrila is keeping your screen on while you cook." : "This browser may let the screen dim; tap it to wake it."}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only sm:not-sr-only">{on ? "Screen stays on" : "Screen may dim"}</span>
    </span>
  )
}

function IngredientChecklist({ ingredients, scale, ticked, onToggle }: {
  ingredients: CookIngredient[]
  scale: number
  ticked: Set<number>
  onToggle: (i: number) => void
}) {
  return (
    <div>
      {groupLines(ingredients).map((g, n) => (
        <div key={n}>
          {g.title && <h3 className="mt-4 mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h3>}
          <ul>
            {g.items.map(({ item: ing, index: i }) => {
              const on = ticked.has(i)
              return (
                <li key={i} className="border-b last:border-0">
                  <button type="button" role="checkbox" aria-checked={on} onClick={() => onToggle(i)}
                          className="flex min-h-12 w-full items-center gap-3 py-2 text-left">
                    <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors",
                                        on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                      {on && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
                    </span>
                    <span className={cn("flex-1", on && "text-muted-foreground line-through")}>
                      <IngredientText line={ing} scale={scale} fixed />
                    </span>
                    {ing.in_pantry && !on && (
                      <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary-text">In pantry</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function TimerPill({ timer: t, now, onChange }: {
  timer: RunningTimer
  now: number
  onChange: (change: (t: RunningTimer, at: number) => RunningTimer | null) => void
}) {
  const left = t.endsAt !== null ? t.endsAt - now : t.left
  const done = t.rang || left <= 0
  return (
    <li className={cn("flex shrink-0 items-center gap-2 rounded-2xl border py-1.5 pr-1.5 pl-3",
                      done ? "border-danger bg-danger-soft motion-safe:animate-pulse" : "bg-surface-muted")}>
      <div className="leading-tight">
        <p className="tabular text-[18px] font-bold" role="timer" aria-label={`Step ${t.step} timer`}>
          {done ? "Time's up" : clock(left)}
        </p>
        <p className="text-[11px] text-muted-foreground">Step {t.step} · {t.label}</p>
      </div>
      {!done && (
        <Button variant="ghost" size="icon-sm" aria-label={t.endsAt !== null ? "Pause timer" : "Resume timer"}
                onClick={() => onChange((x, at) => x.endsAt !== null
                  ? { ...x, endsAt: null, left: x.endsAt - at }
                  : { ...x, endsAt: at + x.left })}>
          {t.endsAt !== null ? <Pause /> : <Play />}
        </Button>
      )}
      <Button variant="ghost" size="sm" aria-label="Add a minute"
              onClick={() => onChange((x, at) => x.rang || (x.endsAt !== null && x.endsAt <= at)
                ? { ...x, rang: false, endsAt: at + 60_000, left: 60_000 }
                : x.endsAt !== null ? { ...x, endsAt: x.endsAt + 60_000 } : { ...x, left: x.left + 60_000 })}>
        +1 min
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Dismiss timer" onClick={() => onChange(() => null)}>
        <X />
      </Button>
    </li>
  )
}

function changeText(c: PantryChange) {
  return c.after === null ? "used up, removed" : `${amount(c.before)} → ${amount(c.after)} ${c.unit}`
}

function Finish({ recipe, servings, result, onDone, onBack, heading }: {
  recipe: CookRecipe
  servings: number
  result: CookResult | null
  onDone: (r: CookResult) => void
  onBack: () => void
  heading: React.RefObject<HTMLHeadingElement | null>
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
      refreshKitchen("recipe_id" in recipe.source
        ? `/recipes/${recipe.source.recipe_id}` : `/me/recipes/${recipe.source.cookbook_id}`)
      toast.success(updatePantry && r.pantry.length ? "Logged, and your pantry is up to date" : "Logged. Enjoy your meal!")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save. Try again.")
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="flex flex-col items-start gap-4">
        <span className="grid size-14 place-items-center rounded-full bg-primary-soft text-primary-text"><Check className="size-7" strokeWidth={3} /></span>
        <h2 ref={heading} tabIndex={-1} className="text-[24px] font-bold leading-8 outline-none">Enjoy your meal</h2>
        <p className="text-muted-foreground">
          Logged {recipe.title}, {servings} serving{servings === 1 ? "" : "s"}.
          {result.cooked?.pantry_updated && result.pantry.length > 0 && " Your pantry now shows what is left."}
        </p>
        {result.cooked?.pantry_updated && result.pantry.length > 0 && <ChangeList changes={result.pantry} />}
        <div className="flex flex-wrap gap-2">
          <Link href={recipe.backHref} className={buttonVariants({ size: "lg" })}>Back to the recipe</Link>
          <Link href="/pantry" className={buttonVariants({ variant: "outline", size: "lg" })}>Open pantry</Link>
        </div>
      </div>
    )
  }

  const changes = preview?.pantry ?? []
  return (
    <div className="flex flex-col gap-5">
      <span className="grid size-14 place-items-center rounded-full bg-yellow-soft"><ChefHat className="size-7" /></span>
      <h2 ref={heading} tabIndex={-1} className="text-[24px] font-bold leading-8 outline-none">That is every step</h2>
      <p className="-mt-3 text-muted-foreground">
        Tap &ldquo;I cooked this&rdquo; to log it. Pantrila can also take what you used out of your pantry, so your
        grocery list stays right.
      </p>
      <div className="rounded-[20px] border bg-surface p-4 sm:p-5">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block font-semibold">Take what I used out of my pantry</span>
            <span className="text-[12px] text-muted-foreground">
              Only items with an amount change; ones without an amount stay as they are.
            </span>
          </span>
          <Switch checked={updatePantry} onCheckedChange={setUpdatePantry} aria-label="Take what I used out of my pantry" />
        </label>
        <div className={cn("mt-3", !updatePantry && "opacity-50")}>
          {error ? <p className="text-[13px] text-danger">{error.message}</p>
            : !preview ? <p className="text-[13px] text-muted-foreground">Checking your pantry…</p>
            : changes.length ? <ChangeList changes={changes} />
            : <p className="text-[13px] text-muted-foreground">No measured pantry item changes.</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="lg" className="h-14 px-6 text-[16px]" onClick={cooked} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <ChefHat />} I cooked this
        </Button>
        <Button variant="outline" size="lg" className="h-14" onClick={onBack}><ArrowLeft /> Last step</Button>
      </div>
    </div>
  )
}

function ChangeList({ changes }: { changes: PantryChange[] }) {
  return (
    <ul className="grid w-full gap-1.5 text-[14px]">
      {changes.map((c) => (
        <li key={c.food} className="flex justify-between gap-3">
          <span className="capitalize">{c.name}</span>
          <span className={cn("tabular", c.after === null ? "text-orange" : "text-muted-foreground")}>{changeText(c)}</span>
        </li>
      ))}
    </ul>
  )
}
