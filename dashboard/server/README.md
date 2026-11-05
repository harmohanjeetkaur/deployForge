# Local GitOps API

The self-service release coordinator adds repository/source lookup, tag creation,
actual Actions-run tracking, artifact/digest verification, automatic GitOps handoff
and durable release history. See [self-service releases](../docs/self-service-releases.md)
for routes, permissions and restart recovery. It is disabled by default and does
not start Docker/Kubernetes. Existing manual operation jobs remain process-local;
release-owned promotion checkpoints are durably recorded by the coordinator.

The server binds to 127.0.0.1:3001, restricts CORS to localhost:5173, and requires
the local dashboard Origin and either an approved local session with CSRF verification
or a valid operator Bearer credential for deployment/rollback POSTs. Browser
requests use sessions; no deployment credential is supplied through React.
Set `DEPLOYFORGE_DEPLOY_TOKEN` securely in the process environment. Never print
or commit it. Token comparisons use constant-time comparison for equal lengths.

## Normal dashboard requests

`POST /api/deploy` and `POST /api/rollback` accept:

```json
{ "tag": "<40-character-lowercase-SHA>", "execution": "real", "environment": "docker-desktop" }
```

Only the exact server environment value `DEPLOYFORGE_ENABLE_DEPLOY=true` enables
real execution. The variable remains unset by default. An explicit real request
against a disabled API returns 503; it never silently returns a successful
simulation. Enabled APIs require explicit real intent and a matching environment.
The config endpoint reports execution capability, authentication configuration
(as a boolean only), and the target context. It never returns credentials.

`DEPLOYFORGE_KUBE_CONTEXT` defaults to docker-desktop. All kubectl reads explicitly
include that context. Deployment/namespace defaults are deployforge and
deployforge-gitops. `DEPLOYFORGE_ARGOCD_APP` and
`DEPLOYFORGE_ARGOCD_NAMESPACE` default to deployforge and argocd. The UI confirms
the target environment; the server independently checks the submitted value.

Both operations validate SHA shape, GHCR availability and amd64/arm64 support,
reject the current live or Helm image, validate a clean tracked main branch,
fetch and compare origin/main, and recheck immediately before writing. Rollback
also independently validates retained earlier ReplicaSets owned by the exact
Deployment UID, twice before writing. Current, mutable, unavailable, foreign,
or registry-only images cannot be rollback targets.

Only Helm values.yaml image.tag changes. Commits use --only for that file and
verify parent, paths, and content before normal push of the exact commit to
origin/main. Git hooks are disabled for that scoped commit. The engine never
pulls, resets, stashes, force-pushes, changes Kubernetes directly, or automatically
rolls back. A Git failure preserves local work; a push timeout may mean the
remote accepted the commit, so inspect state before taking another action.

## Status and convergence

Poll `GET /api/deploy/status/:tag?id=<job-id>` for either operation. Jobs include
operation, state, stage, commit, push status, observed readiness, and progress:
request-accepted → gitops-commit → argocd-sync → kubernetes-rollout →
health-verification → healthy. A commit alone is not deployment success.

The engine requires observed Kubernetes generation, the exact target container
image, all replicas updated/ready/available, and ArgoCD Synced/Healthy at the
pushed commit. ArgoCD terminal sync errors at that commit, degraded health, rollout
progress deadlines, and convergence timeout are failures. No recovery request is
submitted. Pushed desired state remains after failure. Read-only observation can
continue outside the job to investigate; an operation timeout does not cancel
ArgoCD reconciliation.

One process-local lock covers both operations and stays held through convergence.
Use a single backend process and avoid concurrent manual Git edits. Jobs and locks
are in memory. Retained ReplicaSets may be pruned and do not prove that every old
revision was healthy. SHA tags rely on publisher immutability rather than digest
pinning. Image rollback does not restore databases or external configuration.

## Development tooling and tests

With execution disabled, a tooling POST containing only `{ "tag": "..." }`
retains the existing backend dry-run: image/current-state/Git validation occurs
without fetching, editing, committing, pushing, or changing cluster resources.
Synchronization is checked against cached origin/main. It still requires the
same authentication and Origin. The normal UI does not use this request form.

Run `npm test` here for isolated engine/router/history tests. All Git writes,
pushes and cluster observations in unit tests are mocked. From dashboard, run
`npm run test:e2e` for simulated execution-enabled browser tests with Google
Chrome. Run `DEPLOYFORGE_LIVE_CHECK=1 npm run test:e2e` only with deployment mode
unset and a clean tracked tree to include read-only GHCR/Kubernetes integration.
That test uses an ephemeral API and random test-only credential, guards backend
subprocesses against writes, verifies tooling dry-run behavior, and confirms the
normal UI refuses unconfigured execution. Existing running services are not
restarted by the test. No production-changing test runs automatically.

## Local browser sessions

`POST /api/session/request` creates only a pending session. It cannot authorize an
operation. An operator runs `npm run authorize -- <connection-code>` from this
server directory, or uses `--prefix dashboard/server` from the repository root.
The helper reads the existing owner-only private credential and approves that
specific pending browser; it never returns a browser cookie to the operator.

Cookies contain random 256-bit identifiers, stored hashed on the backend. Cookies
are HttpOnly, Secure, SameSite=Strict, scoped to `/api`, and have no persistent
browser expiry. Every session-authorized release POST also requires its CSRF
header and the exact allowed Origin. Sessions are bounded in memory, expire,
can be logged out, and disappear on backend restart. Existing bearer tooling,
execution defaults, Git validation, image verification, and locks are unchanged.
This assumes a trusted local account and same-origin app; it is not a substitute
for production multi-user authentication or protection against same-origin XSS.
