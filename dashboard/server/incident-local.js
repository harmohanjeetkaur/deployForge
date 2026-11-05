// Deterministic diagnosis from captured evidence. No model, network or mutation capability.
export function createLocalIncidentAnalysis() {
  return {
    config: { provider: 'Local analysis', model: 'Evidence rules v1', configured: true, enabled: true },
    async analyze(evidence) {
      const sections = (evidence.sections || []).filter(s => s.available !== false);
      if (!sections.length) throw Object.assign(Error('No evidence available; collect a fresh snapshot'), { statusCode: 409 });
      const podSection = sections.find(s => s.id === 'pod');
      let pod = {};
      try { pod = JSON.parse(podSection?.content || '{}'); } catch { /* Missing structured status remains unknown. */ }
      const logs = sections.filter(s => /^(logs-|previous-)/.test(s.id));
      const events = sections.find(s => s.id === 'events');
      const text = logs.map(s => s.content).join('\n');
      const reasons = [pod.reason, ...(pod.containers || []).map(c => c.state?.waiting?.reason || c.state?.terminated?.reason)].join(' ');
      let summary = 'The available evidence does not establish a specific failure cause.';
      let likelyCause = 'More evidence is needed before identifying a cause.';
      let checks = ['Review pod events, container termination reasons and recent configuration changes.'];
      let remediation = ['Confirm the failure cause before changing the workload.'];
      const citations = new Set([podSection?.id].filter(Boolean));
      if (/CrashLoopBackOff/.test(reasons)) {
        summary = 'The container is repeatedly failing to stay running.';
        likelyCause = 'Repeated process termination is preventing a stable startup; CrashLoopBackOff describes the restart backoff, not the root cause.';
        checks = ['Inspect the previous container logs and exit code.', 'Compare startup configuration with the last healthy revision.'];
        remediation = ['Correct the confirmed startup error, then verify that restart counts stabilize and readiness succeeds.'];
        const missing = logs.find(s => /missing.*(?:required|config)|(?:required|config).*missing/i.test(s.content));
        if (missing) {
          likelyCause = 'Startup logs indicate missing required configuration. This is a likely explanation for the repeated termination.';
          citations.add(missing.id);
          remediation = ['Verify the required configuration reference and supply the missing value through the approved configuration process.', 'Verify startup and readiness after the configuration is corrected.'];
        }
      } else if (/ReadinessProbeFailed/.test(reasons) || /Readiness probe failed/i.test(events?.content || '')) {
        summary = 'The workload has a readiness failure and cannot be treated as ready to serve traffic.';
        likelyCause = 'The readiness endpoint or a startup dependency is failing; the exact dependency is not established by readiness status alone.';
        if (/503/.test(`${text}\n${events?.content || ''}`)) {
          likelyCause = 'The captured evidence includes HTTP 503 responses, consistent with an endpoint reporting that it is not ready.';
          logs.filter(s => /503/.test(s.content)).forEach(s => citations.add(s.id));
        }
        if (events) citations.add(events.id);
        checks = ['Check the configured readiness path, port and response.', 'Inspect dependency health and recent application logs before changing probe settings.'];
        remediation = ['Restore the failing dependency or readiness handler after confirming the cause.', 'Keep readiness checks enabled and verify that the pod becomes ready.'];
      } else if (/ImagePullBackOff|ErrImagePull/.test(reasons)) {
        summary = 'The container image could not be pulled.';
        likelyCause = 'The image reference, registry access or registry connectivity may be incorrect.';
        checks = ['Review pull events and confirm the exact image reference exists.', 'Verify registry access without revealing credentials.'];
        remediation = ['Correct the confirmed image reference or registry access through the approved deployment process.'];
      } else if (pod.ready === true) {
        summary = 'The captured pod status reports ready.';
        likelyCause = 'No readiness failure is established in this snapshot; readiness alone does not verify every application function.';
        checks = ['Compare recent alerts and application request metrics with the readiness observation.'];
        remediation = ['Continue monitoring; do not change the workload solely on this observation.'];
      }
      if (!citations.size) citations.add(sections[0].id);
      return { provider: 'Local analysis', model: 'Evidence rules v1', generatedAt: new Date().toISOString(), readOnly: true,
        diagnosis: { summary, likelyCause, confidence: 'low', evidenceIds: [...citations], checks, remediation,
          caveats: ['Rule-based interpretation of the captured snapshot; this is not an LLM-generated diagnosis.', 'Evidence can be incomplete or stale. Confirm hypotheses before acting.'] } };
    },
  };
}
