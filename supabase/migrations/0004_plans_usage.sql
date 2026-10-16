-- Saved meal plans and a usage log per user, for the web app.
--
-- meal_plans keeps every plan a user generated; the app shows the latest. Recipes are not
-- copied: the plan stores ids and the API reloads and re-checks them against the corpus.
-- usage_events records each paid call (plan or chat turn) with its tokens, cost and latency;
-- the API counts them for per-user and global daily limits, and the Insights page shows them.
-- Both tables get RLS with no policies, like migration 0003: only the API (table owner) reads
-- or writes them.

create table meal_plans (
    id         bigint generated always as identity primary key,
    user_id    text not null,
    -- MealPlan JSON: days, meals (meal type, recipe id, portions) and notes.
    plan       jsonb not null,
    -- Planner metrics: repairs, fallbacks, pantry use, warnings, path, first-draft problems.
    report     jsonb not null,
    created_at timestamptz not null default now()
);

create index meal_plans_user_idx on meal_plans (user_id, created_at desc);

create table usage_events (
    id            bigint generated always as identity primary key,
    user_id       text not null,
    kind          text not null check (kind in ('plan', 'chat')),
    model         text not null,
    llm_calls     integer not null default 0,
    tool_calls    integer not null default 0,
    input_tokens  integer not null default 0,
    output_tokens integer not null default 0,
    embed_tokens  integer not null default 0,
    -- Null when PANTRIO_PRICE_*_PER_MTOK is unset: unknown, not free.
    cost_usd      numeric(10, 6),
    latency_ms    integer not null,
    ok            boolean not null default true,
    created_at    timestamptz not null default now()
);

create index usage_events_user_idx on usage_events (user_id, created_at desc);
create index usage_events_created_idx on usage_events (created_at);

alter table meal_plans enable row level security;
alter table usage_events enable row level security;
