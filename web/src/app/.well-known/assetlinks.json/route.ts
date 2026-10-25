import { androidAssociation } from "@/lib/app-links"

// Android checks this to open app.pantrila.com recipe and plan links in the app (verified app links).
export function GET() {
  const body = androidAssociation(process.env.ANDROID_CERT_SHA256)
  return body ? Response.json(body) : new Response("Not found", { status: 404 })
}
