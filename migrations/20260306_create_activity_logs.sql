-- Create activity_logs table for tracking admin/editor/author actions
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_email VARCHAR(255) NOT NULL,
    user_role VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id TEXT,
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster queries
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX idx_activity_logs_action ON activity_logs(action);
CREATE INDEX idx_activity_logs_resource ON activity_logs(resource_type, resource_id);

-- Create function to auto-delete logs older than 3 months
CREATE OR REPLACE FUNCTION delete_old_activity_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM activity_logs
    WHERE created_at < NOW() - INTERVAL '3 months';
END;
$$ LANGUAGE plpgsql;

-- Create trigger to run cleanup on insert (checks periodically)
CREATE OR REPLACE FUNCTION trigger_cleanup_old_logs()
RETURNS TRIGGER AS $$
BEGIN
    -- Run cleanup every 1000 inserts to avoid overhead
    IF (SELECT COUNT(*) FROM activity_logs) % 1000 = 0 THEN
        PERFORM delete_old_activity_logs();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cleanup_old_logs_trigger
AFTER INSERT ON activity_logs
FOR EACH STATEMENT
EXECUTE FUNCTION trigger_cleanup_old_logs();

-- Function to provide aggregate stats for dashboards
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
        COUNT(DISTINCT user_id) AS active_users,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS last_7d,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS last_30d
    FROM activity_logs;
$$ LANGUAGE sql STABLE;

-- Function to fetch top actions in last 30 days
CREATE OR REPLACE FUNCTION get_activity_log_top_actions(limit_count INTEGER DEFAULT 10)
RETURNS TABLE (
    action VARCHAR,
    action_count BIGINT
) AS $$
    SELECT
        action,
        COUNT(*) AS action_count
    FROM activity_logs
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY action
    ORDER BY action_count DESC
    LIMIT limit_count;
$$ LANGUAGE sql STABLE;
