# Pantrila on iPhone and Android (Expo)

Goal: Pantrila in the App Store and Google Play, built with Expo (React Native) from one codebase in
`mobile/`, using the same FastAPI API (`api.pantrila.com`) and Supabase Auth as the web app. The web
app stays as it is; the native app is another client.

Decisions (owner, 2026-10-24):

- Expo (React Native) with Expo Router and TypeScript, not Capacitor, a PWA or Swift/Kotlin.
- One app for both platforms; builds, store uploads and over-the-air updates through EAS (Expo
  Application Services).
- Logic that does not draw UI is shared with `web/` through a `packages/core` package.
- No backend rewrite. API changes only where a native client needs them (a client header for
  analytics, deep-link files, Apple sign-in).
- Freemium from launch: Free and **Pantrila Pro**, sold through Apple and Google in-app purchases
  (required for a digital subscription inside the apps), managed by **RevenueCat**. Pro is
  **€4.99 a month or €29.99 a year, each with a 7-day free trial** (a store "introductory offer",
  so there is no trial code). ReciMe charges $59.99 a year in the US (checked 2026-10-24), so
  Pantrila's yearly price is half of it and the monthly price stays under €5. Apple and Google
  collect EU VAT; web billing (Stripe through RevenueCat) waits until after launch, since selling
  on the web makes Pantrila responsible for VAT. Pro bought on a phone also unlocks the web app
  (same user id). Launch market: Malta first, then the EU and the UK, all in English.
- Feature parity with the web app is the target for 1.0, except: the first-run tour becomes a short
  onboarding, Insights stays web only, and the PostHog session replays stay web only.

How to use this plan: do **one PR at a time, in order**. Start each PR in a fresh chat with
"Do the next PR of `docs/plans/mobile-app.md`". Read this file and `CLAUDE.md` first. At the end of
each PR, tick its checklist here, add a line to the handoff log at the bottom, and update the Status
section of `CLAUDE.md`. Owner steps (accounts, dashboards, phone checks) are marked **(owner)**.

## Things to know before starting

- **The Mac runs macOS 13 (Ventura).** Current Xcode needs a newer macOS, and Apple only accepts
  uploads built with a recent Xcode. So iOS builds run in the cloud on **EAS Build**, not locally.
  Android can build locally (Android Studio runs on Ventura) or on EAS. Testing happens on a real
  phone with a **development build** (a debug app with Pantrila's native modules, installed once,
  then reloaded from `npx expo start`). Expo Go is not enough: the share extension, Google/Apple
  sign-in and speech recognition need native code.
- **EAS free plan** has a monthly build limit. Use development builds and over-the-air reloads for
  everyday work; make new native builds only when native code or config changes.
- **Google Play, new personal developer account**: before the first production release, the app
  must run a **closed test with at least 12 testers opted in for 14 days in a row**. Start this
  early (PR 13), as it is the longest wait in the plan.
- **Apple rules that shape the app**:
  - Sign in with Apple is required because the app offers Google sign-in (guideline 4.8).
  - Account deletion must be possible in the app (5.1.1(v)); Pantrila already has `DELETE /me`.
  - The app must do more than a website (4.2): native share import, voice, notifications and
    native screens cover this.
  - App Review needs a way in: guest sign-in covers it; say so in the review notes.
- **Streaming**: React Native's built-in `fetch` cannot read a response as it arrives. Use
  `fetch` from `expo/fetch` for the server-sent events of `POST /plans` and `POST /chat/stream`.
- **No model, prompt or schema change is planned**, so no eval reruns. If a PR changes any of
  these after all, it follows the eval rule in `CLAUDE.md`.

## Target layout

```
package.json            npm workspaces: web, mobile, packages/*  (site/ stays separate)
packages/core/          shared TypeScript, no React DOM, no Next.js, no React Native
  src/types.ts          API types (moved from web/src/lib/types.ts)
  src/api.ts            createApi({ baseUrl, getToken, onSlow }) -> request/send/stream helpers
  src/sse.ts            SSE parser used by plans and chat
  src/amounts.ts  cooking.ts  temperature.ts  voice.ts  sections.ts  plan.ts  format.ts  avatar.ts
  test/                 unit tests (Vitest), run in CI
web/                    unchanged behaviour; imports @pantrila/core
mobile/                 Expo app
  app/                  Expo Router screens (tabs, recipe, cook, import, auth callback)
  src/                  components, hooks, platform adapters (storage, voice, notifications)
  app.config.ts         bundle ids, schemes, plugins, env
  eas.json              build profiles: development, preview, production
  assets/               icon, adaptive icon, splash (from web/brand/)
```

Identifiers: iOS bundle id and Android package `com.pantrila.app`; URL scheme `pantrila://`;
universal / app links on `https://app.pantrila.com`.

Main libraries (pin the versions that ship with the Expo SDK of the day; `npx expo install` picks
them):

| Need | Library |
| --- | --- |
| Screens and links | `expo-router` |
| Styling | Uniwind (Tailwind 4 classes, as on web) with the tokens from `web/src/app/globals.css` (NativeWind 4 needs Tailwind 3, which clashed with web's Tailwind 4 in the shared install; changed in PR 2) |
| Data | `swr` (as on the web) |
| Supabase session | `@supabase/supabase-js` + `@react-native-async-storage/async-storage`, key in `expo-secure-store` |
| Google sign-in | `@react-native-google-signin/google-signin` -> `supabase.auth.signInWithIdToken` |
| Apple sign-in | `expo-apple-authentication` -> `signInWithIdToken` |
| Streaming | `expo/fetch` |
| Images | `expo-image` |
| Photos and camera | `expo-image-picker`, `expo-image-manipulator` |
| Share into the app | `expo-share-intent` (iOS share extension, Android intent filter) |
| Voice | `expo-speech-recognition` (on-device where the phone supports it) |
| Timers | `expo-notifications` (local notifications only), `expo-keep-awake`, `expo-audio` (chime) |
| Errors | `@sentry/react-native` (Sentry EU, same rules as web: no PII, no replays) |
| Tests | Jest + React Native Testing Library; Maestro for end-to-end flows |

## PR 0: accounts and dashboards (owner, no code; can run alongside PR 1-4)

- [x] Apple Developer Program ($99/year), paid 2026-10-25 (Apple still processing: no team yet). Individual is quickest; an organisation account shows a
      company name in the store but needs a D-U-N-S number (days to weeks).
- [x] Google Play Console ($25 once), paid 2026-10-25. Identity checks can take a few days.
- [x] Expo account (`mikegauci`); `npx eas-cli login` on the Mac.
- [ ] App Store Connect: create the app "Pantrila", bundle id `com.pantrila.app`.
- [ ] Play Console: create the app "Pantrila", package `com.pantrila.app`.
- [ ] Google Cloud (same project as web sign-in): an **iOS OAuth client** (bundle id) and an
      **Android OAuth client** (package + SHA-1 of the EAS signing key, from `eas credentials`).
      Add both client ids to Supabase → Auth → Google → "Authorized Client IDs".
- [ ] Apple: a Services ID and a Sign in with Apple key; Supabase → Auth → Apple enabled with them
      (steps go in `docs/apple-sign-in.md`, written in PR 4).
- [ ] Supabase → Auth → URL Configuration: add `pantrila://auth/callback` to the redirect list.
- [ ] App Store Connect → Business: sign the Paid Applications Agreement, add bank and tax details
      (needed before any subscription can be tested or sold).
- [ ] Apple **App Store Small Business Program** and Google Play's 15% service fee tier: enrol, so
      the store cut is 15% instead of 30%.
- [ ] Play Console: payments profile (merchant account) linked.
- [ ] RevenueCat account (free until about $2.5k a month in revenue); a project "Pantrila" with the
      iOS and Android apps added (App Store Connect API key, Play service account).

## PR 1: shared `packages/core` (no behaviour change)

Branch `feat/shared-core`. Moves platform-free code out of `web/` so the native app can use it.

- [x] Root `package.json` with npm workspaces `web`, `packages/*` (`mobile` added in PR 2); one
      root `package-lock.json` replaces `web/package-lock.json`. `site/` stays out.
- [x] `packages/core` (`@pantrila/core`, TypeScript source consumed directly; `transpilePackages`
      in `web/next.config.ts`).
- [x] Move `types.ts`, `amounts.ts`, `temperature.ts` (pure parts), `sections.ts`, `plan.ts`,
      `format.ts`, `avatar.ts` and the pure parts of `cooking.ts` and `voice.ts` (parsing,
      `voiceCommand`, `micHelp`, timers from text, `stepUses`, `preheatHint`, `fanTemp`).
      React hooks and `localStorage` code stay in `web/` and import the pure functions.
- [x] `api.ts`: a `createApi({ baseUrl, getToken, onSlow, fetch })` factory in core; `web/` wraps
      it with its Supabase session, Sonner toast and wake-up notice. SSE parsing to `core/sse.ts`.
- [x] Unit tests for the moved functions (Vitest in `packages/core`), run in CI.
- [x] CI: install from the root; `web` job unchanged otherwise; new `core` test step.
- [x] Vercel `pantrila` project: check the preview build passes with the workspace install (root
      directory stays `web/`; "Include files outside the root directory" on).
- [x] All Playwright specs pass; no visible change.

Done when: web works exactly as before and imports the moved code from `@pantrila/core`.

## PR 2: Expo app skeleton

Branch `feat/mobile-skeleton`.

- [x] `npx create-expo-app@latest mobile` (TypeScript, Expo Router), added to the workspaces.
- [x] `app.config.ts`: name Pantrila, `com.pantrila.app`, scheme `pantrila`, light and dark mode,
      portrait on phones, `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`,
      `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (named as on web), `EXPO_PUBLIC_SENTRY_DSN` (`mobile/.env.example`).
- [x] Icon, Android adaptive icon and splash from `web/brand/` (extend `web/scripts/icons.mjs` or
      add `mobile/scripts/icons.mjs`).
- [x] Uniwind (was NativeWind, see Styling above) with the design-system tokens (colours, radii, font) from `globals.css`; a note in
      `web/DESIGN_SYSTEM.md` that the tokens now live in two places and must stay in sync.
- [x] `eas.json`: `development` (dev client, internal), `preview` (internal testers), `production`
      (store). EAS project id in `app.config.ts` (the owner step below fills it).
- [x] One screen that calls `/health` and `/meta` through `@pantrila/core`'s API.
- [x] Jest + React Native Testing Library set up with one test; `npx expo-doctor` clean.
- [x] CI `mobile` job: lint, typecheck, Jest, `expo-doctor`; skipped when `mobile/` and
      `packages/` are unchanged, like the other jobs. Add it to the "CI must pass on main" ruleset
      only once it is stable.
- [x] **(owner)** `npx eas-cli init` in `mobile/` and put the project id it prints in
      `app.config.ts` (`EAS_PROJECT_ID`): `@mikegauci/pantrila`, `b60bab44-4784-4b21-8ba2-e8aed45df863`.
- [ ] **(owner)** Android: development build finished on EAS (build `54f04176-a9c9-4192-969a-3b008ab94c5b`,
      keystore created by EAS; APK
      https://expo.dev/artifacts/eas/T1kt9jzEW5Evw4BQdJRkGQwfnGwy50zvWMYDsxkOrQI.apk); not yet installed on a phone
      (none to hand).
- [ ] **(owner)** iPhone: waits for Apple to activate the Developer team (`device:create` said "no team").
- [ ] **(owner)** then `eas build --profile development --platform ios` and `--platform android`; install
      on the phone; `npx expo start` reloads it.
- [x] `CLAUDE.md` Commands and Layout gain `mobile/`.

## PR 3: subscription tiers in the API

Branch `feat/subscription-tiers`. Backend only, so every later screen can show the right limits.

- [x] Migration `entitlements` (RLS on, as every table): `user_id`, `tier` (`free`|`pro`),
      `status` (`trial`|`active`|`grace`|`expired`), `expires_at`, `store` (`app_store`|
      `play_store`|`stripe`|`manual`), `product_id`, `updated_at`. No row means Free. Apply on
      Supabase before deploying.
- [x] `POST /webhooks/revenuecat`: checks the `Authorization` header against
      `REVENUECAT_WEBHOOK_SECRET`, then asks RevenueCat's REST API for the subscriber
      (`REVENUECAT_API_KEY`) and stores what it says (the webhook body alone is not trusted;
      repeats and out-of-order events are harmless). RevenueCat's app user id is the Supabase user
      id.
- [x] `PANTRILA_PRO_USERS` (comma-separated user ids) for the owner and App Review test accounts.
- [x] Caps per tier in `operations.py`: the existing `PANTRILA_DAILY_*` caps become Pro's, and a
      Free set is added with a window (day, week or month). Starting point, changeable through env
      vars without a deploy:

      | Paid feature | Free | Pro (fair use) |
      | --- | --- | --- |
      | Meal plans | 1 a week | 5 a day |
      | Recipe imports (link, post, photo, text) | 5 a month | 20 a day |
      | Assistant messages | 10 a day | 50 a day |
      | AI recipe photos | none (meal-type art) | 5 a day |

      Browsing, search, cooking mode with voice, the grocery list, pantry, swaps and My recipes
      stay free and unlimited (no model cost). The shared daily budget
      (`PANTRILA_DAILY_BUDGET_USD`) still caps everyone.
- [x] A Free cap reached returns 402 with `{ "code": "pro_required", "feature", "resets_at" }`;
      a Pro fair-use cap stays a 429.
- [x] `/me` and `/me/usage` return the tier, status, renewal or end date and what is left of each
      cap. Web: a "Pro" badge in the account menu, usage on Profile, and at a Free cap a sheet
      "Get Pantrila Pro in the app" (store links once PR 14 ships; no web checkout).
- [x] Account deletion: `entitlements` in `USER_TABLES`; RevenueCat's subscriber is deleted too.
      The delete screens say a store subscription must be cancelled in the phone's settings (Apple
      and Google do not let apps cancel it).
- [x] PostHog: `trial_started`, `subscribed`, `renewed`, `cancelled`, `expired` from the webhook
      (allowlist in `analytics.py`), keyed by user id only.
- [x] Privacy page lists RevenueCat; terms gain a subscription section (auto-renewal, cancel in the
      store, trial ends after 7 days, refunds through Apple or Google).
- [x] Tests: webhook auth and replay, caps per tier and window, 402 vs 429, the allowlist, account
      deletion. `.env.example` and `render.yaml` list the new variables.
- [ ] **(owner)** set `REVENUECAT_WEBHOOK_SECRET` and `REVENUECAT_API_KEY` on Render; point the
      RevenueCat webhook at `https://api.pantrila.com/webhooks/revenuecat`.

No model call, so no eval rerun. Existing users become Free on deploy; decide before merging
whether early users get Pro for a while (a `manual` entitlement with an end date).

As built: migration `20261025120000_entitlements` (applied on Supabase 2026-10-25) also adds
`will_renew`, a `subscription_events` table (webhook event ids, so a repeat sends no second PostHog
event) and a usage kind `estimate`: food estimates in the recipe form no longer count as imports
(`PANTRILA_DAILY_ESTIMATES`, 20 a day for everyone). Free caps are `PANTRILA_FREE_PLANS|CHATS|IMPORTS|PHOTOS`
and `..._WINDOW`; Pro's chat cap default rose from 10 to 50 (`PANTRILA_DAILY_CHATS`, also in `render.yaml`;
check the value on Render). Early users: nobody gets Pro by default; to give someone Pro until a date run
`insert into entitlements (user_id, tier, status, expires_at, store) values ('<id>', 'pro', 'active',
'2027-01-01', 'manual')` (a webhook never takes a manual Pro away while it lasts).

## PR 4: sign-in

Branch `feat/mobile-sign-in`.

- [ ] Supabase client with AsyncStorage session storage (encrypted with a key in
      `expo-secure-store`, as Supabase's Expo guide shows), auto refresh paused in the background.
- [ ] Welcome screen like the web login: Continue with Google, Continue with Apple (iOS; Android
      shows it only if it works with the web flow, else hides it), "Try it as a guest", "Prefer
      email? Sign in with a link".
- [ ] Google: native sheet -> `signInWithIdToken({ provider: "google", token })`.
- [ ] Apple: `expo-apple-authentication` -> `signInWithIdToken({ provider: "apple", token, nonce })`.
- [ ] Magic link: `signInWithOtp` with `emailRedirectTo: "pantrila://auth/callback"`; the
      `auth/callback` route exchanges the code.
- [ ] Guest -> keep data with Google or Apple (`linkIdentity` with the id token; same user id); the
      "account already exists" message as on the web.
- [ ] Sign out; switching accounts clears SWR caches and stored state keyed by user id (as the web's
      account isolation does).
- [ ] `docs/apple-sign-in.md` (Apple Developer + Supabase steps) and `docs/google-sign-in.md` gains
      the native client ids.
- [ ] Tests for the auth helpers; **(owner)** sign in with each method on both phones.

## PR 5: app shell, Home and Recipes

Branch `feat/mobile-recipes`.

- [ ] Tabs: Home, Assistant, Recipes, Plan, Grocery (same order as the web nav); Pantry and Profile
      from the account button in the header.
- [ ] "Waking up the Pantrila server…" notice (same 3 s / 10 min rule) and `/health` ping on start.
- [ ] Home: greeting, Ask Pantrila card (opens Assistant; the chat itself comes in PR 10), My recipes
      section (latest 4, or the import pitch card).
- [ ] Recipes: search, Meal / Time / Diet / Cuisine filter chips, safety banner, recipe cards with
      photos (`expo-image`), infinite list.
- [ ] Recipe page: photo, nutrition, allergen warnings for the person's rules, ingredients with the
      tap-to-change unit picker, method with the °C/°F switch, fan-oven temperatures and fractions
      (all from `@pantrila/core`), "Start cooking" (opens PR 7's screen; a placeholder until then).
- [ ] Pull to refresh; empty and error states.
- [ ] Jest tests for the screens' logic.

## PR 6: meal plan and grocery list

Branch `feat/mobile-plan`.

- [ ] Plan screen: create a plan (SSE through `expo/fetch`: step labels, then the plan; keep-alives
      and early end handled like the web), days with meals, energy and macro bars, the energy range
      band.
- [ ] Meal menu: swap (sheet with Pantrila's recipes / My recipes, search, filters, Show more), add
      back, eat out (Light / Normal / Big / not counted), leftovers, skip, repeat on other days,
      start cooking with leftover servings.
- [ ] Grocery list by aisle, ticks kept per user, unlisted cookbook foods apart.
- [ ] Tests for plan helpers already in core; Jest for the sheets.

## PR 7: cooking mode (native)

Branch `feat/mobile-cooking`.

- [ ] Full-screen steps, get-ready page, ingredient checklist, "for this step" chips, group
      headings, preheat hint, servings and "N of these servings are for later".
- [ ] Screen stays on (`expo-keep-awake`).
- [ ] Timers parsed from step text (core); each running timer schedules a **local notification**,
      so it rings with the phone locked or the app closed; pausing or stopping cancels it. Chime in
      the app. Ask for notification permission the first time a timer starts.
- [ ] Voice: "next", "back", "start timer", "stop timer", "start" on the get-ready page, through
      `expo-speech-recognition` and core's `voiceCommand`; on-device recognition when available (the
      privacy notice then says speech stays on the phone; otherwise it names Apple or Google);
      a help sheet when the mic or speech permission is denied (opens Settings).
- [ ] Progress kept on the phone for 12 h (same key shape as the web).
- [ ] "I cooked this" with the pantry preview (`/me/cooked/preview`, `/me/cooked`).
- [ ] Sends `cooking_mode_opened` to `POST /me/events`.
- [ ] **(owner)** cook a recipe on a real phone with voice and a locked-phone timer.

## PR 8: My recipes and imports

Branch `feat/mobile-cookbook`.

- [ ] My recipes list and recipe page (groups, notes, credit to the creator, "Back to the chat"),
      edit form (lines, groups, steps with `## Heading`, notes), delete.
- [ ] Imports as background jobs (`POST /me/recipes/import/jobs`, poll the job): from a link, a
      post, typed text, photos. The job id is saved before the request, so an import survives the
      app being closed or the phone locked; on reopen the app shows "Finishing your import…".
- [ ] Live import steps (`import-progress`), auto-save, the review form only when `needsReview`.
- [ ] Photos: camera or library (`expo-image-picker`), shrunk to JPEG on the phone
      (`expo-image-manipulator`) as the web does.
- [ ] Recipe photo made in the background after save; "Making the photo…"; New / Remove photo.
- [ ] Food estimates for unmatched lines (automatic, as on the web).

## PR 9: share to Pantrila and links into the app

Branch `feat/mobile-share`. The feature that makes the app worth installing.

- [ ] `expo-share-intent`: Pantrila appears in the share sheet of Instagram, TikTok, Facebook,
      Safari and Chrome. A shared post or recipe link opens the app and starts the import job; a
      shared photo starts a photo import.
- [ ] Universal links (iOS) and app links (Android) for `https://app.pantrila.com/recipes/...` and
      `/plan`: `web/public/.well-known/apple-app-site-association` and `assetlinks.json` (with the
      EAS signing SHA-256); `web/src/proxy.ts` must not redirect them.
- [ ] Signed-out share: sign in first, then continue the import.
- [ ] Analytics: `recipe_imported` already comes from the API; nothing new.
- [ ] **(owner)** share a real reel from each app on both phones.

## PR 10: assistant chat

Branch `feat/mobile-assistant`.

- [ ] Threads list (drawer), New chat, delete; `?q=` from Home's card.
- [ ] `POST /chat/stream` through `expo/fetch`: step label, recipe cards as found, reply text as it
      arrives, then the final reply; error state.
- [ ] Recipe cards and links to recipe pages and cooking mode; draft recipes with "Save to My
      recipes" / "Saved to My recipes"; warning cards.
- [ ] Dictation into the message box (`expo-speech-recognition`).

## PR 11: pantry, profile and the rest

Branch `feat/mobile-profile`.

- [ ] Pantry: list, add (food matching with suggestions), amounts, remove.
- [ ] Profile: diet, allergies, excluded foods, nutrition targets (one number / a range), people,
      avatar upload (crop square, JPEG; Google picture fallback), keep data with Google or Apple.
- [ ] "Send feedback" with `@sentry/react-native` `captureFeedback`; Sentry errors on with the user
      id only.
- [ ] Delete account (type "delete"), clears local data and signs out.
- [ ] Short onboarding (three cards: plan, import from a post, cook hands-free) instead of the web
      tour.
- [ ] API: an `X-Pantrila-Client: ios|android|web` header read by `analytics.py`, so PostHog splits
      the funnel by platform (property only; the web keeps working without it). New Python test.
- [ ] Privacy page on `site/` and terms: name the apps, local notifications, speech recognition
      (on-device or Apple/Google), camera and photos.

## PR 12: paywall and free trial

Branch `feat/mobile-paywall`. Must ship before store submission: Apple reviews subscriptions with
the app.

- [ ] **(owner)** App Store Connect: subscription group "Pantrila Pro" with `pro_monthly` (€4.99)
      and `pro_yearly` (€29.99), each with a 7-day free trial introductory offer; prices for the
      other storefronts from Apple's equalisation (check the UK price). Review screenshot of the
      paywall.
- [ ] **(owner)** Play Console: subscription `pro` with base plans `monthly` and `yearly` at the
      same prices and a 7-day free trial offer for new subscribers.
- [ ] **(owner)** RevenueCat: products, entitlement `pro`, offering `default` with both packages.
- [ ] `react-native-purchases` (and `react-native-purchases-ui` for RevenueCat's paywall, or our
      own screen in the design system); `Purchases.logIn(<supabase user id>)` on sign-in,
      `logOut` on sign-out.
- [ ] Paywall: shown at a 402 from the API and from Profile → "Pantrila Pro". Lists what Pro gives,
      the yearly plan first with its saving ("€2.50 a month"), the trial ("7 days free, then
      €29.99 a year"), and Apple's required parts: price and period, auto-renewal wording, links
      to the terms and privacy pages, "Restore purchases".
- [ ] A guest who buys is asked to keep their data with Google or Apple first (the purchase stays
      with the store account either way, and "Restore purchases" recovers it).
- [ ] Profile: plan, renewal date, "Manage subscription" (opens the App Store or Play page).
- [ ] After a purchase the app refreshes `/me` until the webhook has landed (a few seconds), so
      Pro limits apply at once.
- [ ] **(owner)** test in the App Store sandbox (TestFlight) and Play license testers: start a
      trial, cancel, restore on a second phone, expire, and check the web app shows Pro.

No model call, so no eval rerun.

### Converting Free users to Pro

Principle: Free must already be useful at its best moment, and Pro is offered right after the person
has felt that value and hit a limit. Never on a blank screen, never in cooking mode, never as a
popup on launch. Cooking mode, the grocery list, the pantry and search stay free (see PR 3's table).

Where the offer appears, with the copy each time:

- **Limit reached (402)**: the paywall sheet names what they tried ("You have used your 1 plan this
  week") and when it resets ("Free plans reset Monday"), then offers "Try Pro free for 7 days".
  This is the main conversion point, so it has to be fast and clear.
- **Import limit (5 a month)**: show the count ("5 of 5 imports this month") at the moment they paste
  a fifth link, with the trial as the way on. Never hidden behind a failed import.
- **After a plan is saved**: one quiet line under the plan ("Free: 1 plan a week. Pro plans as often
  as you like."). Shown once per week, not on every visit.
- **Profile**: a "Pantrila Pro" row showing plan and usage, with "Try free for 7 days" for Free users.
  No banner on other screens.
- **Trial day 5**: a push reminder ("Your free trial ends in 2 days. Cancel any time in Settings,
  nothing is charged before then."). Honest and useful; it also protects the store rating.
- **Expired subscriber**: a "Welcome back" sheet on their next open, with the yearly plan first and
  their data untouched. Nothing is deleted or locked away.

The paywall (PR 12) itself:

- Lead with the benefit they just hit, not a feature list. Then the yearly plan first with its
  saving, the monthly plan second, and the trial above the button ("7 days free, then €29.99 a year").
- Price, period, auto-renewal wording, "Restore purchases", terms and privacy links are always
  visible, as Apple requires.
- Use only true claims: no countdowns, no "only 3 left", no invented user counts or reviews.
- Cancelling is one tap in the store's settings, and the app says so. Trust is part of why people
  start a trial.

Measure before tuning (PostHog, keyed by user id; events in PR 3 plus `paywall_shown` with
`reason` (`limit`, `profile`, `welcome_back`), `paywall_closed` and `trial_started` by `source`):

- Share of people who reach a limit and then start a trial, per limit. This tells us which limit
  is doing the work.
- Trial start to paid, and paid after 3 months (the number that pays the bills).
- Set targets after 4 weeks of real data. Until then, do not change the limits to chase a number.

Guardrails: no ads in the apps (Free stays ad-free; ad SDKs would also break the PR 13 privacy
answers), no feature that works on the web
but is locked on the phone, and no change to a limit without writing down the before and after
numbers here.

## PR 13: store readiness and testing

Branch `feat/mobile-store`.

- [ ] App Store Connect: privacy labels (data: email, user id, user content, crash data; not used
      for tracking; no ad SDKs), age rating, category Food & Drink, support URL
      `https://pantrila.com`, privacy URL `https://pantrila.com/privacy`.
- [ ] Play Console: Data safety form (same answers), content rating, target audience, app access
      (guest sign-in, no login needed), ads: none.
- [ ] Review notes for both stores name the Pro products and how to reach the paywall.
- [ ] Permission texts in `app.config.ts` (camera, photos, microphone, speech recognition,
      notifications) in plain words.
- [ ] Store listing text and screenshots (6.9" and 6.5" iPhone, iPad if supported, Android phone);
      `docs/store-listing.md` holds the text so it is versioned. A Maestro flow takes the
      screenshots.
- [ ] Maestro end-to-end flows (guest sign-in, search, plan, cook, import) run on EAS.
- [ ] **(owner)** `eas build --profile production` both platforms; `eas submit` to TestFlight and the
      Play **closed testing** track; invite at least 12 Android testers and keep them opted in for
      14 days. TestFlight beta testers in the meantime.
- [ ] Fix what testers find (follow-up PRs as needed).

## PR 14: launch

Branch `feat/mobile-launch`.

- [ ] **(owner)** Submit to App Review and to Play production (after the 14-day test). Review notes:
      "Tap Try it as a guest; no account needed."
- [ ] `site/`: the "Coming soon" store cards become real App Store and Google Play badges with links;
      the web app offers the app on phones (smart app banner on iOS).
- [ ] EAS Update channels for production, so JavaScript-only fixes ship without a store review;
      `runtimeVersion` policy set so an update never reaches a build with different native code.
- [ ] README: mobile section, architecture diagram gains the app, screenshots; `docs/demo-script.md`
      gains the share-to-import moment.
- [ ] `CLAUDE.md`: Status, Layout and Commands final.

## Later (not in 1.0)

- Remote push notifications (plan reminders, "your import is ready" when the app is closed).
- Home-screen widgets (today's meals), Siri / Google Assistant shortcuts.
- Offline cache of the plan and saved recipes.
- iPad and tablet layouts beyond the phone layout scaled up.

## Progress

| PR | Branch | State |
| --- | --- | --- |
| 0 | (owner) | in progress (Apple, Play Console and Expo accounts paid; Apple team pending) |
| 1 | `feat/shared-core` | done |
| 2 | `feat/mobile-skeleton` | done (EAS project linked, Android development build finished; owner: install it on an Android phone, iPhone build once Apple activates the team) |
| 3 | `feat/subscription-tiers` | done (owner: RevenueCat keys on Render, webhook URL in RevenueCat) |
| 4 | `feat/mobile-sign-in` | not started |
| 5 | `feat/mobile-recipes` | not started |
| 6 | `feat/mobile-plan` | not started |
| 7 | `feat/mobile-cooking` | not started |
| 8 | `feat/mobile-cookbook` | not started |
| 9 | `feat/mobile-share` | not started |
| 10 | `feat/mobile-assistant` | not started |
| 11 | `feat/mobile-profile` | not started |
| 12 | `feat/mobile-paywall` | not started |
| 13 | `feat/mobile-store` | not started |
| 14 | `feat/mobile-launch` | not started |

## Handoff log

Add one line per PR: date, PR link, what landed, anything the next PR must know.

- 2026-10-24: plan written (this file).
- 2026-10-24: freemium added (PR 3 subscription tiers, PR 12 paywall); later PRs renumbered.
- 2026-10-25: PR 1 (`feat/shared-core`): root npm workspaces and lockfile, `@pantrila/core` (types, API client
  factory, SSE reader, amounts, cooking, temperature, voice, sections, plan, format, avatar) with 49 Vitest tests and
  a CI `core` job; web imports it, no visible change. For PR 2: import core as `@pantrila/core/<module>` (package
  `exports` map `./*` to `src/*.ts`, so Metro needs package exports on, the default in recent SDKs); build the phone
  client with `createApi({ baseUrl, getToken, onSlow, fetch })` passing `fetch` from `expo/fetch` for streaming; core
  uses `TextDecoder` and `ReadableStream.getReader`, no `TextDecoderStream`. `avatarFor` returns Tailwind class names,
  so NativeWind needs `packages/core/src` in its content paths too.
- 2026-10-25: PR 2 (`feat/mobile-skeleton`): Expo SDK 58 app in `mobile/` (Expo Router, React 19.3 and
  React Native 0.88, one copy each in the shared install), `app.config.ts` (`com.pantrila.app`, scheme
  `pantrila`, phones only, portrait, light and dark), `eas.json` (development, preview, production; public
  URLs in `env`), icons and splash from `web/brand/` through `web/scripts/icons.mjs`, Uniwind instead of
  NativeWind (Tailwind 4 like web; NativeWind 4.2.7 needs Tailwind 3, which took web's place at the root of
  the install, and does not list SDK 58), tokens and Plus Jakarta Sans (four weights, `font-sans-*`) in
  `mobile/src/global.css`, one screen calling `/health` and `/meta` through `createApi` with `expo/fetch`
  (core gains `health()`), Jest + RNTL 14 (`render` is async there), CI `mobile` job. For PR 3/4: `/meta`
  shows "Sign in first." until sign-in lands; `getToken` in `mobile/src/lib/api.ts` is the place to wire the
  Supabase session; the publishable key goes in as an EAS environment variable
  (`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) and `mobile/.env.local`. TypeScript 6 in `mobile/` needs
  `types` listed in `tsconfig.json`. `jest-expo` leaves a timer that prints "Jest did not exit one second
  after", but it exits. The owner still runs `npx eas-cli init` (project id into `app.config.ts`) and the
  first development builds.
- 2026-10-25: PR 2 owner part, later: the Android development build finished (build
  `54f04176-a9c9-4192-969a-3b008ab94c5b`, APK
  https://expo.dev/artifacts/eas/T1kt9jzEW5Evw4BQdJRkGQwfnGwy50zvWMYDsxkOrQI.apk); still not installed (no Android phone
  to hand).
- 2026-10-25: PR 2 owner part (`feat/mobile-eas-project`): EAS project `@mikegauci/pantrila`, id
  `b60bab44-4784-4b21-8ba2-e8aed45df863`, in `mobile/app.config.ts` (dynamic config, so `eas init` cannot write it;
  `npx expo config --type public` shows `extra.eas.projectId`). Android development build queued on EAS
  (build `54f04176-a9c9-4192-969a-3b008ab94c5b`, keystore made by EAS, versionCode 1 remote); no Android phone to
  install it on yet. iPhone skipped: Apple ID login and 2FA work, but `device:create` says the account has no team, so
  the Developer Program membership is still being processed. The Expo login went through Google, which first needed
  the expo.dev onboarding finished. Still to do: `device:create` + iOS development build, install both, `npx expo
  start` shows "Server: Up".
- 2026-10-25: PR 3 (`feat/subscription-tiers`): `entitlements.py` (Free or Pro from `entitlements` rows,
  `PANTRILA_PRO_USERS`, RevenueCat REST subscriber -> trial/active/grace/expired), `POST /webhooks/revenuecat`
  (Authorization header = `REVENUECAT_WEBHOOK_SECRET`, then reads each named user from RevenueCat with
  `REVENUECAT_API_KEY`; `TEST` events answer ok; anonymous `$RCAnonymousID` users are skipped), caps per tier in
  `operations.py` (`allowance(kind, tier)`, `ProRequired` 402 with `code`, `feature`, `resets_at`), `/me` and
  `/me/usage` gain `subscription` and the new `limits` shape (`plans|chats|imports|photos: {limit, left, window,
  resets_at}`), account deletion deletes the RevenueCat subscriber before the sign-in, PostHog subscription events.
  Web: Pro badge in the account menu, "Your plan" card on Profile, `ProSheet` ("Get Pantrila Pro in the app") opened
  by `askForPro(e)` at a 402, no automatic AI photo on Free. Core: `ApiError.pro`, `@pantrila/core/subscription`
  (`leftText`, `subscriptionText`). For PR 4 and later: show limits with `leftText`; a 402 has `error.pro`; PR 12
  logs into RevenueCat with the Supabase user id, entitlement id `pro`. Owner: set `REVENUECAT_WEBHOOK_SECRET`,
  `REVENUECAT_API_KEY` and `PANTRILA_PRO_USERS` on Render and point RevenueCat's webhook at
  `https://api.pantrila.com/webhooks/revenuecat` (Authorization header value = the secret).
