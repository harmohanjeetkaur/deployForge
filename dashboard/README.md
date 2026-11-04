# DeployForge dashboard

A local platform engineering dashboard for GHCR image verification, GitOps
releases, Kubernetes revision history, and explicit image rollback. The existing
Go API, Helm chart, CI workflow, and ArgoCD application remain the deployment
architecture.

## Run locally

Use Node.js 24 and npm:

```sh
cd dashboard
npm ci
npm ci --prefix server
npm start --prefix server
```

Start `npm run dev` in a second terminal and open `http://localhost:5173`.
The API binds only to `127.0.0.1:3001`. Vite uses port 5173 strictly and proxies
to that IPv4 address. Restart the API after changing backend source.

## Release workflow

Choose a different image candidate or enter a 40-character immutable SHA. Verify
its real GHCR availability and both linux/amd64 and linux/arm64 platforms, preview
the image change, supply the operator-provided deployment token, and confirm.
The normal UI explicitly requests real GitOps execution. It shows an actionable
configuration error when execution or server authentication is unavailable;
it never presents a simulation as a successful deployment.

The API updates only Helm image.tag, commits only that values file, and pushes
normally to origin/main. Progress distinguishes request acceptance, commit
creation, ArgoCD synchronization, Kubernetes rollout, and final observed health.
Success requires the target image to be ready and ArgoCD Synced/Healthy at the
exact pushed commit. A timeout or partial failure is not success and does not
cancel a pushed change. No automatic rollback or retry is performed.

For rollback, select an eligible retained revision or its Rollback to Revision X
action, verify the image, preview, and confirm. Rollback creates a new GitOps
commit; it never directly changes Kubernetes. History is bounded by retained
ReplicaSets and is not a historical health audit. Image rollback cannot undo
schema migrations, external state, secrets, or unrelated configuration.

## Operator setup and safety

The backend remains execution-disabled by default. Operators must explicitly
configure `DEPLOYFORGE_ENABLE_DEPLOY=true` for the API process to accept the
normal UI's real requests, provide `DEPLOYFORGE_DEPLOY_TOKEN` securely, configure
Git identity and origin/main push credentials, and supply read access to the
cluster and ArgoCD application. This repository does not enable that variable.

The target context defaults to docker-desktop and can be configured with
`DEPLOYFORGE_KUBE_CONTEXT`. Every kubectl read is pinned to that context. The UI
shows and submits the configured target environment; mismatches are rejected.
Default namespace/application settings are documented in [server notes](server/README.md).

Tokens are password input, kept only in memory, cleared on authentication failure,
explicit clearing, and navigation away from Deployments. No secret is embedded in
Vite variables, logs, browser storage, or tracked environment files. Use a private
owner-only credential handoff rather than printing a token. Environment files
are ignored and the Express process does not load them automatically.

Real operations require main synchronized with origin/main and a clean tracked
working tree. One process-local lock covers deployment and rollback through final
convergence. Run one API process, avoid concurrent repository edits, and do not
restart during an operation. Locks and job history do not survive restarts.

## Verification

```sh
npm test --prefix server
npm run lint
npm run build
npm run test:e2e
```

Browser tests use installed Google Chrome. Execution-enabled browser/API fixtures
are simulated and never enable a real backend or run a Git/Kubernetes mutation.
The original backend dry-run behavior remains available for development tooling
and the opt-in read-only integration test described in the server notes. It is
not the normal release UI. Security findings are explicitly unavailable until a CI results API is connected.

### Readiness, authorization, and operation history

Deployment readiness is read from the local API on entry, every ten seconds, and
when the window gains focus. Failed configuration requests disable execution.
A token provided in the compact **Authorize Deployment** section stays in React
memory and clears on navigation or an HTTP 401 authentication rejection. Entering a
token does not prove authorization: the server validates it at submission.

Select a GHCR candidate for **Deploy Version**, or a retained Kubernetes revision
for **Rollback to Revision X**. Verification, preview, authorization, and confirmation
remain mandatory. Disabled reasons appear next to the action.

The API configuration includes `latestOperation` from the current backend process.
The UI also supports older backends through their existing image-tag status route.
Only one operation is retained, and it is lost on backend restart. Older operations
may have no timestamp. Kubernetes ReplicaSet creation time is not a release time.
No persistence has been added. If durable history is required, a separately approved
minimal append-only operation journal with restricted permissions and no credentials
would be a possible next step.

GET-only live browser verification (confirmation is always cancelled):

```sh
DEPLOYFORGE_READ_ONLY_UI=1 npm run test:e2e --prefix dashboard -- live-readiness.spec.js
```

This test requires an already execution-enabled backend with the verified rollback
operation still retained in process memory; it never enables execution. It reads the
existing private credential into memory. Every non-GET API request is blocked by the test.

### Platform control center

Overview and Kubernetes use `/api/kubernetes/status` for workload information.
The endpoint now adds replica counts, deployment revision, bounded pod diagnostics,
and optional live ArgoCD sync/health metadata. An ArgoCD read failure leaves workload
data available and renders ArgoCD as unavailable. Pod readiness does not imply
ArgoCD health, and zero desired replicas are never labelled a healthy running workload.

Security explicitly reports missing CI evidence; it does not turn a passing CI run
into a vulnerability verdict. No scan-results API is currently connected.

Monitoring optionally reads `GET /api/monitoring/status`. The supported response is
`{ "services": [{ "name": "Prometheus", "status": "up", "url": "http://127.0.0.1:9090" }] }`.
Status must be `up`, `down`, or `unknown`; URLs are optional, and only HTTP(S)
loopback links without embedded credentials are rendered. This is an integration
contract, not a simulated monitoring backend. The existing backend returns 404
until monitoring is separately implemented. No metrics or charts are fabricated.

Read-only live visual verification:

```sh
DEPLOYFORGE_LIVE_DESIGN=1 npm run test:e2e --prefix dashboard -- live-design.spec.js
```

The test blocks non-GET API requests and captures desktop/mobile screenshots under
`/private/tmp/deployforge-control-*.png`. It does not submit a release operation.

### Execution configuration consistency (Step 1)

Overview, Deployments, and Settings share the same interpretation of
`GET /api/deploy/config`. Healthy Kubernetes replicas and ArgoCD synchronization do
not enable the local dashboard's execution mode. The backend reads
`DEPLOYFORGE_ENABLE_DEPLOY` at startup; only the exact value `true` enables real
execution. Authentication is independently reported and remains mandatory.

Configuration refreshes on page entry, window focus, tab visibility, manual
refresh, and a ten-second interval. Requests time out and superseded requests are
cancelled. Unavailable, contradictory, or unsupported configuration never enables
an action. All three pages show the same execution state, authentication status,
and last-check time. A deliberate backend restart is required to change execution
mode; the dashboard never enables it automatically.

Run the GET-only live consistency check without changing execution mode:

```sh
DEPLOYFORGE_READ_ONLY_CONFIG=1 npm run test:e2e --prefix dashboard -- execution-consistency.spec.js
```

Enabled and disabled transitions are tested with fixtures, not live operations.
