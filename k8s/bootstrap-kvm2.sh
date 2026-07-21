#!/usr/bin/env bash
# One-time provisioning for KVM2 (Hostinger, 2 vCPU / 8GB) — installs k3s
# (lightweight Kubernetes; a full kubeadm control plane's extra ~1.5GB+
# overhead isn't worth it on a single 2-vCPU node), metrics-server (needed for
# the HPAs in backend-hpa.yaml / frontend-hpa.yaml), and basic hardening.
# Run as root on KVM2 itself: `ssh root@KVM2_IP 'bash -s' < bootstrap-kvm2.sh`
set -euo pipefail

echo "[1/5] Installing k3s (Traefik + local-path-provisioner bundled, both used)..."
curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

echo "[2/5] Waiting for node to be Ready..."
until kubectl get nodes | grep -q " Ready"; do sleep 2; done

echo "[3/5] Installing metrics-server (required for HPA; k3s does not bundle it)..."
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
# k3s's kubelet serves a self-signed cert — metrics-server rejects it by
# default. This is the standard, documented fix for k3s specifically.
kubectl -n kube-system patch deployment metrics-server --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

echo "[4/5] Firewall (ufw) — SSH + HTTP(S) only, everything else closed..."
apt-get update -qq && apt-get install -y -qq ufw fail2ban >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (Cloudflare origin pull + ACME-style checks)
ufw allow 443/tcp   # HTTPS
# The k3s API (6443) and kubelet (10250) are deliberately NOT opened here —
# GitHub Actions deploys over SSH + local kubectl (see .github/workflows/
# deploy-backend.yml), never against a publicly exposed k8s API. Keeping the
# API bound to localhost/private network only removes an entire class of
# "leaked kubeconfig" breach.
ufw --force enable
systemctl enable --now fail2ban

echo "[5/5] Done. Namespace + workload manifests are applied by CI, not here —"
echo "      see k8s/README.md for the one-time secret bootstrap and first apply."
