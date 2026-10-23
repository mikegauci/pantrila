-- One row per person per day they used the app, for the analytics funnel (pantrila.analytics):
-- their first day is sign-up, the next one within a week is a return. Deleted with the account.
create table user_activity (
    user_id text not null,
    day     date not null,
    primary key (user_id, day)
);
alter table user_activity enable row level security;
