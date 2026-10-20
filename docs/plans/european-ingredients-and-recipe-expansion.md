# Plan: European nutrition data and 100 sourced recipes

Owner-approved scope, 20 October 2026. Four sequential PRs; use a fresh chat per PR to
keep context small. This file is the implementation brief and progress record. Read
`CLAUDE.md` and applicable `AGENTS.md` instructions too. No previous conversation is needed.

## Current handoff

- **Status: PR 1 complete in [PR #38](https://github.com/mikegauci/pantrio/pull/38).** Eight ingredient additions;
  no new recipes, production database writes, embeddings or photos.
- **Next action: confirm PR #38 merged and live prerequisites, then implement PR 2 only.** Begin with public corpus provenance
  and per-page licensing review for the 5–10 dessert pilot. Verify live prerequisites below
  before exposing dependent recipes.
- Baseline observed during planning: 300 corpus recipes, 23 tagged as dessert, approximately
  210 ingredient keys. PR 1 confirmed this baseline; the table now has 218 keys.
- Target: **100 additions: 60 desserts and 40 everyday recipes**, for 400 corpus recipes if
  all candidates qualify. The 5–10 dessert pilot counts toward the 60; it is not extra.
- The target is not a quota. Report any shortfall instead of adding duplicates, incomplete
  recipes or undisclosed AI-generated filler.
- Keep the existing 300 recipes and ingredient keys. Do not convert the whole collection to
  Ciqual or regenerate existing recipes as part of this additive release.
- Initial recipe source: **Wikibooks Cookbook**, subject to per-page review and licensing.
  **ANSES Ciqual backs nutrition values, not recipe instructions or kitchen testing.**

## PR sequence and progress

| PR | Scope | Dependency | Status |
|---|---|---|---|
| 1 | European ingredient support and dessert safeguards | None | Complete — [#38](https://github.com/mikegauci/pantrio/pull/38) |
| 2 | Recipe provenance, attribution and 5–10 dessert pilot | PR 1 merged | Not started |
| 3 | Expand to 60 added desserts, including pilot | PR 2 merged | Not started |
| 4 | Add 40 everyday recipes | PR 3 merged | Not started |

Each PR must leave the application working. Follow the repository's branch, review, CI and
delivery instructions. Use readable commits within each PR; split recipe content into small
batches of about 20–25 or fewer. Do not create a separate PR for every recipe batch.

Update this file and the short `CLAUDE.md` status as work lands. Record the actual PR URL,
counts, tests, eval reports, deployment state and next action. Never mark kitchen testing or
deployment complete based only on local checks.

## Decisions and acceptance rules

### Nutrition and ingredient data

Pantrio currently joins `ingredients.csv` to `usda_foods.csv` by `fdc_id`. USDA provides
nutrition; Pantrio's curated metadata provides allergens, diet classes and unit conversions.

- Support multiple nutrition sources without pretending Ciqual codes are USDA IDs. Store
  source, source food code, dataset version, source URL and required attribution per ingredient.
- Keep existing USDA values and keys stable. Preserve personal cookbook and estimated-food
  compatibility. Do not silently remap saved estimates to newly supported ingredients.
- Build a reproducible importer and commit the selected normalized data. Record upstream
  version and checksum. No dataset download or live nutrition API is needed at app runtime.
- Document selected energy, protein, carbohydrate, fat and fibre fields and conversions.
  Reconcile USDA/Ciqual nutrient definitions before combining them. Prefer retaining the app's
  existing carbohydrate convention for this release where a defensible conversion is possible.
  Do not silently change low-carbohydrate classifications or mix incompatible definitions.
- Handle missing, trace and "less than" values explicitly. Unknown is not zero. Reject an
  unsupported entry or use a clearly documented compatible fallback; do not invent values.
- Match the actual ingredient: whole eggs, whites and yolks; sweetened condensed versus
  evaporated milk; cream fat levels; butter versus vegetable-fat pastry; unsweetened cocoa
  versus drinking chocolate; gelatin versus agar. Add distinct keys when necessary.
- Start new ingredients with grams. Add volume or piece conversions only with supporting
  evidence; no invented weight for a gelatin sheet, pastry sheet, biscuit or scoop.
- Review allergen/diet metadata separately. Resolve animal-derived setting agents and mixed
  products conservatively; do not infer a gelatin's animal origin from a generic nutrient row.
  Exclude unresolved cases. Generic metadata cannot establish product-specific cross-contact.

Official sources researched during planning (verify current documentation/terms at import):

- [Ciqual 2025 overview](https://ciqual.anses.fr/cms/en/2025-anses-ciqual-table)
- [English dataset](https://ciqual.anses.fr/cms/sites/default/files/inline-files/Table%20Ciqual%202025_ENG_2025_11_03.xlsx)
- [English methodology](https://ciqual.anses.fr/cms/sites/default/files/inline-files/Table%20Ciqual%202025%20doc%20ENG_2025_11_19.pdf)
- [Reuse and attribution conditions](https://ciqual.anses.fr/cms/en/node/22)

Candidate Ciqual entries verified in the downloadable dataset during planning:

| Ingredient | Ciqual code |
|---|---:|
| Mascarpone | 19584 |
| Sweetened condensed milk | 19027 |
| Milk chocolate | 31004 |
| White chocolate | 31010 |
| Sponge fingers / ladyfingers | 24430 |
| Dried gelatin | 11007 |
| Butter puff pastry, raw | 23424 |

Recheck mappings and required nutrient completeness. These are candidates, not permission
to assume all brands, gelatin origins or pastry formulations have identical composition.

### Recipe sourcing, review and licensing

- Source full recipes from Wikibooks Cookbook; verify each page's licence, attribution and
  third-party notices. [Wikibooks licensing policy](https://en.wikibooks.org/wiki/Wikibooks:Copyrights).
- Store original title, source URL, page revision, retrieval date, required attribution,
  licence name/URL, adaptation notes and review status/method/evidence.
- Design public corpus provenance separately from personal cookbook social-media handles.
  Existing AI-generated recipes must retain accurate provenance.
- Preserve attribution, licence and modification notices through storage, API responses and
  required display surfaces. Adapted text must comply with the applicable ShareAlike terms.
  Inspect each image's licence separately; the text licence does not establish image rights.
- Review every quantity, serving yield, essential equipment/tin size, oven temperature,
  preparation, cooking, cooling/chilling times and relevant handling instructions.
- Preserve the method and amounts. Convert units deterministically. Do not invent missing
  quantities, silently substitute ingredients or omit unresolved lines. Record adaptations.
- Choose complete, plausible recipes. Distinguish automated consistency checks, editorial
  review and actual kitchen testing. Only claim the review/testing that actually occurred.
- Nutrition/ingredient scaling must not infer a baking time or tin size. Keep original yield,
  equipment and timing clear, including limitations when cooking a scaled batch.
- Avoid duplicate dishes and superficial variations added merely to reach the target.
- If suitable Wikibooks recipes run out, report the validated subset and shortfall. Do not
  change sources or fill the gaps with AI generation without resolving that product decision.

### Dessert substitutions

Current `swaps.py` suggests ingredients by broad aisle/protein group and nutrition similarity,
replaces equal weights, and leaves method steps unchanged. Allergy/diet compatibility does
not establish that the substitution will work in baking.

- Restrict automatic swaps for structural dessert ingredients unless an explicit supported
  rule exists. Cover flour, eggs, raising/setting agents and other recipe-critical ingredients.
- Enforce the restriction centrally across suggestions, direct API calls and assistant tools,
  not only in the UI. Keep existing behaviour outside this scope unless fixing a related defect.
- Do not introduce unverified baking-substitution formulas or label a swap culinarily suitable
  solely because it passes deterministic diet/allergen rules.

### Compatibility and deployment

- Capture recipe IDs, ingredient keys and derived nutrition/allergen/diet results before edits.
  Compare the existing 300 recipes afterward and explain every intended difference.
- Audit stale limits: `UserProfile` pantry/exclusion lists currently cap at 207; corpus generation
  has stricter serving/time limits than `Recipe`. Choose deliberate bounded limits and test
  their boundaries. Do not falsify yield, omit chilling or truncate methods to pass validation.
- **Database hazard:** `db.seed` deletes corpus recipes absent from its input. Add an expansion
  safeguard, confirm all existing IDs are preserved and protect personal cookbook data.
- Deploy prerequisite application support before exposing dependent recipes. Coordinate code,
  ingredient data, catalogue and embeddings; restart workers/caches as needed so food schemas
  and loaders see the same version. Prepare a rollback using prior code/data versions.
- Use existing photo workflows with verified image rights or accurately labelled generated
  images. Keep new photos limited to the actual recipe ingredients.
- Display accurate mixed-source attribution; do not imply all nutrition now comes from Europe.

## PR 1: European ingredient support and dessert safeguards

Deliver the data foundation and safeguards together, before publishing new recipes.

- [x] Capture baseline; inspect existing code and tests.
- [x] Add source-independent nutrition identity/provenance, including estimated-food compatibility.
- [x] Implement reproducible Ciqual subset importer, source manifest and committed normalized data.
- [x] Document nutrient conventions and test mixed-source calculations independently.
- [x] Add reviewed dessert ingredients, exact mappings, diet/allergen metadata and supported units.
- [x] Restrict unsupported dessert substitutions across UI/API/assistant paths.
- [x] Audit ingredient-count, serving and duration bounds; retain deliberate request limits.
- [x] Add a safeguard against destructive partial-corpus seed operations.
- [x] Add truthful nutrition attribution and update relevant documentation.
- [x] Run regression tests/corpus checks and required before/after evals; explain baseline changes.
- [x] Complete repository delivery workflow and record deployed versus local state (see #38).

Starting points: `foods.py`, `nutrition.py`, `corpus.py`, `cookbook.py`, `recipe_import.py`,
`schema.py`, `swaps.py`, `db.py`, `scripts/build_usda_table.py`, `data/ingredients.csv`,
`data/usda_foods.csv`, `tests/test_foods.py`, `tests/test_nutrition.py`, `tests/test_corpus.py`.
Python modules are under `src/pantrio/`. Inspect API and web consumers before changing shapes.

## PR 2: Recipe provenance and 5–10 dessert pilot

- [ ] Implement public corpus provenance through file models, persistence, API and UI.
- [ ] Keep old corpus/personal recipes compatible; do not fabricate provenance.
- [ ] Select 5–10 missing desserts with suitable complete methods and verified reuse terms.
- [ ] Record stable source revisions, attribution, licences, adaptations and review evidence.
- [ ] Add any remaining supported ingredient entries before admitting recipes.
- [ ] Validate quantities, yield, tin/equipment, total elapsed time and handling instructions.
- [ ] Verify recipe display, search, filters, planning, imports, cooking mode, scaling and groceries.
- [ ] Handle source-image licences or generate accurately labelled recipe photos.
- [ ] Regenerate derived evaluation data as required; run tests and relevant evaluations.
- [ ] Deploy and verify pilot only after prerequisite code/data are available; update handoff.

Candidate pages to inspect, not pre-approved recipes:

- [Tiramisù](https://en.wikibooks.org/wiki/Cookbook:Tiramis%C3%B9)
- [New York cheesecake](https://en.wikibooks.org/wiki/Cookbook:New_York_Cheesecake)
- [Carrot cake II](https://en.wikibooks.org/wiki/Cookbook:Carrot_Cake_II)

## PR 3: Expand to 60 added desserts

- [ ] Count accepted pilot recipes toward the 60; normally 50–55 further additions.
- [ ] Select familiar missing desserts and remove duplicates/near-duplicates.
- [ ] Apply the same ingredient, method, provenance, licensing and review rules to every recipe.
- [ ] Add any further ingredients with traceable nutrition and reviewed safety metadata.
- [ ] Use small content commits; validate each batch and generate permitted photos.
- [ ] Run corpus/retrieval checks, regenerate derived eval files where needed and compare baseline.
- [ ] Release verified recipes/embeddings after dependencies; record actual count and shortfall.

## PR 4: Add 40 everyday recipes

- [ ] Select familiar missing everyday recipes, avoiding the existing corpus and PR 3 dishes.
- [ ] Apply the same sourcing, mapping, licensing, completeness and review standards.
- [ ] Include supported ingredient additions and permitted recipe photos.
- [ ] Validate in small content batches; run relevant retrieval/planning tests and evaluations.
- [ ] Release with prerequisite code/data and verify original catalogue/user data remain intact.
- [ ] Record final counts, exclusions, deployment/rollback state and remaining limitations.

## Verification and evaluation rules

Run checks appropriate to each PR and the repository's required CI. Useful existing commands:

```bash
uv run pantrio corpus check
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

Run web checks for affected UI/types. Add meaningful tests for missing/qualified values,
cross-source definitions, exact ingredient distinctions, allergens/diets, substitution bypasses,
saved-food compatibility, numeric boundaries, provenance round-tripping and seed preservation.

Follow `CLAUDE.md`: prompt, schema, tool, retrieval-setting or model changes require relevant
before/after evaluations with quality, cost and latency in the PR. Expanding `FoodKey` changes
structured extraction/generation schemas; account for it. Rebuild generated evaluation labels
when the expanded corpus changes their deterministic generators. Historical reports remain
historical; update selected snapshots only using established project workflows and real results.

Tests and model review are not evidence of kitchen testing. Preserve the existing source-fetch
guards when reading external recipe pages. Do not expose credentials in logs or committed files.

## Required end-of-PR handoff

Update the PR table and append a concise entry below after each PR:

```text
PR number/title/URL:
Status and commit:
Ingredients added (source breakdown):
Recipes added (dessert/everyday; cumulative additions):
Review method and any actual kitchen-testing evidence:
Tests and eval report paths, including cost/latency where relevant:
Changes to the original 300 recipes:
Database/embedding/photo/deployment status:
Rollback reference:
Exclusions, shortfall, blockers and decisions:
Next PR and exact next action:
```

Do not rely on chat history for the next PR. Proceed within the selected PR without stopping
for routine implementation decisions. Ask only when a necessary decision cannot be resolved
from repository instructions or this scope. Do not implement all four PRs in one chat.

## Implementation log

- 2026-10-20: Plan saved from the owner's discussion. Target increased from 60 to 100 additions;
  split into four PRs. All implementation steps remain pending.

### 2026-10-20 — PR 1 implementation and verification

PR number/title/URL: #38 — Add mixed-source nutrition data and dessert safeguards;
https://github.com/mikegauci/pantrio/pull/38
Status and commit: complete on `feat/european-ingredients`; implementation commits `eb51fd0`
and `af3ad63`, followed by the feat/ handoff commit containing this entry. Merge through the
standing repository workflow after the final commit passes every check.
Ingredients added (source breakdown): 8, giving 218 total; 6 Ciqual 2025 (mascarpone,
sweetened_condensed_milk, milk_chocolate, white_chocolate, ladyfingers, butter_puff_pastry)
and 2 USDA SR Legacy (egg_white, egg_yolk). New entries accept g/kg only.
Recipes added (dessert/everyday; cumulative additions): 0/0; cumulative 0. Still 300 recipes,
23 dessert-tagged. Original IDs, file hashes, nutrition, allergens and diet tags are captured
in `data/european_expansion_baseline.json` and checked by regression tests.
Review method and any actual kitchen-testing evidence: editorial review of exact upstream
names, nutrient completeness/definitions, and conservative ingredient safety metadata.
No recipe editorial review or kitchen testing was performed in PR 1.
Tests and eval report paths, including cost/latency where relevant:
- Local Postgres 17 + pgvector: 337 pytest tests pass, 8 paid live gates deselected.
- Ruff lint/format and corpus check pass (300/300, zero problems); importer reproduces CSV
  byte for byte from checksum-pinned workbook. Web lint/typecheck/build pass.
- All 10 browser regressions pass locally using `PLAYWRIGHT_CHANNEL=chrome` (1.2 min).
  Playwright bundled Chromium cannot install on this Mac's macOS 13; CI uses Linux Chromium.
- Before expanded FoodKey: `evals/reports/import-2026-10-20T073120Z.{json,md}`;
  after: `evals/reports/import-2026-10-20T073549Z.{json,md}`. Both 22/22 complete,
  100% found/refused, food matching, lines preserved, servings/time and injection resistance;
  zero missed allergens, one extra allergen; ~$0.0054/import. p50/p95 4.7/12.6 s before,
  5.8/13.0 s after. Prompt/model unchanged; reports' HEAD prompt label refers to that unchanged
  prompt. Before used original 210-food schema, after used expanded 218-food schema.
  No corpus generation or retrieval change; no new recipes requiring retrieval/plan evals.
Changes to the original 300 recipes: none, including derived results. Dessert swap availability
is intentionally restricted centrally for all dessert-tagged recipes until verified rules exist.
Other meal types retain the existing swap algorithm; new egg parts join its protein group.
Database/embedding/photo/deployment status: local test DB only; no migrations, production seed,
embeddings or photos needed. Vercel branch preview deployed successfully. Production deployment is **not yet verified at
  handoff authoring**; main auto-deploys API on Render and web on Vercel. Code/data must ship
atomically and workers restart to rebuild cached foods and FoodKey. Do not expose pilot early.
Rollback reference: prior application/data revision `687fb1f`; no production data rollback needed.
Exclusions, shortfall, blockers and decisions: generic gelatin 11007 excluded (origin/fish
allergen unresolved); agar and other unsupported formulations still require reviewed mappings.
Carbs use available carbs + fibre as disclosed inclusive-fibre approximation. Mascarpone's
`<0.5` fibre uses 0.5 upper bound, with original qualifier preserved; never unknown-as-zero.
See `docs/nutrition-data.md` and `data/ciqual_manifest.json` for conversion/reuse details.
Profile lists now cap at 512; corpus builder agrees with Recipe's 24 servings/1440 min bounds.
Seed refuses missing stored IDs, empty/duplicate inputs before writes; intentional maintenance
only can use Python `allow_delete=True`. Personal cookbook data/estimates remain compatible.
Next PR and exact next action: confirm #38 merged and its main deployment, then PR 2 only.
Check live `/foods` includes all eight keys, dessert swap requests return the explicit refusal,
and nutrition attribution is visible. This entry does not claim a production verification.
Implement public corpus provenance through models, persistence, API and display; verify
Wikibooks revision/licence and completeness before selecting the 5–10 dessert pilot. Count
pilot toward PR 3's 60 desserts. Preserve baseline and production personal cookbook data.
