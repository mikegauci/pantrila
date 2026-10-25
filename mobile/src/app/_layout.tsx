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
import { useEffect } from "react"

import { AuthProvider, useAuth } from "@/components/auth-provider"

SplashScreen.preventAutoHideAsync()

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
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <Screens />
    </AuthProvider>
  )
}

/** Signed out: the welcome screen. Signed in: the app. The email link's callback works either way. */
function Screens() {
  const { session, ready } = useAuth()

  useEffect(() => {
    if (ready) SplashScreen.hideAsync()  // the splash stays up until the stored session is read
  }, [ready])

  if (!ready) return null
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="welcome" />
      </Stack.Protected>
      <Stack.Screen name="auth/callback" />
    </Stack>
  )
}
