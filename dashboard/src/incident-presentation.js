// Presentation-only correlation. Original alerts/evidence remain available.
export function workloadName(pod) {
  return String(pod || '').replace(/-[a-z0-9]{8,10}-[a-z0-9]{5}$/, '')
}
function alertKey(a) {
  if (a.pod) return workloadName(a.pod)
  try { return new URL(a.instance).hostname.split('.')[0] } catch { return a.instance || a.name }
}
export function groupAlerts(alerts = []) {
  const groups = new Map()
  for (const a of alerts) {
    const key = alertKey(a)
    if (!groups.has(key)) groups.set(key, { key, workload: key, alerts: [], state: 'pending', severity: 'warning', demo: false })
    const group = groups.get(key)
    group.alerts.push(a)
    if (a.state === 'firing') group.state = 'firing'
    if (a.severity === 'critical') group.severity = 'critical'
    group.demo ||= a.demo === true
  }
  return [...groups.values()]
}
export function recentGroups(state) {
  const groups = new Map()
  for (const p of state?.pods || []) {
    if (p.ready) continue
    const key = workloadName(p.name)
    const record = state.recent?.find(r => r.pod === p.name && r.source === 'Kubernetes')
    groups.set(key, { key, pod: p.name, title: p.reason || 'Workload not ready', source: 'Kubernetes', demo: p.demo, firstSeen: record?.firstSeen, detail: `${p.restarts} restarts · not ready`, signals: 1 })
  }
  for (const r of state?.recent || []) {
    if (r.state !== 'active' || r.source !== 'Prometheus') continue
    const key = r.pod ? workloadName(r.pod) : r.title === 'DeployForgeDemoHTTPProbeFailure' ? 'deployforge-readiness-demo' : r.id
    if (groups.has(key)) groups.get(key).signals++
    else groups.set(key, { key, pod: r.pod, title: 'Alert condition detected', detail: r.title, source: r.source, demo: r.demo, firstSeen: r.firstSeen, signals: 1 })
  }
  return [...groups.values()]
}
export const alertTitle = a => ({ DeployForgeDemoCrashLoop: 'Container repeatedly restarting', DeployForgeDemoReadinessFailure: 'Readiness checks failing', DeployForgeDemoHTTPProbeFailure: 'Endpoint returning errors' }[a.name] || a.name)
