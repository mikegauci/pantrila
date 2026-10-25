import { CircleCheck } from "lucide-react-native"
import { useEffect, useState } from "react"
import { ActivityIndicator, Text, View } from "react-native"

import { clock, type ImportStep, importRows } from "@pantrila/core/cookbook"

import { Icon } from "@/components/icon"

/**
 * What the import is doing, from the steps the server reports at each poll (ticked when done,
 * spinning while under way), with time spent and, for posts, a rough estimate from this
 * person's recent imports (never a promise). The web's `import-progress.tsx`.
 */
export function ImportProgress({ steps, estimatedSeconds = null }: {
  steps: ImportStep[]
  estimatedSeconds?: number | null
}) {
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
  const remaining = estimatedSeconds === null ? null : Math.max(0, estimatedSeconds - elapsed)
  const rows = importRows(steps)
  return (
    <View accessibilityLabel="Import steps" className="gap-3 rounded-2xl bg-yellow-soft p-4">
      {rows.map(({ step, done }) => (
        <View key={step.key} className="flex-row items-center gap-2">
          {done
            ? <View accessibilityLabel="Done"><Icon icon={CircleCheck} tone="primary" size={16} /></View>
            : <ActivityIndicator accessibilityLabel="In progress" size="small" color="#b7860b" />}
          <Text accessibilityLiveRegion={done ? "none" : "polite"}
                className={`flex-1 text-[13px] ${done ? "font-sans text-muted-foreground" : "font-sans-semibold text-foreground"}`}>
            {step.label}{done ? "" : "…"}
          </Text>
        </View>
      ))}
      <View className="gap-0.5 border-t border-foreground/10 pt-2">
        <Text className="font-sans text-[13px] text-foreground">
          {remaining === null ? `${clock(elapsed)} so far`
            : remaining > 0 ? `About ${clock(remaining)} left`
            : "Taking longer than usual. Still working…"}
        </Text>
        <Text className="font-sans text-xs text-muted-foreground">
          {remaining !== null && "An estimate from your recent imports. "}
          You can lock your phone or leave the app; the import keeps going.
        </Text>
      </View>
    </View>
  )
}
