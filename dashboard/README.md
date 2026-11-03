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
not the normal release UI. Security findings elsewhere in the dashboard remain
explicitly labeled demo data.
