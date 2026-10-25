import { Image } from "expo-image"
import type { User } from "@supabase/supabase-js"
import { Text, View } from "react-native"

import { avatarFor } from "@pantrila/core/avatar"

import { useAuth } from "@/components/auth-provider"
import { useMe } from "@/lib/hooks"

/** The Google profile picture: the user's metadata, else the Google identity's (a guest who added
 * Google). Apple sends none. */
export function googlePicture(user: User | undefined): string | null {
  const pick = (data: Record<string, unknown> | undefined) => {
    const url = data?.avatar_url ?? data?.picture
    return typeof url === "string" && url.startsWith("https://") ? url : null
  }
  const google = user?.identities?.find((i) => i.provider === "google")
  return pick(user?.user_metadata) ?? pick(google?.identity_data) ?? null
}

/** The person's picture as the web shows it: their upload, else their Google picture, else the
 * food emoji on a tint picked from their user id. */
export function UserAvatar({ size = 36 }: { size?: number }) {
  const user = useAuth().session?.user
  const { data: me } = useMe()
  if (!user) return null
  const picture = me?.avatar_url ?? googlePicture(user)
  const { emoji, bg } = avatarFor(user.id)
  return (
    <View className={`items-center justify-center overflow-hidden rounded-full ${bg}`} style={{ width: size, height: size }}>
      {picture
        ? <Image source={picture} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />
        : <Text style={{ fontSize: size / 2 }}>{emoji}</Text>}
    </View>
  )
}
