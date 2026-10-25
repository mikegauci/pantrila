import { router } from "expo-router"
import { MessageCircle, Send } from "lucide-react-native"
import { useState } from "react"
import { Pressable, ScrollView, Text, TextInput, View } from "react-native"

import { AiBadge, Panel } from "@/components/bits"
import { Icon } from "@/components/icon"
import { useChats } from "@/lib/hooks"

export const STARTERS = [
  "What can I cook tonight with what I have?",
  "I just bought eggs, spinach and feta.",
  "Find a quick high-protein breakfast.",
]

/** Home card: a question typed or picked here opens the Assistant tab (the chat itself comes in
 * mobile plan PR 10, which reads `q` and `thread`). */
export function AskPantrila() {
  const [text, setText] = useState("")
  const { data: threads } = useChats()
  const recent = Array.isArray(threads) ? threads.slice(0, 3) : []

  function ask(message: string) {
    if (message.trim()) router.navigate({ pathname: "/assistant", params: { q: message.trim() } })
  }

  return (
    <Panel className="bg-primary-soft">
      <View className="mb-3 flex-row flex-wrap items-center gap-2">
        <Text accessibilityRole="header" className="font-sans-semibold text-lg text-foreground">Ask Pantrila</Text>
        <AiBadge>Cooking assistant</AiBadge>
      </View>
      <Text className="mb-4 font-sans text-base text-muted-foreground">
        It knows your diet, allergies and pantry, searches the recipes, updates your pantry and checks every recipe
        it suggests against your rules.
      </Text>
      <View className="flex-row gap-2">
        <TextInput
          accessibilityLabel="Ask Pantrila"
          placeholder="What should I cook tonight?"
          placeholderTextColorClassName="accent-muted-foreground"
          value={text}
          maxLength={2000}
          onChangeText={setText}
          onSubmitEditing={() => ask(text)}
          returnKeyType="send"
          className="h-11 flex-1 rounded-xl border border-border bg-surface px-3 font-sans text-base text-foreground"
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Ask" disabled={!text.trim()} onPress={() => ask(text)}
                   className={`size-11 items-center justify-center rounded-xl bg-primary ${text.trim() ? "" : "opacity-50"}`}>
          <Icon icon={Send} tone="primary-foreground" size={18} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-5 mt-3"
                  contentContainerClassName="gap-2 px-5">
        {STARTERS.map((s) => (
          <Pressable key={s} accessibilityRole="button" onPress={() => ask(s)}
                     className="h-9 justify-center rounded-lg border border-border bg-surface px-3">
            <Text className="font-sans-medium text-sm text-foreground">{s}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {recent.length > 0 && (
        <View className="mt-4 border-t border-primary/15 pt-3">
          <Text className="mb-1.5 font-sans-medium text-xs text-muted-foreground">Continue a chat</Text>
          {recent.map((t) => (
            <Pressable key={t.id} accessibilityRole="link"
                       onPress={() => router.navigate({ pathname: "/assistant", params: { thread: String(t.id) } })}
                       className="flex-row items-center gap-2 py-1.5">
              <Icon icon={MessageCircle} tone="muted-foreground" size={16} />
              <Text numberOfLines={1} className="flex-1 font-sans text-base text-foreground">{t.title}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Panel>
  )
}
