# Status log

Every shipped change, newest first: what changed, where it lives, and the eval numbers before and
after (or why there was no eval run). Moved out of `CLAUDE.md` on 2026-10-26 to keep that file short;
`CLAUDE.md` keeps a summary of where things stand. Add each new entry at the top.

Paste a recipe on the web: the "Type it in" card on `/recipes/mine/new` is now "Type or paste" and opens a
"Paste a recipe" panel above the blank form (a text box and "Paste from clipboard"), which runs the existing text import
(`kind: "text"` job, `Importer.from_text`) like the phone app's "Paste text". A clean result saves straight away; anything
to fix opens in the form. Checked live on a formatted recipe (8 ingredients, 5 steps) and a messy message-style one
(5 ingredients, 3 steps). No prompt, schema or model change, so no eval rerun.

Android app links live: `ANDROID_CERT_SHA256` on Vercel holds Google Play's app signing key and the EAS upload key
(SHA-256), so `app.pantrila.com/.well-known/assetlinks.json` is served and recipe and plan links open the Android app.
A second Google Android OAuth client carries Play's signing SHA-1, so Google sign-in works in apps installed from Play.
This PR touches `web/` only to record the variable in `web/.env.example`, which also triggers the production build
the variable needs (the project skips builds when `web/` is unchanged). No model call, so no eval rerun.

EAS builds fixed (runtime version): every EAS build failed in "Configure expo-updates" with "Runtime version calculated on local machine not equal to runtime version calculated during build", since the fingerprint policy hashes the app config and `app.config.ts` reads `EAS_BUILD_PROFILE` (blocked permissions) and the `SENTRY_AUTH_TOKEN` secret (Sentry upload), which a Mac does not have. `runtimeVersion` is now `{ policy: "appVersion" }` ("0.1.0"): raise `version` with any native change so an update never reaches an older build (`mobile/README.md`). Config test updated. No model call, so no eval rerun.

Companion messaging: Pantrila is now pitched as "your AI cooking companion" (ask, save, cook; planning and
groceries support them), after an outside review of pantrila.com. Landing site: hero "Your AI cooking companion, from
idea to plate." with a shorter line, "Free to try · No sign-up needed · Free plan has AI usage limits", the assistant
screenshot in front (`home.jpg` removed) and less space above on phones; three benefits (Ask, Save, Cook) replace the
six-card grid; showcase order Ask, Save ("Saw a recipe on Instagram? Make it yours."), Cook, Plan and shop, each with a
link into the app (`/assistant`, `/recipes/mine/new?method=post`, `/recipes`, `/plan`); facts after the showcase;
safety copy no longer says "never shown" and says the checks rely on the ingredient list; FAQ gives the real Free
allowances and Pro's price. Web: sign-in returns to the page someone opened signed out (`lib/return-to.ts`,
`sessionStorage["pantrila-return-to"]`, own pages only; not after signing out in that tab), new login and metadata
copy (`return-after-sign-in.spec.ts`; 45 specs pass). Phone: welcome line and the first intro card ("Ask Pantrila").
Store listing: names "Pantrila: AI Cooking Companion", new subtitle, promo, keywords, descriptions led by Ask/Save/Cook,
and a companion-first screenshot upload order. README intro and the cold-start note (the uptime ping keeps the API
awake). Copy only apart from the return path; no model call, so no eval rerun. Follow-up: privacy and terms describe
Pantrila as an AI cooking companion, and the sharing image (`site/src/app/opengraph-image.jpg`, 1200x630) shows the
headline with the assistant and cooking-mode screenshots.

Launch (mobile plan PR 14): the landing site's store cards show Apple's and Google's official badges with links
(`site/public/badges/`; FAQ and "Get the app" copy follow) once `NEXT_PUBLIC_APP_STORE_ID` (the app's Apple ID, digits)
and `NEXT_PUBLIC_PLAY_STORE_LIVE=1` are set on Vercel, else "Coming soon" (`site/src/lib.ts`). The web app reads the same
two (`web/src/lib/stores.ts`): Safari's `apple-itunes-app` banner (root layout `itunes`), a closable "Pantrila for
Android" bar above the header on Android phones (`components/app-banner.tsx`, `pantrila-app-banner-off`) and store links
in the Pro sheet; Playwright builds with both set (`app-banner.spec.ts`; 43 specs pass). The phone app gains
`expo-updates`: `runtimeVersion: { policy: "appVersion" }` (was "fingerprint"; see the runtime version entry above), `updates.url` from the EAS project, channels
`development` / `preview` / `production` in `eas.json` (`eas update --channel production`; a native change needs a new
store build). README: "Phone apps" section, the app, RevenueCat and `packages/core` in the architecture diagram, phone
commands; the demo script gains sharing a reel into the app. 78 Jest tests (1 new). No model call, so no eval rerun.

Store readiness (mobile plan PR 13): `docs/store-listing.md` holds what goes into App Store Connect and Play Console:
names, subtitle, keywords, descriptions (`tests/test_store_listing.py` checks the character limits), categories, age
and content rating, the App privacy and Data safety answers (email, name, health info from allergies and diet, profile
picture, user content, user id, purchases, product interaction, diagnostics; no tracking, no ads), the in-app products
(suggested ids), review notes ("Try it as a guest"; Account, "Try Pro free for 7 days") and the screenshot list.
`mobile/.maestro/` has Maestro flows (guest sign-in, search, cook, plan, import, tag `e2e`; `screenshots.yaml`) run
by EAS Workflows (`mobile/.eas/workflows/e2e.yml`, `screenshots.yml`) on the new `e2e` build profile (iOS simulator
and APK, no credentials); written from the screens' labels, not yet run. Permission fix: `expo-image-picker`'s
`microphonePermission: false` blocked `RECORD_AUDIO` and dropped the iOS microphone text, so voice commands could not
use the mic; the texts are now constants in `app.config.ts`, secure store asks for no Face ID, and store builds block
`SYSTEM_ALERT_WINDOW` (`src/__tests__/app-config.test.ts`). The privacy page gains "Delete your account"
(`pantrila.com/privacy#delete-account`, Play's deletion link). `eas.json` submits Android to the closed track
(`alpha`). 77 Jest tests (3 new), 2 new Python tests; config changes, so the next build needs making. No model call, so
no eval rerun.

Phone paywall (mobile plan PR 12): `react-native-purchases` (`lib/purchases.ts`) sells Pantrila Pro through RevenueCat
as the Supabase user id (configured at sign-in, `logIn`/`logOut` from `AuthProvider`; off without
`EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `_ANDROID_KEY`). The paywall (`app/pro.tsx`, our own screen) opens at every Free
402 through `askForPro` (`lib/pro.ts`), from Account's plan card, the plan screen's once-a-week line and as "Welcome
back" for an expired store subscriber: what was used up and when it returns, what Pro gives, yearly first ("Save 50%",
price a month), "7 days free, then €29.99 a year" above the button, the store's renewal terms, Restore purchases, Terms
and Privacy; a guest is asked to keep their data with Google or Apple first. After buying it asks `/me` until the
webhook has made the person Pro (up to 30 s); a trial gets a local reminder 2 days before it ends. Account shows
"Manage subscription" (the store's page). Words shared in `@pantrila/core/subscription` (web's Pro sheet uses them).
API: `POST /me/events` takes `paywall_shown` and `paywall_closed`; the webhook adds `source` (the subscriber
attribute `paywall_reason`) to `trial_started` and `subscribed`. 74 Jest tests (10 new), 71 core tests, 1 new Python
test; a new native module, so the next development build needs making. No model call, so no eval rerun.

Phone pantry, profile and account (mobile plan PR 11): the header's account button (the person's upload, else their
Google picture, else the emoji; `components/avatar.tsx`) opens Account: Pantry and Profile, "Your plan" (Free or Pro,
what is left), keep a guest's data with Google or Apple, sign out, Help ("Show the intro again", "Send feedback") and
Delete account (type "delete": `DELETE /me`, then the phone forgets its data and signs out locally). `app/pantry.tsx`
is the web's Pantry (foods offered as you type, "Did you mean", tap a food to change its amount); `app/profile.tsx`
the web's Profile (picture taken or picked, square, 512 px JPEG; allergies, diet, foods never eaten, energy as one
number or a range, protein, carbs, days, meals, cuisines, tastes). Three-card intro (`app/intro.tsx`) once per person
(`pantrila-intro-done:<user>`). `@sentry/react-native` (`lib/sentry.ts`): errors and feedback to Sentry EU when
`EXPO_PUBLIC_SENTRY_DSN` is set, user id only, source maps uploaded only with `SENTRY_AUTH_TOKEN`. API: the phone
sends `X-Pantrila-Client: ios|android` (core `createApi({ headers })`), and `analytics.py` adds `client` to PostHog
events (visits, imports and import jobs, plans, `/me/events`); CORS allows the header, the web does not send it yet.
Privacy and terms name the apps, camera and photos, speech recognition and local notifications. 64 Jest tests (7
new), 67 core tests, 1 new Python test; a new native module, so the next development build needs making. No model
call, so no eval rerun.

Phone assistant chat (mobile plan PR 10): the Assistant tab is the web's chat. It streams `POST /chat/stream` through
core's `streamChat` on `expo/fetch` (step label, then the reply as it is written with found recipes titled, then the
saved reply), lists saved chats in a "Chats" sheet (New chat, delete with a confirm), remembers the last chat per user
(`userKey(id, "chat-thread")`) and asks Home's `?q=` in a new chat or opens `?thread=`. Replies show the profile check,
tool summaries, citations as links, recipe cards with "Let's cook this!" at the reply's servings, and each recipe the
assistant wrote with its warnings and "Save to My recipes" (the draft goes to `recipes/mine/new?from=chat` through
`lib/chat-draft.ts`; saved, it reads "Saved to My recipes as …" and the recipe leads back with `?chat=`). A mic beside
Send types speech into the box (`components/dictate-button.tsx`, PR 7's `phoneListener`; also on Home's card). The
web's reply reading moved to `@pantrila/core/chat` (citations, lists, lines that only cite, draft tags, the reply in
flight), now used by the web too (all 42 Playwright specs pass). 57 Jest tests (6 new), 66 core tests. No new native
module. No API or model change, so no eval rerun.

Share to Pantrila and app links (mobile plan PR 9): the phone app is in the share sheet ("Save to Pantrila" on iOS,
an extension from `expo-share-intent`; Pantrila on Android) for links, text and up to 4 photos. `ShareHandler` (root
layout) turns a share into an import (`lib/share.ts`) and opens `recipes/mine/new`, which starts it at once: a post
link (core's `POST_LINK`) or another link, photos (shrunk on the phone) or text; a shared video says to share the
post's link. Signed out, the share waits ("Sign in to import the recipe you shared") and runs after sign-in.
`+native-intent.tsx` routes iOS's share link. `https://app.pantrila.com/recipes/...` and `/plan` open in the app
(`associatedDomains`, an Android `autoVerify` filter); the web serves `/.well-known/apple-app-site-association` and
`/.well-known/assetlinks.json` from `APPLE_TEAM_ID` and `ANDROID_CERT_SHA256` (404 until set; `web/src/lib/app-links.ts`)
and `proxy.ts` skips `/.well-known`. Owner steps in `docs/share-and-links.md`. 51 Jest tests (6 new), all 42
Playwright specs pass; a new native module and extension, so the next development build needs making. No API or
model change, so no eval rerun.

Phone cookbook and imports (mobile plan PR 8): `recipes/mine` lists the person's recipes ("Where they came from");
`recipes/mine/[id]` shows the photo (made in the background after saving, "Making the photo…", New / Remove), the
creator's credit and site, rule alerts, grouped ingredients, nutrition, the method under its headings, Notes, Edit
(the web's form: groups, `## Heading` lines, notes, credit, unit sheet that converts, food chips, automatic AI
estimates, live preview) and Delete, and "Back to the chat" for `?chat=`. `recipes/mine/new` imports a post, a link,
photos (camera or library through `expo-image-picker`, shrunk to 1600 px JPEG by `expo-image-manipulator`) or pasted
text (a fifth way, phone only) as background jobs: the id is saved under `userKey(id, "import-job")` before the
request, the steps show live, and a job left running is picked up again ("Finishing your import…", also on Home). A
draft is saved straight away unless `needsReview`. Core gains `cookbook.ts` (source texts, credit, `matchFood`,
`needsReview`, `POST_LINK`, `importRows`...), now used by the web too (all 42 Playwright specs pass). Toasts moved to
the root layout so pushed screens show them. 45 Jest tests (9 new), 61 core tests; two new native modules, so the
next development build needs making. No API or model change, so no eval rerun.

Phone cooking mode (mobile plan PR 7): `recipes/[id]/cook` and `recipes/mine/[id]/cook` open a full-screen cooking
mode like the web's: get-ready page with servings (and leftovers "for later" from the plan), grouped checklist, one
step at a time with group heading, preheat hint, "for this step" chips, timers, the ingredient sheet and "I cooked
this" with the pantry preview; progress stays on the phone for 12 h under the web's key shape (sign-out forgets
it). The screen stays on (`expo-keep-awake`). Each running timer schedules a local notification
(`expo-notifications`, asked at the first timer) so it rings with the phone locked or the app closed; pausing,
changing or dismissing replaces or cancels it, and on screen the app rings itself (`expo-audio`, WAVs from
`scripts/cooking_sounds.py`, plus a vibration). Voice commands go through `expo-speech-recognition` and core's
`voiceCommand`, on-device when the phone can (the notice then says speech stays on the phone, else names Apple or
Google), with an "Allow the microphone" sheet that opens Settings. Sends `cooking_mode_opened`. Android timers use
exact-while-idle without the exact-alarm permission; the owner's phone check decides if that is enough. Web: "1 of
these serving is" now reads "servings is". 36 Jest tests, 1 new Python test; four new native modules, so the next
development build needs making. No model call, so no eval rerun.

Phone meal plan and grocery list (mobile plan PR 6): the Plan tab makes a plan through `POST /plans` (core's
`streamPlan` on `expo/fetch`: the planner's steps, then the plan), shows the allowance left, the plan's note and
warnings, each day's meals and its energy (one number or the range band), protein and carbs, and how the plan was
made. Each meal's menu (`MealSheet`, one sheet whose content changes) swaps it (Pantrila's or My recipes, search,
"30 min or less", "Uses my pantry", Show more), repeats it on later days, starts cooking with every serving and the
leftovers' count, adds its recipe back, eats out (Light / Normal / Big / not counted), uses leftovers of an earlier
meal or skips it, all through the existing plan routes. Grocery tab: by aisle, people stepper, ticks kept per
user and plan on the phone, estimated foods of the person's recipes apart, what the pantry covers. Core gains
`cookHref`, `leftoverDays` and `grocery.ts` (`byAisle`, `aisleName`), now used by the web too (all 42 Playwright
specs pass). 31 Jest tests (9 new), 55 core tests. No API or model change, so no eval rerun.

Phone app shell, Home and Recipes (mobile plan PR 5): the signed-in app is five tabs (`mobile/src/app/(tabs)/`,
`expo-router/js-tabs`: Home, Assistant, Recipes, Plan, Grocery, the web's order) with an account button in the
header (Google/Apple picture or the emoji avatar; opens `account.tsx`). The tabs ping `/health` on start and show
"Waking up the Pantrila server…" while a request waits on a sleeping server (`lib/waking.ts` behind `createApi`'s
`onSlow`, the web's 3 s / 10 min rule). Home: greeting, Ask Pantrila (opens the Assistant tab with `?q=`), My
recipes (latest 4 or the import pitch). Recipes: search, Meal/Time/Diet/Cuisine chip rows, the "Only what suits
me" banner, an infinite list (`GET /recipes` gains `offset`; a search stays one page). Recipe page: photo, the
rules it breaks, allergens marked for the person, servings, a unit sheet per ingredient, macro ring, method with
°C/°F (kept per user), fan-oven settings and fractions from core, "Start cooking". Pull to refresh, empty and error
states. Assistant, Plan, Grocery, My recipes, imports, cooking mode, Pantry and Profile say they are coming (their
PRs). New dependencies `lucide-react-native` and `react-native-svg` (native, so the next development build needs
remaking). 22 Jest tests (screens through `expo-router/testing-library` with a fake API); `expo export` bundles iOS
and Android; `expo-doctor` 20/20; 1 new Python test. No model call, so no eval rerun.

Phone sign-in (mobile plan PR 4): the Expo app signs in like the web: Continue with Google (Google's native sheet,
`@react-native-google-signin/google-signin`, id token to `signInWithIdToken`), Continue with Apple (iPhone only,
`expo-apple-authentication` with a SHA-256 nonce; the name Apple sends once is saved), "Try it as a guest", and an
email link that opens `pantrila://auth/callback` (PKCE code exchanged on the phone). A guest keeps their data with
Google or Apple (`linkIdentity` with the id token; "already has its own Pantrila account" as on the web). The session
is stored encrypted (`LargeSecureStore`: AES key in `expo-secure-store`, data in AsyncStorage) and refreshed only
in the foreground; each user gets a fresh SWR cache, and sign-out forgets their `userKey` storage. Routes:
`Stack.Protected` with `welcome` (signed out) and `index` (signed in, with `AccountCard`). New public EAS variables
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (buttons hidden without them).
`docs/apple-sign-in.md` is new; `docs/google-sign-in.md` gains the phone clients and "Skip nonce checks" (needed for
Google's iOS SDK). 11 Jest tests; iOS and Android bundles export; `expo-doctor` 20/20. Not yet tried on a phone (needs
the owner's dashboard steps and a new development build). No model call, so no eval rerun.

Subscription tiers (mobile plan PR 3): Free and Pantrila Pro in the API. Migration `20261025120000_entitlements`
(applied on Supabase): `entitlements` (one row per person who has or had Pro; no row is Free; `store='manual'` rows
are given by hand and never removed by a webhook), `subscription_events` (handled webhook ids) and usage kind
`estimate` (food estimates no longer count as imports; `PANTRILA_DAILY_ESTIMATES`). `entitlements.py`: `tier_of`
(`PANTRILA_PRO_USERS`, else an active row), `from_subscriber` (RevenueCat REST v1 subscriber, entitlement `pro`:
trial, active, grace, expired; `will_renew`). `POST /webhooks/revenuecat` checks `REVENUECAT_WEBHOOK_SECRET`, then
reads each named user from RevenueCat (`REVENUECAT_API_KEY`) and stores that, so replays and out-of-order events are
harmless; PostHog gets `trial_started`, `subscribed`, `renewed`, `cancelled`, `expired` once per event id.
`operations.allowance(kind, tier)`: Free 1 plan a week, 5 imports a month, 10 chats a day, no AI photos
(`PANTRILA_FREE_*` and `_WINDOW`), Pro the `PANTRILA_DAILY_*` caps (chats now 50); a Free cap is a 402
`{detail, code: "pro_required", feature, resets_at}`, a Pro cap a 429. `/me` and `/me/usage` gain `subscription`, and
`limits` is now `plans|chats|imports|photos: {limit, left, window, resets_at}`. Account deletion also deletes the
RevenueCat subscriber. Web: Pro badge in the account menu, "Your plan" card on Profile, "Get Pantrila Pro in the app"
sheet (`components/pro-sheet.tsx`, opened by `askForPro` in `lib/pro.ts`) at a 402, no automatic photo on Free, and
the delete card says to cancel a store subscription first; core gains `ApiError.pro` and `subscription.ts`. Privacy
lists RevenueCat; terms gain a Free/Pro section. Owner: `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_API_KEY`,
`PANTRILA_PRO_USERS` on Render, the RevenueCat webhook URL. No model call, so no eval rerun.

EAS project linked (mobile plan PR 2, owner part): `@mikegauci/pantrila`, id `b60bab44-4784-4b21-8ba2-e8aed45df863`
in `EAS_PROJECT_ID` (`mobile/app.config.ts`). First Android development build finished on EAS (build
`54f04176-a9c9-4192-969a-3b008ab94c5b`, EAS-made keystore, APK
https://expo.dev/artifacts/eas/T1kt9jzEW5Evw4BQdJRkGQwfnGwy50zvWMYDsxkOrQI.apk); not yet installed, as there is no
Android phone to hand. iPhone waits for Apple to activate the Developer team. No app code
change, no model call, so no eval rerun.

Expo app skeleton (mobile plan PR 2): `mobile/` is an Expo SDK 58 app (Expo Router, React 19.3 and React Native
0.88; one copy of each in the root install, shared with web) in the npm workspaces. `app.config.ts`: Pantrila,
`com.pantrila.app`, scheme `pantrila`, phones only, portrait, light and dark, icon/adaptive icon/splash rendered from
`web/brand/` by `web/scripts/icons.mjs` into `mobile/assets/`; `EAS_PROJECT_ID` is set (see the EAS entry above). `eas.json`: `development` (dev client, internal), `preview`, `production`, with the public API and
Supabase URLs in `env`. Styling is Uniwind (Tailwind 4 classes) instead of the planned NativeWind: NativeWind 4.2.7
needs Tailwind 3, which replaced web's Tailwind 4 at the root of the shared install, and lists SDK 57 at most. The
tokens are copied into `mobile/src/global.css` (light/dark `@variant`s, radii, Plus Jakarta Sans as `font-sans`,
`-medium`, `-semibold`, `-bold`; `web/DESIGN_SYSTEM.md` says to keep three copies in sync). The one screen
(`src/app/index.tsx`) shows `/health` and `/meta` through `createApi` with `expo/fetch` (`src/lib/api.ts`; core gains
`health()`); `/meta` says "Sign in first." until sign-in (PR 4). Jest (`jest-expo`, RNTL 14) has one screen test; CI
gains a `mobile` job (lint, typecheck, Jest, `expo-doctor`). Checked here: `expo export` bundles iOS and Android,
`expo-doctor` 20/20, web's 41 Playwright specs still pass. No model call, so no eval rerun.

Shared core for the phone app (mobile plan PR 1): the repo root is an npm workspace (`web`, `packages/*`; `site/`
stays separate) with one root `package-lock.json` (same versions as the old `web/` one). `packages/core`
(`@pantrila/core`, TypeScript source imported as `@pantrila/core/<module>`, `transpilePackages` in
`web/next.config.ts`) now holds the API types, `amounts`, `sections`, `plan`, `format`, `avatar`, the pure parts of
`cooking` (timers, preheat hints, `stepUses`, progress types), `temperature` and `voice` (`voiceCommand`, `micHelp`),
`sse.ts` (`EventParser`, `readEvents` on any ReadableStream, so `expo/fetch` works) and `api.ts`
(`createApi({ baseUrl, getToken, onSlow, fetch })`, `ApiError`). `web/src/lib` keeps the hooks, `localStorage`, wake
lock, sounds, the browser speech listener and `api.ts`, which wraps `createApi` with the Supabase session and the
wake-up toast. `globals.css` adds `@source` for core so its avatar tints stay in the CSS. 49 Vitest tests in
`packages/core/test`; CI gains a `core` job, and the web job installs from the root and also runs on
`packages/**` changes. No visible change (all 41 Playwright specs pass); no model call, so no eval rerun.

PostHog session replay, on by default (owner's choice, opt-out): every signed-in visit is recorded unless the
person turns off "Record my visits" in Profile (`localStorage["pantrila-replay:<user>"]="off"`); there is no prompt.
`web/src/components/replay-consent.tsx` (`ReplaySession`) starts or stops it with the session; `web/src/lib/replay.ts`
loads posthog-js 1.438.7 (EU, through the `/ingest` rewrite in `next.config.ts`, skipped by `proxy.ts`): replay only
(no autocapture, page views, heatmaps, surveys or flags; remote config stays on, which replay needs), inputs masked but
on-screen text shown (owner's choice), `$geoip_disable`, identified by the Supabase user id so replays join the server
funnel person. Signing out or deleting stops and resets it; account deletion also sends `delete_recordings`. Needs
`NEXT_PUBLIC_POSTHOG_KEY` (the `phc_` project key, set on Vercel). Privacy page says recordings are on unless turned
off. Note for a wider EU launch: ePrivacy expects consent before recording, and recordings show allergies and diet.
Playwright builds with a fake key, so every spec presets `pantrila-replay:<user>=off`; `replay-consent.spec.ts` uses a
desktop Chrome user agent because PostHog drops headless browsers as bots. No model call, so no eval rerun.

PostHog funnel: the API sends sign-up -> first import -> first plan -> cooking mode -> return events to PostHog EU
(`analytics.py`, `POSTHOG_API_KEY`; off when unset), keyed by the Supabase user id only: no browser SDK, no cookies,
geoip off, no email or content. `current_user` calls `Visits.seen` once per person per day per process; migration
`20261023150000_user_activity` keeps one row per active day (applied on Supabase), giving `signed_up` (first day),
`app_opened` (daily, for retention) and `returned_within_7_days` (the second day, if within 7 days). The import routes
and jobs send `recipe_imported` (kind), POST /plans `plan_created`, and cooking mode posts `cooking_mode_opened` to
`POST /me/events` (allowlist). Funnels use each event's first occurrence. Account deletion also deletes the PostHog
person and events (`bulk_delete`, needs `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID`) and `user_activity` rows.
People active before this shipped count as signing up on their first day after it. Privacy page lists PostHog. No
model call, so no eval rerun.

Sentry and feedback: API errors (unhandled and `log.exception`) and 10% of requests as traces go to Sentry EU when
`SENTRY_DSN` is set (`config.init_sentry`: no PII, no request bodies; `current_user` sets the user id only). The web
app uses `@sentry/nextjs` 11 (`instrumentation-client.ts`, `instrumentation.ts`, `app/global-error.tsx`;
`withSentryConfig` from `@sentry/nextjs/config` uploads source maps only with `SENTRY_AUTH_TOKEN`; reports go through
the `/monitoring` tunnel, which `proxy.ts` skips) when `NEXT_PUBLIC_SENTRY_DSN` is set; no Session Replay, no trace
headers on API calls (`tracePropagationTargets: []`, the API's CORS allows only its own headers). "Send feedback"
(account menu and Profile Help, `components/feedback.tsx`) sends `Sentry.captureFeedback` with the page and an
optional reply email (prefilled with the account's); without a DSN it shows hello@pantrila.com. Privacy page lists
Sentry. Playwright runs with a fake DSN and intercepts `/monitoring`. No model call, so no eval rerun.

Import jobs in the database: background imports (`POST /me/recipes/import/jobs`) now live in `import_jobs`
(migration `20261023120000_import_jobs`, RLS) instead of one process's memory (`DbImportJobs`; `MemoryImportJobs`
for tests). Each server process has an owner token and a 90 s lease on the jobs it runs, renewed every 20 s by
`keep_jobs`; on a clean shutdown it gives the leases back, and any process takes over lapsed jobs
(`claim_stale`, `for update skip locked`) and runs them again from the saved request on the same allowance
reservation (`PaidOperation.resume`), so a deploy no longer kills imports and an import is charged once. Writes
carry the owner token, so a process that lost a job cannot change it. After 3 runs a job fails with "try again" and
its allowance is given back. Photos in a request are removed when the job ends; rows go after an hour (privacy page
says so). No prompt/model change, so no eval rerun; new `tests/test_import_jobs.py` (memory and Postgres) and an API
take-over test. Apply the migration on Supabase before deploying.

Account deletion: Profile ends with "Delete account" (type "delete" to confirm). `DELETE /me` (`accounts.py`)
deletes, at once and with no grace period, the person's Storage folders (`user-recipes/<id>/`, `avatars/<id>/`, via
`PhotoStore.delete_folder`), their rows in every user table (`USER_TABLES`, one transaction; a test checks the list
against the migrations), then the Supabase Auth user (admin API, service role key). Each step is idempotent, so a
502 part way is fixed by retrying; 503 without the service role key, 409 while an import job runs. The web forgets
local and session storage keyed by the user id and signs out locally. Privacy page says so. No model call, so no
eval rerun; 4 new Python tests, 1 Playwright test (`web/tests/delete-account.spec.ts`).

Landing site word switch: the "Instagram / Facebook / TikTok" word in the Save section (`site/src/components/flip-word.tsx`) now rolls like a slot-machine reel (old word slides up and out, the next slides up from below, spring about 0.35 s, box eases to the new word's width) instead of fading, and each platform takes its own colour (pink, blue, teal). Landing site only, no model call, so no eval rerun.

My recipes on Home: a section after "Ask Pantrila" (`web/src/components/my-recipes-home.tsx`) shows the latest 4
cookbook recipes ("N saved", "See all") and two buttons, "Import from a post" and "From a recipe link", which open
`/recipes/mine/new?method=post|link` on that method (the page reads `?method=` once and drops it). With no recipes
yet it is a yellow pitch card for importing from TikTok, Instagram, Facebook or a recipe site. Web only, no model
call, so no eval rerun; new `web/tests/home-my-recipes.spec.ts`.

Faster assistant replies: a message that asks for recipes (`assistant.presearch_args`, words only: a meal, "recipe",
"idea", "something"...; not a how/what question, a recipe id, the model's own recipe, a swap, scaling or a pantry change)
is searched in code first, with meal type and "N minutes" from its words and the profile's rules as filters, and the
results go to the model as its own `search_recipes` call (`ToolCall.by_code`), so most recipe asks take one model call
instead of two. The prompt says to use those results and search again only if they miss. `POST /chat/stream` (SSE, as
`/plans`: `step` labels, `recipes` cards found, `delta` text, then `reply` or `error`; `/chat` stays for other callers)
streams the turn (`Assistant.reply(on_event=)`, Responses API `stream=True`); the web chat shows the step label, then the
reply as it is written with found recipes already titled (`streamChat` in `web/src/lib/api.ts`). Eval times the first
words of the reply. Before `assistant-2026-10-23T115735Z` vs after `assistant-2026-10-23T121004Z`, 30 cases: right tools,
pantry, cited and drafts 100% both, 0 unsafe or made-up citations both, 14 of 30 searched in code, model calls per turn
1.9 -> 1.5, $0.0035 -> $0.0030/turn, p50/p95 5.1/8.8 -> 3.9/8.1 s, first words 3.3/6.4 s (before: the whole reply). A first
after run that also searched on "I bought tofu. Find me a dinner" skipped `update_pantry` (pantry 75%), so pantry
messages are left to the model. Live: "I want stir fry with beef for lunch" took one model call, first words at 3.0 s.

Microphone help: when the browser blocks the mic, cooking mode opens an "Allow the microphone" sheet (instead of a
toast) with steps for the browser in use (`micHelp(userAgent, touch)` in `web/src/lib/voice.ts`: Safari, Chrome,
Firefox or Edge on iPhone/iPad, including turning on Dictation; Chrome on Android; Safari on Mac; Chrome/Edge on
desktop) and a "Try again" button. Web only, no model call, so no eval rerun; 2 new Playwright tests.

Assistant recipe drafts: a second chat draft saved the first one, since the hidden-but-mounted new-recipe page kept its
form; each draft now gets a fresh form (`formKey`). Save carries the thread (`?from=chat&thread=`), and the saved recipe
shows "Back to the chat" (`?chat=` on `/recipes/mine/[id]`). A recipe saved from a chat keeps `chat_draft`
("<thread>:<FNV hash of the draft as written>", in the recipe JSON, no migration; on `CookbookCard`), and the chat
shows that draft as "Saved to My recipes" with a link instead of the button. Prompt: every recipe of its own that a
reply shows gets a write_recipe call, including a changed version of an earlier one. Assistant eval gains multi-turn
cases (`before`: earlier messages, last turn scored) and `write-then-change-dish` / `write-then-tweak`, 30 cases. Before
`assistant-2026-10-23T110555Z` vs after `assistant-2026-10-23T110643Z`: both new cases fail -> pass (4/4 reruns), 0
unsafe or made-up citations both, `chocolate-cake` missed its draft once after (3/3 on rerun; 4/4 before), $0.0035/turn,
p50/p95 4.6/7.7 s. Also: replies link each recipe they cite or scale to its page and cook mode, no longer show latency
and cost, and wrap instead of overflowing on phones; Insights drops the AI usage panel and its evals card shows the new
report.

Landing site animations: `site/` gains Motion (`motion/react`, `LazyMotion` + `m.*` only, `MotionConfig
reducedMotion="user"`; `src/components/motion.tsx`: `Reveal`, `StaggerList`, `CountUp`, `usePhases`). Hero glow
drifts, the screenshots rise in, the phone floats and the pair tilts towards a mouse (`hero-art.tsx`); facts count up;
sections and cards reveal on scroll; each "up close" screenshot carries a looping demo card (`demos.tsx`: plan day
filling, assistant reply, post import steps, voice timer), played only while on screen and shown finished under
reduced motion; Safety ticks off the 14 EU allergens (`allergen-check.tsx`); the header turns frosted once scrolled
(`scroll-header.tsx`); buttons press and their arrows nudge; FAQ answers slide (CSS `interpolate-size`, Chrome/Edge).
The cooking demo's mic pulse is a CSS animation (`.mic-pulse`), so demo phase changes never restart it; the store
cards show the Apple and Google Play marks (Simple Icons, CC0). Landing site only, no model call, so no eval rerun.

Old address retired, custom domain phase 5: `web/src/proxy.ts` redirects `pantrila.vercel.app` and
`pantrio-azure.vercel.app` to `https://app.pantrila.com` (308, path and query kept); guests who never linked Google
start over there, by the owner's choice. Render `PANTRILA_CORS_ORIGINS` is `https://app.pantrila.com` plus
localhost. No model call, so no eval rerun.

Google branding, custom domain phase 4: `pantrila.com` verified in Search Console; the OAuth app is published (it had
stayed in Testing because a client listed `http://localhost:3000`, now removed) and its branding (name, logo,
pantrila.com home, privacy, terms) is verified, so the Google screen shows Pantrila. All five phases of
`docs/plans/custom-domain.md` are done. Dashboard settings only, no code change.

Branded auth emails: `scripts/email_templates.py` (layout in `scripts/email_layout.html`) writes the Supabase
"Confirm signup", "Magic link" and "Change email address" templates and their subjects to `supabase/templates/`
(README there says where to paste them; the owner pastes them into the dashboard). Table-based HTML with inline
styles in the design-system colours, logo from `https://pantrila.com/email/logo.png` (`site/public/email/`), a
green button, the expiry note and a plain link fallback. A test checks the committed files match the generator. No
model call, so no eval rerun.

Sign-in email, custom domain phase 3: Supabase Auth sends through Resend (custom SMTP `smtp.resend.com:465`, sender
`no-reply@send.pantrila.com`, domain `send.pantrila.com` verified, EU region; 30 emails/hour), so magic links reach
anyone, not only the Supabase team; checked with a link to `hello@pantrila.com`. `hello@pantrila.com` is a FastComet
mailbox (MX `depro4.fcomet.com`, SPF and cPanel DKIM in Vercel DNS). Dashboard settings only, no code change.

Landing site, custom domain phase 2: `site/` is a separate static Next.js app (Vercel project `pantrila-site`,
root `site/`) on `pantrila.com` (`www` redirects): features, safety, "Get the app" (browser; App Store and Google
Play "Coming soon"), FAQ, `/privacy` and `/terms` (contact `hello@pantrila.com`, no inbox yet). Tokens and logo are
copied from `web/` (keep in sync); screenshots in `site/public/screens/` were taken from the live app with a guest
account. CI gains a `site` job; production builds of both Vercel projects skip when their folder is unchanged (previews always build). The app's login
page links to the terms and privacy. No model call, so no eval rerun.

Custom domain, phase 1 (plan `docs/plans/custom-domain.md`): pantrila.com's nameservers moved from GoDaddy to Vercel
(GoDaddy stays the registrar; it held only parking records). The web app is on `app.pantrila.com` (Vercel project
`pantrila`) and the API on `api.pantrila.com` (Render custom domain, CNAME in Vercel DNS); `NEXT_PUBLIC_API_URL` on
Vercel and `PANTRILA_CORS_ORIGINS` on Render point at them, Supabase Site URL is `https://app.pantrila.com` and Google
allows it as an origin. `pantrila.vercel.app` and `pantrio-api.onrender.com` keep working until phase 5 redirects the
old web address. Next: the `site/` landing page on `pantrila.com` (phase 2). No prompt/model change, so no eval rerun.

Dish-name match, video too: a method heard from a post's video (`HEARD`) is replaced by a recipe found for the dish (corpus, else the web search), the same way as a caption with no method; the video's ingredients stay and the notes say where the method is from. Reel eval before `reel-2026-10-22T133955Z` vs after `reel-2026-10-22T134102Z`, 9 cases: food matching 100% both, 0 missed allergens both, method 100% both, same service calls; the eval does not check which method was used, so the replacement is covered by `test_a_method_heard_from_the_video_gives_way_to_a_recipe_found_for_the_dish`. Triggered by recipe 24 (a short preview gave a guessed method).
Dish-name match: a caption that names a dish and lists ingredients but gives no method (`from_post` ends with `NO_METHOD`) takes its method from a Pantrila recipe with the same dish words and at least half the same foods (`Importer._matched`, the shipped corpus, no model call), else from the recipe page one OpenAI web search finds (`_web_method`: `from_link`, only its steps are used). The creator's ingredients stay; each food the two lists disagree on is noted (`_with_method`). Saved straight away; the notes say where the method is from. Web search is priced by `PANTRILA_PRICE_WEB_SEARCH_PER_CALL` (unset: cost unknown). Eval: 4 `caption-dish-*` cases; `run_import --no-match` is the before. Before `import-2026-10-22T130514Z` vs after `import-2026-10-22T130618Z`, 31 cases: method found for a caption's dish 0% -> 75% (3 of 4; the oyakodon search found no page once, and found one on a rerun), 0 missed allergens both, food matching 99% both, lines kept 100% -> 96% and servings/time 100%/100% -> 96%/93% on non-dish pages (same code path; single runs), p50/p95 5.4/12.5 -> 5.7/17.6 s. Average tokens per import 3,177/1,063 -> 4,729/1,054 (the page text); the search fee is not in the run's cost. 8 new offline tests (in `tests/test_social.py`), 2 existing tests updated for the extra call.
Voice commands in cooking mode: a mic button in the cooking header (`web/src/components/voice-control.tsx`) listens
for "next", "back", "start timer" and "stop timer" through the browser's speech recognition (`SpeechRecognition` or
`webkitSpeechRecognition`; hidden where neither exists). Words map to commands in code (`voiceCommand` in
`web/src/lib/voice.ts`, platform-free so a native app can reuse it behind its own `VoiceListener`). "Start timer" resumes
the latest paused timer, else starts the step's next timer; "stop timer" (or "stop") clears a finished timer, else pauses
the latest running one. Each command chimes (`chime` in `cooking.ts`) and shows a 2 s label. On the get-ready page, "start" or "start cooking" opens
step 1 (not in the commands list; ignored on other pages). The first turn-on shows a
notice that the browser sends speech to Google or Apple (`localStorage["pantrila-voice-ok"]`); the mic stays on across
visits (`pantrila-voice`), stops when the page hides (locked phone) and resumes on return; listening restarts after the
browser ends it, giving up after 5 quick ends. A one-time tip (`pantrila-voice-tip-done`), a "?" command list, and a new
tour step ("Cook hands-free", pointing at the mic in the vegetable paella's cooking mode) explain it. Web only, no model call, so no eval rerun; new
`web/tests/voice-commands.spec.ts` (fake microphone), tour spec updated; all 32 Playwright tests pass locally. Not yet
checked on a real phone's microphone.

Energy range: `NutritionTargets` gains `min_kcal` / `max_kcal` (either end may be open; a range replaces `kcal`; floor
above ceiling is a 422). Inside the range a day meets the target and costs nothing in portion fitting, so normal
portions stay; outside, the cost is the distance past the nearer end (`constraints._target_cost`, soft "kcal" warning
"1450 kcal, target 1600-1900 kcal"). Prompts use `NutritionTargets.kcal_text()`: one number reads exactly as before
("2000 kcal"), so the 16 existing planner profiles and every chat case get byte-identical prompts; a two-ended range
adds "(any day inside the range is fine; aim for about 1750)". Profile page: "One number / A range" switch (range
prefilled at +/-10%); the plan's Energy bar draws the range as a band. Eval: 4 range profiles (`range-weight-loss`,
`range-maintenance`, `ceiling-only`, `floor-only`), new "Days meeting the energy target" metric, and
`evals.run_planner --range-as-target` (the range given as its middle, as people had to before). Before
`planner-2026-10-22T113728Z` vs after `planner-2026-10-22T113756Z` on `gpt-5.4-mini`: 0 hard violations both, days
meeting the energy target 81% -> 100%, plans meeting every target 2/4 -> 4/4, kcal error against the middle 0% -> 5%
(any day inside counts), distinct recipes 98% -> 83%, $0.0061 -> $0.0087/plan (one repair), p50/p95 13.8/17.1 ->
14.3/21.6 s (single runs). 1 new Playwright test (`web/tests/energy-range.spec.ts`).

Meal prep (repeat a meal): the meal menu's "Repeat on other days" sheet (`web/src/components/repeat-meal.tsx`) turns
chosen meals on later days into leftovers of one cooked meal through `PUT /plans/latest/meals/{day}/{meal_type}/repeat`
(`meal_swap.repeat_meal`: up to 12 meals, all or none, each with `set_slot`'s leftovers checks; only a cooked meal
repeats). The cooked meal shows "Leftovers for day 2, 3"; its menu's "Start cooking" opens cooking mode with
`?servings=` for every portion (own plus leftovers, rounded up) and `&later=`, which cooking mode states ("2 of these
servings are for later"). The grocery list already buys for leftovers. `useSavePlan` moved to `lib/hooks.ts`. No
model call, so no eval rerun; 2 new Python tests, 1 API test, 1 Playwright test.

Plan meal choices: a plan meal now has a `kind` (`SlotKind`: recipe, leftovers, skipped, eating_out) on
`PlannedMeal`, inside the plan JSON, so no migration; the planner still only makes recipe meals (its `DraftMeal`
output is unchanged, so no eval rerun). Each meal's menu on the Plan page (`web/src/components/meal-menu.tsx`) swaps
it, adds its recipe back, eats out (Light ~500, Normal ~800, Big ~1200 kcal, or not counted; only kcal is added to
the day), uses leftovers of a meal cooked on an earlier day (counted and bought, not a repeat), or skips it. Skipped
and eating-out meals keep their recipe for "Add back" and are never flagged by rules. A meal with leftovers cannot be
skipped or eaten out until they change; swapping it moves its leftovers to the new recipe. `PUT
/plans/latest/meals/{day}/{meal_type}/slot` (`set_slot`) does the changes. Cookbook recipes join a plan as
`mine-<id>` through `meal_swap.PlanCatalog` (`cookbook.plan_recipe`; food rules only, not their meal types); their
estimated foods are listed apart on the grocery list (`GroceryList.unlisted`). The swap sheet has Pantrila's
recipes / My recipes, search over title, cuisine and foods (in code, free), "30 min or less" and "Uses my pantry"
filters, Show more (pages of 6, up to 24) and the day's protein change (`/options?source&q&quick&pantry&offset&limit`).
Skipping does not refit the day's other portions. 8 new Python tests (427 pass), 3 new Playwright tests (all 28 pass locally) (`web/tests/plan-slots.spec.ts`).

Dead-code cleanup: removed the 20 eval reports no doc cites (intermediate assistant and reel runs, raw live
captures), unused Python leftovers (`config.EMBED_DIM`, `SearchResult.timings_ms`, an unused eval constant and test
helper), seven unused shadcn components (badge, card, progress, select, separator, tabs, tooltip) and unused parts of
avatar, dropdown-menu and sheet. Found with vulture, knip and deptry, each hit checked by hand. No behaviour change, so
no eval rerun.

Login page for real users: the sign-in page drops the "owner only" email box and demo wording. "Welcome to
Pantrila" leads with a white Google button (Google's neutral style), an "or" divider, then "Try it as a guest";
email sign-in is a "Prefer email? Sign in with a link" line that opens the form. Email links go out
through Resend (custom SMTP, see the sign-in email entry above). Avatars (header menu and
Profile) fall back to the Google profile picture (`googlePicture` in `web/src/lib/supabase.ts`: user metadata, else
the Google identity's data, so a guest who links Google gets it too) when no picture is uploaded. Web only, no model
call, so no eval rerun.

Lock-phone hint: the import progress box's "You can lock your phone; the import keeps going." shows only below `md`
(phones); desktop keeps "An estimate from your recent imports." Web only, no eval rerun.

Step ingredients by group: cooking mode's "For this step" chips come from `stepUses` in `web/src/lib/cooking.ts`.
When the method has headings, a food on several lines keeps only the line from the group whose name shares a word with
the step's heading ("Chicken" ~ "Rice & Chicken"), else the first line an earlier step has not used; "seasonings",
"spices" or "spice mixture" bring in that group's seasoning lines (named spices, herbs, salt, or measured in tsp/pinch);
"Salt and pepper" matches either word. Chelsea's chicken broth bowl step 2 now shows chicken, 2 tbsp olive oil and the
five seasonings instead of both olive oils. Web only, no model call, so no eval rerun; 1 new Playwright test.

Preheat hint: in cooking mode only, a step that says preheat (or heat the oven) without a time underlines
"Preheat the oven" (dotted, like tappable amounts); hover, focus or tap opens a popover with the sentence of the next
timed step within 3 steps that names the time ("Shown in Step 3: Bake at 180°C (165°C fan) for 9-12 minutes.";
`preheatHint` in `web/src/lib/cooking.ts`, `web/src/components/preheat-text.tsx`, Base UI Popover). Recipe pages no
longer show the old "Coming up in step N" note. Web only, no model call, so no eval rerun; 1 new Playwright test
(`web/tests/preheat-hint.spec.ts`).

Recipe notes: an imported recipe keeps the author's notes (substitutions, storage, tips) in a new `notes` field of
`CookbookRecipeIn` (text, one note per line, 3000 chars, inside the recipe JSON, so no migration). `recipe_notes(html)`
reads them from the page's notes block (WP Recipe Maker and similar keep them in HTML, not schema.org) into
`recipeNotes` in `jsonld_recipe`; the prompt and `ImportedRecipe.notes` also copy a "Notes" section from page text.
Cookbook recipe pages show a "Notes" panel after the Method and the form has a Notes box. Checked on Amy's Healthy
Baking red velvet cookies (11 notes). Import eval before (prompt at `HEAD`) `import-2026-10-21T122302Z` vs after
`import-2026-10-21T122307Z`, 27 cases: 0 missed allergens both, found/refused 100% both, food matching 99% both,
groups 100% both, $0.0067 -> $0.0077/import (notes add output tokens), p50/p95 5.5/9.0 -> 5.4/14.9 s (single runs).
The eval has no page with a notes section, so this checks for regressions only.

Import measures, auto-save, fractions and fan ovens: an unmatched import line that names a table food
(`recipe_import.table_food`, the form's `resolve_food` match: "baking soda", "salt") now gets that food, and an
estimated food in spoons, cups or pieces keeps the source's measure, the amount repair setting the estimate's
`grams_per_ml`/`grams_per_piece` instead of turning "½ tsp" into "2.3 g" (Amy's red velvet cookies: ½ tsp baking
soda, ⅛ tsp salt kept). Imports skip the review form: the new-recipe page saves the draft (`saveNewRecipe`) and opens
it, with its photo made in the background; a draft with an unknown food or no method (`needsReview`), or one the API
refuses, still opens the form. Import notes are no longer shown (per-line estimates stay on the recipe). Amounts show
fraction characters (1¼ tsp, ⅛ tsp) and typed fractions in steps do too (`niceFractions`). Oven steps (oven, bake,
roast, preheat; not when a fan or air fryer is named) add the fan-oven setting, 25°F lower, rounded to 5°C:
"180°C (165°C fan)", "350°F (325°F fan)" (`fanTemp` in `temperature.ts`). Import eval before (code at `main`)
`import-2026-10-21T121751Z` vs after `import-2026-10-21T121957Z`, 27 cases: 0 missed allergens both, food matching 99%
both, amount cases 100% both, $0.0077 -> $0.0072/import, p50/p95 5.2/13.5 -> 4.7/13.6 s (no prompt change; the eval
has no unmatched table-food case). Playwright specs updated for auto-save, plus a no-method fallback test; all 21 pass
locally with `PLAYWRIGHT_CHANNEL=chrome`.

Mobile viewport and cook button: the viewport is locked (`viewport` export in `web/src/app/layout.tsx`: device width, scale 1, no pinch zoom) and `html`/`body` clip horizontal overflow, so pages no longer wobble sideways on phones. Recipe pages (corpus and cookbook) end with a full-width "Start cooking" button after the method (`StartCooking fullWidth`). Web only, no model call, so no eval rerun.

Import progress and units: an import job now records the steps the importer actually takes (`Importer(on_step=)`,
keys of `recipe_import.STEPS`: page, post, caption, link, comments, video, listen, watch, recipe, photos, text,
ingredients, amounts; a repeat of the current step is not new) and `GET /me/recipes/import/jobs/{id}` returns
them as `steps: [{key, label}]`. The new-recipe page shows them live (`web/src/components/import-progress.tsx`,
replacing the guessed "Reading the caption…" countdown) for photo, link, post and resumed imports: earlier steps
ticked, the current one spinning, time so far or "About m:ss left" for posts. The review form converts the amount
when the unit changes (1 cup of rice -> 185 g) through grams with the food's `grams_per_ml`/`grams_per_piece`
(`/foods` now returns them as `TableFood`; estimates carry their own); an estimate note stays, and a unit the food
cannot convert to keeps the number. Recipe pages put a ruler button ("Change measurement for …") at the end of each
line beside the tappable amount (`MeasuredLine` in `amount.tsx`). No prompt or model change, so no eval rerun.

Assistant draft notes: a recipe the assistant writes no longer gets its warnings pasted into the message as "Note from
Pantrila: ..."; they show only in the red card under the reply (cited-recipe notes are unchanged). The card no longer
lists "could not be checked" lines (the review form still lets the person fix unmatched foods), and the prompt tells the
model not to repeat the card's warnings or mention an ingredient (egg, dairy...) the person's rules do not forbid.
`baking soda` / `bicarbonate of soda` alias to baking powder (no allergens, near-zero nutrition per teaspoon); beet powder
stays unknown. The eval's draft-warning check no longer requires an unchecked line. Before (old prompt, code at `main`)
`assistant-2026-10-21T111136Z` vs after `assistant-2026-10-21T111309Z`, 28 cases: 0 unsafe or made-up citations both,
right tools 100% both, 0 drafts missing rule warnings both, recommended a recipe 91% -> 82% (single run; the prompt change
only touches write_recipe wording), $0.0035 -> $0.0038/turn, p50/p95 4.7/10.5 -> 4.8/8.4 s.

Automatic food estimates: the recipe form no longer has an "Estimate N with AI" button. Lines still unmatched
after matching are sent to `/me/recipes/estimate` in one batch about 0.8 s later (once per name; failures toast and
are not retried), and Save waits while it runs. `resolve_food` (and the form's `matchFood`) now ignore prep words
(`PREP_WORDS`: melted, plain, unsweetened, chopped...) and know US names (all-purpose, whole wheat flour, chocolate
chips), which clears most "could not be checked" lines in chat drafts too; chat drafts still get no AI estimate, and
baking soda is not in the table. No prompt/model change, so no eval rerun; Playwright specs could not run locally
(no Chromium), CI runs them.

Faster social imports: production showed social imports at 65-100 s, almost all of it the video read's reasoning
(about 10k output tokens at effort medium; Apify runs about 6 s). `Importer(video_effort="low")` now reads videos at
low effort (pages, photos, text and captions stay medium), and `recipe_import.may_hold_recipe` skips the caption call
for a hook ("Comment RECIPE 👇", "Full recipe at the link"): a caption is read only when it has an amount with a
unit, a count of a table food ("2 eggs"), "ingredients", three table foods or a three-line list; a wrong "no" only
takes the slower link/comments/video path. Evals take `--video-effort` (low by default; medium is the before).
Video before/after `video-2026-10-21T103351Z` (medium) / `video-2026-10-21T103356Z` (low), 6 cases: 0 missed
allergens both, food matching, stated amounts and vague flagged 100% both, output tokens about 60% fewer, $0.0133 ->
$0.0087/import, p50/p95 11.2/21.8 -> 9.0/9.3 s. Reel before (code at `728053a`) `reel-2026-10-21T102748Z` vs after
`reel-2026-10-21T103352Z`, 9 cases: 0 missed allergens both, food matching 98% -> 100%, service and comments runs as
expected 100% both, $0.0248 -> $0.0200/import, p50/p95 12.9/43.0 -> 6.6/15.4 s. Import eval after
`import-2026-10-21T103355Z` vs `import-2026-10-21T101807Z`: 0 missed allergens, captions 100% food matching both
(pages 97.8%: one curry line, a page path this change does not touch), $0.0074 -> $0.0072. Single runs; the live
gain is larger in production, where the video read was the 10k-token call.

Ingredient amounts: imported lines showed their amount twice ("1 cup 1 cup basmati rice"), since the import kept
the whole source line as `name`. The prompt and `ImportedLine.name` now ask for the name without its amount
(vague wording is quoted in `amount_estimate`), and `cookbook.bare_name` strips a leftover leading amount in
`draft_line`; the web strips it on display too (`bareName` in `web/src/lib/amounts.ts`), so older saved recipes
read right without a migration. Amounts show US measures and counts as fractions (1 1/4 tsp) and metric as whole
numbers (454 g; recipes stay metric). On the recipe pages (corpus and cookbook) tapping an amount picks another
unit for that line (g, oz, lb, ml, tsp, tbsp, cup, piece, from the line's grams and the food's
`grams_per_ml`/`grams_per_piece`, now on `LineView`/`IngredientView`; display only, not remembered). Cooking mode
shows fractions and clean names, no picker (its lines are tap-to-tick buttons). New eval metric "names repeating
the amount". Before (code at `e45d531`) `import-2026-10-21T101509Z` vs after `import-2026-10-21T101807Z`, 27 cases:
names repeating the amount 95% -> 0%, lines kept 100% both, food matching 99% -> 100%, 0 missed allergens both,
groups 100% both, $0.0069 -> $0.0074/import, p50/p95 4.3/7.6 -> 5.6/14.8 s (single runs). A first wording
("the amount goes only in quantity and unit") split "1 tbsp butter, plus extra for the pan" into two lines in 3
of 4 runs (lines kept 96%); the prompt now says one entry per source line, never split, keeping such notes in
the name (4/4 runs kept 5 lines). 1 new Playwright test (`web/tests/ingredient-amounts.spec.ts`).

Background recipe photo: "Save to my recipes" now opens the saved recipe at once; its photo is made while the
person reads it. `web/src/lib/photo-jobs.ts` (`makePhoto`, `usePhotoPending`) runs the existing
`POST /me/recipes/{id}/photo` outside the form and marks the id in `sessionStorage["pantrila-photo-jobs"]`; the
recipe page's photo slot (`RecipeArt making`) shows a sweeping light and "Making the photo…" until it lands. After a
reload the server still finishes the photo, so the page polls the recipe every 3 s for up to 90 s. Failures still toast
"Recipe saved. Its photo could not be generated." "New photo" uses the same store. No API, prompt or model change, so
no eval rerun; `import-amounts.spec.ts` updated, new `background-photo.spec.ts`; `post-import.spec.ts` resumes its fake
clock before a fresh page load (a paused clock can stall Supabase's auth start).

Recipe groups: an import keeps the source's headings. Ingredient lines carry `section` ("Broth"; consecutive
lines share one) and the method keeps `step_sections` (`{title, first_step}`, 1-based) beside the flat `steps`
list, both inside the existing recipe JSON, so no migration and older recipes load unchanged. `ImportedLine.section`
and `ImportedRecipe.step_sections` come from the model (prompt: copy headings as written, never invent, "Ingredients"
is not a group); `capped_draft` re-maps heading positions when blank steps are dropped. schema.org lists ingredients
flat, so `jsonld_recipe` lays the ingredient list over the page's text lines and adds `ingredientSections` when it
finds headings between them (checked on the real Chelsea's Messy Apron page: Rice & Chicken / Broth / Optional
Toppings). Web: cookbook recipe page, form (editable group names, "Add group", `## Heading` lines in the method box)
and cooking mode (heading above the step, grouped checklist); corpus recipes are not grouped. Eval: 27 cases (2 new
grouped pages, groups added to `caption-ingredients-only`), new groups-kept / none-invented metrics. Before
(old prompt) `import-2026-10-21T083300Z` vs after `import-2026-10-21T083224Z`: groups kept 100% both, none invented
84% -> 100%, food matching 99% -> 100%, lines kept 96% -> 100%, 0 missed allergens both, $0.0069 -> $0.0065/import,
p50/p95 4.7/11.3 -> 4.3/8.4 s (single runs; the old prompt already filled `section` from the new field
descriptions, so the gain is mostly fewer invented groups). 1 new Playwright test (`web/tests/recipe-sections.spec.ts`).

Background imports: a locked phone or a tab in the background used to drop the import's HTTP
request and show an error. The web app now starts imports with `POST /me/recipes/import/jobs`
(`kind` link|post|text|photos; the page picks the job `id` and saves it first, so a cut-off request can be followed up, and the daily allowance is reserved at once) and polls `GET /me/recipes/import/jobs/{id}` every 2 s (sooner when
the page returns to the foreground; dropped connections and 502+ are retried). The job runs in a
server thread (`import_jobs.py`, in memory, kept 1 h, 2 running per person, same daily cap and
usage log as before). The job id is kept in `localStorage["pantrila-import-job:<user>"]`, so a
reload shows "Finishing your import…" (with "Stop waiting") and delivers the draft. A server restart loses jobs in flight
(404 "interrupted"); an upload still has to finish before the phone sleeps. The synchronous
`/import/link|post|text|photos` routes stay for API/eval callers. No prompt/model change, so no eval
rerun; 4 new API tests and `web/tests/background-import.spec.ts`.

Creator comment links: `from_post` now tries caption -> caption links -> links in the post
creator's own top comments -> video. `post_media.COMMENT_ACTORS` (Facebook
`apify/facebook-comments-scraper`, Instagram `apify/instagram-comment-scraper`, TikTok
`clockworks/tiktok-comments-scraper`), 10 comments per run, token only to api.apify.com, metered as
usage kind `reel` (same daily cap; an import can now use two runs). Creator check from real
output: Facebook commenter `profileUrl` vs the post page's `pageAdLibrary.uri_token`; TikTok
`uniqueId` vs `/@handle/` in `videoWebUrl`; Instagram `ownerUsername` vs the post's handle (no
handle known -> no run). Other commenters' links are never fetched. Fees are per comment (FREE tier
$0.0025 FB + $0.001/run, $0.0026 IG, $0.00125 TikTok), so a lookup is $0.013-0.026, not the
$0.002-0.005 first estimated. Instagram returns newest comments first, so creator comments on busy
posts are missed. No real IG/TikTok creator link comment was found; fixtures
(`tests/data/apify_comments.json`) keep recorded fields with edited texts. Reel eval before/after
`reel-2026-10-21T075706Z` / `reel-2026-10-21T075731Z` (9 cases, 2 new): found 100% both, 0 missed
allergens, site credited 88% -> 100%, 0 stranger pages fetched, $0.0165 -> $0.0236/import (posts
without a link pay a comments run), p50/p95 9.3/26.8 -> 8.4/19.3 s. Live Chelsea reel: 25 lines,
11 steps from the site, no video read, $0.026 service + $0.056 model, 57 s
(`evals/reports/creator-comments-2026-10-21.md`). No prompt/model change.

Import notes accordion: the "Read by AI. Check it before saving." box on `/recipes/mine/new` collapses
the import notes (post, photo and link imports) into one "N notes to check" row, closed by default, so a long
list no longer pushes Save off the screen on phones. Per-ingredient messages stay beside their fields, and the
"to fix before saving" and "does not suit you" alerts are unchanged. Web only (native `<details>`), no model
call, so no eval rerun; `post-import.spec.ts` opens the row before checking a note.

Temperature toggle: recipe Method (corpus and cookbook pages) and cooking mode show a °C/°F switch
when a step names a temperature. Display only: `web/src/lib/temperature.ts` converts in code
(oven temperatures round like cookbooks: 350°F -> 180°C, 200°C -> 400°F; meat and candy stay exact),
collapses "350°F (180°C)" pairs to the chosen unit, and the choice is kept in `localStorage["pantrila-temp-unit"]`
(default °C). Stored recipe text is unchanged. Web only, no model call, so no eval rerun; 1 new Playwright test
(`web/tests/temperature-toggle.spec.ts`).

Google sign-in: login page leads with "Continue with Google" (Supabase `signInWithOAuth`, PKCE,
back to `/auth/callback`), guest stays second, owner magic link unchanged. Guests add Google from
the account menu ("Keep my data with Google") or Profile ("Keep your data") via `linkIdentity`,
keeping the same user id and data; a Google account that already has a user shows a message on
the callback and the guest stays signed in. Helpers in `web/src/lib/supabase.ts`; Home greets by
Google first name. Setup done in Google Cloud and Supabase (Google provider, "Allow manual linking", Site URL and
redirects for `pantrila.vercel.app`; steps in `docs/google-sign-in.md`); owner live-checked Google
sign-in and a guest linking Google on 2026-10-20 (PR #45 merged). No API, schema, prompt or model change, so no
eval rerun; 2 new Playwright tests (`web/tests/google-sign-in.spec.ts`).

Rename Pantrio -> Pantrila: package `pantrila`, CLI `pantrila`, env vars `PANTRILA_*`, web brand and
localStorage keys (`pantrila-tour-done`, `pantrila-cook`; saved tour/cooking state resets once). Kept on
purpose: table `pantrio_migrations`, applied migration files, and the hosted names (Render service `pantrio-api`, Supabase project `pantrio`) until renamed in
their dashboards (the web app has since moved to `pantrila.vercel.app`); Render env vars must be renamed to `PANTRILA_*` before this deploys. No prompt/model
change, so no eval rerun. Historical eval reports keep the old name. 363 Python tests, Ruff, web
typecheck and lint pass.

Facebook shared-reel fix: Apify returns `/share/r/` posts with playback URLs under
`short_form_video_context.playback_video.videoDeliveryLegacyFields`, captions in `message.text`
and duration in `short_form_video_context.video.playable_duration_in_ms`. The Facebook adapter
now reads these in addition to ordinary video fields. Three recorded results: media/caption
recognition 1/3 -> 3/3; ordinary videos unchanged. Videos read successfully but lacking a
complete extractable recipe now suggest the creator's recipe-page link, distinct from a
fetch/decode failure. Owner's 20-second Chelsea reel still lacks a complete recipe; the
creator's `/chicken-broth-bowl/` page imported successfully (25 ingredients, 10 steps).
Reports: `evals/reports/facebook-share-2026-10-20.md` and accompanying JSON. No prompt/model
change or new actor run; existing results were replayed for validation. All 363 Python tests
passed locally (26 database/prerequisite skips, 8 paid live tests deselected); Ruff passed.

Social import form is link-only: no caption toggle, caption field or screenshot fallback
button. Placeholder: "Paste Instagram, Facebook or TikTok link". Helper text: "Pantrila reads
the recipe from your post and credits the creator." Read failures suggest another public
recipe link. Backend caption/text import support remains for API/eval callers. This small
follow-up is pushed directly to main at the owner's explicit request for this change.

Recipe save/import UX: saving a new recipe automatically calls its existing photo endpoint
with a visible "Making the photo…" step; photo failures/allowance limits keep the saved recipe
and offer a retry on its page. Edits do not regenerate photos. Social imports show an estimated
countdown and an overrun message. `GET /me/recipes/import/timing` uses this user's last five
successful imports containing a reel event (last 30 days, latest 100 events), median + 15%,
rounded to 5 seconds and bounded 30–300 seconds. Fallback 105 seconds comes from production
logs on 2026-10-20: successful requests 75.140 / 103.070 s; photo generation 15.111 s. Timing
is a rough request estimate, not server stage telemetry; concurrent request intervals can
occasionally overlap. Upload-video UI, browser extraction, fixtures and the `/import/video`
endpoint are removed. Automatic video/audio reading from social links and its evals remain;
fallbacks are pasted text/captions and screenshots. No prompt/model or database schema change.
Local checks: 360 Python tests passed (26 skipped, 8 live deselected); production browser
checks passed for photo success/failure, edit behavior, fallback and countdown overrun. Web
typecheck/lint/build and Ruff passed. No paid eval rerun: prompts/models are unchanged.
The historical uploaded-video entries below describe the retired feature.

Import amount estimates: missing/vague quantities and unsupported measures (sprigs, handfuls)
are estimated rather than requiring manual unit edits. `RecipeLine.amount_estimate` persists
assumptions in the existing recipe JSON; `derive.estimated` covers amounts as well as foods.
The import prompt requests estimates and deduplicates method references; a single bounded
follow-up call repairs remaining incompatible units without changing food identity/allergens.
The form and saved recipe show "Estimated nutrition" and per-ingredient assumptions; entering
a quantity/unit clears that line's estimate. Older saved recipes remain compatible; no migration.
Before/after import reports: `import-2026-10-20T094538Z` / `import-2026-10-20T094933Z`, 23 cases:
0 missed allergens, foods 98% -> 99%, manual fixes 0.11 -> 0/recipe, $0.0057 -> $0.0068,
p50/p95 6.4/12.1 -> 7.0/19.8 s. Video reports `video-2026-10-20T094527Z` /
`video-2026-10-20T094934Z`, 6 cases: 0 missed allergens, vague flagged 67% -> 100%, foods 97%
both, stated amounts 100% -> 96% (one food mismatch), $0.0110 -> $0.0135, p50/p95
11.7/18.0 -> 13.2/31.4 s. New 2-case amount report `import-2026-10-20T095015Z`:
100% saveable, labelled and no duplicates; 0 missed allergens. These are small single-run
samples. Regression tests cover repair validation, deduplication, saved provenance and API edits.
Branch prefixes apply only to branches; commit messages are plain descriptive text.

Next planned work: **European nutrition data + 100 sourced recipes**, four sequential PRs.
Read [`docs/plans/european-ingredients-and-recipe-expansion.md`](docs/plans/european-ingredients-and-recipe-expansion.md)
before starting; it contains the full scope, safeguards, sources, checklists and handoff log.
**PR 1 complete in [PR #38](https://github.com/mikegauci/pantrila/pull/38). Next: PR 2 only,
after confirming merge and live prerequisite deployment.**
PR 1 adds eight ingredients (six Ciqual, two USDA), source identity, weight-only new foods,
central dessert swap restrictions and corpus seed preservation. Original 300 recipes unchanged.
See the plan for verification and deployment status. PR 2: recipe provenance/licensing + 5–10 dessert
pilot; PR 3: expand to **60 added desserts including the pilot**; PR 4: **40 everyday recipes**.
Target is 100 additions / 400 total, subject to review. Initial recipe source is Wikibooks;
Ciqual supplies nutrition, not recipe testing. Preserve the original 300 recipes. Start a fresh
chat per PR and update the plan's progress/handoff after each. Do not implement this feature
merely because this status entry exists; follow the user's selected task/PR.

Reel audio from a link (plan `docs/plans/reel-audio-from-link.md`, first PR): `from_post`
tries caption -> linked site -> the post's video, found by a third-party service
(`post_media.py`, Apify, `PANTRILA_MEDIA_SOURCE`, default off) and read in memory with PyAV.
Service runs are usage kind `reel` (migration `20261020100000_reel_usage`, applied on Supabase;
cap `PANTRILA_DAILY_REEL_FETCHES`). Prompt: steps only as the source gives them. Reel eval
before/after `reel-2026-10-20T082713Z` / `reel-2026-10-20T082734Z`: found 80% -> 100%, method
67% -> 100%, 0 missed allergens; import eval `import-2026-10-20T082701Z` unchanged in quality.
Second PR: one Apify actor per platform (`post_media.ACTORS`: Instagram, TikTok, Facebook;
$0.0027 / $0.0043 / $0.006 per post), token only ever sent to api.apify.com, TikTok links
alone work (caption from the service). Reel eval 7 cases, before/after
`reel-2026-10-20T084302Z` / `reel-2026-10-20T084329Z`: found 57% -> 100%, method 67% -> 100%,
0 missed allergens. Live on the test reel: 17 lines, 7 steps, ~60-90 s, ~$0.05 (the video
read's reasoning tokens; effort low is a follow-up). Still to do (owner): `APIFY_TOKEN` and
`PANTRILA_MEDIA_SOURCE=apify` on Render, then a live check on the deployed app.

Social recipe import, two PRs; plan and checklists in `docs/plans/social-recipe-import.md`
(read it before either PR). PR 1 (PR #36, merged): `social.py` (post detection, TikTok
oEmbed / Open Graph captions, caption links), `Importer.from_post` (caption, then the linked
recipe site) and `from_text`, `/me/recipes/import/post|text`, cookbook credit fields
(`source_platform`, `source_author`, `recipe_url`; no migration), web "From a post" and
credit, 10 caption eval cases. Prompt unchanged: caption lines were tried and dropped, since
the old prompt already scored the same on all 22 cases (`import-2026-10-20T061450Z` old prompt
vs `import-2026-10-20T061631Z` with the lines: 0 missed allergens, food matching 100%, 4/4
no-recipe captions refused; the lines cost +7%, $0.0054 -> $0.0058). Platform check
(2026-10-20, `scripts/platform_check.py` on the owner's Mac): Instagram and Facebook links
import from the link (Open Graph captions); TikTok oEmbed sends only the player and its page
has no preview tags, so TikTok links open the caption box straight away. Short links in
captions (bzfd.it) are followed.
PR 2 (uploaded video, PR #37, merged): the browser reads a saved or
screen-recorded video (`web/src/lib/video.ts`: 16 kHz mono WAV via `decodeAudioData`, 4 JPEG
frames at 15/40/65/90%, up to 3 min); `POST /me/recipes/import/video` checks the WAV in code,
transcribes it (`PANTRILA_TRANSCRIBE_MODEL`, default `gpt-4o-mini-transcribe`, priced per minute
with `PANTRILA_PRICE_TRANSCRIBE_PER_MIN`; the cost is in the import's usage event and shown
apart as `transcription_cost_usd`), then one extraction call with transcript + frames +
caption. A video with no sound sends frames only (audio null, no transcription); a link that
is not a post is kept as `source_url`. Video-only prompt lines (`VIDEO_INSTRUCTIONS`, `VideoRecipe.vague_amount`); page,
photo, text and caption imports keep the old prompt. Source `"video"` without a post link.
Eval: 6 spoken cases (`evals/video_cases.py`), audio from `evals.video_audio` (`gpt-4o-mini-tts`,
committed in `evals/data/video_audio/`), `evals.run_video` (`--plain` is the before). Reports
on `gpt-5.4-mini`: before `video-2026-10-20T065810Z` (plain prompt) vs after
`video-2026-10-20T065841Z`: 0 missed allergens both, food matching 100% both, stated amounts
right 100% both, vague amounts flagged 0/3 -> 3/3, 0 stated amounts wrongly flagged, sponsor
kept out, not-a-recipe refused, $0.0121 -> $0.0102 per import (transcription $0.0016 of it,
31 s of audio), p50 10.1/9.1 s, p95 29.4/17.3 s. `gpt-4o-transcribe`
(`video-2026-10-20T065914Z`): food matching 97%, vague flagged 2/3, $0.0131, so the default
stays `gpt-4o-mini-transcribe` ($0.003/min; both env vars set on Render).
Ingredients-only captions: a reel whose caption lists the
ingredients and says "full recipe in my bio" was refused, since `to_draft` required steps.
Now a draft with no method is kept when every ingredient line names a word found in the
source text (`grounded`; photos stay strict), with the step "Add the method here." and the
`NO_METHOD` note; `from_post` still tries a linked site first and keeps the caption's draft if
that fails. New eval case `caption-ingredients-only` (23 import cases). PR #39, merged.
`import-2026-10-20T081143Z`: 23/23, found/refused 100% (4/4 no-recipe refused), 0 missed
allergens, 1 extra (tofu bowl: milk, as before), food matching 99% (captions 100%), the new
case a draft with 8/8 foods, $0.0056 per import, p50 4.5 s / p95 12.6 s.
Next: hearing a reel from its link (no screen recording) through a scraping service; plan in
`docs/plans/reel-audio-from-link.md` (Instagram gives no `og:video`, checked 2026-10-20).

Review maintenance: API models/views/backend construction now live in `api_models.py`,
`api_views.py`, and `backend.py`; `api.py` owns routes and app lifecycle. Insights is generated
from `evals/report_selection.json` with `scripts/update_eval_snapshot.py`, checked by pytest.
Retrieval metrics are explicitly named normalized recall (the existing formula is unchanged).
Plan streams send keep-alives and detect premature EOF; recipe previews are tied to the exact
recipe/profile payload. Four production-browser regressions run in CI. Pinned page fetches
fail over among vetted addresses without re-resolving the hostname.

Chat recipe drafts restored from the saved work: write_recipe resolves foods and hands a
draft to the cookbook form. The final guard independently computes structured draft warnings,
including unchecked ingredients, and the UI renders them beside each save action. Saved
chats refresh these warnings too. The evaluator checks rule warnings, not allergen-name
mentions. Before/after 28-case reports: `assistant-2026-10-19T130451Z` and
`assistant-2026-10-19T132325Z`; after: 0 unsafe/made-up citations, 0 missing draft warnings,
100% expected tools, 3/4 expected drafting decisions, $0.00375/turn, p50 4.7s/p95 8.0s.
Existing-recipe citation coverage was 9/11 (before 11/11), so draft/corpus selection remains
a model-quality limitation. Unknown IDs are now blocked
as citations and tracked as blocked attempts. All 8 paid live gates passed. The original stash is retained as a recovery backup.

Review safety/data bounds: saved chats refresh cited cards and expose current-profile warnings.
Concurrent chat writes compare the original history and return 409 on conflict; messages retain
the latest 200 entries. Malformed plan structure skips portion enumeration and reaches repair.
Profile fields, recipe steps/source URLs, uploads (24 MB), and avatar pixels are validated.
Quota reservation migration is applied on Supabase; PR #26 passed CI and merged.

Review usage hardening: migration `20261019124726_usage_reservations` adds RLS-protected
reservations. `operations.py` reserves per-user quota and shared budget atomically before
paid work, settles once on success/failure, and conservatively budgets unknown cost. Searches
are metered and query embeddings cached. Repository calls borrow pooled connections briefly;
external I/O holds none. Local DB concurrency and real-role RLS regressions are included.

Review account isolation: authenticated users get separate SWR caches and retained page state;
remembered chat and grocery keys include the user id. Profile/pantry mutations invalidate all
derived views. Playwright exercises account switching with delayed data; web CI runs it.

Review hardening: recipe imports connect directly to validated IP addresses, preserving HTTPS
hostname verification, with a ten-second overall DNS/socket deadline and bounded DNS workers.
Regression tests cover rebinding, TLS identity, stalled DNS and trickling headers.

Step 1 merged (PR #1): 300-recipe corpus, Supabase seeded and embedded, 65 labelled queries,
hybrid recall@10 0.843, MRR 0.922 (`evals/reports/retrieval-2026-10-15T195536Z.md`).

Step 2 merged (PR #2): LangGraph planner, `constraints.py`, 16 eval profiles. First
eval `evals/reports/planner-2026-10-16T084243Z.md` on `gpt-5.4-mini` (reasoning low; now the
default model, chosen as the cheapest; `gpt-5.5` never evaluated): 16/16 plans, 0 hard
violations, 13/16 meet every target, protein days 94%, pantry use 94%, $0.023 per plan,
p50 19s / p95 84s. Weakest: `cutting` (130 g protein in 1600 kcal, 43% of days met).
Migration 0002 widened `recipe_ingredients.quantity` to 3 decimals (applied and reseeded on
Supabase).

Step 3 (PR #6): pantry and profiles per user (migration 0003, RLS on every table, applied on
Supabase), grocery list, deterministic swaps, LangGraph chat agent with 5 tools and a citation
guard; 24 chat eval cases. `evals/reports/assistant-2026-10-16T094533Z.md` on `gpt-5.4-mini`:
right tools 100%, pantry as asked 100%, 0 unsafe and 0 made-up cited recipes, $0.0022 per
turn, p50 8s / p95 17s (first run before the prompt fix: 96% tools, 50% pantry, 1 made-up id).
Step 4 (PR #7): FastAPI `api.py` (Supabase Auth ES256 tokens verified via JWKS; `sub` is
`user_id`), migration 0004 (`meal_plans`, `usage_events`, RLS; applied on Supabase), plan
progress as SSE, daily caps per user and a total daily budget; Next.js 16 app in `web/` (10
screens per `DESIGN_SYSTEM.md`). Local end-to-end run on `gpt-5.4-mini`: plan 17 s / $0.012,
chat turn 4.5 s / $0.0023. Deployed: web https://app.pantrila.com (also `pantrila.vercel.app`, formerly `pantrio-azure.vercel.app`; Vercel project `pantrila`,
root `web/`, auto-deploys `main`), API https://api.pantrila.com (Render service `pantrila-api`, also `pantrio-api.onrender.com`; Render Blueprint from
`render.yaml`, free plan, sleeps when idle). Supabase Auth: anonymous sign-ins on, Site URL and
`/auth/callback` redirects set for the Vercel URL and localhost:3000. Live check: guest sign-in,
search, a 2-day plan (18.6 s, $0.005) and a chat turn all pass. Decision: guests are the public
way in; magic-link email is owner-only (Supabase's built-in sender, no custom domain for SMTP).
Step 5 (this PR): README rewritten (mermaid architecture and planner diagrams, eval table,
design decisions, limitations, screenshots in `docs/screenshots/`), `docs/demo-script.md` for
the video (to be recorded by the owner and linked in the README). Traces: root runs named
`plan`/`chat`, tagged `api|cli|eval`, with feedback `targets_met`, `repairs`, `fallbacks`,
`pantry_use` (plans) and `flagged_citations` (chat); "Pantrila live" LangSmith dashboard (EU)
built by `scripts/langsmith_dashboard.py`, filtered to `api` traffic. LangSmith's charts API
only accepts V2 definitions (`metric_definition` + `filter_definition`). Fixed plan day cards
overflowing at 1280 px. No prompt/model change, so no eval rerun. Paid evals workflow needs
`OPENAI_API_KEY` and `DATABASE_URL` repository secrets; `LANGSMITH_API_KEY` is set locally
(EU endpoint), so local eval runs upload LangSmith experiments.
User recipes (this PR): cookbook per user (migration 0005: `user_recipes`, usage kind `import`;
applied on Supabase), import from photos (shrunk to JPEG in the browser, not stored) or a link
(SSRF-guarded fetch, schema.org JSON-LD first, else page text), or typed in; one review form
for all three. Unknown foods get a model estimate (marked "Estimated"; the person can edit its
allergens); everything else is derived in code on every read. Not used by the planner (owner's
decision). Imports run at reasoning effort medium. `evals/reports/import-2026-10-16T185930Z.md`:
0 missed allergens, food matching 99%, $0.006 per import, p50 6.5 s / p95 11.5 s (effort low:
2 of 12 drafts missed an allergen; the named-food safety net fixed one, medium the other).
Bot-blocking sites (Allrecipes) refuse the fetch; the app suggests a screenshot.
Chat threads (this PR): migration 0006 (`chat_threads`, RLS; applied on Supabase), `/me/chats`
routes, `POST /chat` takes `thread_id` instead of client-sent history. Assistant page has a
thread list (left column on desktop, "Chats" drawer on mobile) and "New chat". No prompt,
tool or model change, so no eval rerun.
Header avatar (PR #13): food emoji on a soft tint, picked from a hash of the Supabase user id
(`web/src/lib/avatar.ts`); nothing stored, no backend change.
Server wake-up notice (PR #14): any API request pending over 3 s shows one shared Sonner toast
("Waking up the Pantrila server…") until every slow request answers (`request()` in
`web/src/lib/api.ts`); `AppShell` pings `/health` on mount to start the Render wake-up early.
The toast now appears only when no reply has come back in the last 10 minutes, so slow imports
and chat replies on an awake server no longer say the server is waking up. `/health` accepts
HEAD as well as GET for UptimeRobot's default check (free plan, no method setting); the
UptimeRobot monitor pings `https://pantrio-api.onrender.com/health` (moving to `https://api.pantrila.com/health`) every 5 minutes to keep the
free instance awake. Web only.
Recipe photos (this PR): migration 0007 (`recipe_photos`, `user_recipes.photo_path`, usage kind
`photo`; applied on Supabase), public Storage bucket `recipe-photos` (created by `pantrila photos
generate`; needs `SUPABASE_SERVICE_ROLE_KEY`, also set on Render). All 300 corpus recipes
photographed with `gpt-image-2.5-flare` at 1536x1152 medium, stored as 1200x900 WebP: $4.15
total, $0.0138 per photo (408 output tokens each), p50 ~14.5 s / p95 ~20 s. OpenAI allows ~20
images/min, so the run uses 4 workers and SDK retries (6 workers hit 429s). Prompt chosen over
7 sample rounds (owner-reviewed): only the recipe's ingredients as garnish and props, no
generic herb bowls or salt dishes. Cookbook recipes get Generate/New/Remove photo
(`PANTRILA_DAILY_PHOTOS`, default 5). Web uses `next/image` (Vercel Hobby: 5K transformations a
month; `minimumCacheTTL` 31 days). No text-model prompt change, so no eval rerun.
Assistant first (this PR): Assistant is second in the nav (sidebar and mobile tabs) and Home
opens with an "Ask Pantrila" card (`web/src/components/ask-pantrila.tsx`: question box, starters,
last 3 chats); it links to `/assistant?q=` (asked in a new chat) or `?thread=`. Web only.

Profile picture (this PR): migration 0008 (`user_avatars`, path only; applied on Supabase), stored
in the `recipe-photos` bucket under `avatars/<user>/` (no new bucket). The browser crops to a
square and shrinks to JPEG; `PUT /me/avatar` re-encodes it as a 256 px WebP (`photos.to_avatar_webp`),
`DELETE /me/avatar` removes it, `/me` carries `avatar_url`. Header and Profile page show it, else the
emoji avatar. No model call, so no eval rerun.
First-run tour (this PR): `web/src/components/tour.tsx`, 10 steps across Home, Assistant, Recipes,
the new-recipe page (the four ways to add a recipe, then "From a post"), Plan and Grocery, pointing at elements marked `data-tour="…"` (nav links carry `nav-<key>`; the
visible match wins because hidden pages stay mounted). Opens once per user id
(`localStorage["pantrila-tour-done:<id>"]`), replay from the account menu ("App tour") or Profile
("Help"). Web only, no new dependency, so no eval rerun.
Favicon and app icon: a white chef hat on a green gradient, its big AI sparkle cut out so the background shows
through, two small white sparkles tucked in at its top right; the hat
itself is centred. `web/src/app/icon.svg` (favicon), `favicon.ico` (16/32/48) and
`apple-icon.png` (180 px, full bleed); `web/brand/` holds the store master (`app-icon.svg`, `app-icon-1024.png`, no
transparency) and the Android adaptive foreground/background, described in `web/brand/README.md`. `Logo` draws the
same mark inline. `node scripts/icons.mjs` (from `web/`) renders every PNG and the .ico with `sharp`.
File-convention icons, no `layout.tsx` change. Web only, so no eval rerun.
Mobile recipe filters (this PR): Recipes chips are four rows (Meal, Time, Diet, Cuisine) that scroll
sideways edge to edge below `md` (`no-scrollbar` utility) and wrap from `md`; shorter safety banner on
phones, so the first recipe shows above the fold at 390 px. Web only, so no eval rerun.
Cooking mode (this PR): `/recipes/[id]/cook` and `/recipes/mine/[id]/cook` (full-screen
`CookingMode` in `web/src/components/cooking-mode.tsx`): one step at a time, ingredient
checklist (with "for this step" chips matched from the step text), timers parsed from step text
in code (`web/src/lib/cooking.ts`, lower bound of a range), Screen Wake Lock, progress in
`localStorage["pantrila-cook:<user>:<corpus|mine>:<id>"]` for 12 h. "I cooked this" posts
`/me/cooked` (migration `20261019160000_cooked_meals`, RLS, applied on Supabase; latest 500 per user), which by
default takes the grams used out of measured pantry items (`cooking.py`; "some" items stay);
`/me/cooked/preview` shows that first. No model call, so no eval rerun.

Swap a meal (this PR): each meal on the Meal plan page has a swap button that opens a sheet
(`web/src/components/swap-meal.tsx`) listing recipes for that slot. `GET
/plans/latest/meals/{day}/{meal_type}/options` returns up to 6 recipes that pass the person's
current hard rules (SQL filters, then re-checked in code), best fit first; `PUT
/plans/latest/meals/{day}/{meal_type}` with `{plan_id, recipe_id}` re-checks the recipe, fits its
portions in code and saves the change in place (`Records.update_plan`; no migration, no new
plan, no usage event). A stale `plan_id` is a 409; a rule-breaking recipe a 422 with the
problems. The saved report keeps planning cost and path and recomputes warnings and pantry
use. No model call, so no eval rerun; offline tests cover ranking, rule checks and the API.
