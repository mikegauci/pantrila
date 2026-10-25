import { Check, Pause, Play, X } from "lucide-react-native"
import { useState } from "react"
import { Pressable, Text, View } from "react-native"

import { amountIn, bareName, formatAmount, niceFractions } from "@pantrila/core/amounts"
import { clock, PREHEAT, preheatHint, type RunningTimer } from "@pantrila/core/cooking"
import { groupLines } from "@pantrila/core/sections"
import { showTemps, type TempUnit } from "@pantrila/core/temperature"
import type { PantryChange, Unit } from "@pantrila/core/types"

import { Icon } from "@/components/icon"

/** The pieces of cooking mode (components/cooking-mode.tsx), as on the web. */

export interface CookIngredient {
  name: string
  food: string | null
  quantity: number
  unit: Unit
  in_pantry: boolean
  /** The recipe's group heading for this ingredient ("Broth"); cookbook recipes only. */
  section?: string
}

/** "1¼ tsp": the amount in the recipe's own unit for these servings. */
export const amountText = (ing: CookIngredient, scale: number) =>
  `${formatAmount(amountIn(ing, ing.unit, scale), ing.unit)} ${ing.unit}`

/** Every ingredient, grouped under the recipe's headings; tap to tick it off. */
export function Checklist({ ingredients, scale, ticked, onToggle }: {
  ingredients: CookIngredient[]; scale: number; ticked: Set<number>; onToggle: (i: number) => void
}) {
  return (
    <View>
      {groupLines(ingredients).map((g, n) => (
        <View key={n}>
          {g.title !== "" && (
            <Text className="mt-4 mb-1 font-sans-semibold text-[13px] uppercase text-muted-foreground">{g.title}</Text>
          )}
          {g.items.map(({ item: ing, index: i }) => {
            const on = ticked.has(i)
            return (
              <Pressable key={i} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                         accessibilityLabel={`${amountText(ing, scale)} ${bareName(ing.name)}`} onPress={() => onToggle(i)}
                         className="min-h-12 flex-row items-center gap-3 border-b border-border py-2">
                <View className={`size-6 items-center justify-center rounded-full border-2 ${on ? "border-primary bg-primary" : "border-border"}`}>
                  {on && <Icon icon={Check} tone="primary-foreground" size={14} strokeWidth={3} />}
                </View>
                <Text className={`flex-1 font-sans text-base ${on ? "text-muted-foreground line-through" : "text-foreground"}`}>
                  <Text className="font-sans-semibold">{amountText(ing, scale)}</Text> {bareName(ing.name)}
                </Text>
                {ing.in_pantry && !on && (
                  <View className="rounded-full bg-primary-soft px-2 py-0.5">
                    <Text className="font-sans-medium text-[11px] text-primary-text">In pantry</Text>
                  </View>
                )}
              </Pressable>
            )
          })}
        </View>
      ))}
    </View>
  )
}

/** A step's text; when it says to preheat without a time, the preheat words open the later step
 * that names the time ("Shown in Step 3: Bake at 180°C for 9-12 minutes."). */
export function StepText({ steps, index, unit }: { steps: string[]; index: number; unit: TempUnit }) {
  const [open, setOpen] = useState(false)
  const text = showTemps(niceFractions(steps[index]), unit)
  const hint = preheatHint(steps, index)
  const m = hint ? text.match(PREHEAT) : null
  const style = "font-sans-medium text-[22px] leading-[34px] text-foreground"
  if (!hint || !m || m.index === undefined) return <Text className={style}>{text}</Text>
  const end = m.index + m[0].length
  return (
    <View className="gap-3">
      <Text className={style}>
        {text.slice(0, m.index)}
        <Text accessibilityRole="button" accessibilityLabel={`${m[0]}: when to start`} onPress={() => setOpen(!open)}
              className="underline">{m[0]}</Text>
        {text.slice(end)}
      </Text>
      {open && (
        <View accessibilityLiveRegion="polite" className="rounded-xl bg-foreground px-3.5 py-2.5">
          <Text className="font-sans text-sm leading-5 text-background">
            <Text className="font-sans-semibold">Shown in Step {hint.step}:</Text> {showTemps(niceFractions(hint.sentence), unit)}
          </Text>
        </View>
      )}
    </View>
  )
}

/** A running, paused or finished timer, with pause, a minute more and dismiss. */
export function TimerPill({ timer: t, now, onChange }: {
  timer: RunningTimer
  now: number
  onChange: (change: (t: RunningTimer, at: number) => RunningTimer | null) => void
}) {
  const left = t.endsAt !== null ? t.endsAt - now : t.left
  const done = t.rang || left <= 0
  return (
    <View className={`flex-row items-center gap-1 rounded-2xl border py-1.5 pr-1 pl-3 ${done ? "border-danger bg-danger-soft" : "border-border bg-surface-muted"}`}>
      <View>
        <Text accessibilityRole="timer" accessibilityLabel={`Step ${t.step} timer`}
              className="font-sans-bold text-lg text-foreground">{done ? "Time's up" : clock(left)}</Text>
        <Text className="font-sans text-[11px] text-muted-foreground">Step {t.step} · {t.label}</Text>
      </View>
      {!done && (
        <Small label={t.endsAt !== null ? "Pause timer" : "Resume timer"}
               onPress={() => onChange((x, at) => x.endsAt !== null ? { ...x, endsAt: null, left: x.endsAt - at } : { ...x, endsAt: at + x.left })}>
          <Icon icon={t.endsAt !== null ? Pause : Play} size={18} />
        </Small>
      )}
      <Small label="Add a minute"
             onPress={() => onChange((x, at) => x.rang || (x.endsAt !== null && x.endsAt <= at)
               ? { ...x, rang: false, endsAt: at + 60_000, left: 60_000 }
               : x.endsAt !== null ? { ...x, endsAt: x.endsAt + 60_000 } : { ...x, left: x.left + 60_000 })}>
        <Text className="font-sans-medium text-sm text-foreground">+1 min</Text>
      </Small>
      <Small label="Dismiss timer" onPress={() => onChange(() => null)}>
        <Icon icon={X} size={18} />
      </Small>
    </View>
  )
}

function Small({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4}
               className="h-9 min-w-9 items-center justify-center rounded-lg px-1.5">
      {children}
    </Pressable>
  )
}

const round = (q: number) => (q < 10 ? String(Math.round(q * 100) / 100) : String(Math.round(q)))

/** What cooking takes out of the pantry: "200 → 50 g", or "used up, removed". */
export function ChangeList({ changes }: { changes: PantryChange[] }) {
  return (
    <View className="gap-1.5">
      {changes.map((c) => (
        <View key={c.food} className="flex-row justify-between gap-3">
          <Text className="font-sans text-sm capitalize text-foreground">{c.name}</Text>
          <Text className={`font-sans text-sm ${c.after === null ? "text-orange" : "text-muted-foreground"}`}>
            {c.after === null ? "used up, removed" : `${round(c.before)} → ${round(c.after)} ${c.unit}`}
          </Text>
        </View>
      ))}
    </View>
  )
}
