import AsyncStorage from "@react-native-async-storage/async-storage"
import { fireEvent, screen, waitFor } from "expo-router/testing-library"

import { api } from "@/lib/api"
import { PLAN } from "@/test/fixtures"
import { fakeApi, showApp } from "@/test/screens"

jest.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ ready: true, session: { user: { id: "u1", user_metadata: {} } } }),
}))
jest.mock("@/lib/auth", () => ({
  firstName: () => null,
  userKey: (id: string, name: string) => `pantrila:${id}:${name}`,
}))
jest.mock("@/lib/api", () => ({
  ApiError: jest.requireActual("@pantrila/core/api").ApiError,
  api: jest.fn(), health: jest.fn(async () => true),
}))

const { ApiError } = jest.requireActual("@pantrila/core/api")
const item = (food: string, aisle: string, extra = {}) =>
  ({ food, aisle, need_g: 400, have_g: 0, buy_g: 400, amount: "400 g", recipes: ["recipe-1"], ...extra })
const calls = () => (api as jest.Mock).mock.calls.map(([p]) => p as string)

beforeEach(async () => {
  await AsyncStorage.clear()
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/plans/latest": PLAN,
    "/plans/latest/grocery": (path: string) => ({
      people: Number(new URLSearchParams(path.split("?")[1]).get("people")),
      items: [item("chickpeas", "pantry"), item("rice", "pantry", { have_g: 100 }), item("olive_oil", "oils_condiments")],
      covered: [item("onion", "produce", { amount: "2 pieces" })],
      unlisted: ["gochujang"],
    }),
  }))
})

it("lists what to buy by aisle and keeps the ticks for this person and plan", async () => {
  await showApp("/grocery")
  expect(await screen.findByText("Chickpeas")).toBeTruthy()
  expect(screen.getByText("Pantry")).toBeTruthy()
  expect(screen.getByText("Oils and condiments")).toBeTruthy()
  expect(screen.getAllByText("for Recipe 1")).toHaveLength(2)
  expect(screen.getByText("for Recipe 1 · you have 100 g")).toBeTruthy()
  expect(screen.getByText("gochujang")).toBeTruthy()  // an estimated food of the person's own recipe
  expect(screen.getByText("Onion")).toBeTruthy()  // from the pantry

  await fireEvent.press(screen.getByLabelText("Chickpeas, 400 g"))
  expect(await screen.findByText(/1 in the basket/)).toBeTruthy()
  await waitFor(async () => expect(await AsyncStorage.getItem("pantrila:u1:grocery:5")).toBe('["chickpeas"]'))

  await fireEvent.press(screen.getByLabelText("More people"))
  expect(await screen.findByText("2 people")).toBeTruthy()
  expect(calls()).toContain("/plans/latest/grocery?people=2")
})

it("remembers the ticks after the screen opens again", async () => {
  await AsyncStorage.setItem("pantrila:u1:grocery:5", '["rice"]')
  await showApp("/grocery")
  await screen.findByText("Rice")
  await waitFor(() => expect(screen.getByLabelText("Rice, 400 g").props.accessibilityState.checked).toBe(true))
  expect(screen.getByLabelText("Chickpeas, 400 g").props.accessibilityState.checked).toBe(false)
})

it("points to the plan when there is none", async () => {
  ;(api as jest.Mock).mockImplementation(fakeApi({ "/plans/latest": new ApiError(404, "No plan yet") }))
  const shown = await showApp("/grocery")
  expect(await screen.findByText("No grocery list yet")).toBeTruthy()
  await fireEvent.press(screen.getByText("Plan my week"))
  expect(shown.getPathname()).toBe("/plan")
})
