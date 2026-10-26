import AsyncStorage from "@react-native-async-storage/async-storage"
import { fireEvent, screen, waitFor } from "expo-router/testing-library"

import { api } from "@/lib/api"
import { fakeApi, showApp } from "@/test/screens"

jest.unmock("@/lib/intro")
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

beforeEach(async () => {
  await AsyncStorage.clear()
  ;(api as jest.Mock).mockImplementation(fakeApi({ "/me/recipes": [], "/me/chats": [] }))
})

it("shows three cards the first time, then never again for this person", async () => {
  const shown = await showApp("/")
  expect(await screen.findByText("Ask Pantrila")).toBeTruthy()
  expect(shown.getPathname()).toBe("/intro")
  await fireEvent.press(screen.getByText("Next"))
  expect(screen.getByText("Import from a post")).toBeTruthy()
  await fireEvent.press(screen.getByText("Next"))
  expect(screen.getByText("Cook hands-free")).toBeTruthy()
  expect(screen.queryByText("Skip")).toBeNull()
  await fireEvent.press(screen.getByText("Get started"))
  await waitFor(() => expect(shown.getPathname()).toBe("/"))
  expect(await AsyncStorage.getItem("pantrila-intro-done:u1")).toBe("1")

  screen.unmount()
  const again = await showApp("/")
  await screen.findByText(/Saw a recipe on TikTok/)
  expect(again.getPathname()).toBe("/")
})
