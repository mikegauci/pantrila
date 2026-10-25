import AsyncStorage from "@react-native-async-storage/async-storage"
import * as Notifications from "expo-notifications"
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition"
import { act, fireEvent, screen, waitFor } from "expo-router/testing-library"

import type { RecipeDetail } from "@pantrila/core/types"

import { api, send } from "@/lib/api"
import { card } from "@/test/fixtures"
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
  api: jest.fn(), send: jest.fn(), health: jest.fn(async () => true),
}))

const speech = ExpoSpeechRecognitionModule as unknown as typeof ExpoSpeechRecognitionModule & {
  emit: (name: string, event: unknown) => void
}

const RECIPE: RecipeDetail = {
  ...card(1, { title: "Rice bake" }),
  servings: 2,
  ingredients: [
    { name: "rice", food: "rice", quantity: 200, unit: "g", grams: 200, in_pantry: true },
    { name: "butter", food: "butter", quantity: 1, unit: "tbsp", grams: 14, in_pantry: false },
  ],
  steps: ["Preheat the oven to 200°C.", "Toss the rice with the butter.", "Bake for 20 minutes."],
}
const KEY = "pantrila-cook:u1:corpus:recipe-1"
const CHANGE = { food: "rice", name: "rice", used_g: 300, unit: "g", before: 500, after: 200 }

beforeEach(async () => {
  await AsyncStorage.clear()
  jest.clearAllMocks()
  ;(api as jest.Mock).mockImplementation(fakeApi({ "/recipes/recipe-1": RECIPE }))
  ;(send as jest.Mock).mockImplementation(async (path: string) => {
    if (path === "/me/cooked/preview") return { cooked: null, pantry: [CHANGE] }
    if (path === "/me/cooked") return { cooked: { id: 1, pantry_updated: true }, pantry: [CHANGE] }
    return {}
  })
})

const saved = async () => JSON.parse((await AsyncStorage.getItem(KEY)) ?? "null")

it("gets ready with the plan's servings, then steps through with this step's ingredients", async () => {
  await showApp("/recipes/recipe-1/cook?servings=3&later=1")
  expect(await screen.findByText("Get your ingredients out")).toBeTruthy()
  expect(screen.getByText("3 servings")).toBeTruthy()
  expect(screen.getByText(/1 of these servings is for later in your plan/)).toBeTruthy()
  expect(screen.getByLabelText("300 g rice")).toBeTruthy()  // scaled from 2 servings to 3
  expect(send).toHaveBeenCalledWith("/me/events", "POST", { name: "cooking_mode_opened", source: "corpus" })

  await fireEvent.press(screen.getByLabelText("300 g rice"))
  await waitFor(async () => expect((await saved())?.ticked).toEqual([0]))

  await fireEvent.press(screen.getByText("Start cooking"))
  expect(await screen.findByText("Step 1 of 3")).toBeTruthy()
  // A preheat with no time points to the step that names it.
  await fireEvent.press(screen.getByLabelText("Preheat the oven: when to start"))
  expect(screen.getByText("Bake for 20 minutes.", { exact: false })).toBeTruthy()

  await fireEvent.press(screen.getByText("Next step"))
  expect(screen.getByLabelText("Ingredients for this step")).toBeTruthy()
  expect(screen.getAllByLabelText("1½ tbsp butter")).toHaveLength(1)
  await waitFor(async () => expect((await saved())?.page).toBe(2))
})

it("rings a timer, with a notification for a locked phone that pausing cancels", async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({ page: 3, ticked: [], servings: 2, timers: [], savedAt: Date.now() }))
  await showApp("/recipes/recipe-1/cook")
  await fireEvent.press(await screen.findByText("Start 20 min timer"))
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalled()  // asked the first time
  await waitFor(() => expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    identifier: expect.stringMatching(/^pantrila-timer-/),
    content: expect.objectContaining({ title: "Timer done: 20 min", body: "Rice bake, step 3" }),
  })))
  expect(screen.getByText("20:00")).toBeTruthy()

  await fireEvent.press(screen.getByLabelText("Pause timer"))
  await waitFor(() => expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalled())
  await fireEvent.press(screen.getByLabelText("Resume timer"))
  jest.setSystemTime(Date.now() + 20 * 60 * 1000 + 1000)
  await act(async () => { jest.advanceTimersByTime(600) })
  expect(await screen.findByText("Time's up")).toBeTruthy()
  // Cooking mode draws its own toasts (it covers the root layout's), so the test app shows both.
  expect((await screen.findAllByText("Timer done: step 3, 20 min")).length).toBeGreaterThan(0)
})

it("follows voice commands once the person agrees, and says speech stays on the phone", async () => {
  await showApp("/recipes/recipe-1/cook")
  await fireEvent.press(await screen.findByLabelText("Turn on voice commands"))
  expect(screen.getByText(/your speech stays on the phone/)).toBeTruthy()
  await fireEvent.press(screen.getByText("Turn on"))
  await waitFor(() => expect(speech.start).toHaveBeenCalledWith(expect.objectContaining({ requiresOnDeviceRecognition: true })))

  await act(async () => speech.emit("result", { isFinal: true, results: [{ transcript: "start cooking" }] }))
  expect(await screen.findByText("Step 1 of 3")).toBeTruthy()
  await act(async () => speech.emit("result", { isFinal: true, results: [{ transcript: "go to the next step" }] }))
  expect(await screen.findByText("Step 2 of 3")).toBeTruthy()
  await act(async () => speech.emit("result", { isFinal: true, results: [{ transcript: "start the timer" }] }))
  expect(await screen.findByText("No timer in this step")).toBeTruthy()

  // A denied mic opens the help, and the mic turns off.
  await act(async () => speech.emit("error", { error: "not-allowed" }))
  expect(await screen.findByText("Allow the microphone")).toBeTruthy()
  expect(screen.getByText("Open Settings")).toBeTruthy()
})

it("finishes with I cooked this, taking what was used out of the pantry", async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({ page: 4, ticked: [0], servings: 3, timers: [], savedAt: Date.now() }))
  await showApp("/recipes/recipe-1/cook")
  expect(await screen.findByText("That is every step")).toBeTruthy()
  expect(await screen.findByText("500 → 200 g")).toBeTruthy()
  await fireEvent.press(screen.getByText("I cooked this"))
  expect(send).toHaveBeenCalledWith("/me/cooked", "POST", { recipe_id: "recipe-1", servings: 3, update_pantry: true })
  expect(await screen.findByText("Enjoy your meal")).toBeTruthy()
  await waitFor(async () => expect(await AsyncStorage.getItem(KEY)).toBeNull())
})

it("shows a cookbook recipe's ingredient groups", async () => {
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/me/recipes/7": {
      ...RECIPE, id: 7, title: "Broth bowl", step_sections: [{ title: "Broth", first_step: 1 }],
      ingredients: [{ ...RECIPE.ingredients[0], section: "Rice" }, { ...RECIPE.ingredients[1], section: "Broth" }],
    },
  }))
  await showApp("/recipes/mine/7/cook")
  expect(await screen.findByText("Rice")).toBeTruthy()
  expect(screen.getByText("Broth")).toBeTruthy()
  expect(send).toHaveBeenCalledWith("/me/events", "POST", { name: "cooking_mode_opened", source: "mine" })
})
