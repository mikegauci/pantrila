import { expect, test, type Page } from "@playwright/test"

import { account, session } from "./helpers"

const GUEST = "00000000-0000-4000-8000-000000000021"
const GOOGLE = "http://127.0.0.1:54321/fake-google"
const profile = {
  allergies: [], diets: [], exclude_foods: [], max_minutes: null, days: 7,
  meals: ["breakfast", "lunch", "dinner"],
  targets: { kcal: null, min_protein_g: null, max_carbs_g: null },
  pantry: [], cuisines: [], notes: "",
}

async function mockBackends(page: Page) {
  await page.addInitScript((id) => {
    localStorage.setItem(`pantrila-tour-done:${id}`, "1")
    localStorage.setItem(`pantrila-replay:${id}`, "off")
  }, GUEST)
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const url = route.request().url()
    if (url.includes("/signup")) return route.fulfill({ json: session(GUEST) })
    if (url.includes("/user/identities/authorize")) return route.fulfill({ json: { url: GOOGLE } })
    if (url.startsWith(GOOGLE) || url.includes("/authorize")) {
      return route.fulfill({ contentType: "text/html", body: "<h1>Google</h1>" })
    }
    await route.fulfill({ status: 200, json: {} })
  })
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/plans/latest") return route.fulfill({ status: 404, json: { detail: "No plan" } })
    const data = path === "/me/profile" ? profile
      : path === "/meta" ? { allergens: ["peanuts"], diets: [], cuisines: [], meal_types: ["dinner"], units: ["g"] }
      : path === "/me/pantry" || path === "/me/chats" || path === "/me/recipes" || path === "/foods" ? []
      : path === "/me" ? { id: GUEST, email: null, anonymous: true, avatar_url: null, ...account({ chats: 50 }) }
      : { ok: true }
    await route.fulfill({ json: data })
  })
}

// pantrila.com links straight to pages such as the assistant or a post import.
test("someone who opens a page signed out lands on it after signing in", async ({ page }) => {
  await mockBackends(page)
  await page.goto("/recipes/mine/new?method=post")
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  // The page reads ?method= once and drops it from the address.
  await expect(page).toHaveURL("http://127.0.0.1:3100/recipes/mine/new")
})

test("signing out and in again goes to Home", async ({ page }) => {
  await mockBackends(page)
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page).toHaveURL("http://127.0.0.1:3100/")
  await page.goto("/assistant")
  await page.getByRole("button", { name: "Account menu" }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page).toHaveURL("http://127.0.0.1:3100/")
})
