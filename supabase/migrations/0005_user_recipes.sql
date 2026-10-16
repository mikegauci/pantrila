-- Recipes people add themselves (from a photo, a web page or typed in), and a usage kind for
-- the paid extraction calls behind them.
--
-- The row stores what the person reviewed: ingredient lines, each with a food from the
-- ingredient table or the model's estimate for a food the table lacks, plus steps and the
-- source. Grams, nutrition, allergens and diet tags are not stored; the API derives them in
-- code on every read, so a fix to the ingredient table reaches these recipes too. They stay in
-- the person's cookbook and are never used by the planner. RLS with no policies, like 0003.

create table user_recipes (
    id         bigint generated always as identity primary key,
    user_id    text not null,
    -- CookbookRecipeIn JSON: title, summary, cuisine, meal types, time, servings, ingredient
    -- lines, steps, source and source_url.
    recipe     jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index user_recipes_user_idx on user_recipes (user_id, created_at desc);

alter table user_recipes enable row level security;

alter table usage_events drop constraint usage_events_kind_check;
alter table usage_events
    add constraint usage_events_kind_check check (kind in ('plan', 'chat', 'import'));
