-- Reserve daily allowance before paid work. The API serializes reservations and settlement
-- with one short transaction-scoped advisory lock, across processes and users.
create table usage_reservations (
    id uuid primary key,
    user_id text not null,
    kind text not null check (kind in ('plan', 'chat', 'import', 'photo', 'search')),
    reserved_usd numeric(10, 6) not null check (reserved_usd >= 0),
    created_at timestamptz not null default now()
);
create index usage_reservations_created_idx on usage_reservations (created_at);
alter table usage_reservations enable row level security;
alter table usage_events drop constraint usage_events_kind_check;
alter table usage_events add constraint usage_events_kind_check
    check (kind in ('plan', 'chat', 'import', 'photo', 'search'));
