import { fireEvent, screen, waitFor } from "expo-router/testing-library"

import { api } from "@/lib/api"
import { card, list } from "@/test/fixtures"
import { fakeApi, showApp } from "@/test/screens"

jest.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ ready: true, session: { user: { id: "u1", user_metadata: {} } } }),
}))
jest.mock("@/lib/auth", () => ({
  firstName: () => null,
  userKey: (id: string, name: string) => `pantrila:${id}:${name}`,
}))
jest.mock("@/lib/api", () => ({ api: jest.fn(), health: jest.fn(async () => true) }))

const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => card(from + i))
const calls = () => (api as jest.Mock).mock.calls.map(([path]) => path as string).filter((p) => p.startsWith("/recipes"))

beforeEach(() => {
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/meta": { cuisines: ["italian", "thai"], allergens: [], diets: [], meal_types: [] },
    "/recipes": (path: string) => {
      const params = new URLSearchParams(path.split("?")[1])
      if (params.get("q") === "nothing") return list([])
      if (params.get("safe") === "false") return list([card(99, { title: "Peanut noodles", problems: ["contains peanuts"] })])
      return list(params.get("offset") === "0" ? page(1, 24) : page(25, 3), { exclude_allergens: ["peanuts"] })
    },
  }))
})

it("lists recipes that suit the person and loads more at the end of the list", async () => {
  await showApp("/recipes")
  expect(await screen.findByText("Recipe 1")).toBeTruthy()
  expect(screen.getByText("no peanuts")).toBeTruthy()  // the safety banner names the rules
  expect(calls()[0]).toBe("/recipes?q=&safe=true&limit=24&offset=0")

  await fireEvent(screen.getByTestId("recipe-list"), "endReached")
  await waitFor(() => expect(screen.getByTestId("recipe-list").props.data).toHaveLength(27))
  expect(calls()).toContain("/recipes?q=&safe=true&limit=24&offset=24")
  await fireEvent(screen.getByTestId("recipe-list"), "endReached")  // a short page was the last
  expect(calls().filter((p) => p.includes("offset="))).toHaveLength(2)
})

it("filters by chips, shows everything with rule breaks marked, and says when nothing matches", async () => {
  await showApp("/recipes")
  await screen.findByText("Recipe 1")
  await fireEvent.press(screen.getByLabelText("Meal: Breakfast"))
  await fireEvent.press(screen.getByLabelText("Time: ≤ 30 min"))
  await fireEvent.press(screen.getByLabelText("Cuisine: Thai"))
  expect(calls().at(-1)).toBe("/recipes?q=&safe=true&meal=breakfast&max_minutes=30&cuisine=thai&limit=24&offset=0")

  await fireEvent(screen.getByLabelText("Only what suits me"), "valueChange", false)
  expect(await screen.findByText("Not for you: contains peanuts")).toBeTruthy()
  expect(screen.getByText(/Showing every recipe/)).toBeTruthy()

  await fireEvent.changeText(screen.getByLabelText("Search recipes"), "nothing")
  await fireEvent(screen.getByLabelText("Search recipes"), "submitEditing")
  expect(await screen.findByText("No recipes match")).toBeTruthy()
  expect(calls().at(-1)).toContain("q=nothing")
  expect(calls().at(-1)).toContain("limit=36")  // a search is one page of its best matches
})

it("shows an error with a way to try again", async () => {
  const { ApiError } = jest.requireActual("@pantrila/core/api")
  let fail = true
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/meta": { cuisines: [] },
    "/recipes": () => (fail ? new ApiError(0, "Could not reach the Pantrila server") : list([card(1)])),
  }))
  await showApp("/recipes")
  expect(await screen.findByText("Could not reach the Pantrila server")).toBeTruthy()
  fail = false
  await fireEvent.press(screen.getByText("Try again"))
  expect(await screen.findByText("Recipe 1")).toBeTruthy()
})
