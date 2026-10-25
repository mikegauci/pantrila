import { readEvents } from "./sse"
import type { ChatReply, Feature, RecipeCard } from "./types"

/** The Pantrila API for one app. Each app supplies its own address, sign-in token, fetch and
 * slow-request notice; everything else (errors, streaming) is the same on web and phone. */

/** A Free cap was reached (HTTP 402): the feature and when its window starts again. */
export interface ProRequired {
  feature: Feature
  resets_at: string
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public suggestions: string[] = [],
    public problems: string[] = [],
    public pro: ProRequired | null = null,
  ) {
    super(message)
  }
}

export interface ApiOptions {
  baseUrl: string
  /** The signed-in user's access token, or null when nobody is signed in. */
  getToken: () => Promise<string | null>
  /** Called when a request is still waiting after `slowMs` and the server has not answered for a
   * while (a cold start, not a long job); the function it returns runs when that request ends. */
  onSlow?: () => () => void
  /** A fetch whose response body can be read as it arrives (`expo/fetch` on phones). */
  fetch?: typeof fetch
  /** Sent with every request, e.g. `X-Pantrila-Client: ios` so analytics can tell the apps apart. */
  headers?: Record<string, string>
  slowMs?: number
}

export type ChatEvent =
  | { kind: "step"; label: string }
  | { kind: "recipes"; cards: RecipeCard[] }
  | { kind: "delta"; text: string }

export async function errorFrom(res: Response): Promise<ApiError> {
  let detail = res.statusText || `Request failed (HTTP ${res.status})`
  let suggestions: string[] = []
  let problems: string[] = []
  let pro: ProRequired | null = null
  try {
    const body = await res.json()
    if (typeof body.detail === "string") detail = body.detail
    else if (Array.isArray(body.detail)) detail = body.detail.map((d: { msg: string }) => d.msg).join("; ")
    else if (body.detail?.problems) {
      detail = body.detail.message
      problems = body.detail.problems
    }
    suggestions = body.suggestions ?? []
    if (body.code === "pro_required") pro = { feature: body.feature, resets_at: body.resets_at }
  } catch {}
  return new ApiError(res.status, detail, suggestions, problems, pro)
}

// Any reply means the server is awake; a later slow request is a long job, not a cold start.
const AWAKE_MS = 10 * 60 * 1000

export function createApi({ baseUrl, getToken, onSlow, fetch: doFetch = fetch, headers = {}, slowMs = 3000 }: ApiOptions) {
  const root = baseUrl.replace(/\/$/, "")
  let lastReply = 0

  async function token(): Promise<string> {
    const t = await getToken()
    if (!t) throw new ApiError(401, "Sign in first.")
    return t
  }

  /** fetch that explains a network failure: browsers only say "Load failed" or "Failed to fetch". */
  async function request(path: string, init: RequestInit): Promise<Response> {
    const start = Date.now()
    let done: (() => void) | undefined
    const timer = setTimeout(() => {
      if (onSlow && Date.now() - lastReply >= AWAKE_MS) done = onSlow()
    }, slowMs)
    try {
      const res = await doFetch(`${root}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } })
      lastReply = Date.now()
      return res
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e
      const secs = Math.round((Date.now() - start) / 1000)
      const sent = typeof init.body === "string" ? ` (${(init.body.length / 1e6).toFixed(1)} MB sent)` : ""
      throw new ApiError(
        0,
        `Could not reach the Pantrila server after ${secs}s${sent}: the connection dropped before it replied` +
          ` (${e instanceof Error ? e.message : "network error"}). The server may be waking up or the upload` +
          ` was too slow. Check your connection and try again.`,
      )
    } finally {
      clearTimeout(timer)
      done?.()
    }
  }

  /** Call the Pantrila API with the signed-in user's token. */
  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await request(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${await token()}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    })
    if (!res.ok) throw await errorFrom(res)
    return (res.status === 204 ? undefined : await res.json()) as T
  }

  const send = <T>(path: string, method: string, body?: unknown) =>
    api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

  async function events(res: Response, terminal: string[], onEvent: (event: string, data: unknown) => void) {
    if (!res.ok || !res.body) throw await errorFrom(res)
    return readEvents(res.body, terminal, onEvent)
  }

  /** POST /plans streams server-sent events; call `onEvent` for each one. */
  async function streamPlan(onEvent: (event: string, data: unknown) => void, signal?: AbortSignal): Promise<void> {
    const res = await request("/plans", {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, Accept: "text/event-stream" },
      signal,
    })
    if (!(await events(res, ["plan", "error"], onEvent))) throw new ApiError(
      502,
      "Planning progress disconnected before a result arrived. Check your latest plan before trying again.",
    )
  }

  /** POST /chat/stream: steps, found recipes and the reply's text as it is written, then the saved reply. */
  async function streamChat(
    body: { message: string; thread_id: number | null },
    onEvent: (event: ChatEvent) => void,
  ): Promise<ChatReply> {
    const res = await request("/chat/stream", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await token()}`,
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    let reply: ChatReply | undefined
    let failure: ApiError | undefined
    await events(res, ["reply", "error"], (event, data) => {
      const d = data as Record<string, unknown>
      if (event === "step") onEvent({ kind: "step", label: String(d.label) })
      else if (event === "recipes") onEvent({ kind: "recipes", cards: data as RecipeCard[] })
      else if (event === "delta") onEvent({ kind: "delta", text: String(d.text) })
      else if (event === "reply") reply = data as ChatReply
      else if (event === "error") failure = new ApiError(Number(d.status) || 502, String(d.message))
    })
    if (failure) throw failure
    if (!reply) throw new ApiError(502, "The reply was cut off. Reload the chat to see if it was saved.")
    return reply
  }

  /** Wake the API as early as possible; failures surface later on real requests. */
  const ping = () => void request("/health", {}).catch(() => {})

  /** True when the API answers /health (no sign-in needed). */
  const health = () => request("/health", {}).then((res) => res.ok, () => false)

  return { api, send, streamPlan, streamChat, ping, health }
}

export type Api = ReturnType<typeof createApi>
