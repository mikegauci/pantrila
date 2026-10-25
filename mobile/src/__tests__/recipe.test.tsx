import { fireEvent, screen } from "expo-router/testing-library"

import { api } from "@/lib/api"
import { DETAIL } from "@/test/fixtures"
import { fakeApi, showApp } from "@/test/screens"

jest.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ ready: true, session: { user: { id: "u1", user_metadata: {} } } }),
}))
jest.mock("@/lib/auth", () => ({
  firstName: () => null,
  userKey: (id: string, name: string) => `pantrila:${id}:${name}`,
}))
jest.mock("@/lib/api", () => ({ api: jest.fn(), health: jest.fn(async () => true) }))

beforeEach(() => {
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/recipes/recipe-1": DETAIL,
    "/me/profile": { allergies: ["milk"], diets: [], exclude_foods: [] },
  }))
})

it("warns about the person's rules and marks their allergens", async () => {
  await showApp("/recipes/recipe-1")
  expect(await screen.findByText("This recipe does not suit you")).toBeTruthy()
  expect(screen.getByText("• contains milk")).toBeTruthy()
  expect(await screen.findByText("You have 1 of 2 in your pantry")).toBeTruthy()
  expect(screen.getByLabelText("In your pantry")).toBeTruthy()
})

it("scales the ingredients, changes a line's unit and the oven's", async () => {
  const shown = await showApp("/recipes/recipe-1")
  expect(await screen.findByText("200 g")).toBeTruthy()
  expect(screen.getByText(/butter/)).toBeTruthy()  // "1 tbsp butter" reads once, not twice
  expect(screen.queryByText(/1 tbsp 1 tbsp/)).toBeNull()

  await fireEvent.press(screen.getByLabelText("More servings"))
  expect(screen.getByText("3 servings")).toBeTruthy()
  expect(screen.getByText("300 g")).toBeTruthy()

  await fireEvent.press(screen.getByLabelText("Change measurement for rice"))
  await fireEvent.press(screen.getByText(/^1½ cup/))
  expect(screen.getByLabelText("1½ cup rice: change measurement")).toBeTruthy()

  expect(screen.getByText("Preheat the oven to 180°C (165°C fan).")).toBeTruthy()
  expect(screen.getByText("Bake for ½ hour.")).toBeTruthy()
  await fireEvent.press(screen.getByText("°F"))
  expect(screen.getByText("Preheat the oven to 350°F (325°F fan).")).toBeTruthy()

  await fireEvent.press(screen.getAllByText("Start cooking")[0])
  expect(shown.getPathnameWithParams()).toBe("/recipes/recipe-1/cook?servings=3")
})

it("says when a recipe does not exist", async () => {
  await showApp("/recipes/no-such")
  expect(await screen.findByText("No such recipe.")).toBeTruthy()
})
