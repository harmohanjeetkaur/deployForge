# Monitoring verification — 2026-11-04

Installed Helm release deployforge-monitoring, revision 6, namespace
`deployforge-monitoring`, context `docker-desktop`. Five final pods Running/Ready,
zero restarts. All services ClusterIP; local forwarding binds 127.0.0.1 only.
No ClusterRole/ClusterRoleBinding was added.

## Live evidence

- Seven Prometheus targets UP: Prometheus, Alertmanager, kube-state-metrics,
  Blackbox exporter, ArgoCD controller, application healthz and readyz probes.
- Available and desired application replicas: 3. Both probe_success values: 1.
- argocd_app_info: Synced / Healthy.
- Grafana provisioned dashboard and datasource health API: successful.
- Real Chrome browser displayed replica/probe charts with collected samples.
  React Monitoring page showed 7/7 targets UP at desktop and mobile sizes.
- Three final alert rules healthy/inactive. Safe synthetic alert fired and reached
  local-only Alertmanager, then its rule was removed and the alert expired.
- promtool configuration/rule checks and amtool check-config passed.

Measured kubelet-summary snapshot (not scheduler requests):

| Component | CPU (mCPU) | Working-set memory (MiB) |
| --- | ---: | ---: |
| Prometheus | 75.6 | 48.2 |
| Grafana | 203.5 | 177.6 |
| Alertmanager | 47.2 | 15.8 |
| kube-state-metrics | 27.2 | 11.2 |
| Blackbox | 28.6 | 12.3 |
| Total | 382.1 | 265.2 |

Node snapshot: 1820.5m CPU / 2591.2MiB working-set memory. Usage varies with load.
Declared requests remain 260m/512Mi and limits 1100m/1024Mi.

## Regression checks

- Go tests passed.
- Backend: 95 passed.
- Browser: 66 passed, four opt-in cases skipped. Additional real-browser monitoring
  and Grafana checks passed without deployment/rollback submissions.
- Lint, frontend production build, Helm lint and git diff --check passed.
- Render checks verified ClusterIP-only services, no cluster RBAC and budget totals.

Initial installation exposed Grafana 13 OOM/plugin-signature problems, a
Prometheus shared-volume rolling-update conflict and synthetic-rule indentation.
All were corrected: maintained Grafana 12.4.14, unchanged aggregate memory budget,
Recreate updates, isolated config checksums and validated rules. Final release is
Deployed. No signature checks were bypassed.

## Application preservation

Application deployment spec, generation and UID unchanged; same three pod UIDs,
all Ready/Running with zero restarts. Helm values SHA256 unchanged:
`3cb66f435ed921051bdc2f58c2c7a0ebe651e18105a1c8a8fe317330eed5a409`.
Git HEAD and ArgoCD sync revision remain
`639d9b2bea2d502b13add5d1db3e101cf6524e29`.
ArgoCD Application spec unchanged. Running image remains
`ghcr.io/harmohanjeetkaur/deployforge:210426be6d6da6c2e16f234db410f83a0c98bbd2`.
No application deployment, rollback, commit or push performed.

The idle Express backend was restarted to load the read-only status route,
preserving its pre-existing execution mode and private authentication.
Browser deployment sessions require local reapproval after that restart.

## Deferred

Go request/error/latency instrumentation, GitOps operation metrics, corresponding
HTTP/operation alerts and container CPU/memory time-series collection remain
unavailable. See monitoring.md. No application image rollout is authorized here.
