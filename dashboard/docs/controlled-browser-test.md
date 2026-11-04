# Controlled browser deployment test — proposal only

No real operation is authorized by this document. The live backend remains in
its existing dry-run mode. Authentication is required and remains unchanged.

## Current findings

- The process credential matches the owner-only private credential file. Never
  print either value or inspect process environments in terminal output.
- Direct and Vite-proxied configuration both report real execution disabled.
- Invalid bearer credentials produce HTTP 401 before an operation is accepted.
  Origin rejection produces HTTP 403. The UI reports these as authorization
  errors, not failed rollouts. A token is cleared on 401.
- A request being submitted is not an accepted deployment; the API response
  determines when requested/in-progress stages are shown.
- Local main matches origin/main, but tracked source changes currently prevent
  a real GitOps request. Review and commit intended changes only after approval.

## Preconditions, before a separately approved real test

1. Review all pending work, run tests, and obtain permission to commit/push it.
   Require clean tracked/index state on main, with HEAD equal to live origin/main.
   Preserve unrelated untracked files.
2. Recheck Docker Desktop, three ready replicas, ArgoCD Synced/Healthy, and both
   GHCR images/platforms. Confirm there is no active operation or Git lock.
3. Obtain explicit approval for one deployment and one subsequent rollback.
4. Stop only the re-identified backend listener on port 3001. Do not stop Vite.

After approval, from the repository root, the following foreground launcher reads
credentials into process memory and starts exactly one backend. It must not be
run while another backend is listening, or before the above checks pass:

```sh
node --input-type=module <<'NODE'
import { readFileSync, statSync } from 'node:fs';
const path = process.env.HOME + '/.deployforge-secrets/deploy-token';
const file = statSync(path);
if (file.uid !== process.getuid() || (file.mode & 0o777) !== 0o600) {
  throw new Error('Private credential permissions are invalid');
}
const token = readFileSync(path, 'utf8').trim();
if (!token) throw new Error('Credential unavailable');
process.env.DEPLOYFORGE_DEPLOY_TOKEN = token;
process.env.DEPLOYFORGE_ENABLE_DEPLOY = 'true';
process.env.DEPLOYFORGE_KUBE_CONTEXT = 'docker-desktop';
process.env.DEPLOYFORGE_ARGOCD_APP = 'deployforge';
process.env.DEPLOYFORGE_ARGOCD_NAMESPACE = 'argocd';
const { app } = await import('./dashboard/server/index.js');
app.listen(3001, '127.0.0.1');
NODE
```

Verify `/health` returns 200 and `/api/deploy/config` reports `dryRun:false`,
`executionEnabled:true`, `authenticationConfigured:true`, and
`environment:docker-desktop`. These endpoints do not expose the credential.

## Browser authorization without manual copying

A normal React page cannot securely read the private credential file itself.
For a controlled test, approved browser automation can read that file in memory,
fill the existing masked input, and click the actual React controls. Keep traces,
video, header logging, and storage-state exports off. Remain on Deployments for
both operations; the token stays in React memory and is cleared by navigation.
This avoids manual copying and does not bypass the API or its authorization.

A permanent tokenless UI requires a separately approved authentication change.
The proposed minimal design is a short-lived, server-side local session, paired
once through a trusted terminal helper using the existing private credential.
An HttpOnly, SameSite=Strict cookie, exact Origin validation, CSRF protection,
explicit expiry, logout, and loopback-only bindings would be required. Merely
visiting localhost must not create an authorized session. This protects the
local workflow but is not a multi-user or remote authentication solution; a
compromised local account or same-origin script remains a threat.

## Exactly one controlled cycle, after explicit execution approval

1. In Deployments, choose the **GHCR candidate**
   `5b6d2c0589ab9e4a6dedbde072a95ccf124921aa`, not a Kubernetes revision.
   Verify image/platforms, preview the current-to-target change, click
   **Deploy Version**, review confirmation, and confirm once.
2. Record the job ID and its exact commit. Confirm only Helm values changed,
   the normal push succeeded, ArgoCD is Synced/Healthy at that commit, and all
   three pods run the alternate image. A successful push alone is insufficient.
3. Refresh retained revisions. Select the previous revision containing
   `210426be6d6da6c2e16f234db410f83a0c98bbd2`; do not hardcode its revision
   number, because retained ReplicaSets can be renumbered when reused.
   Verify, preview, click **Rollback to Revision X**, and confirm once.
4. Record the rollback job/commit and verify the restored Helm image, remote
   main, ArgoCD exact revision, and all three ready pods on the restored image.
5. Restore the backend to dry-run using the same secure launcher with the real
   execution environment variable removed before importing the application.
   Verify `dryRun:true` and `executionEnabled:false`.

Stop on any rejection, failure, ambiguous network outcome, or timeout. Do not
retry automatically, manually force synchronization, or roll back automatically.
Inspect Git and cluster state before authorizing any further action.
