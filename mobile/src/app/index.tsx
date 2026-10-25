import { ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import useSWR from "swr"

import type { Meta } from "@pantrila/core/types"

import { AccountCard } from "@/components/account"
import { useAuth } from "@/components/auth-provider"
import { api, health } from "@/lib/api"
import { firstName } from "@/lib/auth"

/** The signed-in app's first screen until the tabs land (PR 5): the API is there, the shared
 * client reaches it with this account's token, and the account itself. */
export default function Home() {
  const insets = useSafeAreaInsets()
  const name = firstName(useAuth().session?.user)
  const server = useSWR("health", health)
  const meta = useSWR<Meta, Error>("/meta", (path: string) => api<Meta>(path))

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingTop: insets.top + 24 }}>
      <View className="gap-4 px-4 pb-8">
        <Text className="font-sans-bold text-3xl text-foreground">{name ? `Hello, ${name}` : "Pantrila"}</Text>
        <Text className="font-sans text-base text-muted-foreground">
          The phone app is on its way. This screen checks that it can reach the Pantrila server.
        </Text>

        <Row
          title="Server"
          text={server.data === undefined ? "Checking…" : server.data ? "Up" : "Not reachable"}
          tone={server.data === undefined ? "muted" : server.data ? "good" : "bad"}
        />
        <Row
          title="Recipe options"
          text={meta.data
            ? `${meta.data.cuisines.length} cuisines, ${meta.data.allergens.length} allergens`
            : meta.error?.message ?? "Loading…"}
          tone={meta.data ? "good" : "muted"}
        />
        <AccountCard />
      </View>
    </ScrollView>
  )
}

const TONES = { good: "text-primary-text", bad: "text-danger", muted: "text-muted-foreground" }

function Row({ title, text, tone }: { title: string; text: string; tone: keyof typeof TONES }) {
  return (
    <View className="rounded-2xl border border-border bg-surface p-4">
      <Text className="font-sans-semibold text-sm text-foreground">{title}</Text>
      <Text className={`font-sans mt-1 text-base ${TONES[tone]}`}>{text}</Text>
    </View>
  )
}
