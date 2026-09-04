#!/bin/sh
set -eu

port="${PORT:-80}"
upstream="${API_UPSTREAM:-api:8080}"

case "$port" in
  ''|*[!0-9]*) echo "PORT must be numeric." >&2; exit 2 ;;
esac
case "$upstream" in
  ''|*[!A-Za-z0-9._:-]*) echo "API_UPSTREAM must be a host:port value." >&2; exit 2 ;;
esac

sed \
  -e "s|__PORT__|$port|g" \
  -e "s|__API_UPSTREAM__|$upstream|g" \
  /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g "daemon off;"