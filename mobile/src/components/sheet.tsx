import { X } from "lucide-react-native"
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Icon } from "@/components/icon"

/** A sheet that slides up over the screen (the web's side sheets): a title, an optional line
 * under it, scrolling content and an optional footer that stays put. */
export function Sheet({ open, onClose, title, description, footer, children }: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  const insets = useSafeAreaInsets()
  // iOS draws its own page sheet with a gap at the top; Android gets a full-screen page.
  const ios = Platform.OS === "ios"
  return (
    <Modal visible={open} animationType="slide" presentationStyle={ios ? "pageSheet" : "fullScreen"}
           onRequestClose={onClose}>
      <View className="flex-1 bg-background" style={{ paddingTop: ios ? 0 : insets.top }}>
        <View className="flex-row items-start gap-3 border-b border-border px-4 pt-5 pb-3">
          <View className="flex-1">
            <Text accessibilityRole="header" className="font-sans-semibold text-lg text-foreground">{title}</Text>
            {description && <Text className="mt-1 font-sans text-sm text-muted-foreground">{description}</Text>}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8}
                     className="size-9 items-center justify-center rounded-full bg-surface-muted">
            <Icon icon={X} size={18} />
          </Pressable>
        </View>
        <ScrollView className="flex-1" contentContainerClassName="gap-3 p-4" keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer && (
          <View className="gap-2 border-t border-border px-4 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
            {footer}
          </View>
        )}
      </View>
    </Modal>
  )
}
