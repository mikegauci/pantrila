import { Check } from "lucide-react-native"
import { Modal, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Icon } from "@/components/icon"

/** A short list to pick one from, sliding up from the bottom (the web's native selects). */
export function OptionSheet<T extends string>({ open, title, options, value, onPick, onClose }: {
  open: boolean
  title: string
  options: { value: T; label: string }[]
  value?: T | null
  onPick: (value: T) => void
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" className="flex-1 bg-black/40" onPress={onClose} />
      <View className="max-h-[70%] rounded-t-3xl bg-surface px-4 pt-4" style={{ paddingBottom: insets.bottom + 16 }}>
        <Text accessibilityRole="header" className="mb-2 font-sans-semibold text-base text-foreground">{title}</Text>
        <ScrollView>
          {options.map((o) => (
            <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: o.value === value }}
                       onPress={() => { onPick(o.value); onClose() }}
                       className="h-12 flex-row items-center gap-3 border-b border-border">
              <View className="w-5">{o.value === value && <Icon icon={Check} tone="primary-text" size={18} />}</View>
              <Text className="flex-1 font-sans text-base text-foreground">{o.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  )
}
