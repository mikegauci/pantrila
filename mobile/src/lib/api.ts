import { createApi } from "@pantrila/core/api"
import { fetch as expoFetch } from "expo/fetch"

export { ApiError } from "@pantrila/core/api"

/** The Pantrila API from the phone. `expo/fetch` reads streamed replies (plans, chat) as they
 * arrive, which React Native's own fetch cannot. Sign-in comes in PR 4; until then requests
 * that need a user fail with "Sign in first." */
export const client = createApi({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? "https://api.pantrila.com",
  getToken: async () => null,
  fetch: expoFetch as unknown as typeof fetch,
})

export const { api, send, streamPlan, streamChat, health } = client
