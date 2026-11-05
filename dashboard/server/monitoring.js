// Fixed loopback endpoints only. No arbitrary proxy destinations or credentials.
export async function monitoringStatus(fetcher = fetch) {
  const checks = [
    ['Prometheus', 'http://127.0.0.1:9090', '/api/v1/targets'],
    ['Grafana', 'http://127.0.0.1:3000', '/api/health'],
    ['Alertmanager', 'http://127.0.0.1:9093', '/-/ready'],
  ];
  let targetList = null;
  const services = await Promise.all(checks.map(async ([name, url, path]) => {
    try {
      const response = await fetcher(url + path, { signal: AbortSignal.timeout(2500), redirect: 'error' });
      if (!response.ok) throw new Error('unavailable');
      let message = 'Local monitoring endpoint reachable.';
      if (name === 'Prometheus') {
        const data = await response.json();
        const targets = data.data?.activeTargets;
        if (data.status !== 'success' || !Array.isArray(targets)) throw new Error('invalid response');
        targetList = targets.map(t => ({ job: t.labels?.job || 'Unknown', instance: t.labels?.instance || 'Unknown', health: t.health, lastScrape: t.lastScrape || null, duration: Number.isFinite(t.lastScrapeDuration) ? t.lastScrapeDuration : null }));
        const up = targets.filter(target => target.health === 'up').length;
        message = `${up}/${targets.length} scrape targets UP. Application HTTP and operation metrics await instrumentation.`;
        return { name, url, status: targets.length && up === targets.length ? 'up' : 'down', message };
      }
      return { name, url, status: 'up', message };
    } catch {
      return { name, url, status: 'down', message: 'Unavailable locally. Start the monitoring loopback port-forward and refresh.' };
    }
  }));
  const end = Math.floor(Date.now() / 1000);
  async function query(expression, range = false) {
    try {
      const params = new URLSearchParams({ query: expression });
      if (range) { params.set('start', String(end - 1800)); params.set('end', String(end)); params.set('step', '60'); }
      const r = await fetcher(`http://127.0.0.1:9090/api/v1/${range ? 'query_range' : 'query'}?${params}`, { signal: AbortSignal.timeout(2500), redirect: 'error' });
      if (!r.ok) return null;
      const json = await r.json();
      return json.status === 'success' && Array.isArray(json.data?.result) ? json.data.result : null;
    } catch { return null; }
  }
  const [ready, desired, probes, argo, availability, latency, alerts, demoProbe, demoHTTP] = await Promise.all([
    query('kube_deployment_status_replicas_available{namespace="deployforge-gitops",deployment="deployforge"}'),
    query('kube_deployment_spec_replicas{namespace="deployforge-gitops",deployment="deployforge"}'),
    query('min(probe_success{job="application-probes"})'),
    query('argocd_app_info{name="deployforge"}'),
    query('min(probe_success{job="application-probes"}) * 100', true),
    query('max(probe_duration_seconds{job="application-probes"}) * 1000', true),
    (async () => { try { const r = await fetcher('http://127.0.0.1:9090/api/v1/alerts', { signal: AbortSignal.timeout(2500), redirect: 'error' }); const j = await r.json(); return r.ok && j.status === 'success' && Array.isArray(j.data?.alerts) ? j.data.alerts.map(a => ({ name: a.labels?.alertname || 'Alert', severity: a.labels?.severity || 'unknown', state: a.state, since: a.activeAt, demo: a.labels?.demo === 'true', pod: a.labels?.pod || null, instance: a.labels?.instance || null, summary: String(a.annotations?.summary || '').slice(0, 300) })) : null; } catch { return null; } })(),
    query('probe_success{job="demo-incident-probes"}'),
    query('probe_http_status_code{job="demo-incident-probes"}'),
  ]);
  const number = series => { const raw = series?.[0]?.value?.[1]; return raw !== undefined && Number.isFinite(Number(raw)) ? Number(raw) : null; };
  const points = series => (series?.[0]?.values || []).filter(p => Array.isArray(p) && p.length === 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))).map(([time, value]) => [Number(time), Number(value)]);
  const demoProbes = demoProbe === null ? null : demoProbe.map(s => ({ instance: s.metric?.instance || 'Demo endpoint', success: number([s]), httpStatus: number((demoHTTP || []).filter(h => h.metric?.instance === s.metric?.instance)), demo: true }));
  return { services, demoProbes, checkedAt: new Date().toISOString(), targets: targetList, summary: { ready: number(ready), desired: number(desired), probeSuccess: number(probes), argoSync: argo?.[0]?.metric?.sync_status || null, argoHealth: argo?.[0]?.metric?.health_status || null }, trends: { availability: points(availability), latency: points(latency) }, alerts };

}
