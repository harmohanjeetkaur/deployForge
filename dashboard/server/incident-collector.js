// This module has no mutation/exec capability: every command is a fixed get/logs.
export const INCIDENT_NAMESPACE = 'deployforge-gitops';
const name = value => typeof value === 'string' && value.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value);
export function redact(value) {
  return String(value ?? '').replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]{20,})\b/g, '[REDACTED TOKEN]')
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/(["']?(?:password|passwd|token|api[_-]?key|secret|authorization)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[REDACTED]@')
    .slice(0, 12000);
}
const allowed = pod => pod.metadata?.namespace === INCIDENT_NAMESPACE && (pod.metadata?.labels?.app === 'deployforge' || (pod.metadata?.labels?.['app.kubernetes.io/name'] === 'deployforge' && pod.metadata?.labels?.['app.kubernetes.io/instance'] === 'deployforge') || pod.metadata?.labels?.['app.kubernetes.io/part-of'] === 'deployforge-incident-demo');
export function podView(pod) {
  const statuses = pod.status?.containerStatuses || [];
  return { name: pod.metadata.name, namespace: INCIDENT_NAMESPACE, uid: pod.metadata.uid,
    demo: pod.metadata?.labels?.['app.kubernetes.io/part-of'] === 'deployforge-incident-demo',
    phase: pod.status?.phase || 'Unknown', ready: statuses.length > 0 && statuses.every(s => s.ready),
    restarts: statuses.reduce((n, s) => n + (s.restartCount || 0), 0),
    reason: statuses.map(s => s.state?.waiting?.reason || s.state?.terminated?.reason).filter(Boolean).join(', ') || pod.status?.reason || (pod.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'False') && statuses.some(s => s.state?.running) ? 'ReadinessProbeFailed' : null) };
}
export function createIncidentCollector({ kubectl, monitoring = async () => ({}) }) {
  async function pods() {
    const result = await kubectl(['get', 'pods', '-n', INCIDENT_NAMESPACE, '-o', 'json']);
    return JSON.parse(result).items.filter(allowed).slice(0, 40);
  }
  return {
    async list() { return (await pods()).map(podView); },
    async collect(podName) {
      if (!name(podName)) throw Object.assign(Error('Invalid pod name'), { statusCode: 400 });
      const pod = (await pods()).find(p => p.metadata.name === podName);
      if (!pod) throw Object.assign(Error('Pod is not in the approved application or demo scope'), { statusCode: 404 });
      const sections = [{ id: 'pod', title: 'Pod status', content: JSON.stringify({ ...podView(pod), containers: (pod.status?.containerStatuses || []).map(s => ({ name: s.name, image: s.image, ready: s.ready, restartCount: s.restartCount, state: s.state, lastState: s.lastState })) }) }];
      async function section(id, title, fn) { try { sections.push({ id, title, content: redact(await fn()), available: true }); } catch { sections.push({ id, title, content: 'Evidence unavailable; no value inferred.', available: false }); } }
      await section('events', 'Recent pod events', async () => {
        const data = JSON.parse(await kubectl(['get', 'events', '-n', INCIDENT_NAMESPACE, '--field-selector', `involvedObject.uid=${pod.metadata.uid}`, '-o', 'json']));
        return JSON.stringify(data.items.slice(-20).map(e => ({ reason: e.reason, type: e.type, message: e.message, count: e.count, time: e.lastTimestamp || e.eventTime })));
      });
      for (const container of (pod.spec?.containers || []).slice(0, 3)) {
        if (!name(container.name)) continue;
        await section(`logs-${container.name}`, `Current logs: ${container.name}`, () => kubectl(['logs', podName, '-n', INCIDENT_NAMESPACE, '-c', container.name, '--tail=60', '--limit-bytes=8000', '--timestamps=true']));
        if (pod.status?.containerStatuses?.some(s => s.name === container.name && s.restartCount > 0)) await section(`previous-${container.name}`, `Previous logs: ${container.name}`, () => kubectl(['logs', podName, '-n', INCIDENT_NAMESPACE, '-c', container.name, '--previous=true', '--tail=60', '--limit-bytes=8000', '--timestamps=true']));
      }
      await section('workload', 'Main application rollout', async () => {
        const d = JSON.parse(await kubectl(['get', 'deployment', 'deployforge', '-n', INCIDENT_NAMESPACE, '-o', 'json']));
        return JSON.stringify({ desired: d.spec?.replicas, ready: d.status?.readyReplicas, updated: d.status?.updatedReplicas, image: d.spec?.template?.spec?.containers?.[0]?.image, conditions: d.status?.conditions });
      });
      await section('argocd', 'ArgoCD application', async () => {
        const a = JSON.parse(await kubectl(['get', 'application', 'deployforge', '-n', 'argocd', '-o', 'json']));
        return JSON.stringify({ sync: a.status?.sync, health: a.status?.health });
      });
      await section('monitoring', 'Prometheus signals', async () => {
        const m = await monitoring(); return JSON.stringify({ summary: m.summary, demoProbes: m.demoProbes, alerts: m.alerts?.slice(0, 10), checkedAt: m.checkedAt });
      });
      return { pod: podView(pod), collectedAt: new Date().toISOString(), sections: sections.map(s => ({ ...s, content: redact(s.content) })), commands: [
        `kubectl --context docker-desktop get pod ${podName} -n ${INCIDENT_NAMESPACE}`,
        `kubectl --context docker-desktop describe pod ${podName} -n ${INCIDENT_NAMESPACE}`,
        `kubectl --context docker-desktop logs ${podName} -n ${INCIDENT_NAMESPACE} --tail=60`,
      ] };
    }
  };
}
