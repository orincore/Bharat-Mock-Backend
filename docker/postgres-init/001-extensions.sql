-- Recreates Supabase's extension layout so a Supabase pg_dump restores cleanly.
-- Supabase installs uuid-ossp/pgcrypto into an "extensions" schema, and many table
-- column defaults are qualified as extensions.uuid_generate_v4() / extensions.*.
-- Without this, restoring a Supabase dump fails with hundreds of cascading
-- "relation does not exist" errors from every CREATE TABLE that uses those defaults.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;
