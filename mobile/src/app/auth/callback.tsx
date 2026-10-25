import * as Linking from "expo-linking"
import { router } from "expo-router"
import { useEffect, useRef, useState } from "react"
import { Pressable, Text, View } from "react-native"

import { useAuth } from "@/components/auth-provider"
import { finishEmailLink } from "@/lib/auth"

/** Email sign-in links open the app here (pantrila://auth/callback?code=...); the code becomes a
 * session, and the signed-in app opens. */
export default function AuthCallback() {
  const url = Linking.useLinkingURL()
  const { session } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const done = useRef(false)

  useEffect(() => {
    if (!url || done.current) return
    done.current = true
    finishEmailLink(url).then((message) => {
      if (message) setError(message)
      else router.replace("/")
    })
  }, [url])

  return (
    <View className="flex-1 items-center justify-center gap-3 bg-background p-6">
      {error ? (
        <>
          <Text className="font-sans-semibold text-center text-base text-danger">Sign-in failed: {error}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.replace(session ? "/" : "/welcome")}>
            <Text className="font-sans-medium text-primary-text">{session ? "Back to Pantrila" : "Try again"}</Text>
          </Pressable>
        </>
      ) : (
        <Text className="font-sans text-muted-foreground">Signing you in…</Text>
      )}
    </View>
  )
}
