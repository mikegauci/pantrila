import { devices, expect, test } from "@playwright/test"

import { account, session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000041"

test.use({ userAgent: devices["Pixel 7"].userAgent, viewport: { width: 412, height: 915 } })

test("an Android phone is offered the Play app once, and iPhones get Safari's banner", async ({ page }) => {
  await page.addInitScript((user) => {
    localStorage.setItem(`pantrila-tour-done:${user}`, "1")
    localStorage.setItem(`pantrila-replay:${user}`, "off")
  }, id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const data = path === "/me" ? { id, email: null, anonymous: true, avatar_url: null, ...account({}, "free") }
      : path === "/me/profile" ? { allergies: [], diets: [], exclude_foods: [], pantry: [], days: 7,
        meals: ["dinner"], targets: { kcal: 2000, min_protein_g: null, max_carbs_g: null },
        max_minutes: null, cuisines: [], notes: "" }
      : path === "/meta" ? { allergens: [], diets: [], cuisines: [], meal_types: ["dinner"], units: ["g"] }
      : path === "/plans/latest" ? null
      : path === "/health" ? { ok: true } : []
    if (data === null) return route.fulfill({ status: 404, json: {} })
    await route.fulfill({ json: data })
  })

  await page.goto("/login")
  // Safari reads this tag and shows its own "Get" / "Open" banner; other browsers ignore it.
  await expect(page.locator('meta[name="apple-itunes-app"]')).toHaveAttribute("content", "app-id=6740000000")
  await page.getByRole("button", { name: "Try it as a guest" }).click()

  const banner = page.getByRole("region", { name: "Pantrila for Android" })
  await expect(banner).toBeVisible()
  await expect(banner.getByRole("link", { name: "Get it" }))
    .toHaveAttribute("href", "https://play.google.com/store/apps/details?id=com.pantrila.app")
  await banner.getByRole("button", { name: "Close" }).click()
  await expect(banner).toBeHidden()
  await page.reload()
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await expect(banner).toBeHidden()
})
