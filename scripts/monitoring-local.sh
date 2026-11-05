#!/bin/sh
set -eu
pids=''
cleanup() { for pid in $pids; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT
trap 'exit 0' INT TERM
for item in grafana:3000 prometheus:9090 alertmanager:9093; do
  service=${item%:*}; port=${item#*:}
  kubectl --context docker-desktop -n deployforge-monitoring port-forward --address 127.0.0.1 "service/$service" "$port:$port" &
  pids="$pids $!"
done
wait
