import type { LucideIcon } from "lucide-react-native"
import { ScrollView } from "react-native"

import { EmptyState } from "@/components/bits"

/** A screen the phone app does not have yet; it says what is coming and points to the web app. */
export function Soon({ icon, title, children }: { icon: LucideIcon; title: string; children: string }) {
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="p-4">
      <EmptyState icon={icon} title={title}>
        {`${children} Until then it is in the web app at app.pantrila.com, with the same account.`}
      </EmptyState>
    </ScrollView>
  )
}
