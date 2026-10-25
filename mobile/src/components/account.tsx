import { useEffect, useState } from "react"
import { Alert, Text, View } from "react-native"

import { useAuth } from "@/components/auth-provider"
import { Choice } from "@/components/choice"
import { appleReady, googleReady, linkWith, signOut, type Provider } from "@/lib/auth"

/** Who is signed in; a guest can keep their data with Google or Apple (same user id), and anyone
 * can sign out. Profile takes this over in PR 11. */
export function AccountCard() {
  const { session } = useAuth()
  const [apple, setApple] = useState(false)
  const [busy, setBusy] = useState<Provider | "out" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const user = session?.user

  useEffect(() => {
    appleReady().then(setApple, () => setApple(false))
  }, [])

  if (!user) return null
  const providers = user.identities?.map((i) => i.provider) ?? []

  async function link(provider: Provider) {
    setBusy(provider)
    setError(null)
    const message = await linkWith(provider)
    setBusy(null)
    if (message) setError(message)
  }

  function out() {
    const leave = async () => {
      setBusy("out")
      await signOut(user?.id ?? null)
    }
    if (!user?.is_anonymous) return leave()
    Alert.alert("Sign out of the guest account?",
                "A guest account cannot be opened again: your pantry, plans and recipes on it will be lost.",
                [{ text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: leave }])
  }

  return (
    <View className="gap-3 rounded-2xl border border-border bg-surface p-4">
      {user.is_anonymous ? (
        <>
          <Text className="font-sans-semibold text-base text-foreground">Keep your data</Text>
          <Text className="font-sans text-sm text-muted-foreground">
            You are a guest, so everything lives on this phone&apos;s session. Add Google{apple ? " or Apple" : ""} to
            keep your profile, pantry, plans, cookbook and chats and open them on any device.
          </Text>
          {googleReady() && (
            <Choice label={busy === "google" ? "Opening Google…" : "Continue with Google"} tone="light"
                    disabled={busy !== null} onPress={() => link("google")} />
          )}
          {apple && (
            <Choice label={busy === "apple" ? "Opening Apple…" : "Continue with Apple"} tone="dark"
                    disabled={busy !== null} onPress={() => link("apple")} />
          )}
        </>
      ) : (
        <Text className="font-sans text-sm text-muted-foreground">
          Signed in{providers.includes("google") ? " with Google" : providers.includes("apple") ? " with Apple" : ""} as{" "}
          <Text className="font-sans-semibold text-foreground">{user.email ?? "your Apple ID"}</Text>
        </Text>
      )}
      {error && <Text accessibilityRole="alert" className="font-sans text-sm text-danger">{error}</Text>}
      <Choice label={busy === "out" ? "Signing out…" : "Sign out"} tone="soft" disabled={busy !== null} onPress={out} />
    </View>
  )
}
