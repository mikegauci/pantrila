import { supabase } from "@/lib/supabase"

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "")

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public suggestions: string[] = [],
    public problems: string[] = [],
  ) {
    super(message)
  }
}

async function token(): Promise<string> {
  const { data } = await supabase().auth.getSession()
  const t = data.session?.access_token
  if (!t) throw new ApiError(401, "Sign in first.")
  return t
}

async function errorFrom(res: Response): Promise<ApiError> {
  let detail = res.statusText || "Request failed"
  let suggestions: string[] = []
  let problems: string[] = []
  try {
    const body = await res.json()
    if (typeof body.detail === "string") detail = body.detail
    else if (Array.isArray(body.detail)) detail = body.detail.map((d: { msg: string }) => d.msg).join("; ")
    else if (body.detail?.problems) {
      detail = body.detail.message
      problems = body.detail.problems
    }
    suggestions = body.suggestions ?? []
  } catch {}
  return new ApiError(res.status, detail, suggestions, problems)
}

/** Call the Pantrio API with the signed-in user's token. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
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

export const send = <T>(path: string, method: string, body?: unknown) =>
  api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

/** POST /plans streams server-sent events; call `onEvent` for each one. */
export async function streamPlan(
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}/plans`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, Accept: "text/event-stream" },
    signal,
  })
  if (!res.ok || !res.body) throw await errorFrom(res)
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let end
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      let event = "message"
      let data = ""
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7)
        else if (line.startsWith("data: ")) data += line.slice(6)
      }
      onEvent(event, data ? JSON.parse(data) : null)
    }
  }
}
