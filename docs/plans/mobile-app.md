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

- [x] Supabase client with AsyncStorage session storage (encrypted with a key in
      `expo-secure-store`, as Supabase's Expo guide shows), auto refresh paused in the background.
- [x] Welcome screen like the web login: Continue with Google, Continue with Apple (iOS; Android
      hides it: it would need Apple's web flow), "Try it as a guest", "Prefer
      email? Sign in with a link".
- [x] Google: native sheet -> `signInWithIdToken({ provider: "google", token })`.
- [x] Apple: `expo-apple-authentication` -> `signInWithIdToken({ provider: "apple", token, nonce })`.
- [x] Magic link: `signInWithOtp` with `emailRedirectTo: "pantrila://auth/callback"`; the
      `auth/callback` route exchanges the code.
- [x] Guest -> keep data with Google or Apple (`linkIdentity` with the id token; same user id); the
      "account already exists" message as on the web.
- [x] Sign out; switching accounts clears SWR caches and stored state keyed by user id (as the web's
      account isolation does).
- [x] `docs/apple-sign-in.md` (Apple Developer + Supabase steps) and `docs/google-sign-in.md` gains
      the native client ids.
- [x] Tests for the auth helpers (`mobile/src/__tests__/auth.test.ts`, `welcome.test.tsx`).
- [ ] **(owner)** Google Cloud iOS and Android clients, EAS variables, Supabase client ids and
      "Skip nonce checks" (`docs/google-sign-in.md` section 4); Apple provider in Supabase
      (`docs/apple-sign-in.md`); `pantrila://auth/callback` in Supabase's redirect URLs;
      `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as an EAS variable; a new development build.
- [ ] **(owner)** sign in with each method on both phones.

## PR 5: app shell, Home and Recipes

Branch `feat/mobile-recipes`.

- [x] Tabs: Home, Assistant, Recipes, Plan, Grocery (same order as the web nav); Pantry and Profile
      from the account button in the header.
- [x] "Waking up the Pantrila server…" notice (same 3 s / 10 min rule) and `/health` ping on start.
- [x] Home: greeting, Ask Pantrila card (opens Assistant; the chat itself comes in PR 10), My recipes
      section (latest 4, or the import pitch card).
- [x] Recipes: search, Meal / Time / Diet / Cuisine filter chips, safety banner, recipe cards with
      photos (`expo-image`), infinite list.
- [x] Recipe page: photo, nutrition, allergen warnings for the person's rules, ingredients with the
      tap-to-change unit picker, method with the °C/°F switch, fan-oven temperatures and fractions
      (all from `@pantrila/core`), "Start cooking" (opens PR 7's screen; a placeholder until then).
- [x] Pull to refresh; empty and error states.
- [x] Jest tests for the screens' logic.

Done notes: `/recipes` gained `offset` for the list's pages (a search stays one page of 36, since each
further page would count as another search). Assistant, Plan, Grocery, My recipes, importing, cooking mode,
Pantry and Profile show a "coming to the app" screen until their PRs; ingredient swaps and the recipe card's
bookmark (save to My recipes) are not on the phone yet (PR 8 is the natural place for the bookmark).

## PR 6: meal plan and grocery list

Branch `feat/mobile-plan`.

- [x] Plan screen: create a plan (SSE through `expo/fetch`: step labels, then the plan; keep-alives
      and early end handled like the web), days with meals, energy and macro bars, the energy range
      band.
- [x] Meal menu: swap (sheet with Pantrila's recipes / My recipes, search, filters, Show more), add
      back, eat out (Light / Normal / Big / not counted), leftovers, skip, repeat on other days,
      start cooking with leftover servings.
- [x] Grocery list by aisle, ticks kept per user, unlisted cookbook foods apart.
- [x] Tests for plan helpers already in core; Jest for the sheets.

Done notes: core gains `cookHref`, `leftoverDays` (plan.ts) and `grocery.ts` (`byAisle`, `aisleName`), which the web
now uses too. The meal menu, swap and repeat are one sheet whose content changes (`MealSheet`), since iOS will not
open a second modal while one closes. A Free plan used up shows the server's 402 message; the in-app Pro offer is PR 12.
"Start cooking" opens PR 7's routes (`recipes/[id]/cook`, `recipes/mine/[id]/cook`), placeholders until then.

## PR 7: cooking mode (native)

Branch `feat/mobile-cooking`.

- [x] Full-screen steps, get-ready page, ingredient checklist, "for this step" chips, group
      headings, preheat hint, servings and "N of these servings are for later".
- [x] Screen stays on (`expo-keep-awake`).
- [x] Timers parsed from step text (core); each running timer schedules a **local notification**,
      so it rings with the phone locked or the app closed; pausing or stopping cancels it. Chime in
      the app. Ask for notification permission the first time a timer starts.
- [x] Voice: "next", "back", "start timer", "stop timer", "start" on the get-ready page, through
      `expo-speech-recognition` and core's `voiceCommand`; on-device recognition when available (the
      privacy notice then says speech stays on the phone; otherwise it names Apple or Google);
      a help sheet when the mic or speech permission is denied (opens Settings).
- [x] Progress kept on the phone for 12 h (same key shape as the web).
- [x] "I cooked this" with the pantry preview (`/me/cooked/preview`, `/me/cooked`).
- [x] Sends `cooking_mode_opened` to `POST /me/events`.
- [ ] **(owner)** cook a recipe on a real phone with voice and a locked-phone timer.

Done notes: Android schedules timer notifications with `setExactAndAllowWhileIdle` (expo-notifications'
`bestEffort`); no exact-alarm permission is declared, since Google Play keeps `USE_EXACT_ALARM` for alarm apps. If
the owner's phone rings late, add `SCHEDULE_EXACT_ALARM` and ask for it the first time a timer starts. Ring and chime
are WAV files written by `scripts/cooking_sounds.py` (the web's notes; a test checks them). Progress keys keep the
web's shape (`pantrila-cook:<user>:<recipe>`), so sign-out now forgets that prefix as well as `userKey`. The web's
"1 of these serving is" now reads "servings is". Not yet: "Resume cooking" and "You cooked this N times" on the
recipe page.

## PR 8: My recipes and imports

Branch `feat/mobile-cookbook`.

- [x] My recipes list and recipe page (groups, notes, credit to the creator, "Back to the chat"),
      edit form (lines, groups, steps with `## Heading`, notes), delete.
- [x] Imports as background jobs (`POST /me/recipes/import/jobs`, poll the job): from a link, a
      post, typed text, photos. The job id is saved before the request, so an import survives the
      app being closed or the phone locked; on reopen the app shows "Finishing your import…".
- [x] Live import steps (`import-progress`), auto-save, the review form only when `needsReview`.
- [x] Photos: camera or library (`expo-image-picker`), shrunk to JPEG on the phone
      (`expo-image-manipulator`) as the web does.
- [x] Recipe photo made in the background after save; "Making the photo…"; New / Remove photo.
- [x] Food estimates for unmatched lines (automatic, as on the web).
- [ ] **(owner)** import a post, a link and a cookbook photo on a real phone with the next development build.

Done notes: "typed text" is a fifth way in on the phone ("Paste text", `kind: "text"`), since copying a recipe from
Notes or a message is common there; the web keeps its four. Home shows "Finishing your import…" when a job from an
earlier visit is still saved, and the new-recipe screen picks it up. If the app is closed while a photo is being made,
the server still finishes it; pulling the recipe down shows it (the web polls; the phone does not keep photo jobs
across launches). The Free tier has no Pro sheet on the phone yet (PR 12): a 402 shows its message in place.
`expo-image-picker` and `expo-image-manipulator` are native modules, so the next development build needs making. A
transparent screenshot turns black as JPEG on the phone (the web paints white first); phone screenshots are not
transparent, so this is left as is.

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
| 4 | `feat/mobile-sign-in` | done (owner: Google and Apple dashboards, EAS variables, a new development build, phone checks) |
| 5 | `feat/mobile-recipes` | done (owner: try it on a phone with the next development build) |
| 6 | `feat/mobile-plan` | done (owner: try it on a phone with the next development build) |
| 7 | `feat/mobile-cooking` | done (owner: cook on a real phone with voice and a locked-phone timer) |
| 8 | `feat/mobile-cookbook` | done (owner: import on a real phone with the next development build) |
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
- 2026-10-25: PR 4 (`feat/mobile-sign-in`): Supabase client on the phone (`mobile/src/lib/supabase.ts`: PKCE,
  session encrypted by `LargeSecureStore`, key in `expo-secure-store`, auto refresh only while the app is active;
  without `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` the welcome screen says so instead of crashing), `src/lib/auth.ts`
  (Google sheet -> `signInWithIdToken`, Apple with a SHA-256 nonce and the first-time name saved as `full_name`,
  `linkIdentity` for guests, email links to `pantrila://auth/callback` exchanged in `src/app/auth/callback.tsx`,
  `authMessage` in the web's words, `userKey`/`forgetLocal` for per-user phone storage), `AuthProvider` with a fresh
  SWR cache per user, `Stack.Protected` routes (`welcome` signed out, `index` signed in), Home's `AccountCard`
  (keep your data with Google or Apple, sign out with a warning for guests). The Google plugin is added only when
  `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` is set (without options it expects Firebase files); Apple is iPhone only. 11 Jest
  tests; `expo export` bundles iOS and Android, `expo-doctor` 20/20. For PR 5: put new phone storage under
  `userKey(user.id, ...)` so sign-out forgets it; the tabs replace `index` inside the signed-in `Stack.Protected`;
  `AccountCard` moves to Profile in PR 11. Owner: steps in `docs/google-sign-in.md` section 4 and
  `docs/apple-sign-in.md`, then a new development build (native modules were added).
- 2026-10-25: PR 5 (`feat/mobile-recipes`): tabs in `src/app/(tabs)/` (`expo-router/js-tabs`; Home, Assistant,
  Recipes, Plan, Grocery) with the account button in the header (`account.tsx`: Pantry and Profile "soon",
  `AccountCard`); `/health` ping when the tabs open and the "Waking up the Pantrila server…" notice
  (`lib/waking.ts` counts `createApi`'s `onSlow` requests, `WakeNotice` shows while any wait). Home: greeting, Ask
  Pantrila (opens `/assistant?q=` or `?thread=`, for PR 10 to read), My recipes (latest 4 or the import pitch;
  cards open `/recipes/mine/[id]`, the buttons `/recipes/mine/new?method=post|link`, both placeholders for PR 8).
  Recipes: search, chip rows, "Only what suits me", `FlatList` pages through `useRecipePages` (API `offset`,
  24 a page). Recipe page `recipes/[id]`: photo, rule alert, allergens in red for the person's allergies,
  servings, unit sheet per line (`MeasuredLine`), macro ring (react-native-svg), method with the °C/°F switch
  (kept per user under `userKey(id, "temp-unit")`), "Start cooking" opens `recipes/[id]/cook?servings=` (PR 7's
  route, a placeholder now). Icons are `lucide-react-native` (the web's set; `Icon` takes a theme token so dark
  mode works). New native module: `react-native-svg`, so the next development build needs making anyway. Jest:
  `jest.config.js` (lucide's CommonJS build), `jest.setup.js` (Uniwind theme and AsyncStorage stand-ins), screen
  tests through `renderRouter` with a fake API (`src/test/screens.tsx`); 22 tests. For PR 6: put Plan and Grocery
  in the existing tab files and reuse `bits.tsx`, `MacroRing` and `ChipRow`.
- 2026-10-25: PR 6 (`feat/mobile-plan`): Plan tab (`app/(tabs)/plan.tsx`): "Plan my week" streams `POST /plans`
  through core's `streamPlan` (step labels, then the plan; keep-alives and an early end are core's), the allowance
  line (`leftText`), the plan's note and warnings, a panel per day (today ringed) with `MealRow`s and `DayTargets`
  (`plan-bars.tsx`: energy against one number or a range band, protein, carbs), and "How this plan was made".
  `MealSheet` (`components/meal-sheet.tsx`) is the menu: swap (`swap-meal.tsx`: Pantrila's / My recipes, search,
  30 min, pantry, Show more to 24), repeat (`repeat-meal.tsx`), start cooking with every serving (`cookHref`), add
  back, eat out (Light / Normal / Big / not counted), leftovers of the 4 latest earlier meals, skip; a meal with
  leftovers stays cooked. Grocery tab: by aisle, people stepper, ticks per user and plan under
  `userKey(id, "grocery:<plan>")` (`lib/grocery.ts`), "Also for your recipes" (estimated foods), "From your pantry".
  New shared bits: `Sheet` (iOS page sheet, Android full screen), `Stepper`, `Stat`, `toast` + `Toaster` (the
  web's Sonner). Core: `cookHref`, `leftoverDays`, `grocery.ts` (web uses them now). 31 Jest tests, 55 core tests, 42
  Playwright specs. For PR 7: cooking mode goes in `recipes/[id]/cook.tsx` and `recipes/mine/[id]/cook.tsx`, which
  get `?servings=` and `&later=`.
- 2026-10-25: PR 7 (`feat/mobile-cooking`): `CookingScreen` (`components/cooking-mode.tsx`, parts in
  `cooking-parts.tsx`) on `recipes/[id]/cook` and `recipes/mine/[id]/cook` (full-screen modal, no swipe to leave):
  get-ready page with servings (from `?servings=`), "N of these servings are for later" (`&later=`), the grouped
  checklist, one step at a time with its heading, the preheat hint (tap), "for this step" chips (core `stepUses`),
  timers (core `stepTimers`), the ingredient-list sheet, "I cooked this" with the pantry preview, and
  `cooking_mode_opened`. Screen on with `useKeepAwake`. `lib/timer-alerts.ts`: one local notification per running
  timer (`pantrila-timer-<id>`, replaced or cancelled as it changes; quiet while cooking mode is on screen, which
  rings itself), permission asked at the first timer; Android channel `timers`. `lib/cooking.ts`: progress in
  AsyncStorage for 12 h, `ring` / `chime` (expo-audio, plays in silent mode, plus a vibration). Voice:
  `lib/voice.ts` (`expo-speech-recognition` behind core's `VoiceListener`, on-device when the phone supports it;
  iOS restarts after each phrase, Android stays continuous) and `components/voice-control.tsx` (notice that names
  "stays on the phone" or Apple/Google, command list, "Allow the microphone" with Open Settings). `lib/stored.ts`
  keeps small per-user settings. New native modules `expo-keep-awake`, `expo-notifications`, `expo-audio`,
  `expo-speech-recognition` (plugins and permission texts in `app.config.ts`), so the next development build
  needs making. `jest.setup.js` stands in for all four; 36 Jest tests. For PR 8: the cookbook recipe page's "Start
  cooking" opens `/recipes/mine/<id>/cook`, already built.
- 2026-10-25: PR 8 (`feat/mobile-cookbook`): `recipes/mine` (list with "Where they came from"), `recipes/mine/[id]`
  (photo with "Making the photo…", New / Remove photo, credit to the creator and site, rule alerts, grouped
  ingredients with unit sheets, nutrition, method under its headings with °C/°F, Notes that open, Edit and Delete,
  "Back to the chat" for `?chat=<thread>`) and `recipes/mine/new` (post, link, photos, pasted text or the form;
  `?method=post|link` from Home). `components/cookbook-form.tsx` is the web's form (groups, `## Heading` method, notes,
  credit fields, unit sheet that converts, food chips, automatic AI estimates, live preview). `lib/import-jobs.ts`
  (jobs in AsyncStorage under `userKey(id, "import-job")`, polling that wakes on `AppState` active),
  `lib/photo-jobs.ts` (`makePhoto`, `usePhotoPending`, `saveNewRecipe`), `lib/images.ts` (camera or library, longest side
  1600 px, JPEG 0.85 as data URLs). Core gains `cookbook.ts` (`SOURCE_TEXT`, `PLATFORM`, `siteOf`, `postCredit`,
  `origins`, `BLANK_RECIPE`, `needsReview`, `matchFood`, `POST_LINK`, `importRows`, `clock`), used by the web too. The
  Toaster moved from the tabs to the root layout, so pushed screens show toasts; cooking mode keeps its own. Shared
  bits: `Button`, `OptionSheet`, `StartCooking`. 45 Jest tests (9 new), 61 core tests, 42 Playwright specs. For PR 9:
  start a shared post's import with `importRecipe(userId, { kind: "post", url })` and open `/recipes/mine/new` (it
  resumes the saved job); for PR 10: a chat draft can open the form through a new param on `recipes/mine/new`, and
  the saved recipe's `?chat=` leads back.
