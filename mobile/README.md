# Pantrila for iPhone and Android

The Expo (React Native) app, on the same API (`api.pantrila.com`) and Supabase sign-in as the web
app. Shared code comes from `packages/core` (`@pantrila/core/<module>`); styling is Uniwind (Tailwind
classes) with the design tokens in `src/global.css`. Plan and progress: `docs/plans/mobile-app.md`.

## Run it

```bash
npm ci                                   # from the repo root (one lockfile for web, mobile, packages)
cd mobile
cp .env.example .env.local               # public values only
npx expo start                           # then open the Pantrila development build on the phone
```

Expo Go is not enough (sign-in, sharing and voice need native code), so the phone runs a
**development build**, made once on EAS and reinstalled only when native code or config changes:

```bash
npx eas-cli init                         # once: links the Expo project; put the id it prints in app.config.ts
npx eas-cli build --profile development --platform android   # install from the link or QR code
npx eas-cli device:create                # once per iPhone (needs the Apple Developer account)
npx eas-cli build --profile development --platform ios       # then turn on Developer Mode on the iPhone
```

Sign-in needs `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the Google buttons need
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (`.env.example`; EAS environment
variables for builds). Dashboard steps: `docs/google-sign-in.md` (section 4) and `docs/apple-sign-in.md`.

Profiles in `eas.json`: `development` (dev client, internal), `preview` (internal testers),
`production` (stores).

## Screens

`src/app/(tabs)/` holds the tabs (Home, Assistant, Recipes, Plan, Grocery, in the web's order); the
header's account button opens `account.tsx`. Recipe pages are `recipes/[id]` (Pantrila's) and
`recipes/mine/[id]` (the cookbook), at the same paths as the web. Sheets (`src/components/sheet.tsx`) are one modal each; a flow with several steps changes the sheet's
content rather than opening another (iOS will not stack them). Screens still to come show `Soon`
(`src/components/soon.tsx`) with the PR that brings them. Data comes through SWR hooks in
`src/lib/hooks.ts`; anything kept on the phone for one person goes under `userKey(user.id, ...)`. Toasts
(`toast` from `src/lib/toast.ts`) show through the root layout's `Toaster`; cooking mode, a full-screen modal, has its own.

Cooking mode needs native modules a development build carries: `expo-keep-awake`, `expo-notifications` (timers
that ring with the phone locked), `expo-audio` (the ring and chime in `assets/sounds/`, written by
`scripts/cooking_sounds.py` at the repo root) and `expo-speech-recognition` (voice commands; its permission texts
are in `app.config.ts`).

## Checks

```bash
npm run lint && npm run typecheck && npm test   # in mobile/
npx expo-doctor
```

Screen tests render the routes with `expo-router/testing-library` and a fake API (`src/test/screens.tsx`);
`jest.setup.js` stands in for Uniwind's theme and AsyncStorage.

`src/uniwind-types.d.ts` is written by Metro (`npx expo start` or `npx expo export`); commit it when it
changes. Icons in `assets/` come from `web/brand/` via `node scripts/icons.mjs` in `web/`.

## End-to-end flows and store screenshots

`.maestro/` holds Maestro flows that drive a real build against the live API as a fresh guest: guest sign-in,
search, cooking mode, a plan and a pasted-text import (tag `e2e`; the plan and import cost about $0.02 a run),
and `screenshots.yaml` (tag `screenshots`), which takes the store screenshots listed in
`docs/store-listing.md`. They run on EAS Workflows from simulator and emulator builds (`e2e` profile in
`eas.json`, no Apple credentials needed):

```bash
npx eas-cli workflow:run e2e.yml           # in mobile/: Android emulator and iOS simulator
npx eas-cli workflow:run screenshots.yml   # iPhone 16 Pro Max (6.9") and Pixel 7; PNGs are the jobs' artifacts
maestro test .maestro/search.yaml          # locally, with the app on a simulator or emulator
```

The `e2e` builds use the EAS `preview` environment, so `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must be set
there. Store builds: `npx eas-cli build --profile production --platform all`, then `npx eas-cli submit`
(TestFlight; Play's closed testing track, `alpha`).

## Updates without a store review

`expo-updates` is in the app: each build profile has a channel (`development`, `preview`, `production` in
`eas.json`), and the runtime version is a fingerprint of the native code and config, so an update only reaches
builds with the same native side. A JavaScript or asset fix for store users:

```bash
npx eas-cli update --channel production --environment production --message "Fix the grocery list total"
```

The phone downloads it on launch and uses it from the next one. A change to native code (a new native module, a
plugin or `app.config.ts`) changes the fingerprint: that needs a new store build, and older builds keep their
last update.
