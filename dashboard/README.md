# DeployForge dashboard

React/Vite dashboard and localhost Express API for viewing Kubernetes deployment
status/history, verifying GHCR image platforms, and preparing GitOps deployments.
Dry-run is the default. Real deployment remains disabled unless explicitly opted
in at server startup; see [backend safety and recovery notes](server/README.md).

## Local setup

Use Node.js 24 and npm. Install both dependency sets from their lockfiles:

```sh
cd dashboard
npm ci
npm ci --prefix server
```

Start the backend with `npm start --prefix server` and the frontend with
`npm run dev` in a separate terminal. Open `http://localhost:5173`. The backend
binds to `127.0.0.1:3001`; Vite proxies `/api` to it. Deployment requests require
the localhost dashboard Origin and `DEPLOYFORGE_DEPLOY_TOKEN` configured in the
backend environment. Enter that token in the dashboard password field; it is
kept in browser memory only. Environment files are ignored and are not loaded
automatically by the Express backend. Never use a `VITE_` variable for a secret:
Vite embeds those values in browser bundles.

Leave `DEPLOYFORGE_ENABLE_DEPLOY` unset. Dry-run verifies GHCR, the current image,
and Git state without writing Helm values, committing, pushing, or changing
Kubernetes resources. Kubernetes views and live validation require a local
kubectl context with read access to namespace `deployforge-gitops`. Missing
credentials or connectivity produce errors rather than bypassing validation.
The server resolves the repository root relative to its source location.

## Checks

```sh
npm test --prefix server
npm run lint
npm run build
npm run test:e2e
```

Browser tests use installed Google Chrome. The default suite mocks backend
responses and skips the opt-in live GHCR/Kubernetes dry-run. See the backend
README for that test's prerequisites and mutation guards. Running checks does
not require enabling real deployment.

The repository includes dependency lockfiles, source, tests, and documentation.
Dependencies, environment/credential files, logs, coverage, browser reports, and
build output are ignored. The available-image entry is a fixed portfolio example,
not a live registry listing; security findings shown in the UI are demo data.

## Rollback

On Deployments, choose a previous eligible Kubernetes revision, verify its GHCR
image, and select Rollback. The confirmation displays current and target images.
Rollback uses the same authentication, default dry-run protection, Git validation,
shared operation lock, and ArgoCD/Kubernetes convergence checks as deployment.
A real rollback creates a new Helm image-tag commit rather than changing
Kubernetes directly. See [rollback behavior and limitations](server/README.md#explicit-gitops-rollback).

## Disabled deployment and rollback buttons

Authentication is required even for dry-runs. Enter the backend's current token,
select a different valid SHA image, and verify both GHCR platforms. Dry-run mode
itself does not disable the buttons. The dashboard lists missing prerequisites.

Rollback also requires an explicit `rollbackEligible: true` from the backend's
history response. Missing or malformed eligibility is shown as Unknown and kept
blocked; it is not treated as No or recalculated in the browser. If the running
backend predates rollback support, it must be restarted with the reviewed latest
code in dry-run mode after approval. Refresh Versions then reloads history and
updates the selected revision's metadata without weakening validation.

A valid historical ReplicaSet normally has zero ready replicas after scaling
down; that alone does not disqualify it as a rollback target. Only the currently
deployed revision must be healthy. Backend validation still requires a clean
tracked Git working tree on main synchronized with origin/main, even for a
rollback dry-run. Local implementation changes must be resolved before trying
a live API dry-run; an enabled button does not bypass those server checks.
