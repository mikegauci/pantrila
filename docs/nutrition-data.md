# Ingredient nutrition sources

Pantrila ships a curated subset of USDA FoodData Central SR Legacy 2018-04 (public domain)
and **Anses. 2025. Ciqual French food composition table**, reused under the
[French Open Licence](https://ciqual.anses.fr/cms/en/node/22). ANSES does not endorse Pantrila.
Ciqual supplies composition averages, not recipe instructions or kitchen testing.

Each `Food` records source, source food code, dataset version, source URL and attribution.
`fdc_id` remains the real USDA identifier for existing consumers; it is null for Ciqual and
personal estimates. Existing personal estimates stay estimates, even when their descriptions
now match a supported food. Ingredient keys and all original USDA values remain stable.

## Reproduction

The committed `data/ciqual_manifest.json` pins the upstream workbook URL, SHA-256, version,
selected descriptions, field headers, retrieval date and exclusions. Download that URL to
`.cache/ciqual/2025.xlsx`, then run:

```bash
uv run python scripts/build_ciqual_table.py
uv run python scripts/build_usda_table.py
uv run pantrila corpus check
```

The Ciqual importer uses Python's standard library; no workbook parser or network access is
needed at runtime. It rejects changed bytes/headers/descriptions. `data/ciqual_foods.csv` is the
normalized subset, not the upstream dataset. Raw carbohydrate and fibre strings and the
qualification policy are preserved alongside converted values. Update the manifest only after
reviewing a new dataset. USDA rebuilding uses its existing cached SR Legacy archive.

## Nutrient conventions

All values are per 100 g edible food. See the official
[Ciqual methodology](https://ciqual.anses.fr/cms/sites/default/files/inline-files/Table%20Ciqual%202025%20doc%20ENG_2025_11_19.pdf),
sections 3.2 and 3.3 (pages 9–12).

| App field | Ciqual workbook field | Treatment |
|---|---|---|
| kcal | M: energy, N × Jones factor, with fibres, kcal/100 g | Preserve reported energy; do not reconstruct it from rounded macros |
| protein_g | O: protein, g/100 g | Food-specific Jones nitrogen factor, consistent with the SR Legacy approach; not crude N × 6.25 |
| carbs_g | Q: carbohydrate + AA: fibres | Approximate total carbohydrate inclusive of fibre |
| fat_g | R: fat, g/100 g | Preserve reported value |
| fibre_g | AA: fibres, g/100 g | Preserve numeric values; qualified upper bound described below |

USDA carbohydrate by difference includes fibre. Ciqual carbohydrate excludes fibre and can be
calculated by difference or by summing components. Adding fibre keeps the app's inclusive
convention and its existing low-carb threshold (20 g/serving); it is an approximation, not an
exact reconstruction of USDA by difference. Organic acids and analytical methods can differ.
No existing recipe changes its nutrition or low-carb classification. Do not subtract fibre
again when evaluating a low-carb target. New recipes inherit the disclosed approximation.

Missing (`-`, empty), traces, non-finite and unsupported qualified values are rejected, never
silently converted to zero. For fibre alone, `< x` uses the **upper bound x**, retained as a
qualification in the CSV. Mascarpone has `< 0,5` g fibre: Pantrila uses 0.5 g fibre and 3.6 g
inclusive carbs (3.1 + 0.5). This is a conservative bound, not a measured exact value. It can
raise a new recipe's carbohydrate estimate by less than 0.5 g per 100 g mascarpone. No other
selected nutrient needs a fallback. This policy is not applied to arbitrary nutrient fields.

## Reviewed additions and safety metadata

| Key | Source/code | Metadata and matching limits |
|---|---|---|
| mascarpone | Ciqual 19584 | Cow's milk cheese; dairy, milk allergen |
| sweetened_condensed_milk | Ciqual 19027 | Sweetened whole milk; dairy, milk; not evaporated milk |
| milk_chocolate | Ciqual 31004 | Plain milk chocolate bar; dairy, milk and conservatively soy |
| white_chocolate | Ciqual 31010 | Plain white chocolate bar; dairy, milk and conservatively soy |
| ladyfingers | Ciqual 24430 | Sponge fingers; egg class, gluten/eggs and conservatively milk |
| butter_puff_pastry | Ciqual 23424 | Raw pure-butter pastry; dairy, gluten/milk; not vegetable-fat pastry |
| egg_white | USDA 172183 | Raw fresh white; egg class/eggs; distinct from whole egg |
| egg_yolk | USDA 172184 | Raw fresh yolk; egg class/eggs; distinct from whole egg |

Safety metadata is a separate editorial review of the named ingredient and common formulations,
not inferred from nutrient values. Conservative milk/soy labels do not establish cross-contact
for any particular brand. Check packaging. All eight additions support **g/kg only**: no
invented density, egg-part weight, biscuit count or pastry-sheet weight. Existing whole egg,
cream fat levels and unsweetened cocoa retain their original mappings. Generic dried gelatin
(Ciqual 11007) is excluded: origin and fish-allergen status are unresolved. Agar, evaporated milk,
other cream levels and vegetable-fat pastry need separate reviewed mappings before use.

## Dessert swaps, bounds and seed safety

No verified dessert substitution rules exist. All recipes tagged dessert reject suggestions
and direct equal-weight substitutions centrally, including API and assistant calls. This
conservative restriction includes fruit, fat and dairy because they can be structural too.
Other meal types keep their existing behavior. Allergy/diet compatibility alone does not
validate baking performance. Scaling quantities never establishes baking time or tin size.

The corpus builder now shares Recipe's bounds: 1–24 servings and 1–1440 elapsed minutes.
Longer/larger recipes require a deliberate future model decision, not falsified timings or
servings. Profile pantry/exclusion lists allow 512 entries, bounded independently of catalogue
size. Ingredient strings retain their 80-character limit. Existing request limits stay intact.

`db.seed` refuses empty/duplicate input and any missing stored recipe IDs before writing.
The preservation check and upserts hold a table lock in one transaction. Intentional deletion
requires the explicit Python maintenance option `allow_delete=True`; normal CLI seed cannot
opt into deletion. Personal cookbook tables are never modified by seeding. The committed
`data/european_expansion_baseline.json` captures original IDs, file hashes and derived results.

## Release and rollback

PR 1 introduces no migration, recipes, embeddings or photos. Deploy API code and packaged data
as one revision, restart all workers to refresh the food cache and FoodKey enum, and deploy the
web attribution before adding dependent PR 2 recipes. A build/merge is not evidence of a live
deployment; record actual checks in the expansion plan. Roll back API and web to the prior
revision before any dependent recipes are published. After PR 2 starts, remove dependent
recipes only through a separately reviewed maintenance operation before reverting ingredient
support; never run a partial corpus seed to roll back.
