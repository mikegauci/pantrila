import { Link } from "expo-router"
import { CalendarDays, Check, EllipsisVertical, Sparkles, TriangleAlert } from "lucide-react-native"
import { useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useSWRConfig } from "swr"

import { label, MEAL_ORDER, planDayIndex, seconds, usd } from "@pantrila/core/format"
import { leftoverDays } from "@pantrila/core/plan"
import { leftText } from "@pantrila/core/subscription"
import type { Plan } from "@pantrila/core/types"

import { AiBadge, EmptyState, ErrorState, Panel, PanelTitle, ProblemAlert, Stat } from "@/components/bits"
import { Icon } from "@/components/icon"
import { MealRow } from "@/components/meal-row"
import { MealSheet, type MealTarget } from "@/components/meal-sheet"
import { DayTargets } from "@/components/plan-bars"
import { ApiError, streamPlan } from "@/lib/api"
import { useMe, usePlan, useProfile } from "@/lib/hooks"
import { askForPro, openPaywall } from "@/lib/pro"
import { useStored } from "@/lib/stored"
import { toast } from "@/lib/toast"

const STEPS: Record<string, string> = {
  profile: "Read your profile and pantry",
  retrieve: "Found recipes that pass your rules",
  draft: "The model drafted a week",
  check: "Code checked every rule",
  repair: "The model fixed the problems code found",
  finalise: "Final safety check",
}

/** The meal plan: make one (the planner's steps stream in as it works), then each day's meals
 * with their menu, and the day's energy, protein and carbs against the targets. */
export default function PlanScreen() {
  const { data: plan, isLoading, error: loadError, mutate } = usePlan()
  const { data: profile, mutate: refreshProfile } = useProfile()
  const { data: me, mutate: refreshMe } = useMe()
  const { mutate: revalidate } = useSWRConfig()
  const [steps, setSteps] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // After a plan on Free, one quiet line about Pro, once a week (keyed by the week's reset).
  const [noteWeek, setNoteWeek] = useStored("pro-plan-note")
  const [freeNote, setFreeNote] = useState(false)

  async function generate() {
    setSteps([])
    setError(null)
    try {
      await streamPlan((event, data) => {
        if (event === "step") setSteps((s) => [...(s ?? []), (data as { node: string }).node])
        if (event === "plan") {
          mutate(data as Plan, { revalidate: false })
          revalidate((key) => typeof key === "string" && key.startsWith("/plans/latest/grocery"))
          toast.success("Your week is planned")
          const week = me?.limits.plans.resets_at
          if (me?.subscription.tier === "free" && week && noteWeek !== undefined && noteWeek !== week) {
            setFreeNote(true)
            setNoteWeek(week)
          }
        }
        if (event === "error") setError((data as { message: string }).message)
      })
    } catch (e) {
      // A Free plan used up opens the paywall; the message stays behind it.
      askForPro(e)
      setError(e instanceof ApiError ? e.message : "Could not reach Pantrila. Try again.")
    } finally {
      setSteps(null)
      refreshMe()
    }
  }

  async function refresh() {
    setRefreshing(true)
    await Promise.all([mutate(), refreshProfile(), refreshMe()])
    setRefreshing(false)
  }

  const running = steps !== null
  const plans = me?.limits.plans
  // Pro's fair-use cap stops the button; on Free a tap explains the limit instead.
  const stopped = plans?.left === 0 && me?.subscription.tier === "pro"
  const disabled = running || stopped

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-4 pt-2 pb-10"
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <Panel className="gap-4 bg-primary-soft">
        <View>
          <Text className="font-sans-semibold text-lg text-foreground">
            {profile ? `${profile.days} day${profile.days === 1 ? "" : "s"} of ${profile.meals.map(label).join(", ").toLowerCase()}` : "Your week"}
          </Text>
          <Text className="font-sans text-[13px] text-muted-foreground">
            Uses your profile and pantry. Takes 10 to 90 seconds.{plans ? ` ${leftText("plan", plans)}.` : ""}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={generate}
                   className={`h-12 flex-row items-center justify-center gap-2 rounded-xl bg-primary ${disabled ? "opacity-60" : ""}`}>
          {running ? <ActivityIndicator size="small" color="white" /> : <Icon icon={Sparkles} tone="primary-foreground" size={18} />}
          <Text className="font-sans-semibold text-base text-primary-foreground">
            {running ? "Planning…" : plan ? "Plan a new week" : "Plan my week"}
          </Text>
        </Pressable>
      </Panel>

      {freeNote && !running && (
        <Pressable accessibilityRole="link" onPress={() => openPaywall("plan_note")}>
          <Text className="font-sans text-[13px] text-muted-foreground">
            Free: 1 plan a week. Pro plans as often as you like. <Text className="font-sans-semibold text-primary-text underline">See Pro</Text>
          </Text>
        </Pressable>
      )}

      {running && (
        <Panel>
          <PanelTitle>Working on it</PanelTitle>
          <View accessibilityLiveRegion="polite" className="gap-2">
            {steps.map((s, i) => (
              <View key={i} className="flex-row items-center gap-2">
                <Icon icon={Check} tone="success" size={16} />
                <Text className="font-sans text-[13px] text-foreground">{STEPS[s] ?? s}</Text>
              </View>
            ))}
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" />
              <Text className="font-sans text-[13px] text-muted-foreground">
                {steps.length === 0 ? "Reading your profile…" : steps.at(-1) === "retrieve" ? "The model is choosing recipes…" : "Working…"}
              </Text>
            </View>
          </View>
        </Panel>
      )}

      {error && (
        <View accessibilityRole="alert" className="flex-row items-start gap-3 rounded-2xl bg-danger-soft p-4">
          <Icon icon={TriangleAlert} tone="danger" size={20} />
          <Text className="flex-1 font-sans text-base text-danger">{error}</Text>
        </View>
      )}

      {loadError ? (
        <ErrorState message={loadError.message} onRetry={() => mutate()} />
      ) : isLoading ? (
        <ActivityIndicator className="my-10" />
      ) : !plan ? (
        !running && (
          <EmptyState icon={CalendarDays} title="No plan yet">
            Set your allergies, diet and targets in your profile, add what is in your kitchen, then plan your week.
          </EmptyState>
        )
      ) : (
        <Week plan={plan} />
      )}
    </ScrollView>
  )
}

function Week({ plan }: { plan: Plan }) {
  const today = planDayIndex(plan.created_at, plan.days.length)
  const bad = new Set(plan.problems.map((p) => `${p.day}-${p.meal_type}`))
  const [target, setTarget] = useState<MealTarget | null>(null)
  const r = plan.report
  return (
    <>
      <ProblemAlert title="Some meals no longer fit your profile"
                    items={plan.problems.map((p) => `Day ${p.day} ${p.meal_type}: ${p.message}. Plan a new week.`)} />
      {plan.notes !== "" && (
        <View className="gap-2 rounded-2xl bg-yellow-soft p-4">
          <AiBadge>Pantrila&apos;s note</AiBadge>
          <Text className="font-sans text-base text-foreground">{plan.notes}</Text>
        </View>
      )}
      {r.warnings.length > 0 && (
        <View className="rounded-2xl border border-warning/50 bg-orange-soft p-4">
          <Text className="font-sans-semibold text-[13px] text-foreground">Targets the plan could not meet</Text>
          {r.warnings.map((w) => <Text key={w} className="mt-1 font-sans text-[13px] text-foreground">• {w}</Text>)}
        </View>
      )}

      {plan.days.map((d, i) => (
        <Panel key={d.day} className={`gap-3 p-4 ${i === today ? "border-2 border-yellow" : ""}`}>
          <View className="flex-row items-center justify-between">
            <Text accessibilityRole="header" className="font-sans-semibold text-[15px] text-foreground">Day {d.day}</Text>
            {i === today && (
              <View className="rounded-full bg-yellow px-2">
                <Text className="font-sans-semibold text-xs text-[#1d2a1f]">Today</Text>
              </View>
            )}
          </View>
          {[...d.meals].sort((a, b) => MEAL_ORDER.indexOf(a.meal_type) - MEAL_ORDER.indexOf(b.meal_type)).map((m) => (
            <View key={m.meal_type} className="flex-row items-center gap-1">
              <MealRow m={m} bad={bad.has(`${d.day}-${m.meal_type}`)} laterDays={leftoverDays(plan, d.day, m.meal_type)} />
              <Pressable accessibilityRole="button" accessibilityLabel={`Change day ${d.day} ${m.meal_type}`} hitSlop={6}
                         onPress={() => setTarget({ day: d.day, meal: m.meal_type })}
                         className="size-10 items-center justify-center rounded-xl">
                <Icon icon={EllipsisVertical} size={20} />
              </Pressable>
            </View>
          ))}
          <DayTargets n={d.nutrition} t={plan.targets} />
        </Panel>
      ))}

      <Panel>
        <PanelTitle>How this plan was made</PanelTitle>
        <View className="flex-row flex-wrap gap-4">
          <Stat label="Pantry foods used" value={`${Math.round(r.pantry_use * 100)}%`} />
          <Stat label="Model calls" value={r.llm_calls} hint={`${r.tool_calls} recipe searches`} />
          <Stat label="Cost" value={usd(r.cost_usd, 3)} hint={r.model} />
          <Stat label="Time" value={seconds(r.latency_ms)} />
        </View>
        <Text className="mt-4 font-sans text-[13px] text-muted-foreground">
          Steps: {r.path.join(" → ")}. The first draft had {r.first_draft_problems.length} problem
          {r.first_draft_problems.length === 1 ? "" : "s"}; the model repaired {r.repairs} time{r.repairs === 1 ? "" : "s"}
          {r.fallbacks ? ` and code replaced ${r.fallbacks} unsafe meal${r.fallbacks === 1 ? "" : "s"}` : ""}. Allergens,
          diets, excluded foods and time limits are checked in code on every meal.
        </Text>
        <Link href="/grocery" className="mt-3 font-sans-semibold text-base text-primary-text">See the grocery list</Link>
      </Panel>

      <MealSheet plan={plan} target={target} onClose={() => setTarget(null)} />
    </>
  )
}
