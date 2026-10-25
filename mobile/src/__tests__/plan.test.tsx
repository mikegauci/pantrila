import { fireEvent, screen, waitFor } from "expo-router/testing-library"

import type { Plan } from "@pantrila/core/types"

import { api, send, streamPlan } from "@/lib/api"
import { card, PLAN } from "@/test/fixtures"
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
  api: jest.fn(), send: jest.fn(), streamPlan: jest.fn(), health: jest.fn(async () => true),
}))

const { ApiError } = jest.requireActual("@pantrila/core/api")
const ME = { subscription: { tier: "free" }, limits: { plans: { limit: 1, left: 1, window: "week", resets_at: "2026-10-26T00:00:00Z" } } }
const PROFILE = { days: 2, meals: ["lunch", "dinner"] }

function serve(plan: Plan | null) {
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/plans/latest": plan ?? new ApiError(404, "No plan yet"),
    "/me/profile": PROFILE,
    "/me": ME,
  }))
}

it("plans a week as the planner's steps stream in", async () => {
  serve(null)
  ;(streamPlan as jest.Mock).mockImplementation(async (onEvent: (e: string, d: unknown) => void) => {
    onEvent("step", { node: "profile" })
    onEvent("step", { node: "retrieve" })
    onEvent("plan", PLAN)
  })
  await showApp("/plan")
  expect(await screen.findByText("No plan yet")).toBeTruthy()
  expect(screen.getByText(/2 days of lunch, dinner/)).toBeTruthy()
  expect(screen.getByText(/1 of 1 plan left this week/)).toBeTruthy()

  await fireEvent.press(screen.getByText("Plan my week"))
  expect(await screen.findByText("Day 1")).toBeTruthy()
  expect(screen.getByText("Plan a new week")).toBeTruthy()
  expect(screen.getByText("Lots of beans this week.")).toBeTruthy()
  expect(screen.getByText("• Day 2: 1200 kcal, target 1600-1900 kcal")).toBeTruthy()
  expect(screen.getByText("Leftovers from day 1")).toBeTruthy()
  expect(screen.getByText("Leftovers for day 2")).toBeTruthy()
  expect(screen.getByText("Not counted")).toBeTruthy()  // eating out, no size
  // A range is drawn as a band; day 2 misses it.
  expect(screen.getAllByTestId("energy-band")).toHaveLength(2)
  expect(screen.getByLabelText("Energy 1200 kcal, target 1600–1900 kcal, target missed")).toBeTruthy()
  expect(screen.getByLabelText("Energy 1700 kcal, target 1600–1900 kcal")).toBeTruthy()
})

it("says why a plan could not be made", async () => {
  serve(null)
  ;(streamPlan as jest.Mock).mockRejectedValue(
    new ApiError(402, "Pantrila Free makes 1 meal plan a week. Pantrila Pro plans every day."))
  await showApp("/plan")
  await fireEvent.press(await screen.findByText("Plan my week"))
  expect(await screen.findByText(/Pantrila Free makes 1 meal plan a week/)).toBeTruthy()
})

it("keeps a meal with leftovers cooked and starts cooking with the leftovers' servings", async () => {
  serve(PLAN)
  const shown = await showApp("/plan")

  await fireEvent.press(await screen.findByLabelText("Change day 1 dinner"))
  // Day 1 dinner has leftovers on day 2, so it cannot be skipped or eaten out.
  expect(screen.getByText(/Day 2 lunch is leftovers of this meal, so it stays cooked/)).toBeTruthy()
  expect(screen.getByLabelText("Skip this meal").props.accessibilityState.disabled).toBe(true)
  await fireEvent.press(screen.getByLabelText("Start cooking"))
  expect(shown.getPathnameWithParams()).toBe("/recipes/recipe-2/cook?servings=2&later=1")
})

it("skips a meal through the server and shows the change", async () => {
  serve(PLAN)
  const skipped = structuredClone(PLAN)
  skipped.days[0].meals[0].kind = "skipped"
  ;(send as jest.Mock).mockResolvedValue(skipped)
  await showApp("/plan")
  await fireEvent.press(await screen.findByLabelText("Change day 1 lunch"))
  await fireEvent.press(screen.getByLabelText("Skip this meal"))
  expect(send).toHaveBeenCalledWith("/plans/latest/meals/1/lunch/slot", "PUT", { plan_id: 5, kind: "skipped" })
  expect(await screen.findByText("Skipped day 1 lunch")).toBeTruthy()  // the toast
  expect(screen.getByText("Was Recipe 1")).toBeTruthy()

  await fireEvent.press(screen.getByLabelText("Change day 1 lunch"))
  ;(send as jest.Mock).mockResolvedValue(PLAN)
  await fireEvent.press(screen.getByLabelText("Add back Recipe 1"))
  expect(send).toHaveBeenLastCalledWith("/plans/latest/meals/1/lunch/slot", "PUT", { plan_id: 5, kind: "recipe" })
  await waitFor(() => expect(screen.queryByText("Was Recipe 1")).toBeNull())
})

it("swaps a meal for one of the person's own recipes, with Show more", async () => {
  const option = (n: number) => ({ recipe: card(n), portions: 1, day_nutrition: { ...PLAN.days[0].nutrition, kcal: 1750 },
                                   kcal_change: 50, protein_change: -4 })
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/plans/latest": PLAN, "/me/profile": PROFILE, "/me": ME,
    "/plans/latest/meals/1/lunch/options": (path: string) => {
      const p = new URLSearchParams(path.split("?")[1])
      if (p.get("source") === "mine") return { plan_id: 5, day: 1, meal_type: "lunch", current: PLAN.days[0].meals[0], options: [], total: 0, offset: 0 }
      const limit = Number(p.get("limit"))
      return { plan_id: 5, day: 1, meal_type: "lunch", current: PLAN.days[0].meals[0],
               options: Array.from({ length: limit }, (_, i) => option(10 + i)), total: 9, offset: 0 }
    },
  }))
  ;(send as jest.Mock).mockResolvedValue(PLAN)
  await showApp("/plan")
  await fireEvent.press(await screen.findByLabelText("Change day 1 lunch"))
  await fireEvent.press(screen.getByLabelText("Swap recipe"))
  expect(await screen.findByText("Recipe 15")).toBeTruthy()
  expect(screen.getByText(/Replacing Recipe 1/)).toBeTruthy()
  expect(screen.getAllByText("Day total 1750 kcal (+50) · protein −4 g")).toHaveLength(6)
  expect(screen.getByText("Showing 6 of 9")).toBeTruthy()
  await fireEvent.press(screen.getByText("Show more"))
  expect(await screen.findByText("Recipe 21")).toBeTruthy()

  await fireEvent.press(screen.getByRole("tab", { name: "My recipes" }))
  expect(await screen.findByText("None of your recipes fit")).toBeTruthy()
  await fireEvent.press(screen.getByRole("tab", { name: "Pantrila's recipes" }))
  await fireEvent.press(await screen.findByLabelText("Use Recipe 12"))
  expect(send).toHaveBeenCalledWith("/plans/latest/meals/1/lunch", "PUT", { plan_id: 5, recipe_id: "recipe-12" })
  expect(await screen.findByText("Day 1 lunch is now Recipe 12")).toBeTruthy()
})

it("repeats a meal on later days", async () => {
  serve(PLAN)
  ;(send as jest.Mock).mockResolvedValue(PLAN)
  await showApp("/plan")
  await fireEvent.press(await screen.findByLabelText("Change day 1 lunch"))
  await fireEvent.press(screen.getByLabelText("Repeat on other days"))
  expect(screen.getByText("Instead of Recipe 2")).toBeTruthy()
  expect(screen.getByText("Instead of Eating out")).toBeTruthy()
  await fireEvent.press(screen.getByLabelText("Day 2 dinner"))
  expect(screen.getByText("Cook once, eat 2 times.")).toBeTruthy()
  await fireEvent.press(screen.getByText("Repeat on 1 meal"))
  expect(send).toHaveBeenCalledWith("/plans/latest/meals/1/lunch/repeat", "PUT",
                                    { plan_id: 5, on: [{ day: 2, meal_type: "dinner" }] })
  expect(await screen.findByText("Recipe 1: cook once, eat 2 times")).toBeTruthy()
})
