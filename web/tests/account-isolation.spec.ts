import { expect, test } from "@playwright/test"

const A = "00000000-0000-4000-8000-000000000001"
const B = "00000000-0000-4000-8000-000000000002"
const profile = {
  allergies: [], diets: [], exclude_foods: [], max_minutes: null, days: 7,
  meals: ["breakfast", "lunch", "dinner"],
  targets: { kcal: null, min_protein_g: null, max_carbs_g: null },
  pantry: [], cuisines: [], notes: "",
}

function session(id: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const encode = (data: unknown) => Buffer.from(JSON.stringify(data)).toString("base64url")
  return {
    access_token: `${encode({ alg: "HS256" })}.${encode({ sub: id, exp })}.signature`,
    refresh_token: `refresh-${id}`, token_type: "bearer", expires_in: 3600, expires_at: exp,
    user: { id, aud: "authenticated", role: "authenticated", is_anonymous: true,
      app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  }
}

test("switching accounts drops cached data and remembered chat state", async ({ page }) => {
  let signups = 0
  let releaseB: (() => void) | undefined
  const waiting = new Promise<void>((resolve) => { releaseB = resolve })
  await page.addInitScript(({ a, b }) => {
    localStorage.setItem(`pantrio-tour-done:${a}`, "1")
    localStorage.setItem(`pantrio-tour-done:${b}`, "1")
  }, { a: A, b: B })
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    if (route.request().url().includes("/signup")) {
      await route.fulfill({ json: session(signups++ === 0 ? A : B) })
    } else {
      await route.fulfill({ status: 200, json: {} })
    }
  })
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const token = route.request().headers().authorization?.split(" ")[1]
    const id = token ? JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub : ""
    if (path === "/me/pantry") {
      if (id === B) await waiting
      return route.fulfill({ json: id === A
        ? [{ key: "egg", name: "Alice secret eggs", aisle: "dairy", quantity: null, unit: null, grams: null }]
        : [] })
    }
    if (path === "/plans/latest") return route.fulfill({ status: 404, json: { detail: "No plan" } })
    const data = path === "/me/profile" ? profile
      : path === "/me/chats" ? []
      : path === "/me" ? { id, email: null, anonymous: true, avatar_url: null, limits: { chats_left: 50 } }
      : { ok: true }
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page.getByText("Alice secret eggs")).toBeVisible()
  await page.evaluate((id) => localStorage.setItem(`pantrio-chat-thread:${id}`, "42"), A)
  await page.getByRole("button", { name: "Account menu" }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page).toHaveURL("http://127.0.0.1:3100/")
  await expect(page.getByText("Alice secret eggs")).toHaveCount(0)
  releaseB!()
  await page.getByRole("link", { name: "Assistant", exact: true }).first().click()
  await expect(page.getByText("Ask about cooking, recipes or your pantry")).toBeVisible()
})
