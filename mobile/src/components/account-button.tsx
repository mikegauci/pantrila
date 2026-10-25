import { Image } from "expo-image"
import { Link } from "expo-router"
import { Pressable, Text } from "react-native"

import { avatarFor } from "@pantrila/core/avatar"

import { useAuth } from "@/components/auth-provider"

/** The header's account button: the Google or Apple picture, else the food-emoji avatar the web
 * shows for this user id. It opens Account (Pantry, Profile, sign-out). */
export function AccountButton() {
  const user = useAuth().session?.user
  if (!user) return null
  const picture = typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null
  const { emoji, bg } = avatarFor(user.id)
  return (
    <Link href="/account" asChild>
      <Pressable accessibilityRole="button" accessibilityLabel="Account"
                 className={`mr-4 size-9 items-center justify-center overflow-hidden rounded-full ${bg}`}>
        {picture
          ? <Image source={picture} style={{ width: 36, height: 36 }} accessibilityIgnoresInvertColors />
          : <Text className="text-lg">{emoji}</Text>}
      </Pressable>
    </Link>
  )
}
