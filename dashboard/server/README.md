# Local GitOps deployment

Dry-run is the default. Leave `DEPLOYFORGE_ENABLE_DEPLOY` unset (or set to `false`).
The only opt-in value for real deployment is the exact string `true`, read at server startup.
No environment file enables it in this project.

Run `npm start` in this directory and the Vite dashboard separately. Set
`DEPLOYFORGE_DEPLOY_TOKEN` in the server environment; enter that same token in the
dashboard's password field. The browser keeps it in memory only. Server binding
remains `127.0.0.1:3001`; deployment requests require the localhost:5173 Origin.

Dry-run validates the immutable SHA, public GHCR multi-platform index, Helm image,
live Kubernetes image, clean tracked Git state, main branch and cached origin/main.
It does not fetch, write files, commit, push, or poll convergence. Refresh the remote
tracking branch separately before relying on its synchronization check.

When explicitly enabled in a future approved session, the real path fetches
origin/main, checks synchronization again immediately before editing, updates only
image.tag in helm/deployforge/values.yaml, commits only that path, and normally
pushes the exact commit to origin/main. Git hooks are disabled for this scoped
commit. It never pulls, resets, stashes, force-pushes, or automatically rolls back.
Failures preserve local files and commits for inspection; a push timeout may mean
the remote accepted the commit. Inspect remote and local state before retrying.

Real requests return a job ID. The backend holds its process-local lock through
validation, commit, push and up to five minutes of convergence polling. Read-only
kubectl requests require the local context to access deployment deployforge in
namespace deployforge-gitops and the ArgoCD Application. Defaults for the latter
are name deployforge, namespace argocd; override with DEPLOYFORGE_ARGOCD_APP and
DEPLOYFORGE_ARGOCD_NAMESPACE. Success requires the target image, observed full
rollout with all replicas ready/updated/available, and ArgoCD Synced/Healthy at the
exact pushed commit. No kubectl write or ArgoCD sync command is issued.

Jobs and locks are in memory: run one backend instance, avoid concurrent manual
Git edits, and do not restart it during deployment. A restart loses job tracking
and cannot cancel a pushed GitOps change. Existing CI can independently advance
the Helm tag; a normal push rejects conflicts and exact-revision checks avoid
reporting a different deployment as success. SHA-shaped registry tags rely on
GHCR publisher discipline (they are not digest-pinned).

Run `npm test` for fully mocked validation, dry-run, commit/push failure and
convergence tests. Tests do not invoke Git, GHCR, or Kubernetes.

## Browser and live dry-run verification

From `dashboard`, run `npm run test:e2e` for browser checks using installed Google
Chrome. The live test is skipped by default. Run
`DEPLOYFORGE_LIVE_CHECK=1 npm run test:e2e` to include anonymous GHCR reads,
read-only Git/Kubernetes checks, and the complete authenticated dry-run through
the browser. This command requires DEPLOYFORGE_ENABLE_DEPLOY to remain unset;
the test refuses to run otherwise and never sets or changes it.

The live harness starts a separate API on an ephemeral localhost port and gives
it a random test-only token. Browser API traffic is routed to that isolated API;
existing dashboard/server processes are not restarted. A subprocess guard rejects
every backend command except Git reads and kubectl get. Before/after assertions
cover the Helm SHA-256, Git HEAD/refs/index/tracked status, and Kubernetes deployment
spec/generation/resource version. Browser failure/race tests use mocked responses;
the simulated deployment-status test never invokes a real deployment.

Latest verification: 27 backend tests and 7 browser tests passed, including the
live GHCR image 210426be6d6da6c2e16f234db410f83a0c98bbd2 dry-run against current
image 5b6d2c0589ab9e4a6dedbde072a95ccf124921aa. Build and lint passed.
