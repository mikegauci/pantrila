-- Quantities like 1/8 tsp (0.125) need three decimals; numeric(10, 2) rounded them.
-- Re-run `pantrio db seed` after applying so stored quantities match the corpus.

alter table recipe_ingredients alter column quantity type numeric(10, 3);
