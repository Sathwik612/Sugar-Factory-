#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${BASE_URL:-http://127.0.0.1:8080}"
curl_args=(--silent --show-error --fail --retry 8 --retry-delay 2 --connect-timeout 5 --max-time 30)
if [[ "${ALLOW_INSECURE_TLS:-false}" == "true" ]]; then curl_args+=(-k); fi
cookie_file="$(mktemp)"
trap 'rm -f "$cookie_file"' EXIT

curl "${curl_args[@]}" "${base_url%/}/api/healthz" >/dev/null
curl "${curl_args[@]}" "${base_url%/}/api/readyz" >/dev/null

if [[ -n "${SMOKE_USERNAME:-}" || -n "${SMOKE_PASSWORD:-}" ]]; then
  [[ -n "${SMOKE_USERNAME:-}" && -n "${SMOKE_PASSWORD:-}" ]] || {
    echo "Set both SMOKE_USERNAME and SMOKE_PASSWORD, or leave both empty." >&2
    exit 2
  }
  curl "${curl_args[@]}" -c "$cookie_file" \
    -H 'content-type: application/json' \
    -d "$(node -e 'console.log(JSON.stringify({ username: process.env.SMOKE_USERNAME, password: process.env.SMOKE_PASSWORD }))')" \
    "${base_url%/}/api/login" >/dev/null
  curl "${curl_args[@]}" -b "$cookie_file" "${base_url%/}/api/auth/user" >/dev/null
  curl "${curl_args[@]}" -b "$cookie_file" "${base_url%/}/api/operations-suite" >/dev/null
  echo "VPS smoke passed: health, readiness, login, auth, and Operations Suite."
else
  echo "VPS smoke passed: health and readiness. Set SMOKE_USERNAME/SMOKE_PASSWORD for authenticated checks."
fi