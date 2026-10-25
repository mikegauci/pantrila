import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native"

/** Form parts shared by the recipe form, Pantry and Profile. */

export const INPUT = "rounded-xl border border-border bg-surface px-3 font-sans text-base text-foreground"

export function Field({ name, hint, className = "", ...input }: TextInputProps & { name: string; hint?: string }) {
  return (
    <View className={`gap-1.5 ${className}`}>
      <Text className="font-sans-medium text-sm text-foreground">{name}</Text>
      {hint && <Text className="font-sans text-xs text-muted-foreground">{hint}</Text>}
      <TextInput accessibilityLabel={name} placeholderTextColorClassName="accent-muted-foreground"
                 className={`${INPUT} ${input.multiline ? "min-h-24 py-2.5" : "h-11"}`}
                 textAlignVertical={input.multiline ? "top" : undefined} {...input} />
    </View>
  )
}

/** A chip that is on or off (the web Profile's toggles); `danger` for allergies. */
export function Toggle({ text, on, onPress, danger, label }: {
  text: string; on: boolean; onPress: () => void; danger?: boolean; label?: string
}) {
  const box = on ? (danger ? "border-danger bg-danger" : "border-primary bg-primary-soft") : "border-border bg-surface"
  const ink = on ? (danger ? "text-white" : "text-primary-text") : "text-muted-foreground"
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label ?? text}
               onPress={onPress} className={`h-9 justify-center rounded-full border px-3.5 ${box}`}>
      <Text className={`font-sans-medium text-sm ${ink}`}>{text}</Text>
    </Pressable>
  )
}

/** Two or more choices side by side, one picked ("One number / A range"). */
export function Segmented<T extends string>({ name, options, value, onChange }: {
  name: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={name} className="flex-row gap-1 rounded-full bg-surface-muted p-1">
      {options.map((o) => (
        <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: o.value === value }}
                   onPress={() => onChange(o.value)}
                   className={`h-8 justify-center rounded-full px-3 ${o.value === value ? "bg-surface" : ""}`}>
          <Text className={`font-sans-medium text-xs ${o.value === value ? "text-foreground" : "text-muted-foreground"}`}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}
