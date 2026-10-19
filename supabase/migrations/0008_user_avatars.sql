-- Profile pictures. The image lives in Supabase Storage (public bucket `recipe-photos`, under
-- `avatars/<user>/`); this table holds only its path, and the API turns it into a URL from
-- SUPABASE_URL. One row per user; no row means the app shows the generated food-emoji avatar.
-- RLS with no policies, like 0003.

create table user_avatars (
    user_id    text primary key,
    path       text not null,
    updated_at timestamptz not null default now()
);

alter table user_avatars enable row level security;
