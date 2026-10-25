import { router } from "expo-router"
import { useShareIntentContext } from "expo-share-intent"
import { useEffect } from "react"

import { useAuth } from "@/components/auth-provider"
import { fromShareIntent, holdShare, useSharedRecipe } from "@/lib/share"
import { toast } from "@/lib/toast"

/** Takes what was shared to Pantrila (the share sheet, `expo-share-intent`) and opens the
 * new-recipe screen, which imports it. Signed out, the share waits on the welcome screen until
 * the person signs in. */
export function ShareHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext()
  const { session } = useAuth()
  const shared = useSharedRecipe()

  useEffect(() => {
    if (!hasShareIntent) return
    const found = fromShareIntent(shareIntent)
    resetShareIntent()
    if ("error" in found) toast.error(found.error)
    else holdShare(found)
  }, [hasShareIntent, shareIntent, resetShareIntent])

  useEffect(() => {
    if (!shared || !session) return
    // On a cold start (or just after signing in) the router is not ready while the first screens
    // mount, and says so by throwing: try again shortly, for up to 5 seconds.
    let tries = 0
    const t = setInterval(() => {
      try {
        router.navigate("/recipes/mine/new")
        clearInterval(t)
      } catch {
        if (++tries >= 50) clearInterval(t)
      }
    }, 100)
    return () => clearInterval(t)
  }, [shared, session])

  return null
}
