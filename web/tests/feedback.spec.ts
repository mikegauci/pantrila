import { expect, test } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000010"

test("Send feedback in the account menu sends the message to Sentry", async ({ page }) => {
  const envelopes: string[] = []
  await page.addInitScript((user) => {
    localStorage.setItem(`pantrila-tour-done:${user}`, "1")
    localStorage.setItem(`pantrila-replay:${user}`, "off")
  }, id)
  await page.route("**/monitoring**", async (route) => {
    envelopes.push(route.request().postData() ?? "")
    await route.fulfill({ status: 200, json: {} })
  })
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/plans/latest") return route.fulfill({ status: 404, json: {} })
    const data = path === "/me" ? { id, email: null, anonymous: true, avatar_url: null, limits: {} }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await page.getByRole("button", { name: "Account menu" }).click()
  await page.getByRole("menuitem", { name: "Send feedback" }).click()
  const send = page.getByRole("button", { name: "Send feedback" })
  await expect(send).toBeDisabled()
  await page.getByLabel("Your feedback").fill("The plan page is lovely")
  await send.click()
  await expect(page.getByText("Thanks! Your feedback was sent.")).toBeVisible()
  const feedback = envelopes.find((e) => e.includes('"type":"feedback"'))
  expect(feedback).toContain("The plan page is lovely")
  expect(feedback).toContain(id)
})
