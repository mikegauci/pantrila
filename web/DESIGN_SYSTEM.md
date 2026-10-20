# Pantrila design system

Pantrila is an AI cooking and meal-planning assistant. Its UI follows the look of
**Nutrigo – Nutrition & Diet Dashboard** by Peterdraw
([Dribbble shot](https://dribbble.com/shots/25289981-Nutrigo-Nutrition-Diet-Dashboard-Figma-Template),
[ThemeForest](https://themeforest.net/item/nutrigo-nutrition-diet-dashboard-figma-template/55056572),
[free Figma version](https://www.figma.com/community/file/1482928954965781621/free-version-nutrigo-health-nutrition-diet-admin-dashboard)).

This file goes in the app repo as `web/DESIGN_SYSTEM.md`. Copy its tokens into
`web/src/app/globals.css` (Tailwind v4 `@theme`) and keep the two in sync.

## What is confirmed vs inferred

The Dribbble and Figma pages could not be opened from the build environment, so this
system is built from the product listings.

**Confirmed from the listings**
- Palette is **yellow, green and orange**, "bright, energetic colours inspired by fresh veggies".
- Typefaces are free Google Fonts (family not named).
- 12 screens: Dashboard, Calendar, Messages, Healthy Menu, Recipe Details, Meal Plan,
  Grocery, Food Diary, Progress, Exercise, Insight, Insight Details.
- Desktop 1440px, tablet 800px, mobile 390px frames.
- "Various graphics and charts" for diet and health progress.

**Inferred (check against the Figma file and adjust)**
- Exact hex values, the font family, radii, shadows and spacing below.
- Layout: left sidebar + top bar + card grid, which is the standard Peterdraw dashboard
  shape. Open the free Figma file and compare before building the first screen; if it
  differs, update this file first, then the code.

## Principles

1. **Fresh, not clinical.** Warm off-white canvas, white cards, food photography and
   produce colours. Avoid hospital blue and dense tables.
2. **One glance, one decision.** Each card answers one question ("What's for dinner?",
   "What do I need to buy?", "Am I on target today?").
3. **Show the AI's working.** Anything Pantrila generated shows why: the recipes it
   retrieved, the constraint it respected ("No peanuts: 3 recipes skipped"), the pantry
   items it used. Generated content carries a small sparkle badge.
4. **Safety is loud.** Allergen and diet conflicts use the danger colour and never hide
   behind a tooltip.

## Colour tokens

Green is the brand colour (fresh, healthy, primary actions). Yellow and orange are
accents for highlights and macro charts.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#F7F8F3` | `#121511` | Page canvas (warm off-white) |
| `--surface` | `#FFFFFF` | `#1B1F1A` | Cards, sidebar, popovers |
| `--surface-muted` | `#F1F3EC` | `#232823` | Inputs, inactive pills, table stripes |
| `--border` | `#E6E9E0` | `#2E342D` | Card and input borders |
| `--foreground` | `#1D2A1F` | `#EEF2EA` | Body text, headings |
| `--muted-foreground` | `#6B756B` | `#9AA59A` | Secondary text, labels |
| `--primary` | `#3FA34D` | `#5BC06A` | Primary buttons, active nav, links, progress |
| `--primary-foreground` | `#FFFFFF` | `#0E1A10` | Text on primary |
| `--primary-soft` | `#E4F4E5` | `#1F3A23` | Active nav background, selected chips |
| `--accent-yellow` | `#F9C74F` | `#F9C74F` | Highlights, "today" markers, carbs |
| `--accent-yellow-soft` | `#FEF4D6` | `#3A321A` | Highlight card backgrounds |
| `--accent-orange` | `#F8961E` | `#FFA94D` | Calories, streaks, "expiring soon" |
| `--accent-orange-soft` | `#FEEBD4` | `#3D2A15` | Orange card backgrounds |
| `--success` | `#2E9E4F` | `#5BC06A` | On target, in stock |
| `--warning` | `#E9A11B` | `#F5B83D` | Running low, near limit |
| `--danger` | `#E5484D` | `#FF6B6F` | Allergen conflict, over limit, errors |
| `--ring` | `#3FA34D` | `#5BC06A` | Focus ring |

### Chart and macro colours

Keep these fixed everywhere so a colour always means the same nutrient.

| Series | Colour |
|---|---|
| Protein | `--primary` (green) |
| Carbs | `--accent-yellow` |
| Fat | `--accent-orange` |
| Fibre | `#7CC6B0` (teal) |
| Calories (total) | `--foreground` line or ring |

Text on yellow uses `--foreground`, never white (white on `#F9C74F` fails contrast).

## Typography

Inferred: **Plus Jakarta Sans** (Google Fonts) for everything, loaded via `next/font/google`.
Rounded geometric sans is the Peterdraw house style; swap here if the Figma file says otherwise.

| Role | Size / line height | Weight |
|---|---|---|
| Display (dashboard greeting) | 28 / 36 | 700 |
| H1 page title | 24 / 32 | 700 |
| H2 card title | 18 / 26 | 600 |
| H3 section label | 15 / 22 | 600 |
| Body | 14 / 22 | 400 |
| Small / meta | 12 / 18 | 500 |
| Stat number (KPI) | 32 / 38 | 700, tabular numbers |

Numbers in stats, macros and grocery quantities use `font-variant-numeric: tabular-nums`.

## Shape, spacing, elevation

- **Radius:** cards `20px` (`rounded-[20px]`), buttons and inputs `12px`, pills and
  avatars full. Food images inside cards `16px`.
- **Spacing:** 4px base. Card padding 20px (24px desktop). Grid gap 20px desktop, 16px tablet, 12px mobile.
- **Elevation:** flat cards with a 1px `--border`; one soft shadow
  (`0 4px 20px rgb(29 42 31 / 0.06)`) for popovers, the chat panel and hovered recipe cards.
- **Icons:** Lucide, 20px in nav, 16px inline, 1.75 stroke.

## Layout

- **Desktop (≥1280, designed at 1440):** fixed left sidebar 248px (logo, nav, upgrade/help
  card at the bottom), top bar 72px (page title, search, date, notifications, avatar),
  content grid 12 columns, max width 1200.
- **Tablet (≥768, designed at 800):** sidebar collapses to a 76px icon rail; grid 8 columns.
- **Mobile (designed at 390):** bottom tab bar with 5 items (Home, Assistant, Recipes,
  Plan, Grocery); top bar keeps title and avatar; cards stack in one column.
- **Avatar:** 40px circle in the top bar (24px in the account menu) with a food emoji on a
  soft tint, both picked from a hash of the user id (`src/lib/avatar.ts`), so it stays the
  same for that user and nothing is stored; the email's first letter shows until the session loads.

## Screen map (Nutrigo → Pantrila)

| Nutrigo screen | Pantrila screen | Notes |
|---|---|---|
| Dashboard | **Home** | Greeting, "Ask Pantrila" assistant card, today's meals, macro ring, pantry "use it up" card, grocery preview |
| Healthy Menu | **Recipes** | Search box (hybrid RAG), filter chips (diet, time, cuisine), recipe card grid |
| Recipe Details | **Recipe** | Hero image, macros, ingredients ticked against pantry, steps, "swap ingredient" |
| Meal Plan + Calendar | **Meal plan** | Week grid (days × breakfast/lunch/dinner/snack), "Generate week" button, drag to swap |
| Grocery | **Grocery list** | Grouped by aisle, quantities merged across the plan, pantry items struck out |
| Food Diary | **Pantry** | What's in the kitchen, quantities, expiry dates, add by text or receipt photo |
| Messages | **Assistant** | Chat with the cooking agent; tool calls shown as small cards |
| Progress / Insight / Insight Details | **Insights** | Nutrition vs targets over time; a dev-only tab for eval scores, cost and latency |
| Exercise | (dropped) | Out of scope |

## Components

Built on shadcn/ui (Base UI) like TallyHawk, restyled with the tokens above.

- **Sidebar nav item:** 44px tall, 12px radius; active = `--primary-soft` background,
  `--primary` icon and text, 3px left indicator.
- **Stat card:** label (small, muted), big tabular number, delta pill
  (green up / orange down), optional sparkline.
- **Macro ring:** donut with protein/carbs/fat segments, calories in the centre,
  "of 2,100 kcal" underneath.
- **Recipe card:** 4:3 image with 16px radius, title (2 lines max), time + kcal + diet
  badges, "uses 4 of your pantry items" chip in `--primary-soft`.
- **Meal slot:** small card in the plan grid with thumbnail, name and kcal; empty slot is a
  dashed border with "+ Add".
- **Pantry row:** item, quantity, expiry pill (orange "2 days", red "expired").
- **Grocery item:** checkbox, name, merged quantity, the recipes that need it on hover.
- **Badges:** diet (vegan, gluten-free...) as soft green pills; allergen warnings as red pills
  with an icon; AI-generated as a yellow sparkle pill.
- **Chat message:** user bubbles `--primary` with white text; assistant bubbles `--surface`
  with border; tool-call cards inline ("Searched 412 recipes, 6 matched your filters").
- **Empty states:** a single food illustration, one sentence, one primary button.

## Motion

150ms ease-out for hovers and toggles, 250ms for panels. Streaming chat text fades in per
token chunk. Respect `prefers-reduced-motion`.

## Accessibility

- Text contrast at least 4.5:1 (check primary green on white for small text; use
  `#2E8A3B` for green text under 16px if it fails).
- Never use colour alone for macros or allergens: label every segment and pill.
- All charts have a text summary or table for screen readers.
- Focus ring 2px `--ring` with 2px offset.
