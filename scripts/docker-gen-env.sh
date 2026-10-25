#!/bin/sh
# Creates .env for Docker Compose from .env.docker.example, filling every empty
# secret with a fresh random value. Refuses to overwrite an existing .env.
#   ./scripts/docker-gen-env.sh [origin]      e.g. ./scripts/docker-gen-env.sh https://miba.example.ir
set -eu
cd "$(dirname "$0")/.."
target="${ENV_FILE:-.env}"
if [ -e "$target" ]; then
  echo "$target already exists; refusing to overwrite it." >&2
  exit 1
fi
origin="${1:-http://localhost:5000}"
domain="$(printf '%s' "$origin" | sed -E 's#^[a-z]+://##; s#[:/].*$##')"
rand() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }

umask 077
: > "$target"
while IFS= read -r line || [ -n "$line" ]; do
  key="${line%%=*}"
  case "$line" in
    MONGO_ROOT_PASSWORD=*|MONGO_APP_PASSWORD=*|REDIS_PASSWORD=*) line="$key=$(rand 24)" ;;
    ACCESS_TOKEN_SECRET=*|REFRESH_TOKEN_SECRET=*|CRON_SECRET=*|NEWSLETTER_TOKEN_SECRET=*|READINESS_TOKEN=*) line="$key=$(rand 32)" ;;
    RATE_LIMIT_KEY_SALT=*) line="$key=$(rand 16)" ;;
    CLIENT_URL=*|APP_URL=*|API_URL=*|PUBLIC_SITE_URL=*) line="$key=$origin" ;;
    DOMAIN=*) line="$key=$domain" ;;
  esac
  printf '%s\n' "$line" >> "$target"
done < .env.docker.example
echo "Wrote $target for $origin (mode 600). Review ZARINPAL_*, e-mail and media settings before going live."
