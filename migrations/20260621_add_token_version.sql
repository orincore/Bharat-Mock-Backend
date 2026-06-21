-- 20260621_add_token_version.sql
-- Session-invalidation support. Every issued JWT/refresh token carries the user's
-- token_version (`tv` claim). Bumping this column instantly invalidates every token
-- minted with an older value — used to force-logout all sessions on password reset,
-- and all OTHER sessions on password change.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
