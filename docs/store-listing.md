# Store listing, privacy answers and review notes

What goes into App Store Connect and Play Console for Pantrila, kept here so it is versioned.
Paste each block as written. A heading's `(max N)` is the store's character limit;
`tests/test_store_listing.py` checks every block against it.

App: **Pantrila**, bundle id and package `com.pantrila.app`. Support `https://pantrila.com`
(contact `hello@pantrila.com`), privacy `https://pantrila.com/privacy`, terms `https://pantrila.com/terms`,
account deletion `https://pantrila.com/privacy#delete-account`.

## App Store (iPhone)

### App name (max 30)

```text
Pantrila: AI Cooking Companion
```

### Subtitle (max 30)

```text
Ask, save, cook and plan meals
```

### Promotional text (max 170)

```text
Ask what to cook, save recipes from any post and cook hands-free with your voice. Every suggestion is checked against your allergies and diet.
```

### Keywords (max 100)

```text
meal plan,recipes,grocery list,pantry,allergy,diet,recipe import,voice,vegan,gluten free,macros,chef
```

### Description (max 4000)

```text
Pantrila is your AI cooking companion, from the first idea to the last step at the stove. Tell it your diet, your allergies, the foods you never eat and your nutrition targets once, and everything it suggests is checked against them.

ASK ANYTHING
"What can I make tonight?" Pantrila answers from its recipe library and your pantry. It swaps an ingredient, scales a recipe or writes a new one you can save, and tells you how long to rest the dough. It cites the recipes it recommends and warns you when something breaks your rules. Tell it what you bought and it adds it to your pantry.

SAVE RECIPES FROM ANYWHERE
Saw a recipe on Instagram, TikTok or Facebook? Share the post to Pantrila, paste a recipe link, snap a cookbook page or type it in. Pantrila reads the caption, follows the creator's link or listens to the video, then saves it to your cookbook with amounts, steps and nutrition, keeping the creator's notes and credit.

COOK IT, HANDS FREE
Cooking mode shows one step at a time with the ingredients for that step, starts the timers the method asks for and keeps the screen awake. Timers ring even with the phone locked. Turn on the mic and say "next", "back", "start timer" or "stop timer" while your hands are in the bowl.

PLAN AND SHOP
Pantrila drafts your week from recipes that fit your calories and protein, uses what is in your pantry first, and writes a grocery list of only what is missing, sorted by aisle. Swap a meal, eat out, skip one or cook once for leftovers.

THE AI SUGGESTS. RULES DECIDE.
An allergy is not something to leave to a language model. Each recipe's allergens and diets are worked out in code from its ingredients, covering the 14 allergens EU food law requires labels for. Your rules filter the recipes before the AI sees them, and every plan is checked again, meal by meal. Nutrition comes from USDA and Ciqual food data. Products differ, so if an allergy is serious, always check labels yourself. Pantrila is not medical advice.

FREE AND PRO
Pantrila is free to use: 1 meal plan a week, 5 recipe imports a month and 10 questions a day, with no ads. Pantrila Pro gives 5 meal plans, 20 recipe imports and 50 assistant messages a day, and AI photos for your own recipes: €4.99 a month or €29.99 a year, with a 7-day free trial.

Payment is charged to your Apple Account at confirmation of purchase. The subscription renews automatically unless it is cancelled at least 24 hours before the end of the current period. Your account is charged for renewal within 24 hours before the end of the current period. Manage or cancel the subscription in your Apple Account settings at any time after purchase.

Try it as a guest with no account, or continue with Apple, Google or an email link.

Terms: https://pantrila.com/terms
Privacy: https://pantrila.com/privacy
```

### Settings

| Field | Answer |
| --- | --- |
| Primary category | Food & Drink |
| Secondary category | Health & Fitness |
| Age rating | 4+ (every questionnaire answer "None" or "No"; no user-to-user chat, no web browsing, no gambling) |
| Price | Free, with in-app purchases |
| Copyright | 2026 Mike Gauci |
| Encryption | Standard HTTPS only (`usesNonExemptEncryption: false` in `app.config.ts`) |
| Sign-in for review | None needed (guest), see the review notes |

### In-app purchases (auto-renewable subscriptions)

One subscription group, **Pantrila Pro**, with two products. The ids are suggestions: the app finds the
products through the RevenueCat offering, so other ids work if the review notes match. Both carry a 7-day free introductory offer
(new subscribers). RevenueCat entitlement `pro`, offering `default` with the yearly package first.

| Product id | Duration | Price (EUR) | Display name | Description (max 45) |
| --- | --- | --- | --- | --- |
| `pantrila_pro_yearly` | 1 year | €29.99 | Pantrila Pro yearly | More plans and imports, AI recipe photos |
| `pantrila_pro_monthly` | 1 month | €4.99 | Pantrila Pro monthly | More plans and imports, AI recipe photos |

Each product needs a review screenshot of the paywall (screenshot 08 below) to be "Ready to Submit".

### App privacy ("nutrition label")

Tracking: **No**. Pantrila has no ad SDKs, does not link its data with other companies' data for ads, and
shares nothing with data brokers. Every type below is **linked to the user** (the account id) and is
**not used for tracking**.

| Data type | Collected | Used for | Where it comes from |
| --- | --- | --- | --- |
| Contact info: Email address | Yes | App functionality | Google, Apple or email-link sign-in (none for a guest) |
| Contact info: Name | Yes | App functionality | Google sign-in, or Apple's first sign-in |
| Health & fitness: Health | Yes | App functionality | Allergies, diet and nutrition targets in Profile |
| User content: Photos or videos | Yes | App functionality | The profile picture (import photos are not kept) |
| User content: Other user content | Yes | App functionality | Pantry, plans, chats, cookbook recipes, cooked meals |
| Identifiers: User ID | Yes | App functionality, analytics | Supabase account id (also RevenueCat, PostHog, Sentry) |
| Purchases: Purchase history | Yes | App functionality | Pro subscription state from RevenueCat |
| Usage data: Product interaction | Yes | Analytics | PostHog funnel events (sign-up, import, plan, cooking mode, paywall) |
| Diagnostics: Crash data | Yes | App functionality | Sentry error reports |
| Diagnostics: Performance data | Yes | App functionality | Sentry traces (10% of requests) |
| Diagnostics: Other diagnostic data | Yes | App functionality | Phone model and OS in Sentry reports, feedback |

Not collected: location, contacts, browsing or search history, audio (speech becomes words on the phone or at
Apple; no recording reaches Pantrila), financial info (the store handles payment), sensitive info beyond the
food profile above. Photos sent for an import are used for that request only and deleted when it ends.

## Google Play (Android)

### App name (max 30)

```text
Pantrila: AI Cooking Companion
```

### Short description (max 80)

```text
Ask what to cook, save recipes from any post, cook hands-free. Allergy-checked.
```

### Full description (max 4000)

```text
Pantrila is your AI cooking companion, from the first idea to the last step at the stove. Tell it your diet, your allergies, the foods you never eat and your nutrition targets once, and everything it suggests is checked against them.

ASK ANYTHING
"What can I make tonight?" Pantrila answers from its recipe library and your pantry. It swaps an ingredient, scales a recipe or writes a new one you can save, and tells you how long to rest the dough. It cites the recipes it recommends and warns you when something breaks your rules. Tell it what you bought and it adds it to your pantry.

SAVE RECIPES FROM ANYWHERE
Saw a recipe on Instagram, TikTok or Facebook? Share the post to Pantrila, paste a recipe link, snap a cookbook page or type it in. Pantrila reads the caption, follows the creator's link or listens to the video, then saves it to your cookbook with amounts, steps and nutrition, keeping the creator's notes and credit.

COOK IT, HANDS FREE
Cooking mode shows one step at a time with the ingredients for that step, starts the timers the method asks for and keeps the screen awake. Timers ring even with the phone locked. Turn on the mic and say "next", "back", "start timer" or "stop timer" while your hands are in the bowl.

PLAN AND SHOP
Pantrila drafts your week from recipes that fit your calories and protein, uses what is in your pantry first, and writes a grocery list of only what is missing, sorted by aisle. Swap a meal, eat out, skip one or cook once for leftovers.

THE AI SUGGESTS. RULES DECIDE.
An allergy is not something to leave to a language model. Each recipe's allergens and diets are worked out in code from its ingredients, covering the 14 allergens EU food law requires labels for. Your rules filter the recipes before the AI sees them, and every plan is checked again, meal by meal. Nutrition comes from USDA and Ciqual food data. Products differ, so if an allergy is serious, always check labels yourself. Pantrila is not medical advice.

FREE AND PRO
Pantrila is free to use: 1 meal plan a week, 5 recipe imports a month and 10 questions a day, with no ads. Pantrila Pro gives 5 meal plans, 20 recipe imports and 50 assistant messages a day, and AI photos for your own recipes: €4.99 a month or €29.99 a year, with a 7-day free trial. The subscription renews automatically until you cancel it in Google Play.

Try it as a guest with no account, or continue with Google or an email link.

Terms: https://pantrila.com/terms
Privacy: https://pantrila.com/privacy
```

### Graphics

App icon `docs/store-assets/play-icon-512.png` (512 x 512) and feature graphic
`docs/store-assets/play-feature-graphic-1024x500.png`, both rendered by `node scripts/store-art.mjs` (from `web/`).

### Settings

| Field | Answer |
| --- | --- |
| App or game | App |
| Category | Food & Drink |
| Tags | Meal planning, Recipes, Cooking |
| Contact email | hello@pantrila.com |
| Website | https://pantrila.com |
| Privacy policy | https://pantrila.com/privacy |
| Ads | No, the app contains no ads |
| App access | All functionality is available without special access: "Try it as a guest" on the first screen needs no account. (If Play asks for instructions anyway, paste the review notes.) |
| Content rating (IARC) | Category "Reference, News, or Educational" is wrong; choose "All other app types". Every question "No" (no violence, sexuality, language, controlled substances, gambling, user-to-user interaction or shared location). Expected rating: Everyone / PEGI 3 |
| Target audience | 18 and over (the privacy policy says not for children under 16; picking 13-17 or younger brings the Families policy) |
| News app | No |
| Health apps | Not a medical or health app; it does not diagnose or treat. If asked, "Nutrition and weight management" |
| Government app | No |
| Financial features | None |

### Subscriptions (Monetize, Products, Subscriptions)

| Product id | Base plan id | Period | Price (EUR) | Offer |
| --- | --- | --- | --- | --- |
| `pantrila_pro` | `yearly` | 1 year, auto-renewing | €29.99 | `trial-7d`: 7 days free, new customers |
| `pantrila_pro` | `monthly` | 1 month, auto-renewing | €4.99 | `trial-7d`: 7 days free, new customers |

RevenueCat imports these as `pantrila_pro:yearly` and `pantrila_pro:monthly`; put them in the `default`
offering's annual and monthly packages next to the App Store products.

### Data safety

Data is **encrypted in transit** (HTTPS only). People **can ask for their data to be deleted** (in the app:
Account, Delete account; on the web: `https://pantrila.com/privacy#delete-account`). Nothing is **shared**
with third parties in Google's sense: every processor below acts for Pantrila (Google's "service provider"
exception). Committed to Play Families policy: No (not for children).

| Category: data type | Collected | Optional | Purpose |
| --- | --- | --- | --- |
| Personal info: Name | Yes | Yes (guests give none) | Account management |
| Personal info: Email address | Yes | Yes (guests give none) | Account management |
| Personal info: User IDs | Yes | No | App functionality, Analytics, Account management |
| Health and fitness: Health info | Yes | Yes | App functionality (allergies, diet, nutrition targets) |
| Photos and videos: Photos | Yes | Yes | App functionality (profile picture) |
| App activity: App interactions | Yes | No | Analytics (PostHog funnel events) |
| App activity: Other user-generated content | Yes | Yes | App functionality (pantry, plans, chats, recipes) |
| Financial info: Purchase history | Yes | Yes | App functionality (Pro subscription state) |
| App info and performance: Crash logs | Yes | No | App functionality (Sentry) |
| App info and performance: Diagnostics | Yes | No | App functionality (Sentry traces) |

Not collected: location, contacts, calendar, messages, files, audio (speech becomes words on the phone or at
Google; no recording reaches Pantrila), web browsing, device or other ids, payment info (Google Play handles
it). Photos sent for an import are processed for that request only ("ephemeral") and are not declared as
collected.

### Permissions Play asks about

| Permission | Why |
| --- | --- |
| `RECORD_AUDIO` | Voice commands in cooking mode and the assistant's microphone button, only while they are on |
| `POST_NOTIFICATIONS` | Cooking timers and the trial reminder, scheduled on the phone (no push) |
| `SCHEDULE_EXACT_ALARM` | Not requested; timers use exact-while-idle alarms |
| `READ_EXTERNAL_STORAGE` (Android 12 and older) | Picking recipe photos on old Android versions |

## Review notes (both stores)

```text
No account is needed: on the first screen tap "Try it as a guest". Every feature works as a guest.

Pantrila Pro (auto-renewing subscription, 7-day free trial):
- App Store: pantrila_pro_yearly (€29.99 a year) and pantrila_pro_monthly (€4.99 a month), group "Pantrila Pro".
- Google Play: pantrila_pro with base plans yearly and monthly.

To reach the paywall: tap the account button (top right) to open Account, then "Try Pro free for 7 days" under "Your plan". It also opens when a Free limit is reached, for example a second meal plan in the same week (Plan tab, "Plan a new week").

Restore purchases, the renewal terms, Terms of Use (https://pantrila.com/terms) and the Privacy Policy (https://pantrila.com/privacy) are on the paywall. "Manage subscription" in Account opens the store's subscription page.

Account deletion: Account, Delete account, type "delete". It deletes the account and all its data at once.

Sign in with Apple is offered next to Google sign-in. The app shows no ads and does no tracking.

Voice commands (cooking mode microphone) use on-device speech recognition when the phone supports it. Cooking timers are local notifications.

Native features beyond the website: share recipes into the app from other apps (share sheet), voice control while cooking, timers that ring with the phone locked, camera import of cookbook pages.
```

## Screenshots

Taken by `.maestro/screenshots.yaml` (run `npx eas-cli workflow:run screenshots.yml` in `mobile/`), on an iPhone
16 Pro Max simulator (6.9", 1320 x 2868; App Store Connect scales it for the smaller iPhones, so 6.5" shots are
optional) and a Pixel 7 emulator (1080 x 2400, within Play's limits). The app is phones only
(`supportsTablet: false`), so no iPad shots. Order and caption for each (captions are added in the store's
own frame tool or left out):

| # | Screen | Caption |
| --- | --- | --- |
| 01 | Plan, a planned week | A week of meals that fits your diet |
| 02 | Grocery list | Only what your pantry is missing |
| 03 | Recipes with "Only what suits me" | 300 recipes, checked for your allergies |
| 04 | A recipe page | Nutrition worked out from every ingredient |
| 05 | Cooking mode, step 1 | Cook hands-free, one step at a time |
| 06 | Assistant reply with recipe cards | Ask what to cook tonight |
| 07 | Import from social media | Save recipes from TikTok, Instagram and Facebook |
| 08 | Paywall (by hand, on a build with the RevenueCat key: Account, Your plan) | For the in-app purchase review only |

Play also needs a **feature graphic** (1024 x 500 PNG): the white mark on the brand green (`web/brand/`), with
"Pantrila" beside it.

## Testing before launch

- **Google Play**: a new personal developer account must run a **closed test** with at least 12 testers who
  stay opted in for 14 days in a row before it can apply for production. Upload the first production build to
  the closed testing track by hand once (Play needs one manual upload before `eas submit` can use the API),
  then `npx eas-cli submit --platform android --profile production` sends later builds there (`eas.json`
  `submit.production.android.track` is `alpha`, Play's closed track). Testers join through the opt-in link.
- **Apple**: no minimum test. TestFlight is optional: internal testers (the team, up to 100) need no review;
  external testers need a short Beta App Review. `npx eas-cli submit --platform ios --profile production`
  uploads to TestFlight.
