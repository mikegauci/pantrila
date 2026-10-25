import { CircleCheck, TriangleAlert } from "lucide-react-native"
import { Text, View } from "react-native"

import { Icon } from "@/components/icon"
import { useToast } from "@/lib/toast"

/** Shows `toast.success` / `toast.error` messages above the tab bar (and over pushed screens). */
export function Toaster() {
  const t = useToast()
  if (!t) return null
  return (
    <View pointerEvents="none" className="absolute inset-x-4 bottom-20 z-20 items-center">
      <View accessibilityRole="alert" accessibilityLiveRegion="polite"
            className="flex-row items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 shadow-md">
        <Icon icon={t.tone === "error" ? TriangleAlert : CircleCheck} tone={t.tone === "error" ? "danger" : "success"} size={18} />
        <Text className="shrink font-sans-medium text-sm text-foreground">{t.text}</Text>
      </View>
    </View>
  )
}
