-- Recipe photos. The image files live in Supabase Storage (public bucket `recipe-photos`);
-- these columns hold only their paths in that bucket, and the API turns a path into a URL
-- from SUPABASE_URL, so no URL is stored.
--
-- recipe_photos is separate from recipes so `pantrio db seed` (which upserts recipes from the
-- corpus files) never touches photos; a recipe dropped from the corpus takes its row with it.
-- Cookbook photos are generated on request and logged as usage kind `photo`. RLS with no
-- policies, like 0003.

create table recipe_photos (
    recipe_id  text primary key references recipes (id) on delete cascade,
    path       text not null,
    model      text not null,
    created_at timestamptz not null default now()
);

alter table recipe_photos enable row level security;

alter table user_recipes add column photo_path text;

alter table usage_events drop constraint usage_events_kind_check;
alter table usage_events
    add constraint usage_events_kind_check check (kind in ('plan', 'chat', 'import', 'photo'));
