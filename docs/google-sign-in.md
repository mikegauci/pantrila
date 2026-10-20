# Google sign-in setup

Pantrila signs people in through Supabase Auth. Google is a Supabase provider, so the API needs
no change: it already accepts any Supabase access token. These steps are done once, in two
dashboards. No new environment variables on Vercel or Render.

Values used below:

- Supabase callback: `https://tlnigvzkselebbtetibt.supabase.co/auth/v1/callback`
- Web app: `https://pantrila.vercel.app` (and `http://localhost:3000` for local work)

## 1. Google Cloud Console

1. Open <https://console.cloud.google.com/>, create or pick a project (for example "Pantrila").
2. **Google Auth Platform → Branding**: app name `Pantrila`, a support email, your developer
   contact email. Under **Authorised domains** add `tlnigvzkselebbtetibt.supabase.co` and
   `pantrila.vercel.app`. Home page: `https://pantrila.vercel.app`.
3. **Audience**: user type **External**, then **Publish app** (status "In production").
   While it is "Testing", only listed test users can sign in.
4. **Data access**: keep only the basic scopes `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile`. These are non-sensitive, so Google does not review the app.
   Until the branding is verified, Google's consent screen names the Supabase domain instead
   of "Pantrila"; that does not block sign-in.
5. **Clients → Create client**, type **Web application**, name `Pantrila web`:
   - Authorised JavaScript origins: `https://pantrila.vercel.app`, `http://localhost:3000`
   - Authorised redirect URIs: `https://tlnigvzkselebbtetibt.supabase.co/auth/v1/callback`
   Save, then copy the **Client ID** and **Client secret**.

## 2. Supabase dashboard (project `pantrila`)

1. **Authentication → Sign In / Providers → Google**: turn it on, paste the Client ID and
   Client secret, save. Leave "Skip nonce checks" off.
2. **Authentication → Sign In / Providers**, under the user sign-up settings: turn on
   **Allow manual linking**, then tap **Save changes** at the bottom of that User Signups
   section (it has its own save button; until it is saved, guests see "Manual linking is
   disabled"). This lets a guest add Google and keep the same user id (and so
   their profile, pantry, plans, cookbook and chats). Anonymous sign-ins stay on.
3. **Authentication → URL Configuration**: check that the redirect URLs still include
   `https://pantrila.vercel.app/auth/callback` and `http://localhost:3000/auth/callback`
   and that the Site URL is `https://pantrila.vercel.app/`. Add the old
   `https://pantrio-azure.vercel.app/auth/callback` too if people still use that address.
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
