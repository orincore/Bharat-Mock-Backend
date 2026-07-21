-- Follow-up to 20260707_optimize_activity_logs_stats.sql, closing the last remaining
-- full-table-scan cost in get_activity_log_stats(): `total_activities` was still an
-- unconditional COUNT(*) FROM activity_logs with no bound, on every single call
-- (dashboard load). Unlike the FILTER'd last_24h/7d/30d counts (bounded by the
-- idx_activity_logs_created_at index), COUNT(*) with no WHERE has to visit every row's
-- visibility info and gets linearly slower as the table grows.
--
-- Replaced with the standard Postgres "fast approximate row count" technique: read
-- pg_class.reltuples, which planner statistics (autovacuum/autoanalyze) already keep
-- roughly current, instead of counting rows directly. This is the same trick used for
-- `SELECT COUNT(*)` estimates in tools like pgAdmin. It's an estimate (can lag true
-- count between autoanalyze runs), which is an acceptable trade for a dashboard summary
-- figure — this function is intentionally not used anywhere an exact count is required.
CREATE OR REPLACE FUNCTION get_activity_log_stats()
RETURNS TABLE (
    total_activities BIGINT,
    active_users BIGINT,
    last_24h BIGINT,
    last_7d BIGINT,
    last_30d BIGINT
) AS $$
    SELECT
        (SELECT GREATEST(reltuples::BIGINT, 0) FROM pg_class WHERE relname = 'activity_logs') AS total_activities,
        COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS active_users,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS last_7d,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS last_30d
    FROM activity_logs;
$$ LANGUAGE sql STABLE;
