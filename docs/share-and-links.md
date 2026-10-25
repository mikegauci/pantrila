# Share to Pantrila and links into the app

The phone app appears in the share sheet ("Save to Pantrila" on iOS, "Pantrila" on Android) and opens
`https://app.pantrila.com/recipes/...` and `/plan` links. Code: `mobile/app.config.ts` (the
`expo-share-intent` plugin, `ios.associatedDomains`, `android.intentFilters`), `mobile/src/lib/share.ts`,
`mobile/src/components/share-handler.tsx`, `mobile/src/app/+native-intent.tsx`, and on the web
`web/src/lib/app-links.ts` with the two routes under `web/src/app/.well-known/`.

## Owner steps

1. **Apple Team ID.** Once Apple activates the Developer team: developer.apple.com → Membership details →
   Team ID (10 characters). Set `APPLE_TEAM_ID` on the Vercel project `pantrila` (Production).
2. **Android signing fingerprints.** In `mobile/`: `npx eas-cli credentials -p android` → the build
   profile → "Keystore" shows the SHA-256 fingerprint. After the first Play upload, also copy Play Console →
   the app → Test and release → App integrity → App signing key certificate → SHA-256. Set both,
   comma-separated, as `ANDROID_CERT_SHA256` on Vercel.
3. **Redeploy the web app** (the two files are built at deploy time), then check
   `https://app.pantrila.com/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
   answer JSON with no redirect.
4. **iOS build.** The share extension is a second target, `com.pantrila.app.share-extension`, sharing the
   App Group `group.com.pantrila.app` with the app. The first `eas build --platform ios` asks to make its
   provisioning profile; say yes (EAS registers the identifier, the App Group and Associated Domains).
5. **Try it** on both phones: share a reel from Instagram, TikTok and Facebook, a recipe page from Safari
   and Chrome, and a photo from the library; open an app.pantrila.com recipe link from Notes or Messages.
