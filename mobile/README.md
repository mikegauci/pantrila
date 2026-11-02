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

CI runs `expo-doctor` without its "packages match the installed Expo SDK" check, because Expo's list changes each
time it publishes a patch; `npx expo install --check` runs after it as a warning only ("Expo packages out of date" on
the run's summary).

### Before a store build

1. `npx expo install --check` in `mobile/`; if it lists packages, `npx expo install --fix` and commit.
2. `npx expo-doctor` passes with every check.
3. If anything native changed since the last store build (an `expo-*` or React Native upgrade, a native module, a
   plugin or `app.config.ts`), raise `version` in `app.config.ts` and `package.json`.

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

### Automatic Android store builds

`.eas/workflows/store-android.yml` runs on EAS whenever a push to `main` changes `app.config.ts`, which is where
`version` is raised after a native change: it builds the `production` profile (EAS raises `versionCode`) and submits
the build to Play's `alpha` track. So the release path for a native change is: update packages, raise `version`,
merge. JavaScript-only fixes still go out with `eas update`. Start it by hand with
`npx eas-cli workflow:run store-android.yml`. It needs, once, from the owner:

1. expo.dev, project `pantrila`, GitHub: link `mikegauci/pantrila` with base directory `mobile`.
2. A Google Cloud service account (for example `eas-submit`, project `pantrila`, no roles), its JSON key uploaded
   under the project's Credentials, Android, "Google Service Account Key for Play Store Submissions", and the account
   invited in Play Console (Users and permissions) with "Release to testing tracks" on the app.
3. To let Claude Code sessions start builds too: an Expo access token (expo.dev, Account settings, Access tokens)
   stored in the cloud environment as `EXPO_TOKEN`.

## Updates without a store review

`expo-updates` is in the app: each build profile has a channel (`development`, `preview`, `production` in
`eas.json`), and the runtime version is the app's `version` in `app.config.ts`, so an update only reaches
builds of that version. A JavaScript or asset fix for store users:

```bash
npx eas-cli update --channel production --environment production --message "Fix the grocery list total"
```

The phone downloads it on launch and uses it from the next one. A change to native code (a new native module, a
plugin, `app.config.ts`, or an upgrade of React Native or an `expo-*` package, even a patch) needs a raised `version` and a new store build, so the update never reaches older
builds, which keep their last update. (The fingerprint policy was dropped: the config reads `EAS_BUILD_PROFILE`
and the `SENTRY_AUTH_TOKEN` secret, so the fingerprint on a Mac never matched the one on EAS and builds failed.)
