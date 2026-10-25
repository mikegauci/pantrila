# Google sign-in setup

Pantrila signs people in through Supabase Auth. Google is a Supabase provider, so the API needs
no change: it already accepts any Supabase access token. These steps are done once, in two
dashboards. No new environment variables on Vercel or Render.

Values used below:

- Supabase callback: `https://tlnigvzkselebbtetibt.supabase.co/auth/v1/callback`
- Web app: `https://app.pantrila.com` (the old `https://pantrila.vercel.app` still works; and
  `http://localhost:3000` for local work)

## 1. Google Cloud Console

1. Open <https://console.cloud.google.com/>, create or pick a project (for example "Pantrila").
2. **Google Auth Platform → Branding**: app name `Pantrila`, a support email, your developer
   contact email, the logo (`site/public/email/logo.png`), home page `https://pantrila.com`,
   privacy `https://pantrila.com/privacy`, terms `https://pantrila.com/terms`. Under **Authorised
   domains** add `pantrila.com` (verified in Google Search Console with a TXT record in Vercel DNS)
   and `tlnigvzkselebbtetibt.supabase.co`. Then **Verify branding**.
3. **Audience**: user type **External**, then **Publish app** (status "In production").
   While it is "Testing", only listed test users can sign in. Google refuses to publish while any
   client lists a non-HTTPS address, so local work keeps no `http://` origin (it is not needed:
   sign-in goes through the Supabase callback).
4. **Data access**: keep only the basic scopes `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile`. These are non-sensitive, so Google does not review the app.
   Until the branding is verified, Google's consent screen names the Supabase domain instead
   of "Pantrila"; that does not block sign-in.
5. **Clients → Create client**, type **Web application**, name `Pantrila web`:
   - Authorised JavaScript origins: `https://app.pantrila.com` (HTTPS only)
   - Authorised redirect URIs: `https://tlnigvzkselebbtetibt.supabase.co/auth/v1/callback`
   Save, then copy the **Client ID** and **Client secret**.

## 2. Supabase dashboard (project `pantrila`)

1. **Authentication → Sign In / Providers → Google**: turn it on, paste the Client ID and
   Client secret, save. For the phone app, see section 4: it adds client ids here and turns
   "Skip nonce checks" on.
2. **Authentication → Sign In / Providers**, under the user sign-up settings: turn on
   **Allow manual linking**, then tap **Save changes** at the bottom of that User Signups
   section (it has its own save button; until it is saved, guests see "Manual linking is
   disabled"). This lets a guest add Google and keep the same user id (and so
   their profile, pantry, plans, cookbook and chats). Anonymous sign-ins stay on.
3. **Authentication → URL Configuration**: check that the redirect URLs still include
   `https://app.pantrila.com/auth/callback`, `https://pantrila.vercel.app/auth/callback` and
   `http://localhost:3000/auth/callback`, and that the Site URL is `https://app.pantrila.com`.
   Add the old `https://pantrio-azure.vercel.app/auth/callback` too if people still use that
   address. For the phone app's email links, also add `pantrila://auth/callback`.
   Vercel preview URLs are not listed, so Google sign-in on a preview deploy falls back to the
   Site URL.

## 3. Check it

On the live app:

1. Sign out, then **Continue with Google** on the login page: you return signed in, and Home
   greets you by your first name.
2. **Try it as a guest**, add a pantry item, then **Account menu → Keep my data with Google**
   (or Profile → Keep your data). After Google you are back with the same pantry item, and
   Profile says "Signed in with Google".
3. As a guest, pick a Google account that has already signed in: the callback page explains
   that it has its own account and the guest stays signed in.

Signing in with Google using the owner's email joins the existing magic-link account,
because Supabase links identities that share a verified email.

## 4. The phone app (Expo, `mobile/`)

The app does not go through the browser: Google's own sign-in sheet
(`@react-native-google-signin/google-signin`) returns an id token, and the app hands it to
Supabase (`signInWithIdToken`, or `linkIdentity` for a guest), see `mobile/src/lib/auth.ts`.
Google needs to know the app, and Supabase needs to accept tokens made for it.

1. **Google Cloud → Clients → Create client**, type **iOS**, name `Pantrila iOS`, bundle ID
   `com.pantrila.app`. Copy its **Client ID** (`...apps.googleusercontent.com`).
2. **Create client**, type **Android**, name `Pantrila Android`, package `com.pantrila.app`, and
   the **SHA-1** of the signing key. EAS made and keeps the key: `npx eas-cli credentials
   --platform android` in `mobile/` shows its SHA-1 fingerprint. Add a second Android client for
   the Play Store's app signing key once the app is on Google Play (Play Console → App integrity
   shows it). Android clients have no id to copy: Google matches the package and fingerprint.
3. **EAS environment variables** (all environments; they are public, "Plain text" is fine), in
   `mobile/`:
   `npx eas-cli env:create --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value <the Web client's id>`
   and the same for `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` with the iOS client's id. The web client
   id makes Google address the id token to the web client on Android. For `npx expo start`, put the
   same two lines in `mobile/.env.local`. The iOS id also sets the URL scheme Google's sheet
   returns to (`app.config.ts`), so **make a new development build** after setting it.
4. **Supabase → Google provider**: in **Client IDs** (authorised client ids), list the Web client
   id and the iOS client id, comma separated. Turn **Skip nonce checks** on: Google's iOS SDK puts
   a nonce in the token that the app cannot see, so Supabase could not check it. This only affects
   id-token sign-ins; the web app's redirect sign-in is unchanged.
5. Check on each phone: Continue with Google signs in; as a guest, Profile → Keep your data with
   Google keeps the same data; a Google account that already has Pantrila shows the "already has
   its own Pantrila account" message and the guest stays signed in.
