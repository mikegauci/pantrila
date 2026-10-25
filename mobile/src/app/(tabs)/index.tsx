import { useState } from "react"
import { RefreshControl, ScrollView, Text, View } from "react-native"
import { useSWRConfig } from "swr"

import { AskPantrila } from "@/components/ask-pantrila"
import { useAuth } from "@/components/auth-provider"
import { MyRecipesHome } from "@/components/my-recipes-home"
import { firstName } from "@/lib/auth"

function greeting(hour = new Date().getHours()) {
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
}

/** Home: a greeting, Ask Pantrila and My recipes. Today's meals join with the plan (PR 6). */
export default function Home() {
  const { session } = useAuth()
  const name = firstName(session?.user) ?? session?.user.email?.split("@")[0]
  const { mutate } = useSWRConfig()
  const [refreshing, setRefreshing] = useState(false)

  async function refresh() {
    setRefreshing(true)
    await Promise.all([mutate("/me/chats"), mutate("/me/recipes")])
    setRefreshing(false)
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-4 pt-2 pb-10"
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <View>
        <Text className="font-sans-bold text-[28px] leading-9 text-foreground">
          {greeting()}{name ? `, ${name}` : ""}
        </Text>
        <Text className="font-sans text-base text-muted-foreground">Here is what is cooking today.</Text>
      </View>
      <AskPantrila />
      <MyRecipesHome />
    </ScrollView>
  )
}
