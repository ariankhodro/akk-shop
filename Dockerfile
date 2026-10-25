# syntax=docker/dockerfile:1.7
# MIBA storefront: one image that serves the API and the built SPA.
#   docker build -t miba-shop .
ARG NODE_IMAGE=node:22-alpine

# ---- 1. Frontend build -------------------------------------------------------
FROM ${NODE_IMAGE} AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
# Optional build secret "build_ca": extra CA bundle for TLS-intercepting corporate
# proxies (docker build --secret id=build_ca,src=/path/ca.crt). Never stored in a layer.
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --no-audit --no-fund
COPY frontend/ ./
# Public, build-time storefront settings (never secrets: they end up in the bundle).
ARG VITE_PUBLIC_SITE_URL="" VITE_STORE_SUPPORT_EMAIL="" VITE_STORE_INSTAGRAM_URL="" \
    VITE_STORE_TELEGRAM_URL="" VITE_STORE_X_URL="" VITE_ENAMAD_SEAL_IMAGE_URL="" VITE_ENAMAD_SEAL_LINK_URL=""
ENV VITE_PUBLIC_SITE_URL=$VITE_PUBLIC_SITE_URL VITE_STORE_SUPPORT_EMAIL=$VITE_STORE_SUPPORT_EMAIL \
    VITE_STORE_INSTAGRAM_URL=$VITE_STORE_INSTAGRAM_URL VITE_STORE_TELEGRAM_URL=$VITE_STORE_TELEGRAM_URL \
    VITE_STORE_X_URL=$VITE_STORE_X_URL VITE_ENAMAD_SEAL_IMAGE_URL=$VITE_ENAMAD_SEAL_IMAGE_URL \
    VITE_ENAMAD_SEAL_LINK_URL=$VITE_ENAMAD_SEAL_LINK_URL
# Unit tests and lint run in CI (they import backend/ and api/ modules); the
# image build only produces the static bundle.
RUN npx vite build

# ---- 2. Production dependencies ----------------------------------------------
# The backend resolves its packages from the root node_modules (root and backend
# package.json declare the same runtime dependencies).
FROM ${NODE_IMAGE} AS deps
WORKDIR /build
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

# ---- 3. Runtime ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=5000 \
    SERVE_FRONTEND=true \
    FRONTEND_DIST=/app/frontend/dist \
    MEDIA_STORAGE=local \
    UPLOADS_DIR=/app/data/uploads
WORKDIR /app
COPY --chown=root:root package.json package-lock.json ./
COPY --from=deps --chown=root:root /build/node_modules ./node_modules
COPY --chown=root:root backend/ ./backend/
COPY --chown=root:root seo/ ./seo/
COPY --chown=root:root scripts/ ./scripts/
COPY --from=frontend --chown=root:root /build/frontend/dist ./frontend/dist
# Application code stays root-owned and read-only for the runtime user; only the
# uploads directory (a mounted volume in compose) is writable.
RUN rm -rf backend/tests && mkdir -p /app/data/uploads && chown -R node:node /app/data
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run with an init process (`init: true` in compose, `docker run --init`) so
# signals are forwarded and zombies reaped; server.js drains on SIGTERM.
STOPSIGNAL SIGTERM
CMD ["node", "backend/server.js"]
