#!/usr/bin/env bash
# Nightly logical backup, run via cron on KVM1 (see README.md for the
# crontab line). Keeps the last 7 daily dumps; activity_logs data is excluded
# for the same reason Phase 1 of the migration excluded it (real bloat, not
# important data — see MIGRATION_TRACKER.md §1.4).
set -euo pipefail

BACKUP_DIR="/var/backups/bharatmock-postgres"
STAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7

mkdir -p "$BACKUP_DIR"
chown postgres:postgres "$BACKUP_DIR"

sudo -u postgres pg_dump --format=custom \
  --exclude-table-data=public.activity_logs \
  -d bharatmock \
  -f "$BACKUP_DIR/bharatmock_${STAMP}.dump"

find "$BACKUP_DIR" -name '*.dump' -mtime "+${RETENTION_DAYS}" -delete

echo "Backup complete: $BACKUP_DIR/bharatmock_${STAMP}.dump"
# TODO (client decision): also sync this off-box (e.g. rclone to R2/S3) — a
# backup that only ever lives on KVM1 doesn't survive KVM1 itself failing.
