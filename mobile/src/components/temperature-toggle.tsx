import { Pressable, Text, View } from "react-native"

import type { TempUnit } from "@pantrila/core/temperature"

import { useTempUnit } from "@/lib/temperature"

const UNITS: TempUnit[] = ["C", "F"]

/** °C / °F switch for the temperatures in a recipe's method. The choice is kept on this phone. */
export function TemperatureToggle() {
  const [unit, setUnit] = useTempUnit()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Temperature unit"
          className="flex-row rounded-lg border border-border bg-surface p-0.5">
      {UNITS.map((u) => (
        <Pressable key={u} accessibilityRole="radio" accessibilityState={{ checked: unit === u }}
                   onPress={() => setUnit(u)}
                   className={`h-7 min-w-9 items-center justify-center rounded-md px-2 ${unit === u ? "bg-primary" : ""}`}>
          <Text className={`font-sans-semibold text-[13px] ${unit === u ? "text-primary-foreground" : "text-muted-foreground"}`}>
            °{u}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}
