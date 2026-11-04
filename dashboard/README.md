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
its real GHCR availability and both linux/amd64 and linux/arm64 platforms. Click
Deploy Version or Rollback to review the current and target images, then confirm. A local browser session handles authorization automatically.
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

The browser uses a short-lived HttpOnly, Secure, SameSite=Strict session cookie.
There is no deployment credential input and no credential in React, localStorage,
or sessionStorage. Approve a new browser once in a trusted local terminal using
the nonsecret connection code in Settings:

```sh
npm run authorize --prefix dashboard/server -- <browser-connection-code>
```

The helper reads `~/.deployforge-secrets/deploy-token` privately (0600, directory
0700). It never prints the credential or puts it in command arguments. Approval
expires after two minutes; approved sessions have a two-hour maximum and expire
after thirty minutes without an authorized operation. Backend restart invalidates
all sessions. Logout is available in Settings. Use `http://localhost:5173` so
Chrome accepts the Secure localhost cookie. This setup is local-only, not remote
multi-user authentication. Environment files remain ignored.

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
A local session survives page navigation. HTTP 401/403 rejects the session in the
UI and displays an authorization error, not a failed rollout. Only a trusted
operator holding the private credential can approve a pending browser.

Select a GHCR candidate for **Deploy Version**, or a retained Kubernetes revision
for **Rollback to Revision X**. Verification, authorization, and confirmation remain mandatory. The primary
action opens the change review; there is no separate preview prerequisite.
Buttons stay clickable and explain missing prerequisites inline before any request
is submitted. A running release cannot be interrupted by changing the selection.

The API configuration includes `latestOperation` from the current backend process.
The UI also supports older backends through their existing image-tag status route.
Only one operation is retained, and it is lost on backend restart. Older operations
may have no timestamp. Kubernetes ReplicaSet creation time is not a release time.
No persistence has been added. If durable history is required, a separately approved
minimal append-only operation journal with restricted permissions and no credentials
would be a possible next step.

Live session verification (only session setup writes; release confirmations are cancelled):

```sh
DEPLOYFORGE_READ_ONLY_UI=1 npm run test:e2e --prefix dashboard -- live-readiness.spec.js
```

This test requires an already execution-enabled backend. It pairs a fresh browser
using the trusted helper, checks real image verification, and cancels both release
confirmations. All deployment and rollback POSTs are blocked; only authentication
setup may write session state. The test never enables execution.

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

The test permits session setup but blocks other non-GET API requests and captures desktop/mobile screenshots under
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

### Simplified release controls

Choose **Deploy a version** or **Roll back a version**, select the image/revision,
verify GHCR availability, then click **Deploy Version** or **Rollback**. The action
opens a review dialog; only its confirmation can submit the request. Current and
target images are shown in that dialog. Progress and revision history remain below.
No token entry or separate review card is present. All buttons are interactive;
validation, authorization, and duplicate-submission guards remain enforced by
handlers and the backend. Missing prerequisites produce an inline explanation.
The running backend mode is reported accurately; this UI does not enable execution.
