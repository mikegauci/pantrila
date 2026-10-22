import { expect, test, type Page } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000011"

const recipe = {
  id: "french-mushroom-omelette", title: "Mushroom Omelette", summary: "Quick eggs.", cuisine: "french",
  meal_types: ["breakfast"], diet_tags: ["vegetarian"], allergens: ["eggs", "milk"], total_minutes: 10,
  servings: 1, nutrition: { kcal: 300, protein_g: 20, carbs_g: 2, fat_g: 22, fibre_g: 1 }, ingredient_count: 2,
  pantry_foods: ["egg"], problems: [], photo_url: null,
  ingredients: [
    { name: "eggs", food: "egg", quantity: 3, unit: "piece", grams: 150, in_pantry: true },
    { name: "butter", food: "butter", quantity: 10, unit: "g", grams: 10, in_pantry: false },
  ],
  steps: ["Whisk the eggs.", "Melt the butter and cook the eggs for 2 to 3 minutes until just set."],
}

async function open(page: Page, speech: boolean) {
  await page.clock.install()
  await page.addInitScript(({ user, speech }) => {
    localStorage.setItem(`pantrila-tour-done:${user}`, "1")
    if (!speech) {
      for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
        Object.defineProperty(window, name, { value: undefined, configurable: true })
      }
      return
    }
    // A fake microphone: the test "says" a phrase through window.__say.
    const w = window as unknown as Record<string, unknown>
    w.__listening = false
    class FakeRecognition {
      onresult: ((e: unknown) => void) | null = null
      onend: (() => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      start() { w.__rec = this; w.__listening = true }
      stop() { w.__listening = false }
      abort() { w.__listening = false }
    }
    w.SpeechRecognition = FakeRecognition
    w.webkitSpeechRecognition = FakeRecognition
    w.__say = (text: string) => {
      const result = Object.assign([{ transcript: text }], { isFinal: true })
      ;(w.__rec as FakeRecognition).onresult?.({ resultIndex: 0, results: [result] })
    }
  }, { user: id, speech })
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const data = path === "/recipes/french-mushroom-omelette" ? recipe
      : path === "/me/cooked/preview" ? { cooked: null, pantry: [] }
      : path === "/me/profile" ? { allergies: [], diets: [] }
      : path === "/me" ? { id, email: null, anonymous: true, avatar_url: null, limits: {} }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await page.waitForURL("http://127.0.0.1:3100/")
  await page.goto("/recipes/french-mushroom-omelette/cook")
  return page.getByRole("region", { name: "Cooking Mushroom Omelette" })
}

const say = (page: Page, text: string) => page.evaluate((t) => (window as unknown as { __say: (t: string) => void }).__say(t), text)

test("voice commands move between steps and run timers", async ({ page }) => {
  const cooking = await open(page, true)
  await expect(cooking.getByText("Cook hands-free.")).toBeVisible()

  await cooking.getByRole("button", { name: "Voice command list" }).click()
  await expect(page.getByText("Silence a finished timer, or pause the running one")).toBeVisible()
  await page.keyboard.press("Escape")

  await cooking.getByRole("button", { name: "Turn on voice commands" }).click()
  const notice = page.getByRole("dialog", { name: "Turn on voice commands?" })
  await expect(notice.getByText(/sends what you say to Google or Apple/)).toBeVisible()
  await notice.getByRole("button", { name: "Turn on" }).click()
  await expect(cooking.getByRole("button", { name: "Turn off voice commands" })).toBeVisible()
  await expect(cooking.getByText("Cook hands-free.")).toBeHidden()
  expect(await page.evaluate(() => (window as unknown as { __listening: boolean }).__listening)).toBe(true)

  await say(page, "start cooking")
  await expect(cooking.getByText("Whisk the eggs.")).toBeVisible()
  await say(page, "start") // only the get-ready page starts cooking
  await expect(cooking.getByText("Whisk the eggs.")).toBeVisible()
  await say(page, "start timer")
  await expect(page.getByRole("status").filter({ hasText: "No timer in this step" })).toBeVisible()

  await say(page, "go to the next step")
  await expect(cooking.getByText(/Melt the butter/)).toBeVisible()
  await expect(page.getByRole("status").filter({ hasText: "Next step" })).toBeVisible()

  await say(page, "start the timer")
  await expect(cooking.getByRole("timer")).toHaveText("2:00")
  await expect(page.getByRole("status").filter({ hasText: "Timer started: 2–3 min" })).toBeVisible()
  await page.clock.fastForward("00:30")
  await say(page, "pause the timer")
  await expect(cooking.getByRole("button", { name: "Resume timer" })).toBeVisible()
  await say(page, "start timer")
  await expect(cooking.getByRole("button", { name: "Pause timer" })).toBeVisible()
  await page.clock.fastForward("01:40")
  await expect(cooking.getByRole("timer")).toHaveText("Time's up")
  await say(page, "stop")
  await expect(cooking.getByRole("timer")).toHaveCount(0)

  await say(page, "back")
  await expect(cooking.getByText("Whisk the eggs.")).toBeVisible()

  // Remembered for the next visit, and off when the mic is tapped again.
  await page.reload()
  await expect(cooking.getByRole("button", { name: "Turn off voice commands" })).toBeVisible()
  await cooking.getByRole("button", { name: "Turn off voice commands" }).click()
  expect(await page.evaluate(() => (window as unknown as { __listening: boolean }).__listening)).toBe(false)
})

test("no mic where the browser cannot recognise speech", async ({ page }) => {
  const cooking = await open(page, false)
  await expect(cooking.getByText("Get your ingredients out")).toBeVisible()
  await expect(cooking.getByRole("button", { name: /voice command/i })).toHaveCount(0)
})
