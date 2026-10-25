import { useEffect, useState } from "react"
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Choice } from "@/components/choice"
import { supabaseReady } from "@/lib/supabase"
import { appleReady, googleReady, sendEmailLink, signInAsGuest, signInWith, type Provider } from "@/lib/auth"

type Busy = Provider | "guest" | "email" | null

/** Welcome, as the web's login page: Google, Apple (iPhone), a guest, or an email link. */
export default function Welcome() {
  const insets = useSafeAreaInsets()
  const [apple, setApple] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)

  useEffect(() => {
    appleReady().then(setApple, () => setApple(false))
  }, [])

  async function run(kind: Exclude<Busy, null>, action: () => Promise<string | null>) {
    setBusy(kind)
    setError(null)
    const message = await action().catch((e: unknown) => (e instanceof Error ? e.message : String(e)))
    setBusy(null)
    if (message) setError(message)
    else if (kind === "email") setSent(true)
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }}
                  keyboardShouldPersistTaps="handled">
        <View className="gap-2 px-6">
          <Text className="font-sans-bold text-3xl text-foreground">Welcome to Pantrila</Text>
          <Text className="font-sans text-base text-muted-foreground">
            Set your diet and allergies, add what is in your kitchen and plan a week of meals.
          </Text>

          {!supabaseReady() && (
            <Text accessibilityRole="alert" className="font-sans mt-4 rounded-xl bg-danger-soft p-3 text-sm text-danger">
              Sign-in is not set up in this build: set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (mobile/.env.local, or an EAS
              environment variable) and rebuild.
            </Text>
          )}
          {error && (
            <Text accessibilityRole="alert" className="font-sans mt-4 rounded-xl bg-danger-soft p-3 text-sm text-danger">
              {error}
            </Text>
          )}

          <View className="mt-8 gap-3">
            {googleReady() && (
              <Choice label={busy === "google" ? "Opening Google…" : "Continue with Google"} tone="light"
                      disabled={busy !== null} onPress={() => run("google", () => signInWith("google"))} />
            )}
            {apple && (
              <Choice label={busy === "apple" ? "Opening Apple…" : "Continue with Apple"} tone="dark"
                      disabled={busy !== null} onPress={() => run("apple", () => signInWith("apple"))} />
            )}
            <Text className="font-sans text-center text-xs text-muted-foreground">
              Keeps your pantry, plans and cookbook on any device.
            </Text>
          </View>

          <View className="my-6 flex-row items-center gap-3">
            <View className="h-px flex-1 bg-border" />
            <Text className="font-sans text-xs text-muted-foreground">or</Text>
            <View className="h-px flex-1 bg-border" />
          </View>

          <Choice label={busy === "guest" ? "Starting…" : "Try it as a guest"} tone="soft"
                  disabled={busy !== null} onPress={() => run("guest", signInAsGuest)} />
          <Text className="font-sans mt-2 text-center text-xs text-muted-foreground">
            No account needed. Add Google{apple ? " or Apple" : ""} later to keep your data.
          </Text>

          <View className="mt-8 border-t border-border pt-6">
            {sent ? (
              <View accessibilityRole="summary" className="gap-2">
                <Text className="font-sans text-sm text-foreground">
                  Check <Text className="font-sans-semibold">{email.trim()}</Text> for a sign-in link and open it on
                  this phone.
                </Text>
                <Pressable accessibilityRole="button" onPress={() => setSent(false)}>
                  <Text className="font-sans-medium text-sm text-primary-text">Use another email</Text>
                </Pressable>
              </View>
            ) : emailOpen ? (
              <View className="gap-2">
                <Text className="font-sans-medium text-sm text-foreground">Sign in with email</Text>
                <TextInput
                  accessibilityLabel="Email"
                  className="font-sans h-12 rounded-xl border border-border bg-surface px-3 text-base text-foreground"
                  autoFocus autoCapitalize="none" autoComplete="email" keyboardType="email-address"
                  placeholder="you@example.com" value={email} onChangeText={setEmail}
                />
                <Choice label={busy === "email" ? "Sending…" : "Email me a sign-in link"} tone="primary"
                        disabled={busy !== null || !email.includes("@")}
                        onPress={() => run("email", () => sendEmailLink(email))} />
              </View>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setEmailOpen(true)}>
                <Text className="font-sans text-center text-sm text-muted-foreground">
                  Prefer email? <Text className="font-sans-medium text-primary-text">Sign in with a link</Text>
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
