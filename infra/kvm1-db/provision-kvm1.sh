#!/usr/bin/env bash
# One-time provisioning for KVM1 (Hostinger, 1 vCPU / 4GB) — Postgres 17 +
# PgBouncer, installed NATIVELY (not Docker). This box only ever runs one
# stateful service with no replicas/rolling updates to orchestrate, so
# container overhead buys nothing here and a native install shaves off
# container network/storage indirection on a box that only has one core to
# spend. k3s is deliberately NOT installed on KVM1 for the same reason.
#
# Usage: KVM2_IP=<backend box's IP> ./provision-kvm1.sh
set -euo pipefail

: "${KVM2_IP:?Set KVM2_IP to the backend box's IP — Postgres will only accept connections from it}"

echo "[1/6] Installing Postgres 17..."
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg
install -d /usr/share/postgresql-common/pgdg
curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq
apt-get install -y -qq postgresql-17 postgresql-client-17 pgbouncer ufw fail2ban

PG_CONF_DIR="/etc/postgresql/17/main"
PG_DATA_DIR=$(sudo -u postgres psql -tAc "SHOW data_directory;")

echo "[2/6] Applying tuning (postgresql-tuning.conf, sized for 1 vCPU / 4GB)..."
cp "$(dirname "$0")/postgresql-tuning.conf" "$PG_CONF_DIR/conf.d/bharatmock-tuning.conf" 2>/dev/null \
  || { mkdir -p "$PG_CONF_DIR/conf.d"; cp "$(dirname "$0")/postgresql-tuning.conf" "$PG_CONF_DIR/conf.d/bharatmock-tuning.conf"; }
grep -q "include_dir = 'conf.d'" "$PG_CONF_DIR/postgresql.conf" \
  || echo "include_dir = 'conf.d'" >> "$PG_CONF_DIR/postgresql.conf"

echo "[3/6] Network: listen for KVM2 only, over the private/internal address..."
sed -i "s/^#listen_addresses.*/listen_addresses = '*'/" "$PG_CONF_DIR/postgresql.conf"
echo "host    bharatmock    bharatmock    ${KVM2_IP}/32    scram-sha-256" >> "$PG_CONF_DIR/pg_hba.conf"

echo "[4/6] Extensions schema (required before restoring the Supabase dump —"
echo "      see MIGRATION_TRACKER.md Phase 1 restore gotcha)..."
systemctl restart postgresql
sudo -u postgres psql -c "CREATE DATABASE bharatmock;" || true
sudo -u postgres psql -d bharatmock -f "$(dirname "$0")/../../docker/postgres-init/001-extensions.sql"
sudo -u postgres psql -c "CREATE USER bharatmock WITH ENCRYPTED PASSWORD '${DB_PASSWORD:?Set DB_PASSWORD}';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE bharatmock TO bharatmock;"
sudo -u postgres psql -c "ALTER DATABASE bharatmock OWNER TO bharatmock;"

echo "[5/6] PgBouncer (transaction pooling) — see pgbouncer.ini for pool sizing..."
cp "$(dirname "$0")/pgbouncer.ini" /etc/pgbouncer/pgbouncer.ini
echo "\"bharatmock\" \"${DB_PASSWORD}\"" > /etc/pgbouncer/userlist.txt
chown postgres:postgres /etc/pgbouncer/userlist.txt
chmod 600 /etc/pgbouncer/userlist.txt
systemctl enable --now pgbouncer

echo "[6/6] Firewall — Postgres/PgBouncer only reachable from KVM2, SSH open..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow from "${KVM2_IP}" to any port 6432 proto tcp   # PgBouncer — app connects here, not 5432 directly
ufw --force enable
systemctl enable --now fail2ban

echo "Done. App's DATABASE_URL should point at KVM1:6432 (PgBouncer), not :5432 directly."
echo "Next: run backup-postgres.sh once manually, then add it to root's crontab (see README.md)."
