-- Per-user data (profiles and pantries) and row level security on every table.
--
-- Supabase exposes tables in `public` through its REST API. RLS with no policies denies the
-- `anon` and `authenticated` roles everything, so only the Pantrio API (which connects as the
-- table owner and bypasses RLS) can read or write. user_id is the auth provider's user id.

create table user_profiles (
    user_id    text primary key,
    -- UserProfile JSON without the pantry, which lives in pantry_items.
    profile    jsonb not null,
    updated_at timestamptz not null default now()
);

create table pantry_items (
    user_id    text not null,
    food       text not null,
    -- Unset quantity means "some": enough for any recipe.
    quantity   numeric(10, 3) check (quantity > 0),
    unit       text,
    grams      numeric(10, 1) check (grams >= 0),
    updated_at timestamptz not null default now(),
    primary key (user_id, food),
    check ((quantity is null) = (unit is null) and (quantity is null) = (grams is null))
);

alter table user_profiles enable row level security;
alter table pantry_items enable row level security;
alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table recipe_embeddings enable row level security;
alter table pantrio_migrations enable row level security;
