# Testing evidence

Refreshed on **6 November 2026 (Asia/Kolkata)** against the current working tree,
including incident troubleshooting, local analysis and monitoring improvements.
These are local results, not a new GitHub Actions run. External release/deployment
integrations are mocked; opt-in live suites were not enabled.

## Results and receipts

| Check | Result | Evidence |
| --- | --- | --- |
| Complete Express/backend test suite | 180 passed, 0 failed | [Actual backend output](backend-results.txt) |
| Complete browser suite | 90 passed, 0 failed; 4 opt-in tests skipped | [Actual browser output](browser-results.txt) |
| Dashboard lint | Passed | `npm run lint --prefix dashboard` |

Backend and browser tests mock external mutations. Browser fixtures intercept API
requests; pressing a confirmation button in these tests reaches a mock, never a
live Git tag, Git push, registry publication, Kubernetes deployment, or rollback.
The tests assert request counts, payloads, authorization, state transitions and
failure behavior. A screenshot alone does not establish those assertions; the
linked test source and logs provide their context.

All workflow images below have a visible **AUTOMATED TEST · MOCKED INTEGRATIONS ·
NO LIVE DEPLOYMENT** marker. Fictional commit IDs, run IDs and timestamps in these
images are test fixtures. The [main README gallery](../../README.md#dashboard-screenshots)
contains separate read-only captures of all seven pages plus the rollback view and a completed local diagnosis using existing live API data.

## Create Tag & Deploy

[Test source](../../dashboard/e2e/releases.spec.js). The successful workflow test
resolves source, submits exactly one release intent, observes CI and publication,
checks digest/run/health evidence, and retains history after navigation. Other
cases cover disabled execution, security failure, unauthorized sessions, and
blocking active work without blocking failed/review-required history.

### Source and version selection

![Create release inputs — mocked test](../images/testing/create-release-input-mock.png)


### CI in progress

![Create release CI — mocked test](../images/testing/create-release-ci-mock.png)


### Release completes with image and rollout evidence

![Create release success — mocked test](../images/testing/create-release-success-mock.png)


## Deploy an existing image

[Test source](../../dashboard/e2e/production-ui.spec.js). Tests verify the review
shows both current and target images and cancellation sends no deployment POST.
The progress test tracks commit creation, ArgoCD sync, Kubernetes rollout, and
health verification independently before accepting success. Additional cases
reject simulation responses and missing health proof, recover authorization,
and guard duplicate confirmation.

### Deployment confirmation

![Deployment review — mocked test](../images/testing/deployment-confirmation-mock.png)


### Deployment in progress

![Deployment progress — mocked test](../images/testing/deployment-progress-mock.png)


### Deployment healthy

![Deployment success — mocked test](../images/testing/deployment-success-mock.png)


## Roll back a retained revision

[Test source](../../dashboard/e2e/rollback.spec.js). Tests select an eligible
retained revision, verify the image, inspect current/target images and confirm
exactly one authenticated rollback request. They also cover requested/in-progress/
succeeded states, timeouts, authentication errors, invalid/current/unretained
revisions, changing selections and cancelling confirmation without submission.

### Rollback confirmation

![Rollback review — mocked test](../images/testing/rollback-confirmation-mock.png)


### Rollback in progress

![Rollback progress — mocked test](../images/testing/rollback-progress-mock.png)


### Rollback healthy

![Rollback success — mocked test](../images/testing/rollback-success-mock.png)


## Reproduce

From the repository root, with dashboard dependencies and Google Chrome installed:

```sh
npm test --prefix dashboard/server
npm run lint --prefix dashboard
DEPLOYFORGE_DOC_SCREENSHOTS=1 npm run test:e2e --prefix dashboard
```

The screenshot switch only adds captures to already mocked tests. Omitting it
runs the same assertions without writing documentation images. Test captures are
written to `docs/images/testing/`. Browser tests reuse the local Vite server when
present or start it on port 5173. They do not require Docker or Kubernetes.

To refresh the **live read-only page gallery**, first have the dashboard and API
running with the relevant read integrations available, then run:

```sh
DEPLOYFORGE_CAPTURE_UI=1 node scripts/capture-ui-docs.mjs
```

The helper starts no infrastructure and blocks release/deployment/rollback writes.
For the seven page views, rollback view and an actual **local** diagnosis, explicitly
opt into a temporary browser session:

```sh
DEPLOYFORGE_CAPTURE_UI=1 DEPLOYFORGE_CAPTURE_LOCAL_ANALYSIS=1 \
  node scripts/capture-ui-docs.mjs
```

This mode requires `DEPLOYFORGE_AI_PROVIDER=local` on the existing backend and the
owner-only operator credential. It approves only its own temporary browser,
collects real pod evidence and runs local rules, then disconnects the browser.
No external AI call is permitted. Credentials are never captured. All nine views
and current errors are recorded in [the capture receipt](../images/capture-receipt.json).
The Security page currently shows unavailable GitHub report retrieval, not a clean
scan. No live deployment or rollback was performed for documentation.

## Incident analysis coverage

[Backend tests](../../dashboard/server/incidents.test.js) check evidence bounds,
credential redaction, consent, authorization, expiry, request deduplication,
structured OpenAI output and safe quota/rate-limit handling with mocked responses.
[Local analysis tests](../../dashboard/server/incident-local.test.js) verify
startup, readiness, image pull, healthy and unknown cases without model calls.
[Browser tests](../../dashboard/e2e/incidents.spec.js) exercise evidence preview,
approval, citations, provider errors and accurate local analysis attribution.

![Actual local diagnosis using captured Kubernetes evidence](../images/ai-troubleshooting-analysis.png)
