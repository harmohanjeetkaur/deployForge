# DeployForge monitoring implementation plan

Status: monitoring-only implementation approved. See monitoring.md for the installed scope and deferred application instrumentation.

## Observed baseline

- Context: docker-desktop; one node, 8 allocatable CPU and 3,911,080 Ki memory.
- Existing requests: 1,200m CPU and 464 Mi memory. These are scheduler reservations,
  not measured live consumption; actual usage must also be checked when available.
- DeployForge: deployforge-gitops/deployforge, 3/3 ready.
- Image at inspection: ghcr.io/harmohanjeetkaur/deployforge:210426be6d6da6c2e16f234db410f83a0c98bbd2.
- ArgoCD: deployforge in argocd, Synced/Healthy at
  639d9b2bea2d502b13add5d1db3e101cf6524e29.
- Existing ArgoCD metrics services are available for scraping.
- No Prometheus/Grafana/Alertmanager installation was found.
- The dashboard Monitoring page exists; /api/monitoring/status returns 404.
- Go source has healthz/readyz routes and no Prometheus instrumentation.

## Architecture

A standalone Helm release in a new deployforge-monitoring namespace:

    Kubernetes workload status -> kube-state-metrics --+
    Kubelet/cAdvisor CPU and memory --------------------+
    ArgoCD metrics services ---------------------------+-> Prometheus -> Grafana
    Existing application readiness -> blackbox-exporter+       |
    Instrumented Go /metrics (later image rollout) ----+       +-> Alertmanager
    Local Express operation /metrics (connectivity gated) ----+

The React page reads a new bounded, read-only Express monitoring-status endpoint.
It provides collector status, real scrape/alert summaries, and local links. Grafana
holds detailed charts. No fake telemetry or inferred scan results are introduced.

No Prometheus Operator, ServiceMonitor CRDs, privileged node-exporter DaemonSet,
external service, Ingress, NodePort, LoadBalancer, or application image update.
All chart services use ClusterIP. Local UIs are exposed only through loopback
port-forwarding. Images will be version-pinned and checked for the local node's
architecture before installation; this plan does not select floating latest tags.

## Initial resource budget

Component             CPU request/limit    Memory request/limit
Prometheus            100m / 500m          256Mi / 512Mi
Grafana               100m / 300m          128Mi / 256Mi
Alertmanager           25m / 100m           32Mi / 64Mi
kube-state-metrics     25m / 100m           64Mi / 128Mi
blackbox-exporter      10m / 100m           32Mi / 64Mi
TOTAL                 260m / 1100m        512Mi / 1024Mi

One replica each. Prometheus: 24h retention, 1GiB TSDB size limit, 2Gi local PVC.
Grafana: provisioned configuration/dashboard; start with ephemeral storage so
recreation is reproducible. Alertmanager: ephemeral local-only demo state.
No HA claim; monitoring data is for local demonstrations. Measure usage and
adjust before expanding; declared requests do not prove real free memory.

## Exact intended files

Create:
- helm/monitoring/Chart.yaml, values.yaml
- helm/monitoring/templates/namespace-rbac.yaml
- helm/monitoring/templates/prometheus.yaml
- helm/monitoring/templates/grafana.yaml
- helm/monitoring/templates/alertmanager.yaml
- helm/monitoring/templates/kube-state-metrics.yaml
- helm/monitoring/templates/blackbox-exporter.yaml
- helm/monitoring/files/prometheus.yml
- helm/monitoring/files/alerts.yml
- helm/monitoring/files/alertmanager.yml
- helm/monitoring/files/grafana-datasource.yml
- helm/monitoring/files/grafana-provider.yml
- helm/monitoring/files/deployforge-dashboard.json
- app/internal/metrics/metrics.go, metrics_test.go
- dashboard/server/metrics.js, metrics.test.js
- dashboard/server/monitoring.js, monitoring.test.js
- dashboard/e2e/monitoring.spec.js
- scripts/monitoring-local.sh (loopback forwarding/cleanup; no release requests)

Modify:
- app/cmd/api/main.go (HTTP instrumentation, /metrics, health/ready aliases)
- app/go.mod, app/go.sum (official Prometheus Go client)
- dashboard/server/package.json and package-lock.json (Prometheus client)
- dashboard/server/index.js (read-only metrics and monitoring routes)
- dashboard/server/deployment.js (operation lifecycle observations only)
- dashboard/src/ControlPages.jsx (Monitoring summary)
- dashboard/src/App.css (small monitoring styles if needed)
- dashboard/README.md and server/README.md (setup, access, limitations)

Preserve the existing deployment Helm chart/values, CI workflow, GitOps source,
ArgoCD Application, authentication, confirmation, locks, and release behavior.
Keep the two current pending UI wording edits and unrelated untracked assets.

## Scraping and permissions

- Kubernetes object metrics: scoped to deployforge-gitops workloads using
  kube-state-metrics. Limit its permissions and resources to those actually used.
- Existing readiness endpoints: blackbox HTTP probe of /readyz and /healthz;
  this supplies real application availability without replacing the Go image.
- ArgoCD controller/server/repo metrics: existing services, no ArgoCD changes.
- CPU/memory: kubelet/cAdvisor with authenticated reads and verified certificates.
  Check certificate trust and read permissions. Do not disable TLS verification
  or grant cluster-admin. If unavailable, show N/A and report the missing access.
- Go HTTP metrics: configure the target only when the instrumented image is
  separately approved and deployed. The current image cannot acquire new code
  simply because source files were edited.
- Express metrics: test host.docker.internal connectivity from the monitoring
  network. Preserve the API's 127.0.0.1 binding and never forward deployment
  credentials into Prometheus. If the existing binding is unreachable, stop this
  target's integration and propose a restricted metrics transport separately;
  do not bind the deployment API to 0.0.0.0 or add a broad proxy as a workaround.
- Add only the discovery/RBAC resources required for these targets. Kubelet
  access should use the narrow nodes/metrics permission where supported; do not
  casually grant nodes/proxy access or treat it as harmless general read access.

## Instrumentation and dashboards

Go owns HTTP request count, error count, and duration histogram. Use bounded route
patterns, methods, and status classes; never URI/query/user/tag/session labels.
Exclude metrics self-scrapes from application traffic panels.

Express owns active GitOps operations, successful/failed operations, and rollback
counts. Observe the existing accepted-operation lifecycle, not UI clicks. Failed
authentication is not a failed deployment. Separate real operations from tooling
simulations. Initialize counters honestly; do not invent past samples from the
last-operation record or retained Kubernetes revisions. Counters can reset on
process restart; Prometheus rate/increase queries account for resets.

Provisioned Grafana panels:
- Request rate and HTTP error rate.
- Histogram-based P95 response latency.
- Deployment/rollback outcomes and active operations.
- Desired/ready replicas, pod readiness, restarts.
- Container CPU and working-set memory where collected.
- ArgoCD sync/health and monitoring target availability.

Use datasource/namespace filters, units, legends, and reasonable time windows.
Unavailable series show No data, not fabricated zeroes or healthy badges.

## Alerts and local routing

Prometheus evaluates rules; Alertmanager groups and routes them.
- Application probe unavailable for 1m.
- HTTP 5xx rate over 5% for 5m, with a minimum traffic guard.
- P95 API latency over 500ms for 5m, with a traffic guard.
- Deployment ready replicas below desired for 2m.
- Increase in failed real GitOps operations.

Use a receiver named local-only with no email, Slack, webhook, or other external
notification configuration. Verify delivery in Alertmanager's UI/API. A clearly
labelled synthetic info alert will test the alert pipeline without disrupting the
application. Disable the synthetic rule again after validation. Rules depending
on future instrumentation are marked pending until real series exist.

## Rollout stages and approval boundary

Approval 1: local source implementation and monitoring-only cluster installation.
This includes the new namespace, chart workloads/services/configuration, local PVC,
monitoring-only RBAC, and a generated Grafana credential Secret. Generate the
credential privately and never put its value in Git, logs, or Helm CLI arguments.
A local Express restart is needed to load new endpoints; only restart when no
release is active, preserve its configured mode/authentication, and acknowledge
that browser sessions require reapproval afterward. No release request is run.

Approval 2, separate later: build/publish an instrumented Go image and perform an
explicitly controlled GitOps deployment. Editing app/** must not be pushed as
part of a monitoring-only commit without reviewing CI triggers: the existing CI
can build/publish an image and update Helm automatically. No such push is covered
by Approval 1.

After Approval 1, Kubernetes/ArgoCD/probe metrics can be demonstrated immediately.
HTTP panels and their alerts remain incomplete until Approval 2 is executed.
Do not declare the full monitoring goal complete before all required live series
are collected and Grafana displays them.

## Verification and local access

- Go, backend, and browser tests; lint, frontend build, Helm lint/template.
- Validate Prometheus rules/config, Alertmanager config, and Grafana JSON.
- Verify each configured target UP, real samples, working dashboard queries,
  datasource access, and expected down/unavailable UI behavior.
- Fire the labelled synthetic alert, verify Alertmanager receives it, then remove
  the test condition. No app outage, deployment, or rollback is used as a test.
- Compare application image, deployment generation, pod identities, Helm values,
  Git history, and ArgoCD health before/after monitoring-only installation.

Proposed local access after installation:

    kubectl --context docker-desktop -n deployforge-monitoring port-forward --address 127.0.0.1 service/grafana 3000:3000
    kubectl --context docker-desktop -n deployforge-monitoring port-forward --address 127.0.0.1 service/prometheus 9090:9090
    kubectl --context docker-desktop -n deployforge-monitoring port-forward --address 127.0.0.1 service/alertmanager 9093:9093

Sources reviewed:
- https://docs.docker.com/desktop/features/networking/networking-how-tos/
- https://grafana.com/docs/grafana/latest/administration/provisioning/
- https://prometheus.io/docs/practices/pushing/ (do not introduce Pushgateway as
  an unreviewed replacement for normal long-running service scraping)
