import { Text, View } from "react-native"

import { hasKcalRange, kcalMet, kcalTargetText } from "@pantrila/core/plan"
import type { Nutrition, NutritionTargets } from "@pantrila/core/types"

const pct = (n: number) => `${Math.max(0, Math.min(100, n * 100))}%` as const

/** A day's value against its target: within 10% of a number (energy), at least (protein) or at
 * most (carbs). The figure turns orange when the target is missed. */
function Bar({ name, value, target, unit, bar, kind }: {
  name: string; value: number; target: number | null; unit: string; bar: string; kind: "near" | "min" | "max"
}) {
  const max = Math.max(value, target ?? 0) * 1.1 || 1
  const ok = target == null ? true
    : kind === "near" ? Math.abs(value - target) <= 0.1 * target
    : kind === "min" ? value >= target : value <= target
  return (
    <View className="gap-1" accessibilityLabel={`${name} ${Math.round(value)} ${unit}${target ? ` of ${Math.round(target)}` : ""}${ok ? "" : ", target missed"}`}>
      <View className="flex-row justify-between">
        <Text className="font-sans text-xs text-muted-foreground">{name}</Text>
        <Text className={`font-sans-medium text-xs ${ok ? "text-foreground" : "text-[#a65a00]"}`}>
          {Math.round(value)}{target ? ` / ${Math.round(target)}` : ""} {unit}
        </Text>
      </View>
      <View className="h-1.5 rounded-full bg-surface-muted">
        <View className={`h-full rounded-full ${bar}`} style={{ width: pct(value / max) }} />
        {target ? <View className="absolute -top-0.5 h-2.5 w-0.5 bg-foreground" style={{ left: pct(target / max) }} /> : null}
      </View>
    </View>
  )
}

/** Energy against one number (±10%) or a range, drawn as a band between its ends. */
function EnergyBar({ value, t }: { value: number; t: NutritionTargets }) {
  if (!hasKcalRange(t)) return <Bar name="Energy" value={value} target={t.kcal} unit="kcal" bar="bg-foreground" kind="near" />
  const lo = t.min_kcal ?? 0
  const hi = t.max_kcal ?? null
  const max = Math.max(value, hi ?? lo) * 1.1 || 1
  const ok = kcalMet(value, t)
  return (
    <View className="gap-1" accessibilityLabel={`Energy ${Math.round(value)} kcal, target ${kcalTargetText(t)}${ok ? "" : ", target missed"}`}>
      <View className="flex-row justify-between">
        <Text className="font-sans text-xs text-muted-foreground">Energy</Text>
        <Text className={`font-sans-medium text-xs ${ok ? "text-foreground" : "text-[#a65a00]"}`}>
          {Math.round(value)} kcal <Text className="text-muted-foreground">· {kcalTargetText(t)}</Text>
        </Text>
      </View>
      <View className="h-1.5 rounded-full bg-surface-muted">
        <View testID="energy-band" className="absolute inset-y-0 rounded-full border border-primary/40 bg-primary-soft"
              style={{ left: pct(lo / max), width: pct(((hi ?? max) - lo) / max) }} />
        <View className="h-full rounded-full bg-foreground" style={{ width: pct(value / max) }} />
      </View>
    </View>
  )
}

/** A day's energy, protein and carbs against the person's targets. */
export function DayTargets({ n, t }: { n: Nutrition; t: NutritionTargets }) {
  return (
    <View className="gap-2">
      <EnergyBar value={n.kcal} t={t} />
      <Bar name="Protein" value={n.protein_g} target={t.min_protein_g} unit="g" bar="bg-primary" kind="min" />
      <Bar name="Carbs" value={n.carbs_g} target={t.max_carbs_g} unit="g" bar="bg-yellow" kind="max" />
    </View>
  )
}
