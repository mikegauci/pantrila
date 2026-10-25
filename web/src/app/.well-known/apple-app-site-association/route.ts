import { appleAssociation } from "@/lib/app-links"

// iOS fetches this (through Apple's CDN) to open app.pantrila.com recipe and plan links in the app.
export function GET() {
  const body = appleAssociation(process.env.APPLE_TEAM_ID)
  return body ? Response.json(body) : new Response("Not found", { status: 404 })
}
