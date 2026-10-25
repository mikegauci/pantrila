import { fireEvent, screen, waitFor } from "expo-router/testing-library"
import * as ImagePicker from "expo-image-picker"

import type { Me, PantryItem, Profile } from "@pantrila/core/types"

import { api, send } from "@/lib/api"
import { forgetLocal } from "@/lib/auth"
import { sendFeedback } from "@/lib/sentry"
import { fakeApi, showApp } from "@/test/screens"

const mockSignOut = jest.fn(async () => ({ error: null }))

jest.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    ready: true,
    session: { user: { id: "u1", email: "ada@example.com", is_anonymous: false, identities: [{ provider: "google" }], user_metadata: {} } },
  }),
}))
jest.mock("@/lib/auth", () => ({
  userKey: (id: string, name: string) => `pantrila:${id}:${name}`,
  appleReady: async () => false,
  googleReady: () => true,
  linkWith: jest.fn(),
  signOut: jest.fn(),
  forgetLocal: jest.fn(async () => {}),
}))
jest.mock("@/lib/supabase", () => ({ supabase: () => ({ auth: { signOut: mockSignOut } }) }))
jest.mock("@/lib/sentry", () => ({
  FEEDBACK_EMAIL: "hello@pantrila.com",
  sentryReady: () => true,
  sendFeedback: jest.fn(async () => true),
}))
jest.mock("@/lib/api", () => ({
  ApiError: jest.requireActual("@pantrila/core/api").ApiError,
  api: jest.fn(), send: jest.fn(), health: jest.fn(async () => true),
}))

const { ApiError } = jest.requireActual("@pantrila/core/api")
const allowance = (limit: number, left: number) => ({ limit, left, window: "week" as const, resets_at: "2026-10-26T00:00:00Z" })
const ME: Me = {
  id: "u1", email: "ada@example.com", anonymous: false, avatar_url: null,
  subscription: { tier: "free", status: null, expires_at: null, will_renew: false, store: null },
  limits: { plans: allowance(1, 1), chats: allowance(10, 7), imports: allowance(5, 5), photos: allowance(0, 0) },
} as Me
const PROFILE: Profile = {
  allergies: [], diets: [], exclude_foods: ["mushroom"], max_minutes: null, days: 3, meals: ["lunch", "dinner"],
  targets: { kcal: 2000, min_protein_g: null, max_carbs_g: null, min_kcal: null, max_kcal: null }, pantry: [], cuisines: [], notes: "",
}
const META = { allergens: ["peanuts", "milk"], diets: ["vegan", "low_carb"], meal_types: ["breakfast", "lunch", "dinner"], units: ["g"], cuisines: ["italian"] }
const FOODS = [
  { key: "chickpeas", name: "chickpeas", aisle: "pantry" },
  { key: "chicken_breast", name: "chicken breast", aisle: "meat" },
  { key: "spinach", name: "spinach", aisle: "produce" },
]
const item = (key: string, aisle: string, extra: Partial<PantryItem> = {}): PantryItem =>
  ({ key, name: key.replaceAll("_", " "), aisle, quantity: null, unit: null, grams: null, ...extra })
const sent = () => (send as jest.Mock).mock.calls

beforeEach(() => {
  ;(send as jest.Mock).mockReset()
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/me": ME, "/me/profile": PROFILE, "/meta": META, "/foods": FOODS,
    "/me/pantry": [item("eggs", "dairy_eggs", { quantity: 6, unit: "piece", grams: 300 }), item("rice", "pantry")],
  }))
})

it("lists the pantry by aisle, adds a food with an amount and removes one", async () => {
  ;(send as jest.Mock).mockImplementation(async (path: string, method: string, body?: { food: string }) =>
    method === "POST" ? item(body!.food, "pantry") : undefined)
  await showApp("/pantry")
  expect(await screen.findByText("Eggs")).toBeTruthy()
  expect(screen.getByText("6 piece · 300 g")).toBeTruthy()
  expect(screen.getByText("some")).toBeTruthy()
  expect(screen.getByText("Dairy eggs")).toBeTruthy()

  // Typing offers foods from the table.
  await fireEvent.changeText(screen.getByLabelText("Food"), "chick")
  await fireEvent.press(await screen.findByLabelText("Pick Chickpeas"))
  await fireEvent.changeText(screen.getByLabelText("Amount"), "400")
  await fireEvent.press(screen.getByText("Add"))
  await waitFor(() => expect(sent()[0]).toEqual(["/me/pantry", "POST", { food: "Chickpeas", quantity: 400, unit: "g" }]))
  expect(await screen.findByText("Added Chickpeas")).toBeTruthy()

  await fireEvent.press(screen.getByLabelText("Remove Rice"))
  await waitFor(() => expect(sent()[1]).toEqual(["/me/pantry/rice", "DELETE"]))
})

it("offers the foods the API suggests for an unknown one, and tapping a food changes its amount", async () => {
  ;(send as jest.Mock).mockImplementation(async (path: string, method: string, body: { food: string }) => {
    if (body.food === "chikpeas") throw new ApiError(422, "Unknown food: chikpeas", ["chickpeas"])
    return item(body.food, "pantry")
  })
  await showApp("/pantry")
  await fireEvent.changeText(await screen.findByLabelText("Food"), "chikpeas")
  await fireEvent.press(screen.getByText("Add"))
  expect(await screen.findByText("Did you mean")).toBeTruthy()
  await fireEvent.press(screen.getByText("Chickpeas"))
  await waitFor(() => expect(sent()[1][2]).toMatchObject({ food: "chickpeas" }))

  await fireEvent.press(screen.getByLabelText("Change Eggs, 6 piece · 300 g"))
  expect(screen.getByLabelText("Food").props.value).toBe("Eggs")
  expect(screen.getByLabelText("Amount").props.value).toBe("6")
})

it("edits the profile: allergies, foods never eaten and an energy range, saved together", async () => {
  ;(send as jest.Mock).mockImplementation(async (_path: string, _method: string, body: Profile) => body)
  await showApp("/profile")
  await fireEvent.press(await screen.findByLabelText("Allergy: Peanuts"))
  await fireEvent.press(screen.getByLabelText("Diet: Low carb"))
  expect(screen.getByText("Low carb means at most 20 g carbs per serving.")).toBeTruthy()
  await fireEvent.press(screen.getByLabelText("Remove Mushroom"))
  await fireEvent.changeText(screen.getByLabelText("Foods you never eat"), "spin")
  await fireEvent.press(await screen.findByLabelText("Never eat Spinach"))

  // One number to a range keeps the goal: ±10%.
  await fireEvent.press(screen.getByRole("radio", { name: "A range" }))
  expect(screen.getByLabelText("At least (kcal)").props.value).toBe("1800")
  expect(screen.getByLabelText("At most (kcal)").props.value).toBe("2200")
  await fireEvent.changeText(screen.getByLabelText("At most (kcal)"), "")
  await fireEvent.press(screen.getByLabelText("More days"))

  await fireEvent.press(screen.getByText("Save profile"))
  await waitFor(() => expect(sent()).toHaveLength(1))
  const [path, method, body] = sent()[0]
  expect([path, method]).toEqual(["/me/profile", "PUT"])
  expect(body).toMatchObject({
    allergies: ["peanuts"], diets: ["low_carb"], exclude_foods: ["spinach"], days: 4,
    targets: { kcal: null, min_kcal: 1800, max_kcal: null },
  })
  expect(await screen.findByText("Profile saved")).toBeTruthy()
})

it("uploads a profile picture cut square on the phone", async () => {
  ;(ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
    canceled: false, assets: [{ uri: "file:///me.jpg", width: 1200, height: 900 }],
  })
  ;(send as jest.Mock).mockResolvedValue({ ...ME, avatar_url: "https://x.test/a.webp" })
  await showApp("/profile")
  await fireEvent.press(await screen.findByLabelText("Choose a picture"))
  await waitFor(() => expect(sent()[0]).toEqual(["/me/avatar", "PUT", { image: "data:image/jpeg;base64,SlBFRw==" }]))
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsEditing: true, aspect: [1, 1] }))
  expect(await screen.findByLabelText("Remove the picture")).toBeTruthy()
})

it("shows the plan, sends feedback and opens Pantry and Profile from Account", async () => {
  const shown = await showApp("/account")
  expect(await screen.findByText("Pantrila Free")).toBeTruthy()
  expect(screen.getByText("7 of 10 messages left this week")).toBeTruthy()
  expect(screen.getByText(/Signed in with Google as/)).toBeTruthy()

  await fireEvent.press(screen.getByText("Send feedback"))
  expect(screen.getByLabelText("Email for a reply (optional)").props.value).toBe("ada@example.com")
  await fireEvent.changeText(screen.getByLabelText("Your feedback"), "The timer was quiet")
  await fireEvent.press(screen.getAllByText("Send feedback").at(-1)!)
  await waitFor(() => expect(sendFeedback).toHaveBeenCalledWith("The timer was quiet", "ada@example.com", "/account"))
  expect(await screen.findByText("Thanks! Your feedback was sent.")).toBeTruthy()

  await fireEvent.press(screen.getByLabelText("Pantry"))
  expect(shown.getPathname()).toBe("/pantry")
})

it("deletes the account only after typing delete, then forgets the phone's data and signs out", async () => {
  ;(send as jest.Mock).mockResolvedValue(undefined)
  await showApp("/account")
  await fireEvent.press(await screen.findByText("Delete my account"))
  await fireEvent.changeText(screen.getByLabelText("Type delete to confirm"), "delet")
  await fireEvent.press(screen.getByText("Delete everything"))
  expect(send).not.toHaveBeenCalled()
  await fireEvent.changeText(screen.getByLabelText("Type delete to confirm"), "Delete ")
  await fireEvent.press(screen.getByText("Delete everything"))
  await waitFor(() => expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" }))
  expect(sent()[0]).toEqual(["/me", "DELETE"])
  expect(forgetLocal).toHaveBeenCalledWith("u1")
})
