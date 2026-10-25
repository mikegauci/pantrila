import { router } from "expo-router"
import { CalendarDays, Mic, Share, type LucideIcon } from "lucide-react-native"
import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/bits"
import { Icon } from "@/components/icon"
import { introDone } from "@/lib/intro"

/** The phone's onboarding instead of the web's tour: three cards, once per person (lib/intro.ts). */
const CARDS: { icon: LucideIcon; tint: string; tone: string; title: string; text: string }[] = [
  {
    icon: CalendarDays, tint: "bg-primary-soft", tone: "primary-text", title: "Plan your week",
    text: "Set your diet, allergies and targets in Profile. Pantrila plans the week's meals, checks every one " +
      "against your rules in code and makes the grocery list from what your pantry is missing.",
  },
  {
    icon: Share, tint: "bg-yellow-soft", tone: "foreground", title: "Import from a post",
    text: "Seen a recipe on TikTok, Instagram, Facebook or a recipe site? Tap Share and pick Pantrila. It reads " +
      "the recipe into My recipes and credits the creator.",
  },
  {
    icon: Mic, tint: "bg-orange-soft", tone: "foreground", title: "Cook hands-free",
    text: "Cooking mode shows one step at a time, with timers that ring even when the phone is locked. Turn on " +
      "the mic and say “next”, “back” or “start timer”.",
  },
]

export default function Intro() {
  const userId = useAuth().session?.user.id
  const insets = useSafeAreaInsets()
  const [n, setN] = useState(0)
  const card = CARDS[n]
  const last = n === CARDS.length - 1

  function finish() {
    if (userId) introDone(userId)
    if (router.canGoBack()) router.back()
    else router.replace("/")
  }

  return (
    <View className="flex-1 bg-background px-6" style={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }}>
      <View className="flex-row justify-end">
        {!last && (
          <Pressable accessibilityRole="button" onPress={finish} hitSlop={8}>
            <Text className="font-sans-semibold text-base text-muted-foreground">Skip</Text>
          </Pressable>
        )}
      </View>
      <View className="flex-1 items-center justify-center gap-6">
        <View className={`size-28 items-center justify-center rounded-full ${card.tint}`}>
          <Icon icon={card.icon} tone={card.tone} size={52} strokeWidth={1.5} />
        </View>
        <Text accessibilityRole="header" className="text-center font-sans-bold text-[28px] leading-9 text-foreground">{card.title}</Text>
        <Text className="text-center font-sans text-base leading-6 text-muted-foreground">{card.text}</Text>
      </View>
      <View accessibilityLabel={`Card ${n + 1} of ${CARDS.length}`} className="mb-6 flex-row justify-center gap-2">
        {CARDS.map((c, i) => (
          <View key={c.title} className={`h-2 rounded-full ${i === n ? "w-6 bg-primary" : "w-2 bg-border"}`} />
        ))}
      </View>
      <View className="flex-row gap-3">
        {n > 0 && <Button text="Back" variant="outline" className="flex-1" onPress={() => setN(n - 1)} />}
        <Button text={last ? "Get started" : "Next"} className="flex-1" onPress={() => (last ? finish() : setN(n + 1))} />
      </View>
    </View>
  )
}
