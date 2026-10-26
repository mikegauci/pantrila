import AsyncStorage from "@react-native-async-storage/async-storage"
import { act, fireEvent, screen, waitFor } from "expo-router/testing-library"
import { Linking } from "react-native"
import Purchases from "react-native-purchases"

import type { Me } from "@pantrila/core/types"

import { api, send, streamPlan } from "@/lib/api"
import { linkWith } from "@/lib/auth"
import { purchaser } from "@/lib/purchases"
import { PLAN } from "@/test/fixtures"
import { fakeApi, showApp } from "@/test/screens"

let mockGuest = false
jest.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ ready: true, session: { user: { id: "u1", is_anonymous: mockGuest, identities: [], user_metadata: {} } } }),
}))
jest.mock("@/lib/auth", () => ({
  firstName: () => null,
  userKey: (id: string, name: string) => `pantrila:${id}:${name}`,
  appleReady: async () => false,
  googleReady: () => true,
  linkWith: jest.fn(async () => null),
  signOut: jest.fn(),
}))
jest.mock("@/lib/api", () => ({
  ApiError: jest.requireActual("@pantrila/core/api").ApiError,
  api: jest.fn(), send: jest.fn(async () => null), streamPlan: jest.fn(), health: jest.fn(async () => true),
}))

const { ApiError } = jest.requireActual("@pantrila/core/api")
const at = "2026-11-02T00:00:00+00:00"
const allowance = (limit: number, left: number) => ({ limit, left, window: "week" as const, resets_at: at })
const FREE: Me = {
  id: "u1", email: null, anonymous: false, avatar_url: null,
  subscription: { tier: "free", status: null, expires_at: null, will_renew: false, store: null },
  limits: { plans: allowance(1, 0), chats: allowance(10, 7), imports: allowance(5, 5), photos: allowance(0, 0) },
}
const PRO: Me = { ...FREE, subscription: { tier: "pro", status: "trial", expires_at: at, will_renew: true, store: "app_store" } }
const events = () => (send as jest.Mock).mock.calls.filter(([p]) => p === "/me/events").map(([, , body]) => body)

process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_test"

beforeAll(() => purchaser("u1"))  // RevenueCat is set up once per app run, as the signed-in person

beforeEach(() => {
  mockGuest = false
  ;(send as jest.Mock).mockClear()
  ;(Purchases.purchasePackage as jest.Mock).mockClear()
  ;(api as jest.Mock).mockImplementation(fakeApi({ "/me": FREE, "/me/profile": { days: 2, meals: ["dinner"] }, "/plans/latest": new ApiError(404, "No plan") }))
})

it("opens at a Free cap and leads with what was used up", async () => {
  ;(streamPlan as jest.Mock).mockRejectedValue(new ApiError(402, "Free includes 1 meal plan a week.", [], [], { feature: "plan", resets_at: at }))
  const shown = await showApp("/plan")
  await fireEvent.press(await screen.findByText("Plan my week"))
  expect(await screen.findByText("You have used this week's free meal plan.")).toBeTruthy()
  expect(shown.getPathname()).toBe("/pro")
  expect(screen.getByText("It comes back on Monday 2 November.")).toBeTruthy()
  expect(screen.getByText("With Pantrila Pro, plan a new week whenever you like.")).toBeTruthy()
  expect(events()).toContainEqual({ name: "paywall_shown", reason: "limit", feature: "plan" })
})

it("puts the yearly plan first, with its saving, the trial and the store's terms", async () => {
  await showApp("/pro?reason=profile")
  const options = await screen.findAllByRole("radio")
  expect(options.map((o) => o.props.accessibilityLabel)).toEqual(["Yearly, €29.99 a year", "Monthly, €4.99 a month"])
  expect(options[0].props.accessibilityState.checked).toBe(true)
  expect(screen.getByText("Save 50%")).toBeTruthy()
  expect(screen.getByText("€29.99 a year, €2.50 a month")).toBeTruthy()
  expect(screen.getByText("7 days free, then €29.99 a year")).toBeTruthy()
  expect(screen.getByText(/renews automatically every year until you cancel at least 24 hours before it renews/)).toBeTruthy()
  expect(screen.getByText("Restore purchases")).toBeTruthy()

  await fireEvent.press(screen.getByText("Terms"))
  expect(Linking.openURL).toHaveBeenCalledWith("https://pantrila.com/terms")
  await fireEvent.press(options[1])
  expect(screen.getByText("7 days free, then €4.99 a month")).toBeTruthy()
})

it("buys, then waits for the API to say Pro so Pro's limits apply at once", async () => {
  let webhookLanded = false
  ;(api as jest.Mock).mockImplementation(fakeApi({ "/me": () => (webhookLanded ? PRO : FREE) }))
  ;(Purchases.purchasePackage as jest.Mock).mockImplementationOnce(async () => {
    webhookLanded = true
    return { customerInfo: { entitlements: { active: { pro: { periodType: "TRIAL", expirationDate: "2099-01-08T00:00:00Z" } } } } }
  })
  const shown = await showApp("/pro?reason=limit&feature=chat&resets_at=" + encodeURIComponent(at))
  await fireEvent.press(await screen.findByText("Try Pro free for 7 days"))
  expect(Purchases.setAttributes).toHaveBeenCalledWith({ paywall_reason: "limit" })
  expect((Purchases.purchasePackage as jest.Mock).mock.calls[0][0].identifier).toBe("$rc_annual")
  expect(await screen.findByText("Pantrila Pro is on")).toBeTruthy()
  await waitFor(() => expect(shown.getPathname()).not.toBe("/pro"))
  expect(events()).toContainEqual({ name: "paywall_closed", reason: "limit", outcome: "bought" })
})

it("asks a guest to keep their data first, and lets them buy as a guest", async () => {
  mockGuest = true
  const bought = () => (Purchases.purchasePackage as jest.Mock).mock.calls.length > 0
  ;(api as jest.Mock).mockImplementation(fakeApi({ "/me": () => (bought() ? PRO : FREE) }))
  await showApp("/pro")
  await fireEvent.press(await screen.findByText("Try Pro free for 7 days"))
  expect(await screen.findByText("Keep your data first?")).toBeTruthy()
  expect(Purchases.purchasePackage).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByText("Continue with Google"))
  expect(linkWith).toHaveBeenCalledWith("google")
  await fireEvent.press(screen.getByText("Buy as a guest"))
  expect(Purchases.purchasePackage).toHaveBeenCalled()
})

it("says so when the store has no Pro for this account", async () => {
  await showApp("/pro")
  await fireEvent.press(await screen.findByText("Restore purchases"))
  expect(await screen.findByText("No Pantrila Pro found for this App Store account.")).toBeTruthy()
})

it("shows Pro on Account with the store's page to manage it", async () => {
  ;(api as jest.Mock).mockImplementation(fakeApi({ "/me": PRO }))
  await showApp("/account")
  expect(await screen.findByText("Pantrila Pro, free trial, renews on 2 November 2026")).toBeTruthy()
  await fireEvent.press(screen.getByText("Manage subscription"))
  await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith("https://apps.apple.com/account/subscriptions"))
})

it("offers the trial on Account to someone on Free", async () => {
  const shown = await showApp("/account")
  await fireEvent.press(await screen.findByText("Try Pro free for 7 days"))
  expect(shown.getPathname()).toBe("/pro")
  expect(await screen.findByText("Plan, import and ask as often as you like.")).toBeTruthy()
})

const ENDED: Me = { ...FREE, subscription: { tier: "free", status: "expired", expires_at: at, will_renew: false, store: "play_store" } }

it("welcomes back a subscriber whose Pro ended", async () => {
  ;(api as jest.Mock).mockImplementation(fakeApi({ "/me": ENDED, "/me/recipes": [], "/me/chats": [] }))
  const shown = await showApp("/")
  expect(await screen.findByText("Welcome back")).toBeTruthy()
  expect(shown.getPathname()).toBe("/pro")
  expect(await AsyncStorage.getItem("pantrila:u1:pro-welcome-back")).toBe(at)
  await fireEvent.press(screen.getByText("Not now"))
  expect(shown.getPathname()).toBe("/")
})

it("welcomes them back only once per ending", async () => {
  await AsyncStorage.setItem("pantrila:u1:pro-welcome-back", at)
  ;(api as jest.Mock).mockImplementation(fakeApi({ "/me": ENDED, "/me/recipes": [], "/me/chats": [] }))
  const shown = await showApp("/")
  expect(await screen.findByText("My recipes")).toBeTruthy()
  await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalledWith("pantrila:u1:pro-welcome-back"))
  await act(async () => {})
  expect(shown.getPathname()).toBe("/")
})

it("after a plan on Free, mentions Pro once a week", async () => {
  ;(api as jest.Mock).mockImplementation(fakeApi({ "/me": { ...FREE, limits: { ...FREE.limits, plans: allowance(1, 1) } },
                                                  "/me/profile": { days: 2, meals: ["dinner"] }, "/plans/latest": PLAN }))
  ;(streamPlan as jest.Mock).mockImplementation(async (onEvent: (e: string, d: unknown) => void) => onEvent("plan", PLAN))
  await showApp("/plan")
  await fireEvent.press(await screen.findByText("Plan a new week"))
  expect(await screen.findByText(/Free: 1 plan a week. Pro plans as often as you like./)).toBeTruthy()
  expect(await AsyncStorage.getItem("pantrila:u1:pro-plan-note")).toBe(at)
  await fireEvent.press(screen.getByText("Plan a new week"))
  expect(await AsyncStorage.getItem("pantrila:u1:pro-plan-note")).toBe(at)
})
