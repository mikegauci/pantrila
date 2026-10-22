// Addresses the landing site links to, kept in one place.
export const SITE_URL = "https://pantrila.com"
export const APP_URL = "https://app.pantrila.com"
export const GITHUB_URL = "https://github.com/mikegauci/pantrila"
export const CONTACT_EMAIL = "hello@pantrila.com"

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ")
}
