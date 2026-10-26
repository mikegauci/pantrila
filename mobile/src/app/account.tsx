import { Link, router } from "expo-router"
import { BadgeCheck, ChevronRight, Compass, MessageSquareHeart, Refrigerator, Sparkles, UserRound } from "lucide-react-native"
import { useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"

import { leftText, subscriptionText } from "@pantrila/core/subscription"

import { AccountCard } from "@/components/account"
import { Button, Panel, PanelTitle } from "@/components/bits"
import { DeleteAccount } from "@/components/delete-account"
import { FeedbackSheet } from "@/components/feedback"
import { Icon } from "@/components/icon"
import { useMe } from "@/lib/hooks"
import { openPaywall, proOffer } from "@/lib/pro"
import { manageSubscription } from "@/lib/purchases"

/** From the header's account button: Pantry and Profile, the plan the person is on, help, the
 * account itself (keep a guest's data, sign out) and deleting it. */
export default function Account() {
  const [feedback, setFeedback] = useState(false)
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-10">
      <View className="rounded-2xl border border-border bg-surface">
        <Row href="/pantry" icon={Refrigerator} title="Pantry" text="What is in your kitchen" />
        <View className="h-px bg-border" />
        <Row href="/profile" icon={UserRound} title="Profile" text="Picture, diet, allergies and nutrition targets" />
      </View>
      <PlanCard />
      <AccountCard />
      <Panel>
        <PanelTitle>Help</PanelTitle>
        <View className="gap-2">
          <Button text="Show the intro again" icon={Compass} variant="outline" onPress={() => router.push("/intro")} />
          <Button text="Send feedback" icon={MessageSquareHeart} variant="outline" onPress={() => setFeedback(true)} />
        </View>
      </Panel>
      <DeleteAccount />
      <FeedbackSheet open={feedback} onClose={() => setFeedback(false)} />
    </ScrollView>
  )
}

function Row({ href, icon, title, text }: { href: "/pantry" | "/profile"; icon: typeof Refrigerator; title: string; text: string }) {
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={title} className="flex-row items-center gap-3 p-4">
        <Icon icon={icon} tone="primary-text" size={20} />
        <View className="flex-1">
          <Text className="font-sans-semibold text-base text-foreground">{title}</Text>
          <Text className="font-sans text-sm text-muted-foreground">{text}</Text>
        </View>
        <Icon icon={ChevronRight} tone="muted-foreground" size={18} />
      </Pressable>
    </Link>
  )
}

/** Free or Pantrila Pro, what is left of each paid feature, and the way to Pro (the paywall) (where Restore purchases is) or
 * to the store's page for the subscription (renewal, cancelling). */
function PlanCard() {
  const { data: me } = useMe()
  if (!me) return null
  const s = me.subscription
  const store = s.store === "app_store" ? "the App Store" : s.store === "play_store" ? "Google Play" : null
  const fromStore = s.store === "app_store" || s.store === "play_store"
  return (
    <Panel>
      <PanelTitle>Your plan</PanelTitle>
      <View className="mb-2 flex-row items-center gap-2">
        <Text className="flex-1 font-sans-semibold text-base text-foreground">{subscriptionText(s)}</Text>
        {s.tier === "pro" && <Icon icon={BadgeCheck} tone="primary-text" size={20} />}
      </View>
      {(["plan", "chat", "import", "photo"] as const).map((f) => (
        <Text key={f} className="font-sans text-sm text-muted-foreground">
          {leftText(f, me.limits[`${f}s` as "plans" | "chats" | "imports" | "photos"])}
        </Text>
      ))}
      <Text className="mt-2 font-sans text-xs text-muted-foreground">
        {s.tier === "pro"
          ? store ? `Cancel any time in ${store}; it takes one tap.` : "Thanks for trying Pantrila Pro."
          : "Browsing, cooking mode, your pantry and the grocery list stay free."}
      </Text>
      <View className="mt-3 gap-2">
        {s.tier === "free" && <Button text={proOffer(me)} icon={Sparkles} onPress={() => openPaywall("profile")} />}
        {s.tier === "pro" && fromStore && (
          <Button text="Manage subscription" variant="outline" onPress={() => manageSubscription().catch(() => {})} />
        )}
      </View>
    </Panel>
  )
}
