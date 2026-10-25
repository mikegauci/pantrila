import "../global.css"

// One import per weight, so only these four fonts ship (the package root pulls in all 14).
import { PlusJakartaSans_400Regular } from "@expo-google-fonts/plus-jakarta-sans/400Regular"
import { PlusJakartaSans_500Medium } from "@expo-google-fonts/plus-jakarta-sans/500Medium"
import { PlusJakartaSans_600SemiBold } from "@expo-google-fonts/plus-jakarta-sans/600SemiBold"
import { PlusJakartaSans_700Bold } from "@expo-google-fonts/plus-jakarta-sans/700Bold"
import { useFonts } from "expo-font"
import { Stack } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { ShareIntentProvider } from "expo-share-intent"
import { useEffect } from "react"
import { useCSSVariable } from "uniwind"

import { AuthProvider, useAuth } from "@/components/auth-provider"
import { ShareHandler } from "@/components/share-handler"
import { Toaster } from "@/components/toaster"

SplashScreen.preventAutoHideAsync()

// Cooking mode covers the app and has its own close button; a stray swipe must not leave it.
const COOKING = { presentation: "fullScreenModal", gestureEnabled: false } as const

export default function RootLayout() {
  // One family per weight: the names match the font-sans-* tokens in global.css.
  const [loaded, error] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  })
  const fonts = loaded || Boolean(error)

  if (!fonts) return null
  // The share sheet's provider comes first, as expo-share-intent asks.
  return (
    <ShareIntentProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <Screens />
        <ShareHandler />
        {/* Above every screen but cooking mode, a full-screen modal with its own. */}
        <Toaster />
      </AuthProvider>
    </ShareIntentProvider>
  )
}

/** Signed out: the welcome screen. Signed in: the tabs and the screens they open. The email
 * link's callback works either way. */
function Screens() {
  const { session, ready } = useAuth()
  const [background, foreground] = useCSSVariable(["--color-background", "--color-foreground"]) as string[]

  useEffect(() => {
    if (ready) SplashScreen.hideAsync()  // the splash stays up until the stored session is read
  }, [ready])

  if (!ready) return null
  return (
    <Stack screenOptions={{
      headerShown: false,
      headerStyle: { backgroundColor: background },
      headerTintColor: foreground,
      headerShadowVisible: false,
      headerTitleStyle: { fontFamily: "PlusJakartaSans_600SemiBold" },
      headerBackButtonDisplayMode: "minimal",
      contentStyle: { backgroundColor: background },
    }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="recipes/[id]/index" options={{ headerShown: true, title: "Recipe" }} />
        <Stack.Screen name="recipes/[id]/cook" options={COOKING} />
        <Stack.Screen name="recipes/mine/index" options={{ headerShown: true, title: "My recipes" }} />
        <Stack.Screen name="recipes/mine/[id]/index" options={{ headerShown: true, title: "My recipe" }} />
        <Stack.Screen name="recipes/mine/[id]/cook" options={COOKING} />
        <Stack.Screen name="recipes/mine/new" options={{ headerShown: true, title: "Add a recipe" }} />
        <Stack.Screen name="account" options={{ headerShown: true, title: "Account", presentation: "modal" }} />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="welcome" />
      </Stack.Protected>
      <Stack.Screen name="auth/callback" />
    </Stack>
  )
}
