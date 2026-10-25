import AsyncStorage from "@react-native-async-storage/async-storage"
import * as ImagePicker from "expo-image-picker"
import { act, fireEvent, screen, waitFor } from "expo-router/testing-library"
import { Alert } from "react-native"

import type { CookbookDetail, CookbookRecipeIn, ImportView } from "@pantrila/core/types"

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
// Each test's import gets its own job id (the job watchers live as long as the module).
let mockJobId = ""
jest.mock("expo-crypto", () => ({ randomUUID: () => mockJobId }))
let jobs = 0

const ME = {
  subscription: { tier: "pro" },
  limits: {
    imports: { limit: 20, left: 19, window: "day", resets_at: "2026-10-26T00:00:00Z" },
    photos: { limit: 5, left: 4, window: "day", resets_at: "2026-10-26T00:00:00Z" },
  },
}
const FOODS = [
  { key: "rice", name: "Rice", aisle: "grains", grams_per_ml: 0.8, grams_per_piece: null },
  { key: "chicken_breast", name: "Chicken breast", aisle: "meat", grams_per_ml: null, grams_per_piece: 170 },
]
const N = { kcal: 600, protein_g: 30, carbs_g: 70, fat_g: 20, fibre_g: 8 }

const RECIPE: CookbookRecipeIn = {
  title: "Chicken broth bowl", summary: "A warming bowl.", cuisine: "", meal_types: ["dinner"], total_minutes: 40,
  servings: 2, steps: ["Cook the rice.", "Simmer the broth."], step_sections: [{ title: "Broth", first_step: 2 }],
  ingredients: [
    { name: "rice", quantity: 1, unit: "cup", food: "rice", estimate: null, section: "Rice & Chicken" },
    { name: "chicken breast", quantity: 2, unit: "piece", food: "chicken_breast", estimate: null, section: "Rice & Chicken" },
  ],
  notes: "Keeps 3 days in the fridge.\nUse thighs if you like.",
  source: "post", source_url: "https://www.tiktok.com/@chelsea/video/1", source_platform: "tiktok",
  source_author: "chelsea", recipe_url: "https://www.chelseasmessyapron.com/chicken-broth-bowl/",
}

function detail(over: Partial<CookbookDetail> = {}): CookbookDetail {
  return {
    ...card(7), id: 7, title: RECIPE.title, cuisine: "", source: "post", source_url: RECIPE.source_url,
    source_platform: "tiktok", source_author: "chelsea", recipe_url: RECIPE.recipe_url, chat_draft: null,
    created_at: "2026-10-25T10:00:00Z", updated_at: "2026-10-25T10:00:00Z", nutrition: N, estimated: false,
    invalid: [], ingredients: [
      { ...RECIPE.ingredients[0], grams: 185, in_pantry: true, grams_per_ml: 0.8 },
      { ...RECIPE.ingredients[1], grams: 340, in_pantry: false, grams_per_piece: 170 },
    ],
    steps: RECIPE.steps, step_sections: RECIPE.step_sections!, recipe: RECIPE, ...over,
  } as CookbookDetail
}

const PREVIEW = { ingredients: [], nutrition: N, allergens: [], diet_tags: [], estimated: false, problems: [] }

/** `send` by "METHOD path"; anything else (such as `/me/events`) answers null. */
function serveSend(routes: Record<string, unknown | ((body: unknown) => unknown)>) {
  ;(send as jest.Mock).mockImplementation(async (path: string, method: string, body?: unknown) => {
    const found = routes[`${method} ${path}`]
    if (found === undefined) return null
    return typeof found === "function" ? (found as (b: unknown) => unknown)(body) : found
  })
}

afterEach(() => jest.useRealTimers())

beforeEach(async () => {
  mockJobId = `job${++jobs}`
  await AsyncStorage.clear()
  ;(send as jest.Mock).mockReset().mockResolvedValue(null)
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/me": ME, "/me/profile": { allergies: [] }, "/foods": FOODS, "/meta": { reel_platforms: ["tiktok"] },
    "/me/recipes": [detail(), { ...detail({ id: 8, title: "Pasta from a link", source: "link" }) }],
    "/me/recipes/7": detail(), "/me/recipes/import/timing": { estimated_seconds: 60 },
  }))
})

it("lists my recipes with where they came from", async () => {
  const shown = await showApp("/recipes/mine")
  expect(await screen.findByText("Where they came from: social media 1, links 1.")).toBeTruthy()
  expect(screen.getByText("From social media")).toBeTruthy()
  await fireEvent.press(screen.getByLabelText("Pasta from a link"))
  expect(shown.getPathname()).toBe("/recipes/mine/8")
})

it("shows a recipe with its groups, credit, notes and the way back to the chat", async () => {
  const shown = await showApp("/recipes/mine/7?chat=12")
  expect(await screen.findByText("Rice & Chicken")).toBeTruthy()
  expect(screen.getByText("Broth")).toBeTruthy()  // the method's heading
  expect(screen.getByText("From @chelsea on TikTok")).toBeTruthy()
  expect(screen.getByText("chelseasmessyapron.com")).toBeTruthy()
  expect(screen.getByText("You have 1 of 2 in your pantry.")).toBeTruthy()
  expect(screen.getByText(/4 of 5 photos left today/)).toBeTruthy()

  expect(screen.queryByText("Keeps 3 days in the fridge.")).toBeNull()
  await fireEvent.press(screen.getByText("Notes"))
  expect(screen.getByText("Keeps 3 days in the fridge.")).toBeTruthy()

  await fireEvent.press(screen.getAllByText("Start cooking")[0])
  expect(shown.getPathname()).toBe("/recipes/mine/7/cook")
})

it("deletes a recipe after asking", async () => {
  jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => buttons?.[1].onPress?.())
  serveSend({ "DELETE /me/recipes/7": null })
  await showApp("/recipes/mine/7")
  await fireEvent.press(await screen.findByText("Delete"))
  await waitFor(() => expect(send).toHaveBeenCalledWith("/me/recipes/7", "DELETE"))
  expect(await screen.findByText("Deleted Chicken broth bowl")).toBeTruthy()
})

it("edits the method with a ## heading and saves it", async () => {
  serveSend({
    "POST /me/recipes/preview": PREVIEW,
    "PUT /me/recipes/7": (body: unknown) => detail({ recipe: body as CookbookRecipeIn }),
  })
  await showApp("/recipes/mine/7")
  await fireEvent.press(await screen.findByText("Edit"))
  await fireEvent.changeText(screen.getByLabelText("Method"), "## Rice\n\nCook the rice.\n\n## Broth\n\nSimmer.")
  await fireEvent.press(screen.getByText("Save changes"))
  await waitFor(() => expect(send).toHaveBeenCalledWith("/me/recipes/7", "PUT", expect.objectContaining({
    steps: ["Cook the rice.", "Simmer."],
    step_sections: [{ title: "Rice", first_step: 1 }, { title: "Broth", first_step: 2 }],
  })))
  expect(await screen.findByText("Saved Chicken broth bowl")).toBeTruthy()
})

const imported = (draft: CookbookRecipeIn, notes: string[] = []): ImportView =>
  ({ draft, notes, cost_usd: 0.007, latency_ms: 5200 })

it("imports a post as a job, shows its steps and saves it with a photo", async () => {
  let polls = 0
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/me": ME, "/meta": { reel_platforms: ["tiktok"] }, "/me/recipes/import/timing": { estimated_seconds: 60 },
    "/me/recipes": [], "/me/profile": { allergies: [] }, "/me/recipes/7": detail(),
    [`/me/recipes/import/jobs/${mockJobId}`]: () => (++polls === 1
      ? { id: mockJobId, status: "running", steps: [{ key: "post", label: "Reading the post" }], result: null, error: null }
      : { id: mockJobId, status: "done", steps: [], result: imported(RECIPE), error: null }),
  }))
  serveSend({
    "POST /me/recipes/import/jobs": { id: mockJobId, status: "running", result: null, error: null },
    "POST /me/recipes": detail(),
    "POST /me/recipes/7/photo": detail({ photo_url: "https://example.com/p.webp" }),
  })
  jest.useFakeTimers()
  const shown = await showApp("/recipes/mine/new?method=post")
  await fireEvent.changeText(await screen.findByLabelText("Post link"), "https://www.tiktok.com/@chelsea/video/1")
  await fireEvent.press(screen.getByText("Read recipe"))
  expect(send).toHaveBeenCalledWith("/me/recipes/import/jobs", "POST",
                                    { id: mockJobId, kind: "post", url: "https://www.tiktok.com/@chelsea/video/1" })
  // The id is kept on the phone before the request, so a closed app can pick the job up.
  expect(JSON.parse((await AsyncStorage.getItem("pantrila:u1:import-job"))!).id).toBe(mockJobId)
  expect(await screen.findByLabelText("Import steps")).toHaveTextContent(/Reading the post…/)
  expect(screen.getByText(/About 1:00 left|About 0:5\d left/)).toBeTruthy()

  await act(async () => { jest.advanceTimersByTime(2100) })
  jest.useRealTimers()
  await waitFor(() => expect(shown.getPathname()).toBe("/recipes/mine/7"))
  expect(send).toHaveBeenCalledWith("/me/recipes", "POST", RECIPE)
  expect(send).toHaveBeenCalledWith("/me/recipes/7/photo", "POST")
  expect(await AsyncStorage.getItem("pantrila:u1:import-job")).toBeNull()
})

it("opens the form for a draft with an unknown food and estimates it on its own", async () => {
  const draft = {
    ...RECIPE, source: "link" as const, source_platform: null, source_author: null, recipe_url: null,
    ingredients: [...RECIPE.ingredients, { name: "yuzu kosho", quantity: 1, unit: "tsp" as const, food: null, estimate: null }],
  }
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/me": ME, "/foods": FOODS, "/me/profile": { allergies: [] }, "/me/recipes/import/timing": { estimated_seconds: 60 },
    [`/me/recipes/import/jobs/${mockJobId}`]: { id: mockJobId, status: "done", result: imported(draft, ["Servings guessed."]), error: null },
  }))
  const estimate = {
    description: "citrus chilli paste", diet_class: "plant", allergens: [], kcal: 120, protein_g: 2, carbs_g: 10,
    fat_g: 1, fibre_g: 3, grams_per_ml: 1.1, grams_per_piece: null,
  }
  serveSend({
    "POST /me/recipes/import/jobs": { id: mockJobId, status: "running" },
    "POST /me/recipes/preview": PREVIEW,
    "POST /me/recipes/estimate": { estimates: [{ name: "yuzu kosho", estimate }], cost_usd: 0.001 },
  })
  await showApp("/recipes/mine/new?method=link")
  await fireEvent.changeText(await screen.findByLabelText("Recipe link"), "https://example.com/bowl")
  await fireEvent.press(screen.getByText("Read recipe"))
  expect(await screen.findByText("Read by AI. Finish it before saving.")).toBeTruthy()
  await fireEvent.press(screen.getByText("1 note to check"))
  expect(screen.getByText("• Servings guessed.")).toBeTruthy()
  expect(screen.getByDisplayValue("Chicken broth bowl")).toBeTruthy()
  expect(screen.getByDisplayValue("Rice & Chicken")).toBeTruthy()  // the group's name, editable
  await waitFor(() => expect(send).toHaveBeenCalledWith("/me/recipes/estimate", "POST", { names: ["yuzu kosho"] }),
                { timeout: 3000 })
  expect(await screen.findByText(/Estimated: citrus chilli paste/)).toBeTruthy()
})

it("reads photos from the library, shrunk to JPEG", async () => {
  ;(ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
    canceled: false, assets: [{ uri: "file:///a.heic", width: 4000, height: 3000 }, { uri: "file:///b.png", width: 800, height: 600 }],
  })
  const { ApiError } = jest.requireActual("@pantrila/core/api")
  serveSend({ "POST /me/recipes/import/jobs": () => { throw new ApiError(402, "Pantrila Free imports 5 recipes a month.") } })
  await showApp("/recipes/mine/new")
  await fireEvent.press(await screen.findByLabelText("From photos"))
  await fireEvent.press(await screen.findByText("Choose photos"))
  expect(await screen.findByLabelText("Photo 2")).toBeTruthy()
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ selectionLimit: 4 }))
  await fireEvent.press(screen.getByLabelText("Remove photo 2"))
  await fireEvent.press(screen.getByText("Read recipe"))
  expect(send).toHaveBeenCalledWith("/me/recipes/import/jobs", "POST",
                                    { id: mockJobId, kind: "photos", images: ["data:image/jpeg;base64,SlBFRw=="] })
  // A Free cap says so in place; the saved job id is dropped again.
  expect(await screen.findByText("Pantrila Free imports 5 recipes a month.")).toBeTruthy()
  await waitFor(async () => expect(await AsyncStorage.getItem("pantrila:u1:import-job")).toBeNull())
})

it("picks up an import left running when the app was closed", async () => {
  await AsyncStorage.setItem("pantrila:u1:import-job", JSON.stringify({ id: "old1", at: Date.now() }))
  ;(api as jest.Mock).mockImplementation(fakeApi({
    "/me": ME,
    "/me/recipes/import/jobs/old1": { id: "old1", status: "running", steps: [{ key: "video", label: "Watching the video" }] },
  }))
  await showApp("/recipes/mine/new")
  expect(await screen.findByText("It kept running while you were away. The recipe will appear here when it is read.")).toBeTruthy()
  expect(await screen.findByLabelText("Import steps")).toHaveTextContent(/Watching the video…/)
  await fireEvent.press(screen.getByText("Stop waiting"))
  await waitFor(async () => expect(await AsyncStorage.getItem("pantrila:u1:import-job")).toBeNull())
})

// Last: it leaves the router's history behind.
it("says on Home that an import is still running", async () => {
  await AsyncStorage.setItem("pantrila:u1:import-job", JSON.stringify({ id: "old2", at: Date.now() }))
  ;(api as jest.Mock).mockImplementation(fakeApi({ "/me": ME, "/me/recipes": [], "/me/chats": [] }))
  const shown = await showApp("/")
  await fireEvent.press(await screen.findByText("Finishing your import…"))
  expect(shown.getPathname()).toBe("/recipes/mine/new")
})
