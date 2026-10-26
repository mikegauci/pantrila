import * as Notifications from "expo-notifications"
import { Linking, Platform } from "react-native"
import Purchases, {
  INTRO_ELIGIBILITY_STATUS, PACKAGE_TYPE, PURCHASES_ERROR_CODE, type CustomerInfo, type PurchasesPackage,
} from "react-native-purchases"

import type { Offer } from "@pantrila/core/subscription"

/**
 * Pantrila Pro through Apple and Google, managed by RevenueCat (entitlement `pro`, offering
 * `default` with a yearly and a monthly package). Off unless the platform's public SDK key is set
 * (`EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`). The RevenueCat user is
 * the Supabase user id, so the API's webhook knows whose Pro it is; the API stays the judge of
 * what Pro allows (`/me`), the SDK only sells it.
 */
const key = () => Platform.OS === "ios" ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
export const purchasesReady = () => Boolean(key())
export const STORE = Platform.OS === "ios" ? "app_store" : "play_store"
export const STORE_NAME = Platform.OS === "ios" ? "App Store" : "Google Play"
const ENTITLEMENT = "pro"
const MANAGE_URL = Platform.OS === "ios"
  ? "https://apps.apple.com/account/subscriptions"
  : "https://play.google.com/store/account/subscriptions?package=com.pantrila.app"

let configured = false
let current: string | null = null

/** Buy as this person (their Supabase id), or nobody after sign-out. Called on every sign-in
 * change; repeats for the same person do nothing. */
export async function purchaser(userId: string | null) {
  const apiKey = key()
  if (!apiKey || userId === current) return
  current = userId
  try {
    if (!configured) {
      if (!userId) return
      Purchases.configure({ apiKey, appUserID: userId })
      configured = true
    } else if (userId) {
      await Purchases.logIn(userId)
    } else if (!(await Purchases.isAnonymous())) {
      await Purchases.logOut()
    }
  } catch {
    current = null  // the next sign-in change tries again
  }
}

export interface StoreOffer extends Offer {
  pkg: PurchasesPackage
}

function offer(pkg: PurchasesPackage, period: Offer["period"], trialAllowed: boolean): StoreOffer {
  const p = pkg.product
  const intro = p.introPrice
  return {
    pkg, period, price: p.priceString, amount: p.price,
    perMonth: period === "year" ? p.pricePerMonthString : p.priceString,
    trial: trialAllowed && intro && intro.price === 0 ? intro.period : null,
  }
}

/** The yearly and monthly plans as the store sells them here (its prices and currency), each
 * with its free trial if this person can still have one; empty when the store has none. */
export async function loadOffers(): Promise<StoreOffer[]> {
  if (!configured) return []
  const packages = (await Purchases.getOfferings()).current?.availablePackages ?? []
  const yearly = packages.find((p) => p.packageType === PACKAGE_TYPE.ANNUAL)
  const monthly = packages.find((p) => p.packageType === PACKAGE_TYPE.MONTHLY)
  const found = [yearly, monthly].filter((p): p is PurchasesPackage => Boolean(p))
  // Google leaves out a trial someone already had; Apple needs asking.
  let ineligible = new Set<string>()
  if (Platform.OS === "ios" && found.length) {
    const asked = await Purchases.checkTrialOrIntroductoryPriceEligibility(found.map((p) => p.product.identifier))
      .catch(() => ({}) as Record<string, { status: INTRO_ELIGIBILITY_STATUS }>)
    ineligible = new Set(Object.entries(asked)
      .filter(([, e]) => e.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE).map(([id]) => id))
  }
  return found.map((p) => offer(p, p === yearly ? "year" : "month", !ineligible.has(p.product.identifier)))
}

const hasPro = (info: CustomerInfo) => ENTITLEMENT in info.entitlements.active

/** Start the store's purchase sheet. `reason` is the paywall it came from, which the webhook
 * reads back for PostHog. "cancelled" when the person closes the sheet. */
export async function buy(o: StoreOffer, reason: string): Promise<"bought" | "cancelled"> {
  await Purchases.setAttributes({ paywall_reason: reason }).catch(() => {})
  try {
    const { customerInfo } = await Purchases.purchasePackage(o.pkg)
    if (!hasPro(customerInfo)) throw new Error("The store did not confirm Pantrila Pro. Try Restore purchases.")
    remindBeforeTrialEnds(customerInfo)
    return "bought"
  } catch (e) {
    if ((e as { code?: string }).code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return "cancelled"
    throw e
  }
}

/** Pro bought earlier with this store account (another phone, a reinstall); true if found. */
export async function restore(): Promise<boolean> {
  if (!configured) return false
  return hasPro(await Purchases.restorePurchases())
}

/** The store's own page for this subscription, where cancelling is one tap. */
export async function manageSubscription() {
  const url = configured ? (await Purchases.getCustomerInfo().catch(() => null))?.managementURL : null
  await Linking.openURL(url ?? MANAGE_URL)
}

/** A local reminder two days before a free trial ends, so nobody is charged by surprise. */
async function remindBeforeTrialEnds(info: CustomerInfo) {
  const pro = info.entitlements.active[ENTITLEMENT]
  if (pro?.periodType !== "TRIAL" || !pro.expirationDate) return
  const at = new Date(new Date(pro.expirationDate).getTime() - 2 * 86_400_000)
  if (at.getTime() < Date.now() + 3_600_000) return
  try {
    const allowed = (await Notifications.getPermissionsAsync()).granted ||
      (await Notifications.requestPermissionsAsync()).granted
    if (!allowed) return
    await Notifications.scheduleNotificationAsync({
      identifier: "pantrila-trial-ends",
      content: {
        title: "Your free trial ends in 2 days",
        body: `Cancel any time in ${Platform.OS === "ios" ? "Settings" : "Google Play"}; nothing is charged before then.`,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    })
  } catch {}
}
