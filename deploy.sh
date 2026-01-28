#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/root/Bharat-Mock-Backend"
PM2_PROCESS="bharat-mock-backend"

cd "$APP_DIR"

echo "[Deploy] Pulling latest code..."
git fetch origin main
git checkout main
git pull --ff-only origin main

echo "[Deploy] Installing dependencies..."
npm install --production

echo "[Deploy] Building (if needed)..."
npm run build  # remove if not required

echo "[Deploy] Restarting PM2 service..."
pm2 reload "$PM2_PROCESS" --update-env

echo "[Deploy] Deployment complete."