# KVM2 — k3s deployment

Topology: KVM1 runs Postgres + PgBouncer only (see `../infra/kvm1-db/`). KVM2
runs a single-node k3s cluster with the frontend, backend, and Redis, fronted
by Cloudflare (already configured) and k3s's bundled Traefik ingress.

## One-time setup (in order)

1. **Provision KVM2**: `scp k8s/bootstrap-kvm2.sh root@KVM2_IP:~ && ssh root@KVM2_IP 'bash bootstrap-kvm2.sh'`
2. **Cloudflare Origin Certificate** (Cloudflare dashboard → SSL/TLS → Origin
   Server → Create Certificate, hostnames `bharatmock.com, *.bharatmock.com`,
   15-year validity). Save the cert/key on KVM2, then:
   ```bash
   kubectl create secret tls cloudflare-origin-tls \
     --cert=origin.pem --key=origin-key.pem -n bharatmock
   ```
   Set Cloudflare's SSL/TLS mode to **Full (strict)** once this secret exists —
   Full (strict) is what actually validates against this cert; anything looser
   leaves the origin hop unencrypted or unverified.
3. **Namespace + secrets** (secrets are created directly on the server from a
   gitignored env file — never committed, never templated into a YAML in
   either repo):
   ```bash
   kubectl apply -f k8s/namespace.yaml
   kubectl create secret generic backend-secret -n bharatmock --from-env-file=.env.production   # from Bharat-Mock-Backend
   kubectl create secret generic frontend-secret -n bharatmock --from-env-file=.env.production   # from Bharat-Mock-Frontend
   ```
   Each repo's own `.env.production` (gitignored, never committed) needs every var in `.env.example` that isn't
   already in `k8s/backend-configmap.yaml` (DATABASE_URL pointed at KVM1,
   JWT_SECRET, R2_*, RAZORPAY_*, GOOGLE_*, SMTP_*, REDIS_PASSWORD, etc.) —
   Supabase vars are deliberately omitted here, since this deploy target
   assumes MIGRATION_TRACKER.md's Phase 6+ (KVM1 Postgres) is already live.
4. **Apply everything else**:
   ```bash
   kubectl apply -f k8s/backend-configmap.yaml
   kubectl apply -f k8s/backend-service.yaml
   kubectl apply -f k8s/backend-hpa.yaml
   kubectl apply -f k8s/cluster/redis.yaml
   kubectl apply -f k8s/cluster/ratelimit-middleware.yaml
   # + the frontend repo's equivalent k8s/*.yaml
   kubectl apply -f k8s/cluster/ingress.yaml
   # backend-deployment.yaml itself is applied by CI on first deploy (it's the
   # one manifest whose `image:` tag CI rewrites every push) — apply it
   # manually once up front too, so something is running before the first
   # GitHub Actions run:
   kubectl apply -f k8s/backend-deployment.yaml
   ```

## Day-to-day deploys

Handled by `.github/workflows/deploy-backend.yml` (and the frontend repo's
equivalent): push to `main` → build → push image to GHCR → SSH into KVM2 →
`kubectl set image` + `kubectl rollout status`. The k3s API is never exposed
to the internet; GitHub Actions never talks to it directly, only over SSH to
a box that already has `kubectl` configured locally.

## Resource budget (why replica counts are what they are)

KVM2 = 2 vCPU / 8GB total. Fixed overhead (k3s + containerd + Traefik +
metrics-server + Redis + OS) is roughly 1.2-1.7GB RAM / 400-500m CPU,
always-on regardless of traffic. That leaves the HPAs (`backend-hpa.yaml`,
frontend's equivalent) to range within what's left — see the comments in
`backend-deployment.yaml` for the exact arithmetic. If real usage shows this
is too tight (CPU-throttled pods, frequent OOM kills — `kubectl top pods` /
`kubectl describe pod` will show it), the fix is upgrading KVM2's plan tier,
not silently over-subscribing requests/limits past what 2 vCPU can serve.

## Known ceiling of this design

5(ish) replicas on a single node gives crash self-healing and zero-downtime
rolling deploys — it does not protect against KVM2 itself going down (reboot,
host failure, network outage). That requires a second app-hosting node, which
this design deliberately doesn't include yet (cost/complexity tradeoff — see
the quotation's own §6 terms). Revisit if uptime requirements tighten.
