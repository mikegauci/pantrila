import { NextResponse, type NextRequest } from "next/server"

// The app moved to app.pantrila.com; its old Vercel addresses send people there, keeping the page.
const OLD_HOSTS = new Set(["pantrila.vercel.app", "pantrio-azure.vercel.app"])
const APP_ORIGIN = "https://app.pantrila.com"

export function proxy(request: NextRequest) {
  if (!OLD_HOSTS.has(request.headers.get("host") ?? "")) return NextResponse.next()
  const { pathname, search } = request.nextUrl
  return NextResponse.redirect(new URL(pathname + search, APP_ORIGIN), 308)
}

// Pages only: built assets, images and Sentry reports (/monitoring) never need the host check.
export const config = {
  matcher: ["/((?!_next/static|_next/image|monitoring|favicon.ico|icon.svg|apple-icon.png).*)"],
}
