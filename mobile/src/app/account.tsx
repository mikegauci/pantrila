import { Refrigerator, UserRound } from "lucide-react-native"
import { ScrollView, Text, View } from "react-native"

import { AccountCard } from "@/components/account"
import { Icon } from "@/components/icon"

/** From the header's account button: Pantry and Profile (in the app from mobile plan PR 11), and
 * the account itself. */
export default function Account() {
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-10">
      <View className="rounded-2xl border border-border bg-surface">
        <Row icon={Refrigerator} title="Pantry" text="What is in your kitchen" />
        <View className="h-px bg-border" />
        <Row icon={UserRound} title="Profile" text="Diet, allergies and nutrition targets" />
      </View>
      <Text className="font-sans text-sm text-muted-foreground">
        Pantry and Profile are coming to the app. Until then, change them in the web app at app.pantrila.com
        with this account; recipes here follow them.
      </Text>
      <AccountCard />
    </ScrollView>
  )
}

function Row({ icon, title, text }: { icon: typeof Refrigerator; title: string; text: string }) {
  return (
    <View className="flex-row items-center gap-3 p-4 opacity-60">
      <Icon icon={icon} tone="muted-foreground" size={20} />
      <View className="flex-1">
        <Text className="font-sans-semibold text-base text-foreground">{title}</Text>
        <Text className="font-sans text-sm text-muted-foreground">{text}</Text>
      </View>
      <Text className="font-sans-medium text-xs text-muted-foreground">Soon</Text>
    </View>
  )
}
