-- Pantrila Pro (pantrila.entitlements): one row per person who has or had Pro, written by the
-- RevenueCat webhook from RevenueCat's REST API, or by hand with store 'manual' (early users,
-- with an end date). No row means Free. Deleted with the account.
create table entitlements (
    user_id    text primary key,
    tier       text not null check (tier in ('free', 'pro')),
    status     text not null check (status in ('trial', 'active', 'grace', 'expired')),
    expires_at timestamptz,
    store      text not null check (store in ('app_store', 'play_store', 'stripe', 'manual')),
    product_id text,
    will_renew boolean not null default false,
    updated_at timestamptz not null default now()
);
alter table entitlements enable row level security;

-- RevenueCat webhook events already handled, so a repeated delivery sends no second analytics
-- event.
create table subscription_events (
    id         text primary key,
    user_id    text not null,
    created_at timestamptz not null default now()
);
create index subscription_events_user_idx on subscription_events (user_id);
alter table subscription_events enable row level security;

-- Food estimates get their own usage kind, so they no longer count as recipe imports (Free has
-- 5 imports a month; estimates run on their own from the recipe form).
alter table usage_reservations drop constraint usage_reservations_kind_check;
alter table usage_reservations add constraint usage_reservations_kind_check
    check (kind in ('plan', 'chat', 'import', 'photo', 'search', 'reel', 'estimate'));
alter table usage_events drop constraint usage_events_kind_check;
alter table usage_events add constraint usage_events_kind_check
    check (kind in ('plan', 'chat', 'import', 'photo', 'search', 'reel', 'estimate'));
