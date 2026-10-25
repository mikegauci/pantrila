import { ActivityIndicator, Pressable, Text } from "react-native"

const TONES = {
  light: ["border border-border bg-white", "text-[#1f1f1f]"],
  dark: ["bg-black", "text-white"],
  soft: ["bg-primary-soft", "text-primary-text"],
  primary: ["bg-primary", "text-primary-foreground"],
} as const

/** A full-width button: Google (light), Apple (dark), guest (soft) or the main action (primary). */
export function Choice({ label, tone, disabled, onPress }: {
  label: string
  tone: keyof typeof TONES
  disabled?: boolean
  onPress: () => void
}) {
  const [box, text] = TONES[tone]
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
               className={`h-12 flex-row items-center justify-center gap-2 rounded-xl px-4 ${box} ${disabled ? "opacity-60" : ""}`}>
      {disabled && label.endsWith("…") && <ActivityIndicator size="small" />}
      <Text className={`font-sans-semibold text-base ${text}`}>{label}</Text>
    </Pressable>
  )
}
