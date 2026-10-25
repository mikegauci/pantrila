import { Link } from "expo-router"
import { Pressable } from "react-native"

import { useAuth } from "@/components/auth-provider"
import { UserAvatar } from "@/components/avatar"

/** The header's account button: the person's picture (or food emoji). It opens Account (Pantry,
 * Profile, the plan they are on, help, sign-out). */
export function AccountButton() {
  if (!useAuth().session?.user) return null
  return (
    <Link href="/account" asChild>
      <Pressable accessibilityRole="button" accessibilityLabel="Account" className="mr-4">
        <UserAvatar />
      </Pressable>
    </Link>
  )
}
