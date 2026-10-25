/**
 * The files that let the phone app open app.pantrila.com links (iOS universal links, Android app
 * links). Only recipe pages and the plan open in the app; sign-in callbacks and everything else
 * stay in the browser. Both files need values from the owner's accounts, set on Vercel:
 * `APPLE_TEAM_ID` (Apple Developer team) and `ANDROID_CERT_SHA256` (the app signing key's SHA-256
 * fingerprints, comma-separated: EAS's upload key and Google Play's app signing key). Unset, the
 * file is a 404, so no wrong association is published.
 */
export const APP_ID = "com.pantrila.app"
export const APP_PATHS = ["/recipes/*", "/plan"]

export function appleAssociation(teamId: string | undefined) {
  if (!teamId?.trim()) return null
  return {
    applinks: {
      details: [{
        appIDs: [`${teamId.trim()}.${APP_ID}`],
        components: APP_PATHS.map((path) => ({ "/": path })),
      }],
    },
  }
}

export function androidAssociation(fingerprints: string | undefined) {
  const sha256 = (fingerprints ?? "").split(",").map((f) => f.trim().toUpperCase()).filter(Boolean)
  if (!sha256.length) return null
  return [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: APP_ID, sha256_cert_fingerprints: sha256 },
  }]
}
