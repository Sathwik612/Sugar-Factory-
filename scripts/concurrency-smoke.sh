#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${BASE_URL:-http://127.0.0.1:8080}"
requests="${CONCURRENCY_REQUESTS:-30}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

if ! [[ "$requests" =~ ^[0-9]+$ ]] || (( requests < 25 || requests > 100 )); then
  echo "CONCURRENCY_REQUESTS must be an integer between 25 and 100." >&2
  exit 2
fi

for request in $(seq 1 "$requests"); do
  (
    curl --silent --show-error --output /dev/null \
      --write-out "%{http_code} %{time_total}\n" \
      --connect-timeout 5 --max-time 30 \
      "${base_url%/}/api/readyz"
  ) >"$tmp_dir/$request" 2>"$tmp_dir/$request.err" &
done
wait

cat "$tmp_dir"/*.err >&2
for request in $(seq 1 "$requests"); do cat "$tmp_dir/$request"; done | awk '{ print $2 }' | sort -n >"$tmp_dir/times"
failed="$(for request in $(seq 1 "$requests"); do cat "$tmp_dir/$request"; done | awk '$1 != 200 { count++ } END { print count + 0 }')"
completed="$(wc -l <"$tmp_dir/times" | tr -d ' ')"
if (( completed == 0 )); then
  echo "No concurrency responses were received from $base_url." >&2
  exit 1
fi

p95_index=$(( (completed * 95 + 99) / 100 ))
p95="$(sed -n "${p95_index}p" "$tmp_dir/times")"
max="$(tail -n 1 "$tmp_dir/times")"
echo "Concurrency smoke: ${completed}/${requests} responses, failed=${failed}, p95=${p95}s, max=${max}s, url=${base_url%/}/api/readyz"
(( failed == 0 ))