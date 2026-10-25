# Sign in with Apple setup (iPhone app)

Apple requires Sign in with Apple in an app that offers Google sign-in (App Review guideline
4.8). Pantrila offers it on iPhones only: the app uses Apple's own sheet
(`expo-apple-authentication`) and hands Supabase the identity token with a nonce
(`signInWithIdToken({ provider: "apple", token, nonce })`, or `linkIdentity` for a guest); see
`mobile/src/lib/auth.ts`. Android does not show the button (it would need Apple's web flow). The web
app does not offer Apple yet.

These steps need an active Apple Developer Program membership (team).

## 1. Apple Developer

1. **Certificates, Identifiers & Profiles → Identifiers**: the App ID `com.pantrila.app` must have
   **Sign in with Apple** checked (as a primary App ID). EAS turns the capability on when it
   builds, because `app.config.ts` sets `ios.usesAppleSignIn: true`; check it is ticked after the
   first iOS build.
2. Nothing else is needed for the app alone: a native sign-in needs no Services ID, key or
   secret. (Those are only for Sign in with Apple on the web.)

## 2. Supabase dashboard (project `pantrila`)

1. **Authentication → Sign In / Providers → Apple**: turn it on. In **Client IDs**, enter
   `com.pantrila.app` (the bundle ID: native tokens are issued for it). Leave the secret key empty
   (web only). Save.
2. **Allow manual linking** is already on (see `docs/google-sign-in.md`), so a guest can add Apple
   and keep their user id.

## 3. Check it

On an iPhone with the development build (`npx eas-cli build --profile development --platform ios`):

1. **Continue with Apple** on the welcome screen: Face ID, then you are signed in. The first time,
   Apple shares your name; the app saves it as your profile name (Apple only sends it once).
   With "Hide My Email", the email is an `@privaterelay.appleid.com` address.
2. **Try it as a guest**, then **Keep your data → Continue with Apple**: same user id and data.
3. An Apple ID that already has a Pantrila account shows the "already has its own Pantrila account"
   message; the guest stays signed in.

Account deletion (Profile, Delete account) also deletes the Supabase user. Apple asks apps that
offer Sign in with Apple to revoke the token on deletion; Supabase does not do that yet, so the
person can also remove Pantrila under Settings → Apple ID → Sign in with Apple. Revisit if App
Review asks.
