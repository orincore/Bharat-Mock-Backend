# syntax=docker/dockerfile:1
# Multi-stage build for the Node/Express + Prisma API.
# KVM2 is a 2 vCPU / 8GB Hostinger box shared with the frontend and the k3s
# control plane, so this image is built for a small footprint, not for speed of
# `docker build` — see k8s/backend-deployment.yaml for the resource budget this
# was sized against.

FROM node:20-alpine AS build
WORKDIR /app

# openssl: required by Prisma's query engine at generate-time; libc6-compat:
# several native deps (sharp, etc.) expect glibc-shaped symbols on musl.
RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the rest of the source (see .dockerignore) and generate the Prisma
# client now, inside this same Alpine environment, so the query engine binary
# Prisma downloads matches the musl target the runtime stage below also uses.
COPY . .
RUN npx prisma generate

FROM node:20-alpine AS runner
WORKDIR /app

# Puppeteer (src/utils/pdfBrowser.js, exam PDF rendering) is pointed at
# Alpine's own Chromium package instead of Puppeteer's bundled download —
# puppeteer's bundled Chromium is a glibc build and does not run on musl.
# `PUPPETEER_EXECUTABLE_PATH` below is picked up automatically by
# puppeteer.launch() with no code changes needed.
RUN apk add --no-cache \
      chromium nss freetype harfbuzz ca-certificates ttf-freefont \
      tini openssl \
    && addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_OPTIONS=--max-old-space-size=768

COPY --from=build --chown=app:app /app ./

# winston (src/config/logger.js) mkdir's ./logs relative to CWD at require
# time — /app itself is still root-owned (created implicitly by WORKDIR
# before USER app existed; --chown above only applies to the copied files,
# not the pre-existing parent dir), so without this the app crashes on boot
# with EACCES before it ever reaches app.listen(). Non-recursive: the copied
# files are already app-owned via --chown above, this only needs to fix the
# directory entry itself — `-R` here would re-walk the entire node_modules
# tree for no benefit and add ~40s to every build.
RUN mkdir -p logs && chown app:app /app logs

USER 1001
EXPOSE 8000

# Matches the pod's readinessProbe/livenessProbe in k8s/backend-deployment.yaml —
# kept here too so `docker run` alone (outside k8s) is still self-checking.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# tini as PID 1 so SIGTERM actually reaches the Node process for the app's
# existing graceful-shutdown handlers (src/server.js) instead of being
# swallowed — without it, k8s rolling updates would hard-kill connections.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
