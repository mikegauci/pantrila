import { Pressable, ScrollView, Text } from "react-native"

/** One filter as a row of chips that scrolls sideways (the web's phone layout): tap to pick,
 * tap again to drop. `single` keeps at most one picked. */
export function ChipRow<T extends string>({ name, options, selected, onChange, single = false }: {
  name: string
  options: { value: T; label: string }[]
  selected: T[]
  onChange: (next: T[]) => void
  single?: boolean
}) {
  function toggle(value: T) {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value))
    else onChange(single ? [value] : [...selected, value])
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4"
                contentContainerClassName="items-center gap-2 px-4" accessibilityLabel={name}>
      <Text className="w-16 font-sans-semibold text-xs text-muted-foreground">{name}</Text>
      {options.map((o) => {
        const on = selected.includes(o.value)
        return (
          <Pressable key={o.value} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                     accessibilityLabel={`${name}: ${o.label}`} onPress={() => toggle(o.value)}
                     className={`h-8 justify-center rounded-full border px-3 ${on ? "border-primary bg-primary" : "border-border bg-surface"}`}>
            <Text className={`font-sans-medium text-sm ${on ? "text-primary-foreground" : "text-foreground"}`}>{o.label}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}
