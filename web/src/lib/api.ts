import { toast } from "sonner"

import { createApi } from "@pantrila/core/api"

import { supabase } from "@/lib/supabase"

export { ApiError, type ChatEvent } from "@pantrila/core/api"

// The API sleeps when idle (Render free plan), so the first request can take up to a minute.
// Any request still waiting after 3 s shows one shared toast until every slow one answers.
const WAKE_TOAST = "server-wake"
let slow = 0

function markSlow() {
  if (slow++ === 0)
    toast.loading("Waking up the Pantrila server…", {
      id: WAKE_TOAST,
      duration: Infinity,
      description: "It sleeps when idle. The first load can take a minute.",
    })
  return () => {
    if (--slow === 0) toast.success("Server ready", { id: WAKE_TOAST, duration: 2000, description: undefined })
  }
}

const client = createApi({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  getToken: async () => (await supabase().auth.getSession()).data.session?.access_token ?? null,
  onSlow: markSlow,
})

/** Call the Pantrila API with the signed-in user's token. */
export const { api, send, streamPlan, streamChat } = client

/** Wake the API as early as possible; failures surface later on real requests. */
export const pingServer = client.ping
