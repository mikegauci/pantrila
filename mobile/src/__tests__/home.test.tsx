import { fireEvent, screen } from "expo-router/testing-library"

import { api, health } from "@/lib/api"
import { card } from "@/test/fixtures"
import { fakeApi, showApp } from "@/test/screens"

jest.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    ready: true,
    session: { user: { id: "u1", is_anonymous: true, identities: [], user_metadata: { full_name: "Ada Lovelace" } } },
  }),
}))
jest.mock("@/lib/auth", () => ({
  firstName: (user: { user_metadata: { full_name: string } }) => user.user_metadata.full_name.split(" ")[0],
  userKey: (id: string, name: string) => `pantrila:${id}:${name}`,
  appleReady: async () => false,
  googleReady: () => true,
  linkWith: jest.fn(),
  signOut: jest.fn(),
}))
jest.mock("@/lib/api", () => ({ api: jest.fn(), health: jest.fn(async () => true) }))

const mine = (n: number) => ({ ...card(n), id: n, title: `My dish ${n}` })

it("greets by name, opens a question in the Assistant tab and pings the server", async () => {
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/me/recipes": [],
    "/me/chats": [{ id: 7, title: "Tofu ideas", updated_at: "2026-10-25T10:00:00Z" }],
  }))
  const shown = await showApp("/")
  expect(screen.getByText(/^Good (morning|afternoon|evening), Ada$/)).toBeTruthy()
  expect(health).toHaveBeenCalled()
  // Five tabs, in the web's order.
  for (const tab of ["Home", "Assistant", "Recipes", "Plan", "Grocery"]) expect(screen.getAllByText(tab).length).toBeGreaterThan(0)

  // No recipes yet: the import pitch.
  expect(await screen.findByText(/Saw a recipe on TikTok/)).toBeTruthy()
  expect(await screen.findByText("Tofu ideas")).toBeTruthy()

  await fireEvent.changeText(screen.getByLabelText("Ask Pantrila"), "  What is a roux?  ")
  await fireEvent.press(screen.getByLabelText("Ask"))
  expect(shown.getPathnameWithParams()).toBe("/assistant?q=What+is+a+roux%3F")
})

beforeEach(() => {
  ;(api as jest.Mock).mockImplementation(fakeApi({ "/me/recipes": [1, 2, 3, 4, 5].map(mine), "/me/chats": [] }))
})

it("shows the latest four of My recipes", async () => {
  const shown = await showApp("/")
  expect(await screen.findByText("5 saved")).toBeTruthy()
  expect(screen.getByText("My dish 4")).toBeTruthy()
  expect(screen.queryByText("My dish 5")).toBeNull()

  await fireEvent.press(screen.getByText("My dish 2"))
  expect(shown.getPathname()).toBe("/recipes/mine/2")
})

it("opens Account from the header", async () => {
  const again = await showApp("/")
  await screen.findByText("5 saved")
  await fireEvent.press(screen.getByLabelText("Account"))
  expect(again.getPathname()).toBe("/account")
  expect(await screen.findByText("Keep your data")).toBeTruthy()  // a guest can keep their data
})
