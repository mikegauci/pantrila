import { Tabs } from "expo-router/js-tabs"
import { BookOpen, CalendarDays, Home, MessageCircle, ShoppingBasket, type LucideIcon } from "lucide-react-native"
import { useEffect } from "react"
import { View } from "react-native"
import { useCSSVariable } from "uniwind"

import { AccountButton } from "@/components/account-button"
import { WakeNotice } from "@/components/wake-notice"
import { health } from "@/lib/api"
import { useFirstIntro } from "@/lib/intro"

// Same order as the web's navigation; Pantry and Profile open from the account button.
const TABS: { name: string; title: string; icon: LucideIcon }[] = [
  { name: "index", title: "Home", icon: Home },
  { name: "assistant", title: "Assistant", icon: MessageCircle },
  { name: "recipes", title: "Recipes", icon: BookOpen },
  { name: "plan", title: "Plan", icon: CalendarDays },
  { name: "grocery", title: "Grocery", icon: ShoppingBasket },
]

export default function TabsLayout() {
  const [primary, muted, surface, border, foreground, background] = useCSSVariable([
    "--color-primary-text", "--color-muted-foreground", "--color-surface", "--color-border",
    "--color-foreground", "--color-background",
  ]) as string[]

  useFirstIntro()  // three cards the first time this person opens the app on this phone

  // Start waking the free server as soon as the app opens (the web pings on load too).
  useEffect(() => {
    health().catch(() => {})
  }, [])

  return (
    <View className="flex-1 bg-background">
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: primary,
          tabBarInactiveTintColor: muted,
          tabBarStyle: { backgroundColor: surface, borderTopColor: border },
          tabBarLabelStyle: { fontFamily: "PlusJakartaSans_500Medium", fontSize: 11 },
          headerStyle: { backgroundColor: background },
          headerShadowVisible: false,
          headerTintColor: foreground,
          headerTitleStyle: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 20 },
          headerTitleAlign: "left",
          headerRight: () => <AccountButton />,
          sceneStyle: { backgroundColor: background },
        }}
      >
        {TABS.map(({ name, title, icon: Glyph }) => (
          <Tabs.Screen key={name} name={name} options={{
            title,
            headerTitle: name === "index" ? "Pantrila" : title,
            tabBarIcon: ({ color, size }) => <Glyph color={color} size={size - 2} />,
          }} />
        ))}
      </Tabs>
      <WakeNotice />
    </View>
  )
}
