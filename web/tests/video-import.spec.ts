import path from "node:path"

import { expect, test } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000007"
const post = "https://www.tiktok.com/@sam.cooks/video/7300000000000000009"
const draft = {
  title: "Garlic prawns", summary: "Quick prawns.", cuisine: "", meal_types: ["dinner"],
  total_minutes: 15, servings: 2,
  ingredients: [{ name: "300 g prawns", food: "prawns", quantity: 300, unit: "g", estimate: null }],
  steps: ["Fry the prawns."], source: "post", source_url: post, source_platform: "tiktok",
  source_author: "sam.cooks", recipe_url: null,
}

test("a post whose recipe is only in the video imports from the uploaded video", async ({ page }) => {
  let videoBody: { audio: string; frames: string[]; url: string | null; caption: string | null } | null = null
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript((user) => localStorage.setItem(`pantrio-tour-done:${user}`, "1"), id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const p = new URL(route.request().url()).pathname
    if (p === "/me/recipes/import/post") {
      return route.fulfill({ status: 422, json: { detail:
        "The caption doesn't include the recipe. It may be in the video: upload the video, or paste the recipe text or add screenshots." } })
    }
    if (p === "/me/recipes/import/video") {
      videoBody = route.request().postDataJSON()
      return route.fulfill({ json: { draft, cost_usd: 0.006, transcription_cost_usd: 0.0002, latency_ms: 9000,
        notes: ["Ingredient 2 (olive oil): the video only says “a glug”, so the amount is a guess. Set it."] } })
    }
    const data = p === "/me" ? { id, email: null, avatar_url: null, anonymous: true,
      limits: { imports_left: 9, imports_per_day: 10, photos_left: 5, photos_per_day: 5 } }
      : p === "/me/profile" ? { allergies: [], diets: [], exclude_foods: [], pantry: [],
        days: 7, meals: ["dinner"], max_minutes: null, cuisines: [], notes: "", targets: {} }
      : p === "/foods" ? [{ key: "prawns", name: "prawns", aisle: "seafood" }]
      : p === "/me/recipes/preview" ? { ingredients: [], nutrition: { kcal: 200, protein_g: 30, carbs_g: 2, fat_g: 8, fibre_g: 0 }, allergens: ["crustaceans"],
        diet_tags: [], estimated: false, problems: [] }
      : p === "/plans/latest" ? null
      : p === "/health" ? { ok: true } : []
    if (data === null) return route.fulfill({ status: 404, json: {} })
    await route.fulfill({ json: data })
  })

  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page).not.toHaveURL(/login/)
  await page.goto("/recipes/mine/new")
  await page.getByRole("button", { name: /From a post/ }).click()
  await page.getByLabel("Post link").fill(post)
  await page.getByLabel("Caption", { exact: true }).fill("Garlic prawns 🍤 recipe in the video #fyp")
  await page.getByRole("button", { name: "Read recipe" }).click()

  await expect(page.getByRole("alert").filter({ hasText: "may be in the video" })).toBeVisible()
  await page.getByRole("button", { name: "Upload the video" }).click()
  await expect(page.getByText("In TikTok: Share, then Save video.")).toBeVisible()
  await page.getByLabel("Video file").setInputFiles(path.join(__dirname, "fixtures", "cooking.webm"))
  await page.screenshot({ path: "test-results/video-import-upload.png", fullPage: true })
  await page.getByRole("button", { name: "Read the video" }).click()

  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Garlic prawns")
  await expect(page.getByText("the video only says “a glug”")).toBeVisible()
  expect(videoBody).not.toBeNull()
  const body = videoBody!
  expect(body.url).toBe(post)
  expect(body.caption).toBe("Garlic prawns 🍤 recipe in the video #fyp")
  expect(body.frames).toHaveLength(4)
  expect(body.frames.every((f) => f.startsWith("data:image/jpeg;base64,"))).toBe(true)
  // 4 s of 16 kHz mono 16-bit WAV: a 44-byte header and 128,000 bytes of samples.
  expect(body.audio.startsWith("data:audio/wav;base64,UklGR")).toBe(true)
  const wavBytes = Buffer.from(body.audio.split(",")[1], "base64")
  expect(wavBytes.readUInt32LE(24)).toBe(16_000)
  expect(wavBytes.readUInt16LE(22)).toBe(1)
  expect(Math.abs(wavBytes.length - 44 - 128_000)).toBeLessThan(3_200)
  await page.screenshot({ path: "test-results/video-import-draft.png", fullPage: true })
})
