# Cooking XP, bingo cards and sharing

Goal: make Pantrila fun to come back to by rewarding **cooking**, not screen time. People earn XP when they cook,
level up through chef titles, fill bingo cards from their meal plan, and share what they made with the recipe's
creator tagged. Rewards (some of them Pro time) keep long-time users around and show Free users what Pro gives.

Decisions (owner, 2026-10-26):

- Who it is for: people learning to cook, people saving and sharing recipes, and people with a health goal who plan
  their meals.
- Focus on **cooking, recipes and planning**. No food-waste or leftovers score, and no food expiry tracking (checking
  use-by dates is not practical).
- **XP from cooking** is the core. Cook streaks stay small: a weekly cooking goal, not a daily streak.
- **Social sharing** matters most: a card of what you cooked, with the recipe's creator tagged, posted to Instagram,
  TikTok, Facebook or anywhere through the share sheet.
- **Solo and social, the person's choice**: everything works alone; small invite-only Kitchen Circles are opt-in.
- **Quiet**, not Duolingo: a few opt-in notifications a week at most, never a nag.
- **Phone first**, but the web app shows the same XP, levels, cards and badges (one server-side ledger).
- Free and Pro both get the game; Pro gets more of it (themed cards, streak freezes, card styles, more Circles), and
  levels unlock rewards that let Free users try Pro.

Defaults chosen for the open questions (owner, confirm or change before the PR that uses them):

1. **When**: start after the Google Play closed test is running (the mobile code PRs have all landed), one PR at a
   time. PR 7 (push notifications) needs a store build.
2. **Level rewards**: mostly small, cheap rewards (an extra plan this week, 5 extra imports this month); one
   **7-day Pro pass at level 5** and a **30-day pass at level 15**. Each pass costs model calls, so passes are
   limited to one at a time per person and only if they have never had Pro before.
3. **Dish photo**: the cook card offers "Take a photo of your dish" first and falls back to the recipe's photo. The
   photo is drawn into the card on the phone and is not uploaded (except to a Circle, PR 9, where the person
   chooses).
4. **Public recipe pages**: only for a person's **own** recipes (typed in or written with the assistant), and only
   when they publish one. Imported recipes are never republished; their cards link to the creator's original.
5. **Name**: plain "XP" with chef levels.

How to use this plan: one PR at a time, in order, each in a fresh chat ("do the next PR of
`docs/plans/gamification.md`"). Read this file and `CLAUDE.md` first. At the end of each PR, tick its checklist,
update Progress and the handoff log, and add an entry to [`docs/status-log.md`](../status-log.md). Owner steps are
marked **(owner)**.

## Rules for every PR

- **Never reward eating less.** No XP, badge or square for staying under calories, a "perfect macro day" or weight.
  Health goals count through *cooking a meal you planned*. Recordings and Circles never show diet, allergies or
  nutrition targets.
- **Safety is unchanged.** A challenge, bingo square or shared recipe never bypasses `constraints.py`: recipes
  suggested for a square come from the same filtered search, and cards show the rules a recipe breaks for the person,
  as everywhere else.
- **XP is decided on the server.** The phone and web never send "add 50 XP"; they send what happened (a cook, a
  share) and the API works out the XP from fixed rules in code. Same answer on every device.
- **Idempotent awards**: each award has a key (`kind` + `ref`), so a retried request or a replayed event never pays
  twice (as `subscription_events` does for webhooks).
- **No model call is planned**, so no eval reruns. If a PR adds one (for example, AI-written challenge text), it
  follows the eval rule in `CLAUDE.md`.
- **Every new user table** has RLS on in its migration and is added to `accounts.USER_TABLES` (the test that checks
  the list against the migrations will fail otherwise); account deletion removes everything.
- **Store rules**: XP and rewards are never sold (Apple 3.1.1: digital content is bought only through in-app
  purchase; free rewards are fine). Anything people post for others to see (Circles, public recipes) needs report and
  block (Apple 1.2, Google's user-generated content policy), and the terms page says so.
- **Copy** follows the paywall rules in `docs/plans/mobile-app.md` ("Converting Free users to Pro"): true claims only,
  no countdowns or fake urgency, no popups on launch, nothing in cooking mode except the end screen.
- Web and phone share logic through `@pantrila/core` (level curve formatting, card layout data, bingo grid),
  following `web/DESIGN_SYSTEM.md` on both.

## XP rules (PR 1 builds these; later PRs add their rows)

| What happened | XP | Limits |
| --- | --- | --- |
| Cooked a recipe (cooking mode, then "I cooked this") | 50 | once per recipe per day; a cook must pass the time check below |
| First time cooking that recipe | +25 | |
| First recipe of a cuisine you have not cooked before | +25 | |
| Cooked a meal that is in your current plan | +15 | once per plan meal |
| Cooked hands-free (voice used for at least half the steps) | +10 | once a day |
| Made a weekly plan | 10 | once a week |
| Saved or imported a recipe | 5 | 3 a day |
| Shared a cook card (PR 2) | 10 | once a day |
| Met your weekly cooking goal (PR 3) | 50 | once a week |
| Bingo line / full card (PR 4) | 30 / 100 | once each per card |
| Someone saves or cooks a recipe you published (PR 8) | 15 / 30 | once per person per recipe |

**Time check**: cooking mode starts a cook session when it opens (`POST /me/cook-sessions` returns an id), and "I
cooked this" sends that id. A cook earns XP only when the session has been open for at least a third of the recipe's
total time, capped at 10 minutes (a 5-minute salad needs about 2 minutes, a 2-hour stew 10). It is still logged
either way; it just earns no XP. This matters because XP unlocks rewards.

**Levels** (XP needed in total; the curve grows so early levels come fast):

| Level | Title | XP |
| --- | --- | --- |
| 1 | Kitchen Starter | 0 |
| 2 | Curious Cook | 150 |
| 3 | Home Cook | 400 |
| 5 | Line Cook | 1,000 |
| 8 | Sous Chef | 2,500 |
| 12 | Head Chef | 5,000 |
| 15 | Pantrila Master | 8,000 |

Levels in between keep the previous title with a number ("Home Cook 2"). The full table lives in
`src/pantrila/progress.py`, with a test that pins it.

## PR 1: XP, levels and titles (`feat/cooking-xp`)

- [ ] Migration: `xp_events` (`user_id`, `kind`, `ref`, `xp`, `created_at`, unique `(user_id, kind, ref)`), and
      `cook_sessions` (`id`, `user_id`, `recipe_id` or `cookbook_id`, `opened_at`, `voice_steps`). RLS on, both in
      `USER_TABLES`.
- [ ] `src/pantrila/progress.py`: the XP rules and level table above as code; `award(user, event)` returns the new
      awards and whether the level went up. `DbProgress` / `MemoryProgress`.
- [ ] `POST /me/cook-sessions` (cooking mode calls it on open, both web and phone); `POST /me/cooked` takes
      `session_id` and answers with the awards (`xp`, `level`, `level_up`). Plan, import and save routes award
      their XP too.
- [ ] `GET /me/progress`: XP, level, title, XP to the next level, this week's XP, latest 20 awards.
- [ ] One-time backfill: past `cooked_meals` rows earn their cook XP (no time check, since there were no sessions),
      so early users start with the XP they earned.
- [ ] Web and phone: level badge on the avatar (header and Account), a progress card on Home ("Home Cook · 120 XP to
      Line Cook"), and on the cooking end screen "+75 XP" with a short level-up moment (confetti, haptics on the
      phone; respects reduced motion).
- [ ] Core: `progress.ts` (formatting, the level curve for display).
- [ ] PostHog: `level_up` (`level`).
- [ ] Tests: each XP rule, the daily and weekly limits, the time check, idempotency (same key twice pays once), the
      backfill, the API routes; Jest and Playwright for the end screen and the Home card.

## PR 2: cook cards and creator tagging (`feat/cook-cards`)

The social piece. Phone first; the web gets the same card.

- [ ] At the end of cooking mode (and from the recipe page's "You cooked this"): **Share what you made**.
- [ ] The card (9:16 for Stories, 4:5 for feeds): the dish photo (camera first, else the
      recipe photo), the title, **"Recipe by @handle"** with the platform's mark for imported recipes
      (`source_platform`, `source_author`), the person's level badge, and a small "Made with Pantrila" with a link
      (`app.pantrila.com/recipes/...` for corpus recipes; the creator's original link for imported ones).
- [ ] Caption copied to the clipboard on share, since Instagram, TikTok and Facebook do not let apps fill in the
      caption or tags: "Made @handle's chicken broth bowl 🍲 #pantrila". A toast says "Caption copied, paste it in
      your post".
- [ ] Phone: draw the card with `react-native-view-shot`, share with the system share sheet; **Instagram Stories**
      directly as a sticker over a background when Instagram is installed (needs a Meta App ID, **(owner)**). New
      native modules, so a new development build.
- [ ] Web: the same card drawn to a canvas; Web Share API with the image file where supported, else Download and
      Copy caption.
- [ ] The dish photo stays on the device (drawn into the card, not uploaded).
- [ ] XP for a share (once a day). PostHog: `cook_card_shared` (`target`: stories, sheet, download; `has_photo`,
      `has_creator`).
- [ ] Tests: caption text per platform and for recipes with no creator, the card layout data in core, Jest for the
      share flow with the native modules mocked, Playwright for the web card.

## PR 3: weekly cooking goal (`feat/weekly-goal`)

The light streak.

- [ ] Profile and Home: "Cook N times a week" (1-7, default 3; asked once after the first cook, can be turned off).
- [ ] A week (Monday to Sunday, the person's time zone) meets the goal when it has N cooks that passed the time check.
      The streak counts **weeks** in a row that met it. Eating-out and skipped plan meals never count against it.
- [ ] Pro: one **streak freeze** a month, used automatically for a missed week.
- [ ] Home card: this week's cooks as dots, the week streak, +50 XP when met.
- [ ] Tests: week edges and time zones, freezes, a goal changed mid-week.

## PR 4: Plan Bingo (`feat/plan-bingo`)

- [ ] The current meal plan as a grid (days across, meal types down). Cooking a planned meal stamps its square (from
      PR 1's "cooked a meal in your plan"); eating out and skipped meals show as free squares, so nobody is punished
      for a night out.
- [ ] A full row or column: +30 XP and a small celebration; a full card: +100 XP and a badge.
- [ ] Plan tab (phone) and Plan page (web) get a Bingo view next to the list; the card can be shared as an image like
      PR 2's.
- [ ] Swapping a meal keeps its square if it was already cooked.
- [ ] Free and Pro both get it.
- [ ] Tests: lines in each direction, swaps, a new plan starts a new card, idempotent line awards.

## PR 5: badges and the cooking passport (`feat/cooking-passport`)

- [ ] Passport page (Account → "Your cooking"): cuisines cooked as stamps, meal types, total cooks, favourite recipe,
      this year's count.
- [ ] Techniques found in code from the steps of recipes cooked (a fixed word list: roast, braise, sauté, knead,
      poach, fold, caramelise...; tested, no model call).
- [ ] Badges with clear rules: first cook, 10 / 50 / 100 cooks, 5 cuisines, first bread, first imported recipe cooked,
      hands-free cook, a full bingo card, a year with Pantrila.
- [ ] Free: the summary and badges. Pro: the full passport (every stamp and technique, the year in review).
- [ ] PostHog: `badge_earned` (`badge`).

## PR 6: rewards and referrals (`feat/rewards`)

- [ ] Level rewards (default 2 in "Defaults" above; the owner may change them before this PR): an extra plan this week at level 3,
      5 extra imports at level 4, a **7-day Pro pass at level 5**, more small rewards after, a **30-day pass at
      level 15**. Shown on the level-up moment and in Account → "Rewards" as "Claim".
- [ ] Pro passes are `entitlements` rows with `store='manual'` and an `expires_at`; only for someone who never had
      Pro, one at a time; a store subscription takes over if they buy. The webhook already leaves `manual` rows alone.
- [ ] Extra allowance as a bonus row read by `operations.allowance` (no change to the caps themselves).
- [ ] Long-time members: on each yearly Pantrila anniversary, a badge and a card style; Pro members after a year of
      paid Pro get an exclusive card style and a seasonal card early (no free months unless the owner decides).
- [ ] **Referral**: a personal invite link; when the invited person cooks their first recipe, both get 7 days of Pro
      (or 5 extra imports if already Pro). Capped at 5 rewarded invites a year, only for new accounts that are not
      guests, to stop self-referral farming.
- [ ] Paywall copy and the Pro sheet mention the reward when it explains how a pass ends ("Your 7-day pass ends
      Monday. Nothing is charged; you go back to Free.").
- [ ] PostHog: `reward_claimed` (`reward`), `referral_sent`, `referral_completed`; trial starts after a pass get
      `source: reward`.
- [ ] Tests: claiming twice, a pass for someone who had Pro, a pass then a purchase, referral limits.

## PR 7: quiet notifications (`feat/push-notifications`)

Remote push was "Later" in the mobile plan; this PR brings it in.

- [ ] Phone: ask permission only after a moment that earns it (the first level-up or the weekly goal), never on
      first open. Expo push token saved with `POST /me/devices` (new table `push_devices`, RLS, in `USER_TABLES`).
- [ ] Settings (Account → Notifications): each kind on or off, quiet hours (default 21:00-08:00 local), and a cap of
      **3 a week** in total.
- [ ] Kinds: tomorrow's planned meal (evening before, "Tomorrow: chicken broth bowl"), one square left on your bingo
      card, weekly goal one cook away (Saturday), "Anna cooked your recipe" (PR 8/9), a reward ready to claim.
- [ ] Sent from the API through Expo's push service. Render's free plan has no cron, so a scheduled GitHub Actions
      workflow (or Supabase `pg_cron` calling an endpoint with a secret) runs `pantrila notify` every hour; **(owner)**
      picks one and sets the secret.
- [ ] Web: no push at first.
- [ ] PostHog: `push_sent` (`kind`), `push_opened` (`kind`), so a kind nobody opens can be dropped.
- [ ] **(owner)**: APNs key in EAS (iOS) and FCM credentials (Android), then a new build.
- [ ] Tests: the weekly cap, quiet hours across time zones, turned-off kinds, a device removed after Expo says it is
      gone.

## PR 8: publish your own recipes (`feat/public-recipes`)

- [ ] "Publish" on a cookbook recipe the person wrote (typed in or from the assistant; not imported). It gets a public
      page `app.pantrila.com/r/<slug>` (server-rendered, no sign-in, social preview image from the photo) with
      "Save to Pantrila" and "Cook it".
- [ ] Unpublish at any time; account deletion removes it.
- [ ] The page shows ingredients, method and the author's display name; no profile data, no nutrition targets.
- [ ] When someone saves or cooks it: XP to the author (once per person), and a notification if they allow it.
- [ ] Report button (reason and a note, email to `hello@pantrila.com`); a reported recipe can be hidden by the owner.
- [ ] Universal and app links already cover `app.pantrila.com`; `/r/` opens in the app when installed.
- [ ] Terms: what publishing means and what is not allowed.
- [ ] PostHog: `recipe_published`, `public_recipe_opened`, `public_recipe_saved`.

## PR 9: Kitchen Circles (`feat/kitchen-circles`)

- [ ] A Circle: a name, an invite link, up to 12 people. Free: join one Circle. Pro: create and join up to five.
- [ ] Each member chooses what the Circle sees: cooks (title, photo if they add one, the creator credit), level-ups,
      bingo cards. Nothing about diet, allergies or targets.
- [ ] Reactions only (a few emoji), no comments, so there is nothing to moderate beyond photos.
- [ ] **Circle Bingo**: one shared card a week that members fill together.
- [ ] Report a post, remove a member (the Circle's creator), block a person, leave a Circle.
- [ ] Photos in a Circle are uploaded to Storage under the person's folder and removed with the post or the account.
- [ ] Tables `circles`, `circle_members`, `circle_posts`, `circle_reactions` (RLS on, in `USER_TABLES`; a Circle with
      no members left is deleted).
- [ ] PostHog: `circle_created`, `circle_joined`, `circle_post`, `circle_reaction`.

## PR 10: monthly and seasonal challenge cards (`feat/challenge-cards`)

- [ ] A monthly card of 9 squares, written by the owner as data (`data/challenges/*.json`, checked by a test), for
      example: a new cuisine, a breakfast, a recipe from a creator, a hands-free cook, something under 30 minutes, a
      recipe a friend published, a bread, a soup, cook for 4.
- [ ] Each square shows matching recipes from the person's filtered search ("Show me some"), so safety rules still
      apply.
- [ ] Seasonal sets (Autumn soups, Christmas baking, summer salads) with a collectible badge.
- [ ] Free: the card is visible and the first square counts, so people can see what Pro gives. Pro: the whole card.
- [ ] PostHog: `challenge_square`, `challenge_complete`, and `paywall_shown` with `reason: challenge`.

## Measuring it

Before PR 1, write down the current numbers (PostHog, last 4 weeks) here; after each PR, compare.

- Cooks per active person per week (the main number).
- 4-week retention (`app_opened` on a day 22-28 days after `signed_up`).
- Shares per 100 cooks, and saves from shared links and public pages (growth).
- Trial starts with `source: reward` or `reason: challenge`, and how many of those pay after the trial.
- Push opens per kind (drop kinds under about 5%).

## Progress

| PR | Branch | State |
| --- | --- | --- |
| 1 | `feat/cooking-xp` | not started |
| 2 | `feat/cook-cards` | not started |
| 3 | `feat/weekly-goal` | not started |
| 4 | `feat/plan-bingo` | not started |
| 5 | `feat/cooking-passport` | not started |
| 6 | `feat/rewards` | not started |
| 7 | `feat/push-notifications` | not started |
| 8 | `feat/public-recipes` | not started |
| 9 | `feat/kitchen-circles` | not started |
| 10 | `feat/challenge-cards` | not started |

## Handoff log

Add one line per PR: date, PR link, what landed, anything the next PR must know.

- 2026-10-26: plan written (this file), from the owner's choices in chat.
