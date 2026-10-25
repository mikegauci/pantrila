import { createApi } from "@pantrila/core/api"
import { fetch as expoFetch } from "expo/fetch"
import { Platform } from "react-native"

import { accessToken } from "@/lib/supabase"
import { slowRequest } from "@/lib/waking"

export { ApiError } from "@pantrila/core/api"

/** The Pantrila API from the phone, with the Supabase session's token. `expo/fetch` reads streamed
 * replies (plans, chat) as they arrive, which React Native's own fetch cannot. `X-Pantrila-Client`
 * lets the API's analytics split the funnel by platform (`ios` or `android`). */
export const client = createApi({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? "https://api.pantrila.com",
  getToken: accessToken,
  onSlow: slowRequest,
  fetch: expoFetch as unknown as typeof fetch,
  headers: { "X-Pantrila-Client": Platform.OS === "ios" ? "ios" : "android" },
})

export const { api, send, streamPlan, streamChat, health } = client
