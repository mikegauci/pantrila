-- Saved assistant conversations: one row per thread, so each topic keeps its own context.
--
-- history holds the model turns ({role, content}) the API sends back to the assistant; the
-- API keeps the last 20. messages holds what the app shows: the person's text and each reply
-- with its tool calls, cited recipes, cost and latency, as they were when it was answered.
-- Threads are read and written whole, so both are JSON lists on the row. The API keeps at
-- most 100 threads per user and drops the least recently used. RLS with no policies, like 0003.

create table chat_threads (
    id         bigint generated always as identity primary key,
    user_id    text not null,
    title      text not null,
    history    jsonb not null default '[]',
    messages   jsonb not null default '[]',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index chat_threads_user_idx on chat_threads (user_id, updated_at desc);

alter table chat_threads enable row level security;
