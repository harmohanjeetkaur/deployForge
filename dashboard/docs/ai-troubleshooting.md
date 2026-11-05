# Read-only Kubernetes incident troubleshooting

DeployForge combines healthy application pods with isolated fault-injection workloads.
The AI Troubleshooting page collects real Kubernetes evidence and supports free local
evidence rules or the optional OpenAI Responses API to propose a diagnosis. AI never runs commands, changes a resource,
rolls back, deploys, or creates a failure. No model response is fabricated when the
provider is unavailable or no key is configured.

## Flow

1. Select an approved application/demo pod in `deployforge-gitops`.
2. Connect a local browser session in Settings and collect evidence.
3. Review status, events, current/previous logs, application rollout, ArgoCD and
   monitoring summaries. Unavailable sections remain explicitly unavailable.
4. Approve local analysis, or explicitly consent to send the reviewed snapshot to OpenAI when that provider is configured.
5. Read the diagnosis, likely cause, confidence, evidence citations, suggested
   checks, proposed remediation and uncertainty. Take any action separately.

Only the `deployforge` application labels or the
`app.kubernetes.io/part-of=deployforge-incident-demo` label are in scope. Arbitrary
namespaces/pods cannot be submitted. Status inventory is read-only; collection and
analysis require local session + CSRF or the existing operator credential and the
trusted localhost Origin. No Secret resources, ConfigMap contents or environment
values are collected. Log collection is bounded and common credential patterns
are redacted before preview and transmission. Redaction cannot detect every secret:
review the snapshot and do not send it if private data remains.

Snapshots expire after five minutes, are bounded to 20 in memory, and are not
persisted. Analysis has a single in-flight lock, a 15-second rate limit, a 45-second
provider timeout, bounded output, strict schema validation and evidence-ID checks.
Successful analysis of the same snapshot returns its cached answer rather than
charging for another call. Restart invalidates snapshots and browser sessions.
Prompts explicitly treat logs as untrusted data; the model has no tools or execution
capability. Recommendations are untrusted suggestions, not proven root causes.

## OpenAI configuration

The implementation uses `gpt-5-mini` by default, configurable through
`DEPLOYFORGE_AI_MODEL`. It uses structured JSON output, low reasoning effort,
a bounded output budget, and `store: false`. This disables response-object storage;
it is not a blanket statement about all provider data-retention policies.
Account model access, API billing and limits must be configured by the operator.
An API key is separate from a ChatGPT subscription. No key is required for local
mocked tests or collecting/reviewing Kubernetes evidence.

In the trusted backend terminal, **only when no release/operation is running**:

```zsh
# Stop the old backend with Ctrl+C before these commands.
read -rs "OPENAI_API_KEY?OpenAI API key (hidden): "
echo
export OPENAI_API_KEY
export DEPLOYFORGE_ENABLE_AI=true
export DEPLOYFORGE_AI_MODEL=gpt-5-mini
npm start --prefix dashboard/server
```

Keep existing operator/GitHub configuration in that terminal. The AI flag is
independent of both release/deployment flags; this command does not turn those
flags on. Do not put the key in `VITE_*`, source files, screenshots or chat.
Restart invalidates the local browser session, so reconnect it in Settings using
the existing trusted authorization helper. The OpenAI key is never returned to
React or logged. Set a project usage budget in the OpenAI account. API calls occur
only on explicit Analyze with OpenAI requests after consent.

Docs used for the implementation:
[Responses and structured output](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses),
[GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini).

## Isolated real demo incident

`k8s/demo/incident.yaml` defines exactly one small Deployment, independent of Helm
and the main Service selector. It reuses the existing application image, disables
service-account token mounting, drops capabilities, and has a read-only root
filesystem. Requests: 5m CPU / 8 MiB; limits: 25m CPU / 32 MiB. Recreate strategy
prevents retaining a second failed pod during an update. The required
`DEMO_REQUIRED_CONFIG` variable is intentionally absent; startup prints labelled
error messages and exits 1, producing real restarts / CrashLoopBackOff.

```sh
# Inspect the demo; these commands are read-only.
kubectl --context docker-desktop get pods -n deployforge-gitops -l app=deployforge-incident-demo
kubectl --context docker-desktop logs -n deployforge-gitops deployment/deployforge-incident-demo --tail=20
```

The main application keeps its three healthy replicas. Monitoring shows a separate
live incident summary so an injected failure is not confused with application
availability or a Prometheus alert. Kube-state-metrics already watches this
namespace, so demo pod status/restarts are real collector metrics; no fabricated
alerts or log lines are added to Prometheus. The optional multi-incident drill below adds labelled demo-only monitoring rules.

Only after deciding to run the demo, create it with:

```sh
kubectl --context docker-desktop apply -f k8s/demo/incident.yaml
```

For a supervised resolution demo, this **changes only the demo** and starts its
application when configuration is present:

```sh
kubectl --context docker-desktop set env deployment/deployforge-incident-demo -n deployforge-gitops DEMO_REQUIRED_CONFIG=demo-value
```

To stop or remove it (never delete the application namespace):

```sh
kubectl --context docker-desktop scale deployment/deployforge-incident-demo -n deployforge-gitops --replicas=0
# Or remove exactly the isolated demo resources:
kubectl --context docker-desktop delete -f k8s/demo/incident.yaml
```

Reapplying the original manifest may preserve an imperatively added variable;
remove it explicitly with `kubectl --context docker-desktop set env
deployment/deployforge-incident-demo -n deployforge-gitops DEMO_REQUIRED_CONFIG-`
when intentionally restoring the failure. These mutations are manual only; the
AI page has no endpoint to run them. Check local resources before adding workloads.

## API and tests

- `GET /api/incidents`: scoped pod inventory and nonsecret AI configuration.
- `POST /api/incidents/evidence`: authenticated collection; no external AI call.
- `POST /api/incidents/analyze`: authenticated, explicit consent and snapshot ID.

```sh
npm test --prefix dashboard/server
npm run test:e2e --prefix dashboard -- incidents.spec.js monitoring.spec.js control-center.spec.js
```

Tests use mocks and cover healthy/failing cases, pod scope, redaction, missing
sections, unauthorized/invalid requests, consent, expiry, deduplication, provider
errors, fabricated citations, missing configuration and mobile layout. Passing
mock tests is not proof that a real OpenAI API request succeeded.

## Multiple live failures, monitoring and recent detections

A second isolated manifest, `k8s/demo/readiness.yaml`, runs a tiny HTTP handler
inside the cached application image. It deliberately responds with **HTTP 503**
for an unavailable demo dependency. Readiness therefore fails while the process
remains running; its current logs include request lines and the labelled 503
handler context. Unlike an unknown route on the sample Go API (which can return
200 through its catch-all handler), this endpoint produces a verified error.
The demo Service publishes not-ready addresses only for external failure probing;
it has a unique selector and cannot receive main application traffic.

Both demos use Recreate with one replica each. Combined maximum resource limits
are 64 MiB and 50m CPU; the main three app replicas remain independent.
The second demo is created with:

```sh
kubectl --context docker-desktop apply -f k8s/demo/readiness.yaml
```

Optional Prometheus monitoring adds exactly one `demo-incident-probes` job and
one `deployforge-demo-incidents` rule group with three `demo=true` warnings:

- `DeployForgeDemoCrashLoop`: the startup pod enters CrashLoopBackOff.
- `DeployForgeDemoReadinessFailure`: the HTTP demo pod is not ready.
- `DeployForgeDemoHTTPProbeFailure`: Blackbox detects its non-2xx response.

The rules require 30 seconds of matching observations and then flow to the
existing **local-only** Alertmanager receiver. No email, Slack or external receiver
is configured. Main application health uses a separate scrape job and remains
truthful; a healthy scrape target can still report a failed HTTP probe.

The chart defaults `demoIncidents.enabled=false`. For the existing live setup,
`scripts/configure-demo-monitoring.py` preserves other jobs/rules, backs up the
ConfigMap, and uses a resourceVersion test before changing only its two data keys.
Prepare and review without applying:

```sh
python3 scripts/configure-demo-monitoring.py --enable
```

It prints backup/patch paths. After review, these explicit flags apply and reload:

```sh
python3 scripts/configure-demo-monitoring.py --enable --apply --restart
```

Prometheus uses subPath-mounted config files, so it needs a brief restart; its
persistent volume is retained. Restart the Prometheus loopback port-forward
when its old pod exits. Future Helm upgrades should set
`--set scrapesEnabled=true --set demoIncidents.enabled=true` to retain the demo
config; a Helm upgrade can otherwise replace the temporary live ConfigMap edit.

Overview and Monitoring show **Recently detected** entries from real Kubernetes
readiness/restart status and Prometheus alerts. Repeated observations update
last-seen time without duplicating the record. History is process-local, capped
at 50 records / 12 returned entries and one hour. Resolved signals are identified;
missing pods are marked not-observed rather than falsely recovered. Missing
Prometheus data does not imply an alert resolved. A restart clears this recent
history. The Troubleshoot link selects the affected pod when one is known.
AI evidence includes the actual demo HTTP status, alerts and current/previous logs.
No model call occurs during polling, collection, or monitoring.

### Stop the drill

Stop both isolated workloads, then remove their probe and rule group:

```sh
kubectl --context docker-desktop -n deployforge-gitops scale deployment/deployforge-incident-demo deployment/deployforge-readiness-demo --replicas=0
python3 scripts/configure-demo-monitoring.py --disable --apply --restart
```

Or remove exactly the two demo manifests, including the demo Service:

```sh
kubectl --context docker-desktop delete -f k8s/demo/incident.yaml -f k8s/demo/readiness.yaml
```

Removing a pod alone may leave the HTTP demo alert firing if its scrape job is
still configured; disable the demo monitoring job/group when ending the drill.
The helper's original-configmap backup is retained for inspection/recovery. Never
restore a stale entire ConfigMap blindly if other monitoring settings changed.

Validate offline:

```sh
python3 scripts/test-demo-monitoring.py
helm lint helm/monitoring
helm lint helm/monitoring --set scrapesEnabled=true --set demoIncidents.enabled=true
```

## Incident presentation

The UI correlates Kubernetes and Prometheus signals by workload instead of
repeating every alert as a separate incident. Overview defaults to a short list
of current affected workloads; complete observed history is expandable. Monitoring
keeps raw active-alert counts but groups alert cards, prioritizes unhealthy scrape
targets, and shows the full target list on demand. Raw alert identifiers and signal
metadata remain available in details.

AI Troubleshooting separates workload selection, evidence collection and analysis.
Attention-only and all-workload filters keep healthy pods accessible. Evidence
sources and logs are collapsed by default and show source availability; expand
and review them before consenting to transmission. Workload metadata retains the
controlled fault-injection origin, and raw logs retain their original provenance.
The primary UI does not repeat injected-scenario badges. This is a presentation
change, not a claim that a local drill is a production outage or that the existing
local authentication model is suitable for a public hosted service.
## Free local analysis

Set `DEPLOYFORGE_AI_PROVIDER=local` before starting the backend to use deterministic evidence rules without API credentials or charges. The UI identifies the source as **Local analysis** and uses the same evidence, approval and diagnosis layout. Logs remain actual captured Kubernetes evidence. Results are hypotheses from rules, not LLM-generated output, and no remediation runs automatically.

To return to OpenAI, unset `DEPLOYFORGE_AI_PROVIDER` and configure the existing OpenAI variables. Provider selection is explicit; an OpenAI failure does not silently substitute a local result. Restart the backend from its existing terminal after changing the setting, then reconnect the local browser session.
