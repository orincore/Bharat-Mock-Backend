-- Fixes two scaling anti-patterns in activity_logs (same "unbounded full-table scan"
-- class of bug as the exam save fix in 20260707_add_question_options_exam_sections_indexes.sql).
-- At today's ~4k rows these are fast; they get slower — and eventually block the
-- /admin dashboard's Activity Logs card — as every admin/editor/author action across
-- the whole platform keeps inserting into this one table.

-- 1. trigger_cleanup_old_logs() ran `SELECT COUNT(*) FROM activity_logs` (a full
--    sequential scan) on EVERY single insert, just to check "is this the 1000th row".
--    That COUNT(*) is awaited inside logActivity()'s insert call, so it directly slows
--    down every logged action platform-wide, and gets linearly worse as the table grows.
--    Replaced with a cheap probabilistic check (~1-in-1000 chance per insert, no scan).
CREATE OR REPLACE FUNCTION trigger_cleanup_old_logs()
RETURNS TRIGGER AS $$
BEGIN
    IF random() < 0.001 THEN
        PERFORM delete_old_activity_logs();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. get_activity_log_stats() computed active_users as COUNT(DISTINCT user_id) over
--    the ENTIRE table's history — a DISTINCT aggregate requires scanning/sorting every
--    row, the most expensive part of the query, and is called every time the /admin
--    dashboard loads. Scoped to the same 30-day window shown alongside it on the
--    dashboard card, which is both faster (bounded by the idx_activity_logs_created_at
--    index) and a more meaningful "active users" figure than an all-time distinct count.
CREATE OR REPLACE FUNCTION get_activity_log_stats()
RETURNS TABLE (
    total_activities BIGINT,
    active_users BIGINT,
    last_24h BIGINT,
    last_7d BIGINT,
    last_30d BIGINT
) AS $$
    SELECT
        COUNT(*) AS total_activities,
        COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS active_users,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS last_7d,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS last_30d
    FROM activity_logs;
$$ LANGUAGE sql STABLE;
