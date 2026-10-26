# Guest safeguards

"Try it as a guest" stays: it lets people see Pantrila before giving an email, and it lets both stores' reviewers
in without credentials. A guest is a Supabase anonymous user (`signInAnonymously` in `web/src/app/login/page.tsx` and
`mobile/src/lib/auth.ts`); the API already knows one from the token's `is_anonymous` claim (`auth.User.anonymous`).

What is weak today:

- **Free limits can be reset.** Each guest is a new user id with fresh Free limits (1 plan a week, 5 imports a
  month, 10 chats a day; `operations.allowance`). A script that makes guests gets unlimited AI use until the shared
  `PANTRILA_DAILY_BUDGET_USD` runs out, and then the app stops for everyone for the rest of the day.
- **Lost data.** A guest who deletes the app, clears the browser or changes phone loses everything. Account and
  Profile already offer "Keep my data with Google or Apple" (`linkIdentity`, same user id).
- **Inflated numbers.** One-visit guests count as `signed_up` in PostHog.

Not needed for launch. Start with PR 1 once real users arrive (or the daily budget is hit). One PR each, in order,
with the usual Status entry in [`docs/status-log.md`](../status-log.md).

## PR 1: CAPTCHA on guest sign-in (`feat/guest-captcha`)

Stops scripted guest creation; invisible to most people.

- [ ] (owner) Cloudflare Turnstile site (managed, invisible) for `app.pantrila.com` and the apps; secret key into
      Supabase → Auth → Attack Protection (CAPTCHA, Turnstile). Supabase then requires a token for anonymous
      sign-ins (and for email links and sign-ups; Google and Apple id-token sign-ins are not affected).
- [ ] Web: Turnstile widget on the login page, token passed as `signInAnonymously({ options: { captchaToken } })`
      and to the email link request; site key as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- [ ] Phone: Turnstile in a small WebView (or `@marsidev/react-turnstile` behind a WebView) before "Try it as a
      guest"; site key as an EAS variable; new native module means a new build.
- [ ] Playwright and Jest: fake token in tests; the guest path still works with the key unset (local and CI).
- [ ] Check: a guest sign-in works on web and phone; a request without a token is refused by Supabase.

## PR 2: Lower limits for guests (`feat/guest-limits`)

A guest gets a taste; signing in with Google or Apple gives the full Free plan.

- [ ] `operations.allowance(kind, tier, guest)`: a third tier for anonymous users, from `PANTRILA_GUEST_*` (suggested:
      0 plans, i.e. none until signed in, or 1 a week; 2 imports a month; 3 chats a day; no photos), Free as before
      for signed-in users. Pro is never a guest (the paywall already asks a guest to link first).
- [ ] A guest at its cap gets a 402 with `code: "sign_in_required"` (not `pro_required`), so the apps show "Sign in
      with Google or Apple to keep going (free)" with the link buttons instead of the paywall.
- [ ] `/me` and `/me/usage` report the guest limits, so "Your plan" shows them.
- [ ] Linking an identity keeps the user id, so usage so far carries over and the higher Free caps apply at once.
- [ ] Tests: caps per tier including guest, the 402 code, a linked guest gets Free caps.
- [ ] Privacy and terms: guests have smaller limits.

## PR 3: Ask guests to keep their data (`feat/guest-link-prompt`)

- [ ] After a guest's first saved recipe, first plan or third chat, one dismissible card: "Keep your recipes and plans:
      sign in with Google or Apple. Free, and nothing changes." (kept dismissed per user in storage).
- [ ] Web and phone, using the existing link helpers (`linkGoogle`, Apple on iPhone).
- [ ] PostHog: `guest_linked` (from the API when `anonymous` turns false for a user id), so the funnel can tell guests
      who stayed from one-visit guests.
- [ ] Playwright and Jest tests for when the card shows and that dismissing it sticks.

## Progress

| PR | Branch | State |
| --- | --- | --- |
| 1 | `feat/guest-captcha` | not started |
| 2 | `feat/guest-limits` | not started |
| 3 | `feat/guest-link-prompt` | not started |
