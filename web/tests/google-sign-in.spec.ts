import { expect, test, type Page } from "@playwright/test"

import { session } from "./helpers"

const GUEST = "00000000-0000-4000-8000-000000000003"
const GOOGLE = "http://127.0.0.1:54321/fake-google"
const profile = {
  allergies: [], diets: [], exclude_foods: [], max_minutes: null, days: 7,
  meals: ["breakfast", "lunch", "dinner"],
  targets: { kcal: null, min_protein_g: null, max_carbs_g: null },
  pantry: [], cuisines: [], notes: "",
}

async function mockBackends(page: Page, seen: string[]) {
  await page.addInitScript((id) => localStorage.setItem(`pantrila-tour-done:${id}`, "1"), GUEST)
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const url = route.request().url()
    seen.push(url)
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
      : path === "/me/pantry" || path === "/me/chats" || path === "/foods" ? []
      : path === "/me" ? { id: GUEST, email: null, anonymous: true, avatar_url: null, limits: { chats_left: 50 } }
      : { ok: true }
    await route.fulfill({ json: data })
  })
}

test("Continue with Google starts a PKCE sign-in that returns to the callback", async ({ page }) => {
  const seen: string[] = []
  await mockBackends(page, seen)
  await page.goto("/login")
  await page.getByRole("button", { name: "Continue with Google" }).click()
  await expect(page.getByRole("heading", { name: "Google" })).toBeVisible()
  const authorize = new URL(seen.find((u) => u.includes("/auth/v1/authorize"))!)
  expect(authorize.searchParams.get("provider")).toBe("google")
  expect(authorize.searchParams.get("redirect_to")).toBe("http://127.0.0.1:3100/auth/callback")
  expect(authorize.searchParams.get("code_challenge")).toBeTruthy()
})

test("a guest adds Google from the account menu and keeps a failed link visible", async ({ page }) => {
  const seen: string[] = []
  await mockBackends(page, seen)
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page).toHaveURL("http://127.0.0.1:3100/")
  await page.getByRole("button", { name: "Account menu" }).click()
  await page.getByRole("menuitem", { name: "Keep my data with Google" }).click()
  await expect(page).toHaveURL(GOOGLE)
  const link = new URL(seen.find((u) => u.includes("/user/identities/authorize"))!)
  expect(link.searchParams.get("provider")).toBe("google")
  expect(link.searchParams.get("redirect_to")).toBe("http://127.0.0.1:3100/auth/callback")

  // Google already belongs to another account: the guest stays signed in and sees why.
  await page.goto("/auth/callback?error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user")
  await expect(page.getByText("That Google account already has its own Pantrila account")).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page).toHaveURL(/\/auth\/callback/)
  await page.getByRole("link", { name: "Back to Pantrila" }).click()
  await expect(page.getByText("You are a guest")).toBeVisible()
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible()
})
