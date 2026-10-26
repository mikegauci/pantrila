import AsyncStorage from "@react-native-async-storage/async-storage"
import { router } from "expo-router"
import { useEffect } from "react"

import type { Me } from "@pantrila/core/types"

import { useAuth } from "@/components/auth-provider"
import { ApiError } from "@/lib/api"
import { userKey } from "@/lib/auth"
import { useMe } from "@/lib/hooks"

export const TERMS_URL = "https://pantrila.com/terms"
export const PRIVACY_URL = "https://pantrila.com/privacy"

export type PaywallReason = "limit" | "profile" | "plan_note" | "welcome_back"

/** Open the paywall (`app/pro.tsx`). */
export function openPaywall(reason: PaywallReason, cap?: { feature: string; resets_at: string }) {
  router.push({ pathname: "/pro", params: { reason, ...cap } })
}

/** Open the paywall if `e` is a Free cap (the API's 402); returns whether it was one. */
export function askForPro(e: unknown): boolean {
  if (!(e instanceof ApiError) || !e.pro) return false
  openPaywall("limit", e.pro)
  return true
}

/** The way to Pro: the trial for someone who never had Pro (the stores give it once). */
export const proOffer = (me: Me) => me.subscription.status === null ? "Try Pro free for 7 days" : "Get Pantrila Pro"

/** Someone whose Pro ran out sees the paywall once on their next open ("Welcome back", their data
 * untouched), once per ending; a Pro given by hand ending does not ask. In the tabs layout. */
export function useWelcomeBack() {
  const { data: me } = useMe()
  const userId = useAuth().session?.user.id
  const s = me?.subscription
  const ended = s && s.tier === "free" && s.status === "expired" && s.store !== "manual" ? s.expires_at ?? "expired" : null
  useEffect(() => {
    if (!ended || !userId) return
    const key = userKey(userId, "pro-welcome-back")
    AsyncStorage.getItem(key).then((seen) => {
      if (seen === ended) return
      AsyncStorage.setItem(key, ended).catch(() => {})
      openPaywall("welcome_back")
    }, () => {})
  }, [ended, userId])
}
