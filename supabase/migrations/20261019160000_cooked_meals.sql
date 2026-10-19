-- The cooking log: one row each time a person taps "I cooked this" at the end of cooking mode.
-- A row points at a corpus recipe or a cookbook recipe (no foreign key: the corpus can be
-- reseeded and cookbook recipes deleted) and keeps the title, so the log still reads after
-- either goes. `pantry_updated` records whether the amounts used were taken out of the pantry.
-- The API keeps the latest 500 rows per user. RLS with no policies, like 0003.

create table cooked_meals (
    id             bigint generated always as identity primary key,
    user_id        text not null,
    recipe_id      text,
    cookbook_id    bigint,
    title          text not null,
    servings       integer not null check (servings between 1 and 24),
    pantry_updated boolean not null,
    cooked_at      timestamptz not null default now(),
    check ((recipe_id is null) <> (cookbook_id is null))
);

create index cooked_meals_user_idx on cooked_meals (user_id, cooked_at desc);

alter table cooked_meals enable row level security;
