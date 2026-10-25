import { ActivityIndicator, Text, View } from "react-native"

import { useWaking } from "@/lib/waking"

/** "Waking up the Pantrila server…" while a request waits on a sleeping server (the web's toast). */
export function WakeNotice() {
  if (!useWaking()) return null
  return (
    <View pointerEvents="none" className="absolute inset-x-4 bottom-4 z-10 items-center">
      <View accessibilityRole="alert" accessibilityLiveRegion="polite"
            className="flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 shadow-md">
        <ActivityIndicator size="small" />
        <Text className="font-sans-medium text-sm text-foreground">Waking up the Pantrila server…</Text>
      </View>
    </View>
  )
}
