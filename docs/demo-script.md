# Demo video script

About 3 minutes, recorded on the live demo (https://pantrio-azure.vercel.app) at 1280×800.
Open the API's `/health` a minute before recording so Render's free instance is awake. Use a
fresh guest session so the daily caps are full.

## Before recording

- Browser zoom 100%, a clean window, notifications off.
- In a second tab: the LangSmith "Pantrio live" dashboard and one `plan` trace.
- In a third tab: `evals/reports/planner-2026-10-16T084243Z.md` on GitHub.

## Script

| Time | Screen | Say |
|---|---|---|
| 0:00 | Login page | "Pantrio plans a week of meals around your diet, allergies and what's already in your kitchen. The AI suggests, but every recipe and plan is checked by plain code before you see it." Click **Try it as a guest**. |
| 0:15 | Profile | Pick the vegetarian diet, peanut and tree nut allergies, 1900 kcal and an 80 g protein minimum, then Greek and Indian cuisines. "These are hard rules, except the targets, which are goals." Save. |
| 0:35 | Pantry | Add spinach, feta, chickpeas, eggs. "Free text is matched to a table of 207 foods: 'Eggs' becomes egg, and a typo gets suggestions instead of a guess." |
| 0:50 | Recipes | Search "quick dinner with chickpeas and spinach". Point at the green banner: "Only recipes that suit me. The allergy and diet filters are SQL clauses that run before the search, so the model never sees a recipe with nuts." Toggle **Only what suits me** off to show a red rule-breaking badge, then back on. |
| 1:10 | Recipe page | Show per-serving macros ("protein, carbs and fat"), change servings, click **Swap** on an ingredient. "Swaps are re-checked: nutrition and allergens are recomputed from the new ingredient." |
| 1:30 | Meal plan | Click **Plan my week**. While the steps tick by: "This is a LangGraph agent. It retrieves candidates per meal, drafts a plan, then code fits the portions and checks every rule. Problems go back to the model up to twice; if a meal still breaks a hard rule, code replaces it." When the plan lands, point at the energy and protein bars and any warning. |
| 2:05 | Grocery list | "What the week needs, minus the pantry, rounded up to shop amounts." Change people to 2. |
| 2:15 | Assistant | Ask "I have chickpeas and spinach, what can I make tonight in under 30 minutes?" Point at the tool call line and the cited recipe chips. "Cited recipes go through a guard: anything that breaks your rules or doesn't exist gets flagged." |
| 2:35 | Insights | "Every call is logged: about two cents a plan and a fifth of a cent per chat turn. Under that are the offline evals: zero hard violations across 16 profiles, recall at 10 of 0.84 for search." |
| 2:50 | LangSmith tab | Show the dashboard (requests, cost, latency, plan quality), then open one `plan` trace to show the graph nodes. "Every prompt or model change is measured against these before it ships." |
| 3:00 | | End on the plan page. |

## After recording

Upload unlisted (YouTube or Loom), then add the link at the top of `README.md` next to the
live demo.
