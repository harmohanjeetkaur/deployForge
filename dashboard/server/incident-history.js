// Observed history is process-local, bounded, and never inferred from absent data.
export function createIncidentHistory({ now = Date.now } = {}) {
  const records = new Map();
  return {
    observe(pods, alerts) {
      const timestamp = new Date(now()).toISOString(), seen = new Set();
      const update = (id, fields) => { seen.add(id); const old = records.get(id); records.set(id, { ...old, ...fields, id, firstSeen: old?.firstSeen || timestamp, lastSeen: timestamp, state: 'active', resolvedAt: null }); };
      for (const p of pods) {
        const id = `pod:${p.uid || p.name}`;
        if (!p.ready) update(id, { title: p.reason || `Pod ${p.phase || 'not ready'}`, pod: p.name, demo: p.demo === true, source: 'Kubernetes', severity: 'warning', detail: `${p.restarts || 0} restarts · readiness not passing` });
        else if (records.has(id) && records.get(id).state !== 'resolved') { const old = records.get(id); records.set(id, { ...old, state: 'resolved', resolvedAt: timestamp, lastSeen: timestamp }); }
      }
      for (const a of alerts || []) update(`alert:${a.name}:${a.pod || a.instance || ''}`, { title: a.name, pod: a.pod || null, demo: a.demo === true, source: 'Prometheus', severity: a.severity, detail: `${a.state} · ${a.summary || 'Alert condition observed'}` });
      for (const [id, r] of records) {
        const sourceAvailable = r.source === 'Kubernetes' || Array.isArray(alerts);
        if (!seen.has(id) && r.state === 'active' && sourceAvailable) {
          const knownHealthy = id.startsWith('pod:') && pods.some(p => `pod:${p.uid || p.name}` === id && p.ready);
          records.set(id, { ...r, state: knownHealthy || r.source === 'Prometheus' ? 'resolved' : 'not-observed', resolvedAt: knownHealthy || r.source === 'Prometheus' ? timestamp : null });
        }
        if (now() - Date.parse(r.lastSeen) > 3600000) records.delete(id);
      }
      while (records.size > 50) records.delete(records.keys().next().value);
      return [...records.values()].sort((a,b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen)).slice(0, 12);
    }
  };
}
