import Svg, { Circle } from "react-native-svg"
import { Text, View } from "react-native"
import { useCSSVariable } from "uniwind"

import type { Nutrition } from "@pantrila/core/types"

const SEGMENTS = [
  { key: "protein_g", name: "Protein", token: "--color-primary", dot: "bg-primary", kcalPerG: 4 },
  { key: "carbs_g", name: "Carbs", token: "--color-yellow", dot: "bg-yellow", kcalPerG: 4 },
  { key: "fat_g", name: "Fat", token: "--color-orange", dot: "bg-orange", kcalPerG: 9 },
] as const

/** Donut of protein, carbs and fat by energy, calories in the centre (web/src/components/macro-ring.tsx). */
export function MacroRing({ nutrition, size = 150 }: { nutrition: Nutrition; size?: number }) {
  const colors = useCSSVariable([...SEGMENTS.map((s) => s.token), "--color-surface-muted"]) as string[]
  const parts = SEGMENTS.map((s) => ({ ...s, kcal: nutrition[s.key] * s.kcalPerG }))
  const total = parts.reduce((a, p) => a + p.kcal, 0) || 1
  const r = 15.9155 // circumference 100
  const offsets = parts.map((_, i) => 25 - parts.slice(0, i).reduce((a, p) => a + (p.kcal / total) * 100, 0))
  const summary = SEGMENTS.map((s) => `${s.name} ${Math.round(nutrition[s.key])} g`).join(", ")
  return (
    <View className="flex-row flex-wrap items-center gap-5">
      <View accessible accessibilityRole="image" accessibilityLabel={`${Math.round(nutrition.kcal)} kcal. ${summary}.`}
            style={{ width: size, height: size }}>
        <Svg viewBox="0 0 42 42" width={size} height={size}>
          <Circle cx="21" cy="21" r={r} fill="none" stroke={colors[3]} strokeWidth="5" />
          {parts.map((p, i) => {
            const len = Math.max(0, (p.kcal / total) * 100 - 0.8)
            return (
              <Circle key={p.key} cx="21" cy="21" r={r} fill="none" stroke={colors[i]} strokeWidth="5"
                      strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={offsets[i]} />
            )
          })}
        </Svg>
        <View className="absolute inset-0 items-center justify-center">
          <Text className="font-sans-bold text-2xl text-foreground">{Math.round(nutrition.kcal).toLocaleString("en-GB")}</Text>
          <Text className="font-sans text-xs text-muted-foreground">kcal</Text>
        </View>
      </View>
      <View className="gap-2">
        {[...parts.map((p) => ({ key: p.key, name: p.name, dot: p.dot as string })),
          { key: "fibre_g" as const, name: "Fibre", dot: "bg-fibre" }].map((p) => (
          <View key={p.key} className="flex-row items-center gap-2">
            <View className={`size-2.5 rounded-full ${p.dot}`} />
            <Text className="w-14 font-sans text-[13px] text-muted-foreground">{p.name}</Text>
            <Text className="font-sans-semibold text-[13px] text-foreground">{Math.round(nutrition[p.key])} g</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
