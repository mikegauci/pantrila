import { Check, Ruler } from "lucide-react-native"
import { useState } from "react"
import { Modal, Pressable, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { amountIn, bareName, formatAmount, unitsFor, type Measured, type ShowUnit } from "@pantrila/core/amounts"

import { Icon } from "@/components/icon"

/** One ingredient line in the unit the person picked (the recipe's own at first). Tapping the
 * amount or the ruler opens a sheet of the units it can be shown in (display only, as on the web). */
export function MeasuredLine({ line, scale = 1 }: { line: Measured & { name: string }; scale?: number }) {
  const [unit, setUnit] = useState<ShowUnit>(line.unit)
  const [open, setOpen] = useState(false)
  const insets = useSafeAreaInsets()
  const name = bareName(line.name)
  const units = unitsFor(line)
  const show = (u: ShowUnit) => `${formatAmount(amountIn(line, u, scale), u)} ${u}`

  if (units.length < 2) {
    return (
      <Text className="flex-1 font-sans text-base text-foreground">
        <Text className="font-sans-semibold">{show(unit)}</Text> {name}
      </Text>
    )
  }
  return (
    <>
      <Text className="flex-1 font-sans text-base text-foreground">
        <Text accessibilityRole="button" accessibilityLabel={`${show(unit)} ${name}: change measurement`}
              onPress={() => setOpen(true)} className="font-sans-semibold underline">
          {show(unit)}
        </Text>{" "}
        {name}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Change measurement for ${name}`}
                 hitSlop={8} onPress={() => setOpen(true)} className="p-1">
        <Icon icon={Ruler} tone={unit === line.unit ? "muted-foreground" : "primary-text"} size={18} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel="Close" className="flex-1 bg-black/40" onPress={() => setOpen(false)} />
        <View className="rounded-t-3xl bg-surface px-4 pt-4" style={{ paddingBottom: insets.bottom + 16 }}>
          <Text className="mb-2 font-sans-semibold text-base text-foreground">Show {name} in</Text>
          {units.map((u) => (
            <Pressable key={u} accessibilityRole="radio" accessibilityState={{ checked: u === unit }}
                       onPress={() => { setUnit(u); setOpen(false) }}
                       className="h-12 flex-row items-center gap-3 border-b border-border">
              <View className="w-5">{u === unit && <Icon icon={Check} tone="primary-text" size={18} />}</View>
              <Text className="flex-1 font-sans text-base text-foreground">
                {show(u)}{u === line.unit && <Text className="text-muted-foreground">  (recipe)</Text>}
              </Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    </>
  )
}
