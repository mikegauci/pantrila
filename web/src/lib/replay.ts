// Session replay with PostHog (EU), only for people who said yes. Nothing loads, records or
// is stored in the browser for it until then; "No" or turning it off in Profile stops it.
// Replays mask everything typed (inputs and text areas) but show the text on screen. They
// join the person the API already sends funnel events for (the Supabase user id), so
// deleting the account deletes the recordings too (pantrila.analytics).
import type { PostHog } from "posthog-js"

export type ReplayChoice = "on" | "off"

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
export const replayAvailable = () => Boolean(KEY)

const choiceKey = (userId: string) => `pantrila-replay:${userId}`

export function replayChoice(userId: string): ReplayChoice | null {
  try {
    const v = localStorage.getItem(choiceKey(userId))
    return v === "on" || v === "off" ? v : null
  } catch {
    return "off"  // storage blocked: never ask, never record
  }
}

let client: PostHog | null = null
let recordingFor: string | null = null

/** Start recording this person's visits (they said yes). Safe to call again. */
export async function startReplay(userId: string): Promise<void> {
  if (!KEY || recordingFor === userId) return
  const { default: posthog } = await import("posthog-js")
  if (!client) {
    posthog.init(KEY, {
      api_host: "/ingest",  // through our domain (next.config.ts), so content blockers let it through
      ui_host: "https://eu.posthog.com",
      defaults: "2026-08-30",
      person_profiles: "identified_only",
      persistence: "localStorage",
      opt_out_capturing_by_default: true,  // so reset() never re-enables capture
      disable_session_recording: true,  // recording starts only through startSessionRecording
      // Replay only: page views and clicks already come from the API's funnel events.
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_exceptions: false,  // Sentry has errors
      capture_performance: false,
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
      advanced_disable_feature_flags: true,  // no flags; remote config (which replay needs) stays on
      enable_recording_console_log: false,
      session_recording: { maskAllInputs: true },
    })
    client = posthog
  }
  if (recordingFor && recordingFor !== userId) client.reset()
  client.opt_in_capturing()
  client.register({ $geoip_disable: true })  // no location from the IP address (the project drops IPs)
  client.identify(userId)
  client.startSessionRecording()
  recordingFor = userId
}

/** Stop recording and forget this browser's PostHog id (said no, turned off, or signed out). */
export function stopReplay(): void {
  if (!client) return
  client.stopSessionRecording()
  client.reset()  // back to the default: opted out
  client.opt_out_capturing()
  recordingFor = null
}

export function setReplayChoice(userId: string, choice: ReplayChoice): void {
  try {
    localStorage.setItem(choiceKey(userId), choice)
  } catch {
    // storage blocked: the choice lasts for this page only
  }
  if (choice === "on") void startReplay(userId)
  else stopReplay()
}
