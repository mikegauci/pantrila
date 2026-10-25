import { createApi } from "@pantrila/core/api"
import { fetch as expoFetch } from "expo/fetch"

import { accessToken } from "@/lib/supabase"
import { slowRequest } from "@/lib/waking"

export { ApiError } from "@pantrila/core/api"

/** The Pantrila API from the phone, with the Supabase session's token. `expo/fetch` reads streamed
 * replies (plans, chat) as they arrive, which React Native's own fetch cannot. */
export const client = createApi({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? "https://api.pantrila.com",
  getToken: accessToken,
  onSlow: slowRequest,
  fetch: expoFetch as unknown as typeof fetch,
})

export const { api, send, streamPlan, streamChat, health } = client
