import { expect, test, type Page } from "@playwright/test"

import { account, session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000007"
const picture = "https://pictures.example.test/me.png"
// A 1x1 PNG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
)

async function signIn(page: Page, avatarUrl: string | null) {
  await page.addInitScript((user) => {
    localStorage.setItem(`pantrila-tour-done:${user}`, "1")
    localStorage.setItem(`pantrila-replay:${user}`, "off")
  }, id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/plans/latest") return route.fulfill({ status: 404, json: {} })
    const data = path === "/me"
      ? { id, email: null, anonymous: true, avatar_url: avatarUrl, ...account({ chats: 50 }) }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
}

test("a profile picture does not flash the emoji avatar while it downloads", async ({ page }) => {
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route(picture, async (route) => {
    await held
    await route.fulfill({ body: png, contentType: "image/png" })
  })
  await signIn(page, picture)
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()

  const menu = page.getByRole("button", { name: "Account menu" })
  await expect(menu).toBeVisible()
  await expect(menu).toHaveText("")
  release()
  await expect(menu.locator("img")).toBeVisible()
})

test("a picture that fails to load falls back to the emoji avatar", async ({ page }) => {
  await page.route(picture, (route) => route.fulfill({ status: 404, body: "" }))
  await signIn(page, picture)
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()

  await expect(page.getByRole("button", { name: "Account menu" })).not.toHaveText("")
})
