-- Runs of the third-party service that finds a post's video (reel audio from a link) are
-- logged as their own usage kind, so each person has a daily cap on them and their fee counts
-- toward the shared daily budget.
alter table usage_reservations drop constraint usage_reservations_kind_check;
alter table usage_reservations add constraint usage_reservations_kind_check
    check (kind in ('plan', 'chat', 'import', 'photo', 'search', 'reel'));
alter table usage_events drop constraint usage_events_kind_check;
alter table usage_events add constraint usage_events_kind_check
    check (kind in ('plan', 'chat', 'import', 'photo', 'search', 'reel'));
