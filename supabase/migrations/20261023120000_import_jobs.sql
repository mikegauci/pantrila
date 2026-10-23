-- Background recipe imports survive a deploy or restart: the job, its input and its result live
-- here instead of one server's memory. The server running a job holds a lease (owner +
-- lease_until) and renews it; when it lapses another server takes the job over and runs it
-- again from `request`. Photos in `request` are dropped once the job ends, and rows go after
-- an hour.
create table import_jobs (
    id          text primary key,
    user_id     text not null,
    request     jsonb not null,
    reservation uuid,
    status      text not null default 'running' check (status in ('running', 'done', 'failed')),
    steps       jsonb not null default '[]',
    result      jsonb,
    error       jsonb,
    attempts    integer not null default 1,
    owner       text not null,
    lease_until timestamptz not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index import_jobs_user_idx on import_jobs (user_id, status);
create index import_jobs_lease_idx on import_jobs (lease_until) where status = 'running';
create index import_jobs_created_idx on import_jobs (created_at);
alter table import_jobs enable row level security;
