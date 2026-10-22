"use client"

import { CalendarDays, Check, CircleSlash, CopyPlus, Loader2, Repeat2, Sparkles, TriangleAlert, UtensilsCrossed } from "lucide-react"
import Link from "next/link"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"

import { AiBadge, EmptyState, Panel, PanelTitle, ProblemAlert, RecipeArt, Stat } from "@/components/bits"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { MealMenu } from "@/components/meal-menu"
import { SwapMealSheet, type SwapTarget } from "@/components/swap-meal"
import { ApiError, streamPlan } from "@/lib/api"
import { label, MEAL_ORDER, planDayIndex, seconds, usd } from "@/lib/format"
import { useMe, usePlan, useProfile } from "@/lib/hooks"
import { hasKcalRange, kcalMet, kcalTargetText, mealHref } from "@/lib/plan"
import { cn } from "@/lib/utils"
import type { Nutrition, NutritionTargets, Plan, PlanMeal } from "@/lib/types"

const STEPS: Record<string, string> = {
  profile: "Read your profile and pantry",
  retrieve: "Found recipes that pass your rules",
  draft: "The model drafted a week",
  check: "Code checked every rule",
  repair: "The model fixed the problems code found",
  finalise: "Final safety check",
}

function Bar({ value, target, color, name, unit, kind }: {
  value: number; target: number | null; color: string; name: string; unit: string
  kind: "near" | "min" | "max"
}) {
  const max = Math.max(value, target ?? 0) * 1.1 || 1
  const ok = target == null ? true
    : kind === "near" ? Math.abs(value - target) <= 0.1 * target
    : kind === "min" ? value >= target : value <= target
  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-[12px]">
        <span className="text-muted-foreground">{name}</span>
        <span className={cn("tabular font-medium", !ok && "text-[#a65a00]")}>
          {Math.round(value)}{target ? ` / ${Math.round(target)}` : ""} {unit}
          {!ok && <span className="sr-only"> (target missed)</span>}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-surface-muted">
        <div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, background: color }} />
        {target && <div className="absolute -top-0.5 h-2.5 w-0.5 bg-foreground" style={{ left: `${(target / max) * 100}%` }} />}
      </div>
    </div>
  )
}

/** Energy against one number (±10%) or a range, drawn as a band between its ends. */
function EnergyBar({ value, t }: { value: number; t: NutritionTargets }) {
  if (!hasKcalRange(t)) {
    return <Bar name="Energy" value={value} target={t.kcal} unit="kcal" color="var(--foreground)" kind="near" />
  }
  const lo = t.min_kcal ?? 0
  const hi = t.max_kcal ?? null
  const max = Math.max(value, hi ?? lo) * 1.1 || 1
  const ok = kcalMet(value, t)
  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-[12px]">
        <span className="text-muted-foreground">Energy</span>
        <span className={cn("tabular font-medium", !ok && "text-[#a65a00]")}>
          {Math.round(value)} kcal <span className="text-muted-foreground">· {kcalTargetText(t)}</span>
          {!ok && <span className="sr-only"> (target missed)</span>}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-surface-muted">
        <div className="absolute inset-y-0 rounded-full bg-primary-soft ring-1 ring-primary/40"
             style={{ left: `${(lo / max) * 100}%`, width: `${(((hi ?? max) - lo) / max) * 100}%` }} aria-hidden />
        <div className="relative h-full rounded-full bg-foreground" style={{ width: `${(value / max) * 100}%` }} />
      </div>
    </div>
  )
}

function DayTargets({ n, t }: { n: Nutrition; t: NutritionTargets }) {
  return (
    <div className="grid gap-2">
      <EnergyBar value={n.kcal} t={t} />
      <Bar name="Protein" value={n.protein_g} target={t.min_protein_g} unit="g" color="var(--primary)" kind="min" />
      <Bar name="Carbs" value={n.carbs_g} target={t.max_carbs_g} unit="g" color="var(--accent-yellow)" kind="max" />
    </div>
  )
}

/** One meal of a day: a recipe (Pantrila's or the person's own), leftovers, skipped or eating
 * out. Skipped and eating-out meals are quiet rows; the menu can add their recipe back. */
function MealRow({ m, bad, laterDays }: { m: PlanMeal; bad: boolean; laterDays: number[] }) {
  const href = mealHref(m)
  if (m.kind === "skipped" || m.kind === "eating_out" || !m.recipe || !href) {
    const out = m.kind === "eating_out"
    const Icon = out ? UtensilsCrossed : CircleSlash
    return (
      <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-dashed p-2 text-muted-foreground">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-surface-muted">
          <Icon className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium uppercase">{m.meal_type}</span>
          <span className="block font-medium text-foreground">{out ? "Eating out" : "Skipped"}</span>
          {m.recipe && <span className="block truncate text-[12px]">Was {m.recipe.title}</span>}
        </span>
        <span className="tabular shrink-0 text-right text-[12px]">
          {out ? (m.out_kcal ? `~${Math.round(m.out_kcal)} kcal` : "Not counted") : "0 kcal"}
        </span>
      </div>
    )
  }
  return (
    <Link
      href={href}
      className={cn("flex min-w-0 flex-1 items-center gap-3 rounded-2xl border p-2 hover:shadow-soft",
        bad && "border-danger bg-danger-soft")}
    >
      <RecipeArt meal={m.meal_type} size="sm" photo={m.recipe.photo_url} sizes="48px" className="size-12 shrink-0 rounded-xl" />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium text-muted-foreground uppercase">{m.meal_type}</span>
        <span className="block truncate font-medium">{m.recipe.title}</span>
        {m.kind === "leftovers" ? (
          <span className="flex items-center gap-1 text-[12px] font-medium text-primary-text">
            <Repeat2 className="size-3" aria-hidden /> Leftovers from day {m.from_day}
          </span>
        ) : laterDays.length > 0 ? (
          <span className="flex items-center gap-1 text-[12px] font-medium text-primary-text">
            <CopyPlus className="size-3" aria-hidden /> Leftovers for day {laterDays.join(", ")}
          </span>
        ) : m.cookbook_id != null && (
          <span className="block text-[12px] font-medium text-primary-text">Your recipe</span>
        )}
      </span>
      <span className="tabular shrink-0 text-right text-[12px] text-muted-foreground">
        {Math.round(m.recipe.nutrition.kcal * m.portions)} kcal
        <span className="block">×{m.portions}</span>
      </span>
    </Link>
  )
}

function Week({ plan }: { plan: Plan }) {
  const today = planDayIndex(plan.created_at, plan.days.length)
  const bad = new Set(plan.problems.map((p) => `${p.day}-${p.meal_type}`))
  const [swap, setSwap] = useState<SwapTarget | null>(null)
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {plan.days.map((d, i) => (
        <Panel key={d.day} className={cn("min-w-0 p-4 xl:p-5", i === today && "ring-2 ring-yellow")}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold">Day {d.day}</h3>
            {i === today && <span className="rounded-full bg-yellow px-2 text-[12px] font-semibold">Today</span>}
          </div>
          <ul className="mb-4 grid grid-cols-1 gap-2">
            {[...d.meals].sort((a, b) => MEAL_ORDER.indexOf(a.meal_type) - MEAL_ORDER.indexOf(b.meal_type)).map((m) => (
              <li key={m.meal_type} className="flex items-center gap-1">
                <MealRow m={m} bad={bad.has(`${d.day}-${m.meal_type}`)}
                  laterDays={plan.days.filter((x) => x.meals.some((y) => y.kind === "leftovers"
                    && y.from_day === d.day && y.from_meal === m.meal_type)).map((x) => x.day)} />
                <MealMenu plan={plan} day={d.day} meal={m} onSwap={() => setSwap({ day: d.day, meal: m.meal_type })} />
              </li>
            ))}
          </ul>
          <DayTargets n={d.nutrition} t={plan.targets} />
        </Panel>
      ))}
      <SwapMealSheet target={swap} onClose={() => setSwap(null)} />
    </div>
  )
}

export default function PlanPage() {
  const { data: plan, isLoading, mutate } = usePlan()
  const { data: profile } = useProfile()
  const { data: me, mutate: refreshMe } = useMe()
  const { mutate: revalidate } = useSWRConfig()
  const [steps, setSteps] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  async function generate() {
    setSteps([])
    setError(null)
    abort.current = new AbortController()
    try {
      await streamPlan((event, data) => {
        if (event === "step") setSteps((s) => [...(s ?? []), (data as { node: string }).node])
        if (event === "plan") {
          mutate(data as Plan, { revalidate: false })
          revalidate((key) => typeof key === "string" && key.startsWith("/plans/latest/grocery"))
          toast.success("Your week is planned")
        }
        if (event === "error") setError((data as { message: string }).message)
      }, abort.current.signal)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach Pantrila. Try again.")
    } finally {
      setSteps(null)
      refreshMe()
    }
  }

  const running = steps !== null
  const left = me?.limits.plans_left

  return (
    <div className="grid gap-5">
      <Panel className="flex flex-wrap items-center gap-4 bg-primary-soft">
        <div className="min-w-0 flex-1">
          <p className="text-[18px] font-semibold">
            {profile ? `${profile.days} day${profile.days === 1 ? "" : "s"} of ${profile.meals.map(label).join(", ").toLowerCase()}` : "Your week"}
          </p>
          <p className="text-[13px] text-muted-foreground">
            Uses your <Link href="/profile" className="underline">profile</Link> and{" "}
            <Link href="/pantry" className="underline">pantry</Link>. Takes 10 to 90 seconds.
            {left != null && ` ${left} of ${me?.limits.plans_per_day} plans left today.`}
          </p>
        </div>
        <Button size="lg" onClick={generate} disabled={running || left === 0} data-tour="plan-generate">
          {running ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {running ? "Planning…" : plan ? "Plan a new week" : "Plan my week"}
        </Button>
      </Panel>

      {running && (
        <Panel aria-live="polite">
          <PanelTitle>Working on it</PanelTitle>
          <ol className="grid gap-2">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2 text-[13px]">
                <Check className="size-4 text-success" aria-hidden /> {STEPS[s] ?? s}
              </li>
            ))}
            <li className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {steps.length === 0 ? "Reading your profile…" : steps.at(-1) === "retrieve" ? "The model is choosing recipes…" : "Working…"}
            </li>
          </ol>
        </Panel>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl bg-danger-soft p-4 text-danger">
          <TriangleAlert className="size-5 shrink-0" aria-hidden /> {error}
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-96 rounded-[20px]" />
      ) : !plan ? (
        !running && (
          <Panel>
            <EmptyState icon={CalendarDays} title="No plan yet">
              Set your allergies, diet and targets in your profile, add what is in your kitchen, then
              plan your week.
            </EmptyState>
          </Panel>
        )
      ) : (
        <>
          <ProblemAlert
            title="Some meals no longer fit your profile"
            items={plan.problems.map((p) => `Day ${p.day} ${p.meal_type}: ${p.message}. Plan a new week.`)}
          />
          {plan.notes && (
            <div className="flex flex-wrap items-start gap-3 rounded-2xl bg-yellow-soft p-4">
              <AiBadge>Pantrila&apos;s note</AiBadge>
              <p className="min-w-0 flex-1">{plan.notes}</p>
            </div>
          )}
          {plan.report.warnings.length > 0 && (
            <div className="rounded-2xl border border-warning/50 bg-orange-soft p-4 text-[13px]">
              <p className="font-semibold">Targets the plan could not meet</p>
              <ul className="mt-1 list-disc pl-4">
                {plan.report.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </div>
          )}
          <Week plan={plan} />
          <Panel>
            <PanelTitle>How this plan was made</PanelTitle>
            <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
              <Stat label="Pantry foods used" value={`${Math.round(plan.report.pantry_use * 100)}%`} />
              <Stat label="Model calls" value={plan.report.llm_calls} hint={`${plan.report.tool_calls} recipe searches`} />
              <Stat label="Cost" value={usd(plan.report.cost_usd, 3)} hint={plan.report.model} />
              <Stat label="Time" value={seconds(plan.report.latency_ms)} />
            </div>
            <p className="mt-5 text-[13px] text-muted-foreground">
              Steps: {plan.report.path.join(" → ")}. The first draft had{" "}
              {plan.report.first_draft_problems.length} problem{plan.report.first_draft_problems.length === 1 ? "" : "s"};
              the model repaired {plan.report.repairs} time{plan.report.repairs === 1 ? "" : "s"}
              {plan.report.fallbacks ? ` and code replaced ${plan.report.fallbacks} unsafe meal${plan.report.fallbacks === 1 ? "" : "s"}` : ""}.
              Allergens, diets, excluded foods and time limits are checked in code on every meal.
            </p>
          </Panel>
        </>
      )}
    </div>
  )
}
