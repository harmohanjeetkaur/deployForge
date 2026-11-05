# Local monitoring

Helm release `deployforge-monitoring` in namespace `deployforge-monitoring`.
All services are ClusterIP. No cluster-wide RBAC: kube-state-metrics has a Role
limited to pods, deployments and ReplicaSets in `deployforge-gitops`.

## Access

Run `./scripts/monitoring-local.sh` and keep the terminal open. Ctrl-C stops its
three forwards. Grafana: http://127.0.0.1:3000/d/deployforge-local
Prometheus: http://127.0.0.1:9090 and Alertmanager: http://127.0.0.1:9093.
The React Monitoring page uses the same loopback endpoints.

Grafana username is `admin`. The generated password is held in Kubernetes Secret
`deployforge-monitoring/grafana-admin`, not Helm values. On macOS, copy it directly
to the clipboard without printing it (clear the clipboard after signing in):

```sh
kubectl --context docker-desktop -n deployforge-monitoring get secret grafana-admin -o jsonpath='{.data.password}' | base64 --decode | pbcopy
```

Do not paste credentials into source, command arguments, logs or documentation.

## Collected signals

* Kubernetes desired/available replicas, pod readiness and restarts.
* Existing ArgoCD controller metrics, including application sync and health.
* Blackbox HTTP probes of the existing Go `/healthz` and `/readyz` endpoints.
* Prometheus, Alertmanager, kube-state-metrics and Blackbox self metrics.

Endpoints were verified from inside the cluster before enabling scrapes.
Prometheus retains 24h (size cap 1GB), using a 2Gi PVC. Grafana and Alertmanager
are ephemeral with reproducible provisioned configuration. This is a single-node
local demo stack, not an HA production monitoring service.

## Budget and limitations

Requests total 260m CPU / 512Mi RAM; limits 1100m CPU / 1024Mi RAM.
Grafana 13 exceeded its initial 256Mi startup limit and reported a datasource
plugin signature error. The installation uses maintained Grafana 12.4.14 with
automatic plugin preinstallation disabled and signature validation preserved.
Grafana is allocated 512Mi; Prometheus's limit is 256Mi,
keeping total limits unchanged. Monitor actual usage before increasing retention
or cardinality. Recreate updates prevent concurrent Prometheus data-volume access.

The currently deployed Go image has no request count/error/duration metrics.
No Go code or image is changed in this phase. Those panels and HTTP/operation
alerts await separately approved instrumentation and rollout; no zeros are invented.
The local Express API remains loopback-only and is not a scrape target. Operation
counters require a separately reviewed metrics transport, not exposure of the API.
CPU/memory series are not scraped: metrics-server is absent and no new kubelet
cluster-wide RBAC is granted. Operator read-only kubelet summary provides a point-in-time
usage report; Grafana container CPU/memory panels honestly show No data.

## Alerts and maintenance

Active production-signal rules: application probe unavailable (1m), available
replicas below desired (2m), and scrape target down (2m). Alertmanager routes to
`local-only`, which has no external notification destinations. A temporary
`DeployForgeMonitoringPipelineTest` alert validates delivery, then is disabled.

Reproduce only the monitoring release (never the application chart):

```sh
helm lint helm/monitoring
helm upgrade --install deployforge-monitoring helm/monitoring --kube-context docker-desktop -n deployforge-monitoring --set scrapesEnabled=true --set syntheticAlert=false --wait --timeout 3m
```

On a fresh installation create the namespace and private Grafana Secret first,
install with scrapes disabled, verify endpoint reachability, then enable scrapes.
No token or Grafana password belongs in Helm values.

## DeployForge monitoring overview

The React Monitoring page refreshes every 30 seconds. The backend reads fixed
loopback Prometheus endpoints for current probe health, available/desired replicas,
ArgoCD health/sync, pending/firing alerts, target metadata and 30-minute probe
availability/duration trends. Query failures produce unavailable values rather
than zeroes. Probe duration is explicitly distinguished from API request latency.
The target table adapts to mobile cards. Grafana remains the detailed exploration
view; monitoring reads never invoke deployment or rollback APIs.
