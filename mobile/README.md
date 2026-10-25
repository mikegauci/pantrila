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

Profiles in `eas.json`: `development` (dev client, internal), `preview` (internal testers),
`production` (stores).

## Checks

```bash
npm run lint && npm run typecheck && npm test   # in mobile/
npx expo-doctor
```

`src/uniwind-types.d.ts` is written by Metro (`npx expo start` or `npx expo export`); commit it when it
changes. Icons in `assets/` come from `web/brand/` via `node scripts/icons.mjs` in `web/`.
