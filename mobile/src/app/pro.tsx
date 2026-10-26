import { router, useLocalSearchParams } from "expo-router"
import { BadgeCheck, Check } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native"
import { useSWRConfig } from "swr"

import {
  PRO_GIVES, USED_UP, periodText, renewalText, resetsText, savingText, subscriptionText, trialLine,
} from "@pantrila/core/subscription"
import type { Feature, Me } from "@pantrila/core/types"

import { useAuth } from "@/components/auth-provider"
import { Button, Panel } from "@/components/bits"
import { Choice } from "@/components/choice"
import { Icon } from "@/components/icon"
import { api, send } from "@/lib/api"
import { appleReady, googleReady, linkWith, type Provider } from "@/lib/auth"
import { useMe } from "@/lib/hooks"
import { PRIVACY_URL, TERMS_URL, type PaywallReason } from "@/lib/pro"
import { STORE, STORE_NAME, buy, loadOffers, manageSubscription, purchasesReady, restore, type StoreOffer } from "@/lib/purchases"
import { toast } from "@/lib/toast"

const FEATURES: Feature[] = ["plan", "chat", "import", "photo"]
const REASONS: PaywallReason[] = ["limit", "profile", "plan_note", "welcome_back"]

/** What Pro gives for the cap just reached: the paywall leads with it. */
const BENEFIT: Record<Feature, string> = {
  plan: "With Pantrila Pro, plan a new week whenever you like.",
  chat: "With Pantrila Pro, keep asking: 50 messages a day.",
  import: "With Pantrila Pro, save every recipe you find: 20 imports a day.",
  photo: "With Pantrila Pro, your own recipes get an AI photo.",
}

type Outcome = "bought" | "restored" | "closed"

/** Back to where the paywall opened from, or Home when it was opened by a link. */
const close = () => (router.canGoBack() ? router.back() : router.replace("/"))

/** The paywall, opened at a Free cap (`?reason=limit&feature=&resets_at=`, through `askForPro`),
 * from Account ("profile") or for a returning subscriber ("welcome_back"). Prices and the trial
 * come from the store; the API's `/me` decides what Pro allows, so after a purchase the screen
 * waits for the store's webhook to reach the API. */
export default function Paywall() {
  const params = useLocalSearchParams<{ reason?: string; feature?: string; resets_at?: string }>()
  const reason = (REASONS.find((r) => r === params.reason) ?? "profile") satisfies PaywallReason
  const feature = FEATURES.find((f) => f === params.feature)
  const { data: me } = useMe()
  const guest = useAuth().session?.user.is_anonymous ?? false
  const { mutate } = useSWRConfig()
  const [offers, setOffers] = useState<StoreOffer[] | null>(null)
  const [picked, setPicked] = useState<StoreOffer["period"]>("year")
  const [busy, setBusy] = useState<"buy" | "restore" | "wait" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [askGuest, setAskGuest] = useState(false)
  const outcome = useRef<Outcome>("closed")

  useEffect(() => {
    send("/me/events", "POST", { name: "paywall_shown", reason, feature }).catch(() => {})
    return () => { send("/me/events", "POST", { name: "paywall_closed", reason, outcome: outcome.current }).catch(() => {}) }
  }, [reason, feature])

  useEffect(() => {
    loadOffers().then(setOffers, () => setOffers([]))
  }, [])

  /** The API hears from the store through RevenueCat's webhook, a few seconds after a purchase:
   * ask `/me` until it says Pro, so Pro's limits apply at once. */
  async function turnOn(how: Outcome) {
    outcome.current = how
    setBusy("wait")
    for (let i = 0; i < 15; i++) {
      const fresh = await api<Me>("/me").catch(() => null)
      if (fresh?.subscription.tier === "pro") {
        await mutate("/me", fresh, { revalidate: false })
        mutate("/me/usage")
        toast.success("Pantrila Pro is on")
        return close()
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    mutate("/me")
    toast.success(`Pro is bought. Pantrila switches it on as soon as the store confirms it.`)
    close()
  }

  const offer = offers?.find((o) => o.period === picked) ?? offers?.[0]

  async function start() {
    if (!offer) return
    if (guest && !askGuest) return setAskGuest(true)
    setError(null)
    setBusy("buy")
    try {
      if ((await buy(offer, reason)) === "bought") return turnOn("bought")
    } catch (e) {
      setError(e instanceof Error ? e.message : "The purchase did not go through. Try again.")
    }
    setBusy(null)
  }

  async function restoreNow() {
    setError(null)
    setBusy("restore")
    try {
      if (await restore()) return turnOn("restored")
      setError(`No Pantrila Pro found for this ${STORE_NAME} account.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the store. Try again.")
    }
    setBusy(null)
  }

  const pro = me?.subscription.tier === "pro" && busy !== "wait"
  const yearly = offers?.find((o) => o.period === "year")
  const monthly = offers?.find((o) => o.period === "month")
  const saving = yearly && monthly ? savingText(yearly, monthly) : null
  const resets = feature && params.resets_at ? resetsText(feature, params.resets_at) : null

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-10">
      <View className="gap-1 pt-2">
        <Text accessibilityRole="header" className="font-sans-bold text-2xl text-foreground">
          {reason === "welcome_back" ? "Welcome back" : feature ? USED_UP[feature] : "Pantrila Pro"}
        </Text>
        {resets && <Text className="font-sans text-sm text-muted-foreground">{resets}</Text>}
        <Text className="font-sans-medium text-base text-foreground">
          {reason === "welcome_back"
            ? "Your recipes, pantry and plans are all still here. Pro picks up where you left off."
            : feature ? BENEFIT[feature] : "Plan, import and ask as often as you like."}
        </Text>
      </View>

      <Panel className="gap-2 bg-primary-soft">
        {PRO_GIVES.map((g) => (
          <View key={g} className="flex-row gap-2">
            <Icon icon={BadgeCheck} tone="primary-text" size={18} />
            <Text className="flex-1 font-sans text-[15px] text-foreground">{g}</Text>
          </View>
        ))}
        <Text className="mt-1 font-sans text-[13px] text-muted-foreground">
          Browsing, cooking mode, your pantry, the grocery list and My recipes stay free. Pro bought here works on the
          web app too.
        </Text>
      </Panel>

      {pro ? (
        <Panel className="gap-3">
          <Text className="font-sans-semibold text-base text-foreground">You have {subscriptionText(me.subscription)}.</Text>
          {(me.subscription.store === "app_store" || me.subscription.store === "play_store") && (
            <Button text="Manage subscription" variant="outline" onPress={() => manageSubscription().catch(() => {})} />
          )}
          <Button text="Close" onPress={close} />
        </Panel>
      ) : offers === null ? (
        <ActivityIndicator accessibilityLabel="Loading prices" />
      ) : !offer ? (
        <Panel className="gap-2">
          <Text className="font-sans-semibold text-base text-foreground">Not on sale in this version yet</Text>
          <Text className="font-sans text-sm text-muted-foreground">
            Pantrila Pro will be €4.99 a month or €29.99 a year, with a 7-day free trial.
          </Text>
        </Panel>
      ) : (
        <>
          <View accessibilityRole="radiogroup" className="gap-2">
            {[yearly, monthly].filter((o): o is StoreOffer => Boolean(o)).map((o) => (
              <PlanOption key={o.period} offer={o} picked={o === offer} onPress={() => setPicked(o.period)}
                          badge={o.period === "year" ? saving : null} />
            ))}
          </View>

          {askGuest && guest && <KeepDataFirst onBuy={start} busy={busy !== null} />}

          <View className="gap-2">
            <Text className="text-center font-sans-semibold text-[15px] text-foreground">{trialLine(offer)}</Text>
            <Button text={busy === "wait" ? "Turning on Pro…" : offer.trial ? `Try Pro free for ${periodText(offer.trial)}` : "Subscribe"}
                    busy={busy === "buy" || busy === "wait"} disabled={busy !== null} onPress={start} />
            {error && <Text accessibilityRole="alert" className="font-sans text-sm text-danger">{error}</Text>}
            <Text className="font-sans text-xs text-muted-foreground">{renewalText(offer, STORE)}</Text>
          </View>
        </>
      )}

      <View className="flex-row flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {purchasesReady() && !pro && (
          <TextLink text={busy === "restore" ? "Restoring…" : "Restore purchases"} disabled={busy !== null} onPress={restoreNow} />
        )}
        <TextLink text="Terms" onPress={() => Linking.openURL(TERMS_URL)} />
        <TextLink text="Privacy" onPress={() => Linking.openURL(PRIVACY_URL)} />
      </View>
      {!pro && <Button text="Not now" variant="ghost" disabled={busy === "wait"} onPress={close} />}
    </ScrollView>
  )
}

function PlanOption({ offer, picked, badge, onPress }: { offer: StoreOffer; picked: boolean; badge: string | null; onPress: () => void }) {
  const name = offer.period === "year" ? "Yearly" : "Monthly"
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: picked }} accessibilityLabel={`${name}, ${offer.price} a ${offer.period}`}
               onPress={onPress}
               className={`flex-row items-center gap-3 rounded-2xl border-2 bg-surface p-4 ${picked ? "border-primary" : "border-border"}`}>
      <View className={`size-6 items-center justify-center rounded-full border-2 ${picked ? "border-primary bg-primary" : "border-border"}`}>
        {picked && <Icon icon={Check} tone="primary-foreground" size={14} />}
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="font-sans-semibold text-base text-foreground">{name}</Text>
          {badge && (
            <Text className="rounded-full bg-primary px-2 py-0.5 font-sans-semibold text-[11px] text-primary-foreground">{badge}</Text>
          )}
        </View>
        <Text className="font-sans text-sm text-muted-foreground">
          {offer.price} a {offer.period}{offer.period === "year" && offer.perMonth ? `, ${offer.perMonth} a month` : ""}
        </Text>
      </View>
    </Pressable>
  )
}

/** A guest is asked to keep their data with Google or Apple before buying; the purchase belongs to
 * the store account either way, so "Buy as a guest" stays possible. */
function KeepDataFirst({ onBuy, busy }: { onBuy: () => void; busy: boolean }) {
  const [apple, setApple] = useState(false)
  const [linking, setLinking] = useState<Provider | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    appleReady().then(setApple, () => setApple(false))
  }, [])

  async function link(provider: Provider) {
    setLinking(provider)
    setError(null)
    const message = await linkWith(provider)
    setLinking(null)
    if (message) setError(message)
  }

  return (
    <Panel className="gap-3">
      <Text className="font-sans-semibold text-base text-foreground">Keep your data first?</Text>
      <Text className="font-sans text-sm text-muted-foreground">
        You are a guest. Add Google{apple ? " or Apple" : ""} so your recipes, plans and Pro stay with you on any phone and on
        the web. Pro belongs to your {STORE_NAME} account either way: Restore purchases brings it back.
      </Text>
      {googleReady() && (
        <Choice label={linking === "google" ? "Opening Google…" : "Continue with Google"} tone="light"
                disabled={linking !== null || busy} onPress={() => link("google")} />
      )}
      {apple && (
        <Choice label={linking === "apple" ? "Opening Apple…" : "Continue with Apple"} tone="dark"
                disabled={linking !== null || busy} onPress={() => link("apple")} />
      )}
      {error && <Text accessibilityRole="alert" className="font-sans text-sm text-danger">{error}</Text>}
      <Button text="Buy as a guest" variant="outline" disabled={linking !== null || busy} onPress={onBuy} />
    </Panel>
  )
}

function TextLink({ text, onPress, disabled }: { text: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="link" disabled={disabled} onPress={onPress} hitSlop={8}>
      <Text className={`font-sans-medium text-sm text-primary-text underline ${disabled ? "opacity-60" : ""}`}>{text}</Text>
    </Pressable>
  )
}
