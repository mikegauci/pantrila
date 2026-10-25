import AsyncStorage from "@react-native-async-storage/async-storage"
import { router } from "expo-router"
import { useEffect } from "react"

import { useAuth } from "@/components/auth-provider"

/** The short onboarding (three cards, `app/intro.tsx`) opens once per person on this phone, the
 * first time the tabs show. Its key is not under `userKey`, so signing out and in again does not
 * show it again; deleting the account forgets it. Account → Help opens it again. */
const key = (userId: string) => `pantrila-intro-done:${userId}`

export const introDone = (userId: string) => AsyncStorage.setItem(key(userId), "1").catch(() => {})
export const forgetIntro = (userId: string) => AsyncStorage.removeItem(key(userId)).catch(() => {})

export function useFirstIntro() {
  const userId = useAuth().session?.user.id
  useEffect(() => {
    if (!userId) return
    let live = true
    AsyncStorage.getItem(key(userId)).then((done) => {
      if (live && !done) router.push("/intro")
    }, () => {})
    return () => { live = false }
  }, [userId])
}
