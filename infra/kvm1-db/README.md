# KVM1 — Postgres + PgBouncer

KVM1 (1 vCPU / 4GB) runs Postgres 17 and PgBouncer natively — no Docker, no
k3s. It's a single stateful service with nothing to orchestrate; container
indirection would only cost cycles on a box that has exactly one core to give.

## Provisioning (once, after Phase 5 of MIGRATION_TRACKER.md is verified locally)

```bash
scp -r infra/kvm1-db root@KVM1_IP:~/kvm1-db
scp docker/postgres-init/001-extensions.sql root@KVM1_IP:~/kvm1-db/../docker/postgres-init/001-extensions.sql
ssh root@KVM1_IP
cd kvm1-db
KVM2_IP=<KVM2's IP> DB_PASSWORD='<strong password>' ./provision-kvm1.sh
```

Then add the nightly backup to root's crontab:
```bash
crontab -e
# 2:30am daily
30 2 * * * /root/kvm1-db/backup-postgres.sh >> /var/log/bharatmock-backup.log 2>&1
```

## What the app points at

`DATABASE_URL` in the backend's `backend-secret` (see `../../k8s/README.md`)
must point at **PgBouncer's port (6432), not Postgres directly (5432)**:

```
DATABASE_URL=postgresql://bharatmock:<password>@KVM1_IP:6432/bharatmock
```

## Why PgBouncer isn't optional here

Every backend replica on KVM2 opens its own `pg.Pool` (`src/config/prisma.js`,
sized by `DB_POOL_MAX` — see `k8s/backend-configmap.yaml`). At HPA's max of 4
replicas × `DB_POOL_MAX=10`, that's up to 40 real connections requested
directly — exactly Postgres's `max_connections` ceiling here, with zero
headroom for psql/migrations/monitoring, and no cushion if HPA scales up
further later. PgBouncer in transaction-pooling mode absorbs that: replicas
connect to it freely (`max_client_conn=200`), it multiplexes them onto a
much smaller `default_pool_size=20` of real Postgres connections. This is
standard practice at this connection-concurrency profile, not extra
insurance.

## The real ceiling on this design

KVM1 is 1 vCPU. No amount of replica tuning on KVM2 changes that a single
core serializes CPU-bound query execution — at genuinely "lakhs of users"
concurrent load, KVM1 is the more likely bottleneck than anything on KVM2.
`pg_stat_statements` is enabled (`postgresql-tuning.conf`) specifically so
this is measurable (`SELECT * FROM pg_stat_statements ORDER BY total_exec_time
DESC LIMIT 20;`) before assuming it — but if load testing shows this box
pegged at 100% CPU while KVM2 is idle, the fix is upgrading KVM1's plan tier
(e.g. to a 2 or 4 vCPU KVM plan), not adding more backend replicas.
