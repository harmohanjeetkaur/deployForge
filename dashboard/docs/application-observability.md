# Application observability — implemented locally, not rolled out

No application image was built/published/deployed, no backend restart performed,
no monitoring release upgraded, no ArgoCD Application changed and no permissions
added during this step. Existing pending work is preserved.

## Go instrumentation

A private Prometheus registry per application handler exports:

| Metric | Type | Labels |
| --- | --- | --- |
| deployforge_http_requests_total | Counter | route, method, code |
| deployforge_http_request_duration_seconds | Histogram | route, method (plus generated le buckets) |
| deployforge_http_requests_in_flight | Gauge | none |

The counter records completed response codes. Duration and in-flight cleanup run
even on panic; panics propagate to net/http without inventing an HTTP 500 response.
Route labels come from a fixed allowlist of matched ServeMux patterns, never raw
URLs. Methods have a fixed allowlist plus OTHER. No task titles/bodies, headers,
query strings, bearer/session tokens, user IDs, image SHAs or panic text are labels.
The private registry intentionally excludes process/environment/default collectors.
GET /metrics is not counted as application traffic. Healthz/readyz are preserved;
their traffic is excluded from business-request dashboard/alert queries.

GET /metrics uses the existing Go HTTP port, currently an internal ClusterIP
service. It serves only telemetry, not application state. Do not expose this route
through a future public ingress without reviewing that boundary. Concurrent
scrapes are bounded to two and have a five-second handler timeout.

Pinned client_golang v1.23.2 supports the existing Go toolchain. Latest v1.25.0
requires Go 1.26, so this step does not change the Go version.

## Prepared scrape configuration and panels

Both opt-ins default OFF:

* Application chart: metrics.enabled creates a headless ClusterIP service named
  deployforge-metrics, with http-metrics port 8080.
* Monitoring chart: applicationMetrics.enabled adds job deployforge-api, using
  DNS SRV discovery of every ready pod behind that headless service. Scraping a
  single load-balanced ClusterIP would mix independent process counters; it is
  deliberately avoided. No Kubernetes API discovery token/RBAC is needed.

The job has a five-second timeout, 15-second interval, 5,000-sample limit,
10-label limit and 2MB body limit. Its flag participates in the Prometheus pod
config checksum so a future approved upgrade loads the changed configuration.

Grafana source now includes request rate, 5xx ratio, histogram P95 latency,
in-flight requests, response-code rates and health-probe availability. P95 uses
sum by (le) before histogram_quantile, not averaging pod percentiles. Missing
series remain No data. A zero-error result is derived only when traffic exists;
no traffic yields undefined ratio, not fabricated success.

Rules: existing failed health probes for 1m; HTTP 5xx ratio >5% for 5m, gated on
>0.1 requests/s averaged over 5m; missing/all-down API metrics targets for 2m.
HTTP/metrics rules are disabled until scrape opt-in. There is no automatic rollback.

## Express: investigated, not implemented or restarted

Keep the deployment API bound to 127.0.0.1. Recommended next design: observe the
accepted-operation lifecycle with an OpenTelemetry metrics SDK and periodically
export outbound OTLP/HTTP to Prometheus through the existing 127.0.0.1:9090
port-forward. This needs a separately approved Prometheus OTLP receiver flag and
Express instrumentation/restart; neither is changed now. It creates no new
Express listener and does not pass deployment credentials into Prometheus.

Use bounded operation/outcome/mode attributes, a gauge for accepted active
operations, and counters for accepted deployment/rollback outcomes. Authorization
rejections are not failed deployments; do not reconstruct counters from retained
Kubernetes revisions or process-local last-operation data. Export asynchronously
with bounded timeouts so monitoring outages cannot affect GitOps operations.
Limitations: port-forward availability and process restarts cause collection gaps;
OTLP ingestion authentication/network boundaries need review before broader use.
Prometheus receiver documentation: https://prometheus.io/docs/guides/opentelemetry/

## Container CPU/memory: existing metrics, access not approved

Read-only audit confirmed DeployForge container CPU and working-set memory series
in both existing kubelet /metrics/resource and /metrics/cadvisor endpoints, using
the operator's existing access. metrics.k8s.io is not installed. The monitoring
service account cannot get nodes/metrics or nodes/proxy; Prometheus has no mounted
API token. Do not copy operator kubeconfig/admin credentials into monitoring.

For collection, separately review direct TLS-verified kubelet scraping with narrowly
scoped nodes/metrics permissions restricted to docker-desktop. This is still
cluster-scoped RBAC and requires explicit approval plus certificate/reachability
verification. Do not grant broad nodes/proxy just to access metrics. No such role,
token mount, collector or metrics-server installation is added in this step.
Background: https://kubernetes.io/docs/reference/instrumentation/node-metrics/

## Tests (safe to run now)

```sh
(cd app && go test -race -cover ./... && go vet ./...)
npm test --prefix dashboard/server
npm run test:e2e --prefix dashboard
npm run lint --prefix dashboard
npm run build --prefix dashboard
helm lint helm/deployforge
helm lint helm/monitoring
python3 scripts/test-observability.py
git diff --check
```

The Python test requires PyYAML, Helm and Docker. It renders opt-ins on/off,
checks no application pod/image or cluster RBAC changes, verifies service/DNS
contracts and config-checksum changes, then runs pinned promtool in a read-only,
network-disabled, resource-limited test container with a temporary /tmp tmpfs.
It validates rendered config, all dashboard expressions, real provisioning-query
results and alert timing/traffic/recovery fixtures. Synthetic samples never go
to the live Prometheus server.

## Exact future rollout and verification sequence — requires approval

1. Review/commit pending source first, after approval. **Do not simply push app/**:
   current .github/workflows/ci.yaml builds/publishes AND commits a new Helm image
   tag on main, which can trigger ArgoCD automatically. Resolve/approve that
   coupling before pushing; no CI edits are made here. To retain a dashboard-driven
   deployment, separately approve gating that auto-update job and publishing only.
2. After an approved clean source commit and publication mechanism, publish a
   multi-architecture image tagged with that exact source SHA. A manual publishing
   command, only after approval and secure registry login, is:

   ```sh
   APP_SHA=$(git rev-parse HEAD)
   test -z "$(git status --porcelain -uno)" || exit 1
   docker buildx build --platform linux/amd64,linux/arm64 --tag "ghcr.io/harmohanjeetkaur/deployforge:$APP_SHA" --push ./app
   docker buildx imagetools inspect "ghcr.io/harmohanjeetkaur/deployforge:$APP_SHA"
   ```

3. Approve enabling the metrics headless Service through GitOps: add metrics.enabled:
   true to helm/deployforge/values.yaml in a reviewed configuration commit. Do not
   manually change the image. Wait for ArgoCD Synced/Healthy at that config commit.
4. Use the existing authenticated dashboard to verify the immutable image and both
   platforms, preview and confirm ONE approved deployment. Observe its GitOps
   image-tag commit, ArgoCD exact-revision synchronization and 3/3 ready target pods.
   No kubectl set image or rollout undo.
5. Before enabling API scrapes, verify the metric content on every ready replica:

   ```sh
   node scripts/verify-api-metrics.mjs
   ```

   This performs GET-only requests through temporary loopback pod forwards, validates
   Prometheus Content-Type and expected real samples, and closes its forwards.
   Merely seeing HTTP 200 is insufficient: the old Go catch-all route can return
   ordinary JSON for /metrics. This script is intentionally not run against the
   current uninstrumented image.
6. Once all three pods pass, apply only the approved monitoring upgrade:

   ```sh
   helm upgrade deployforge-monitoring helm/monitoring --kube-context docker-desktop -n deployforge-monitoring --set scrapesEnabled=true --set applicationMetrics.enabled=true --set syntheticAlert=false --wait --timeout 5m
   ```

7. Keep loopback forwards running. After at least two scrapes, verify targets:

   ```sh
   curl -fsS http://127.0.0.1:9090/api/v1/targets
   curl -fsSG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=count(up{job="deployforge-api"} == 1)'
   curl -fsSG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=sum(rate(deployforge_http_requests_total{job="deployforge-api",route!~"/healthz|/readyz"}[5m]))'
   curl -fsS http://127.0.0.1:9090/api/v1/rules
   ```

   Expect THREE independent API targets UP. Open
   http://127.0.0.1:3000/d/deployforge-local and confirm real RPS/error/P95 samples
   after read-only GET traffic (the verification script supplies one request/pod).
   Wait up to five minutes for the rate window; missing traffic is not a failure
   to be disguised as zero. Verify replica/probe/ArgoCD health remains unchanged.
   Test sustained 5xx firing with promtool fixtures, not deliberate live outages.

The new Go endpoint, headless Service, per-pod DNS discovery and HTTP dashboard
series cannot be claimed verified in Kubernetes until those approved steps occur.

## Verification results for this implementation

- Go race/coverage tests and vet passed. Coverage: API 86.4%, metrics 88.1%.
  macOS emitted linker LC_DYSYMTAB warnings during race builds; tests still passed.
- 96 backend tests passed; 67 browser tests passed, four opt-in cases skipped.
- Frontend lint/build, both Helm chart lints and diff checks passed.
- Isolated promtool check-config, alert fixtures and all Grafana query parses passed.
  Fixtures cover sustained/low-traffic errors, client errors/probe exclusion,
  availability failure/recovery, missing telemetry, RPS, error ratio and P95.
- Same application image, three pod identities, zero restarts, Helm image values,
  ArgoCD Application spec and Synced/Healthy revision remain unchanged.
- No live Go endpoint, per-pod metrics Service/DNS, or API series has been deployed
  or claimed verified; approval is required for that final stage.
