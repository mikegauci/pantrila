import { describe, expect, it, vi } from "vitest"

import { ApiError, createApi } from "../src/api"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

describe("createApi", () => {
  it("sends the token and parses JSON", async () => {
    const fetch = vi.fn(async (..._: Parameters<typeof globalThis.fetch>) => json({ ok: 1 }))
    const { send } = createApi({ baseUrl: "https://api.test/", getToken: async () => "t", fetch })
    expect(await send("/me/pantry", "POST", { food: "eggs" })).toEqual({ ok: 1 })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe("https://api.test/me/pantry")
    expect(init?.headers).toEqual({ Authorization: "Bearer t", "Content-Type": "application/json" })
    expect(init?.body).toBe('{"food":"eggs"}')
  })

  it("checks the server without a sign-in", async () => {
    const up = createApi({ baseUrl: "https://api.test", getToken: async () => null, fetch: async () => json({ ok: true }) })
    expect(await up.health()).toBe(true)
    const down = createApi({ baseUrl: "https://api.test", getToken: async () => null, fetch: async () => { throw new TypeError("offline") } })
    expect(await down.health()).toBe(false)
  })

  it("needs a signed-in user", async () => {
    const { api } = createApi({ baseUrl: "https://api.test", getToken: async () => null, fetch: vi.fn() })
    await expect(api("/me")).rejects.toMatchObject({ status: 401, message: "Sign in first." })
  })

  it("turns error bodies into ApiError", async () => {
    const fetch = async () => json({ detail: { message: "Not safe", problems: ["contains peanuts"] }, suggestions: ["tofu"] }, 422)
    const { api } = createApi({ baseUrl: "https://api.test", getToken: async () => "t", fetch })
    const error = await api("/x").catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, message: "Not safe", problems: ["contains peanuts"], suggestions: ["tofu"] })
  })

  it("reads a Free cap's 402", async () => {
    const fetch = async () => json({ detail: "Pantrila Free includes 1 meal plan a week.", code: "pro_required", feature: "plan", resets_at: "2026-10-26T00:00:00+00:00" }, 402)
    const { api } = createApi({ baseUrl: "https://api.test", getToken: async () => "t", fetch })
    const error = await api("/plans").catch((e) => e)
    expect(error).toMatchObject({ status: 402, pro: { feature: "plan", resets_at: "2026-10-26T00:00:00+00:00" } })
    const other = await createApi({ baseUrl: "https://api.test", getToken: async () => "t", fetch: async () => json({ detail: "x" }, 429) }).api("/x").catch((e: ApiError) => e)
    expect((other as ApiError).pro).toBeNull()
  })

  it("explains a dropped connection", async () => {
    const fetch = async () => { throw new TypeError("Load failed") }
    const { api } = createApi({ baseUrl: "https://api.test", getToken: async () => "t", fetch })
    await expect(api("/x")).rejects.toMatchObject({ status: 0, message: expect.stringContaining("Could not reach the Pantrila server") })
  })

  it("tells the app about a slow request only while the server may be asleep", async () => {
    vi.useFakeTimers()
    const done = vi.fn()
    const onSlow = vi.fn(() => done)
    let answer = (_: Response) => {}
    const fetch = () => new Promise<Response>((resolve) => { answer = resolve })
    const { api } = createApi({ baseUrl: "https://api.test", getToken: async () => "t", fetch, onSlow })
    const first = api("/x")
    await vi.advanceTimersByTimeAsync(3000)
    expect(onSlow).toHaveBeenCalledTimes(1)
    answer(json({}))
    await first
    expect(done).toHaveBeenCalledTimes(1)
    // The server just answered, so a slow request now is a long job, not a wake-up.
    const second = api("/y")
    await vi.advanceTimersByTimeAsync(3000)
    expect(onSlow).toHaveBeenCalledTimes(1)
    answer(json({}))
    await second
    vi.useRealTimers()
  })

  it("streams a chat reply", async () => {
    const body = 'event: step\ndata: {"label":"Searching"}\n\nevent: delta\ndata: {"text":"Hi"}\n\n' +
      'event: reply\ndata: {"text":"Hi","thread_id":3}\n\n'
    const fetch = async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } })
    const { streamChat } = createApi({ baseUrl: "https://api.test", getToken: async () => "t", fetch })
    const events: unknown[] = []
    const reply = await streamChat({ message: "hi", thread_id: null }, (e) => events.push(e))
    expect(events).toEqual([{ kind: "step", label: "Searching" }, { kind: "delta", text: "Hi" }])
    expect(reply).toMatchObject({ text: "Hi", thread_id: 3 })
  })

  it("fails a chat stream that ends with an error or no reply", async () => {
    const stream = (body: string) => createApi({
      baseUrl: "https://api.test", getToken: async () => "t", fetch: async () => new Response(body),
    }).streamChat({ message: "hi", thread_id: null }, () => {})
    await expect(stream('event: error\ndata: {"status":429,"message":"Daily limit"}\n\n'))
      .rejects.toMatchObject({ status: 429, message: "Daily limit" })
    await expect(stream('event: step\ndata: {"label":"x"}\n\n')).rejects.toMatchObject({ status: 502 })
  })

  it("fails a plan stream cut off before its result", async () => {
    const { streamPlan } = createApi({
      baseUrl: "https://api.test", getToken: async () => "t", fetch: async () => new Response('event: step\ndata: {"label":"x"}\n\n'),
    })
    await expect(streamPlan(() => {})).rejects.toMatchObject({ status: 502 })
  })
})
