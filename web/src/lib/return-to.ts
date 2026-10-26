// The page someone opened before signing in (a link from pantrila.com such as /assistant or
// /recipes/mine/new?method=post), so sign-in lands there instead of Home. Kept for this tab only.
const KEY = "pantrila-return-to"

/** Only this app's own pages, never another site or the sign-in pages themselves. */
function safe(path: string | null): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null
  if (path === "/" || path.startsWith("/login") || path.startsWith("/auth")) return null
  return path
}

export function rememberReturn(path: string) {
  const kept = safe(path)
  try {
    if (kept) sessionStorage.setItem(KEY, kept)
  } catch {}
}

/** The remembered page (forgotten once read), else Home. */
export function takeReturn(): string {
  try {
    const path = safe(sessionStorage.getItem(KEY))
    sessionStorage.removeItem(KEY)
    return path ?? "/"
  } catch {
    return "/"
  }
}
