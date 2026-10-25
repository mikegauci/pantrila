import AsyncStorage from "@react-native-async-storage/async-storage"
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition"
import { act, fireEvent, screen, waitFor, within } from "expo-router/testing-library"
import { Alert } from "react-native"

import { draftTag } from "@pantrila/core/chat"
import type { ChatEvent } from "@pantrila/core/api"
import type { ChatReply, CookbookRecipeIn } from "@pantrila/core/types"

import { api, send, streamChat } from "@/lib/api"
import { card, DETAIL } from "@/test/fixtures"
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
  api: jest.fn(), send: jest.fn(), streamChat: jest.fn(), health: jest.fn(async () => true),
}))

const { ApiError } = jest.requireActual("@pantrila/core/api")
const ME = {
  subscription: { tier: "pro" },
  limits: {
    chats: { limit: 50, left: 40, window: "day", resets_at: "2026-10-26T00:00:00Z" },
    photos: { limit: 5, left: 0, window: "day", resets_at: "2026-10-26T00:00:00Z" },
  },
}
const TOFU = card(1, { id: "tofu-bowl", title: "Tofu Bowl" })
const DRAFT: CookbookRecipeIn = {
  title: "Miso soup", summary: "Quick and warming.", cuisine: "japanese", meal_types: ["lunch"], total_minutes: 15,
  servings: 2, steps: ["Simmer the stock.", "Stir in the miso."], source: "manual", source_url: null,
  source_platform: null, source_author: null, recipe_url: null,
  ingredients: [{ name: "tofu", quantity: 200, unit: "g", food: "tofu", estimate: null }],
}

function reply(over: Partial<ChatReply> = {}): ChatReply {
  return {
    thread_id: 7, text: "Try Tofu Bowl [tofu-bowl] tonight. It is **quick**.", cited: [TOFU], flagged: [],
    tool_calls: [{ name: "search_recipes", arguments: { query: "tofu dinner" }, output: "tofu-bowl" }],
    profile_problems: [], draft_problems: [], drafts: [], pantry_changed: false, cost_usd: 0.003, latency_ms: 3000,
    ...over,
  }
}

function serve(routes: Record<string, unknown> = {}) {
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/me": ME, "/me/chats": [], "/me/recipes": [], "/recipes/tofu-bowl": { ...DETAIL, ...TOFU }, "/foods": [],
    "/me/profile": { allergies: [] }, ...routes,
  }))
}

beforeEach(async () => {
  await AsyncStorage.clear()
  ;(send as jest.Mock).mockReset().mockResolvedValue(null)
  ;(streamChat as jest.Mock).mockReset()
  serve()
})

it("asks Home's question in a new chat and streams the reply in", async () => {
  let finish: () => void = () => {}
  ;(streamChat as jest.Mock).mockImplementation((_body, onEvent: (e: ChatEvent) => void) => new Promise((resolve) => {
    onEvent({ kind: "step", label: "Searching recipes" })
    finish = () => {
      onEvent({ kind: "recipes", cards: [TOFU] })
      onEvent({ kind: "delta", text: "Try [tofu-bowl]" })
      resolve(reply())
    }
  }))
  const shown = await showApp("/assistant?q=Tofu%20dinner%3F")
  expect(streamChat).toHaveBeenCalledWith({ message: "Tofu dinner?", thread_id: null }, expect.any(Function))
  expect(await screen.findByText("Searching recipes")).toBeTruthy()
  expect(screen.getByText("Tofu dinner?")).toBeTruthy()
  // Home's question is cleared, so asking it again from Home asks again.
  await waitFor(() => expect(shown.getPathnameWithParams()).not.toMatch(/Tofu/))
  expect(streamChat).toHaveBeenCalledTimes(1)

  serve({ "/me/chats": [{ id: 7, title: "Tofu dinner?", messages: 2, updated_at: new Date().toISOString() }] })
  await act(async () => finish())
  expect(await screen.findByText("Searched “tofu dinner”: 1 recipe matched your filters")).toBeTruthy()
  // The citation is a link titled as its recipe (the title written before it goes), and the card opens cook mode.
  expect(screen.getAllByText("Tofu Bowl")[0]).toBeTruthy()
  expect(screen.getByText("quick")).toBeTruthy()
  expect(await AsyncStorage.getItem("pantrila:u1:chat-thread")).toBe("7")
  await fireEvent.press(await screen.findByText("Let's cook this!"))
  expect(shown.getPathnameWithParams()).toBe("/recipes/tofu-bowl/cook?servings=2")
})

it("opens a saved chat from the list and deletes one", async () => {
  const chats = [
    { id: 7, title: "Tofu ideas", messages: 2, updated_at: new Date().toISOString() },
    { id: 8, title: "Pasta night", messages: 2, updated_at: new Date().toISOString() },
  ]
  serve({
    "/me/chats": chats,
    "/me/chats/8": { id: 8, title: "Pasta night", updated_at: chats[1].updated_at, messages: [
      { role: "user", text: "Pasta for four?" }, { role: "assistant", text: "Here is one.", reply: reply({ text: "Here is one.", cited: [], tool_calls: [] }) },
    ] },
  })
  await showApp("/assistant")
  expect(await screen.findByText("Ask about cooking, recipes or your pantry")).toBeTruthy()
  await fireEvent.press(screen.getByText("Chats"))
  await fireEvent.press(await screen.findByText("Pasta night"))
  expect(await screen.findByText("Pasta for four?")).toBeTruthy()
  expect(screen.getByText("Here is one.")).toBeTruthy()
  expect(await AsyncStorage.getItem("pantrila:u1:chat-thread")).toBe("8")

  jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => buttons?.[1].onPress?.())
  await fireEvent.press(screen.getByText("Chats"))
  await fireEvent.press(screen.getByLabelText("Delete “Pasta night”"))
  await waitFor(() => expect(send).toHaveBeenCalledWith("/me/chats/8", "DELETE"))
  expect(await screen.findByText("Ask about cooking, recipes or your pantry")).toBeTruthy()
})

it("saves a recipe the assistant wrote to My recipes and leads back to the chat", async () => {
  ;(streamChat as jest.Mock).mockResolvedValue(reply({
    text: "Here is a soup.", cited: [], tool_calls: [], drafts: [DRAFT], draft_problems: [["Tofu is soy, which you avoid"]],
  }))
  ;(send as jest.Mock).mockImplementation(async (path: string, method: string) =>
    (method === "POST" && path === "/me/recipes" ? { ...DETAIL, id: 12, title: "Miso soup" } : null))
  const shown = await showApp("/assistant")
  await fireEvent.changeText(await screen.findByLabelText("Message"), "Write me a miso soup")
  await fireEvent.press(screen.getByLabelText("Send"))
  expect(await screen.findByText("Check Miso soup")).toBeTruthy()
  expect(screen.getByText("• Tofu is soy, which you avoid")).toBeTruthy()

  await fireEvent.press(screen.getByText("Save “Miso soup” to My recipes"))
  expect(await screen.findByText("From the assistant.")).toBeTruthy()
  expect(screen.getByDisplayValue("Miso soup")).toBeTruthy()
  await fireEvent.press(screen.getByText("Save to my recipes"))
  await waitFor(() => expect(shown.getPathnameWithParams()).toBe("/recipes/mine/12?chat=7"))
  expect(send).toHaveBeenCalledWith("/me/recipes", "POST", expect.objectContaining({
    title: "Miso soup", chat_draft: draftTag(7, DRAFT),
  }))
})

it("shows a saved draft as saved", async () => {
  serve({
    "/me/chats": [{ id: 7, title: "Soup", messages: 2, updated_at: new Date().toISOString() }],
    "/me/chats/7": { id: 7, title: "Soup", updated_at: new Date().toISOString(), messages: [
      { role: "user", text: "Soup?" },
      { role: "assistant", text: "Here.", reply: reply({ text: "Here.", cited: [], tool_calls: [], drafts: [DRAFT], draft_problems: [[]] }) },
    ] },
    "/me/recipes": [{ ...card(3), id: 12, title: "My miso soup", chat_draft: draftTag(7, DRAFT) }],
  })
  await AsyncStorage.setItem("pantrila:u1:chat-thread", "7")
  await showApp("/assistant")
  expect(await screen.findByText("Saved to My recipes as “My miso soup”")).toBeTruthy()
})

it("shows an error from the API in the chat", async () => {
  ;(streamChat as jest.Mock).mockRejectedValue(new ApiError(402, "Pantrila Free answers 10 messages a day."))
  await showApp("/assistant")
  await fireEvent.press(await screen.findByText("Find a quick high-protein breakfast."))
  expect(await screen.findByText("Pantrila Free answers 10 messages a day.")).toBeTruthy()
  expect(screen.getByText("Find a quick high-protein breakfast.")).toBeTruthy()
})

it("types what the person says into the message box", async () => {
  await showApp("/assistant")
  const box = await screen.findByLabelText("Message")
  await fireEvent.changeText(box, "Find")
  await fireEvent.press(screen.getByLabelText("Dictate message"))
  await waitFor(() => expect(screen.getByLabelText("Stop dictating")).toBeTruthy())
  const speech = ExpoSpeechRecognitionModule as unknown as { emit: (n: string, e: object) => void }
  await act(async () => speech.emit("result", { isFinal: true, results: [{ transcript: "a lentil soup" }] }))
  expect(within(screen.getByLabelText("Message").parent!).getByDisplayValue("Find a lentil soup")).toBeTruthy()
  await fireEvent.press(screen.getByLabelText("Stop dictating"))
  expect(screen.getByLabelText("Dictate message")).toBeTruthy()
})
