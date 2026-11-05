import { recentGroups, workloadName } from './incident-presentation.js'
import { useEffect, useState } from 'react'
export function IncidentSummary({ onNavigate, compact = false }) {
  const [state, setState] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => fetch('/api/incidents', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }).then(async r => { if (!r.ok) throw Error(); return r.json() }).then(d => { if (!Array.isArray(d.pods)) throw Error('Invalid incident inventory'); if (!controller.signal.aborted) setState(d) }).catch(() => { if (!controller.signal.aborted) setState(null) })
    refresh(); const timer = setInterval(refresh, 30000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [])
  const groups = recentGroups(state)
  const unavailable = !state
  return <><section className="control-panel incident-monitor"><div className="incident-monitor-title"><span className={`incident-status-icon ${groups.length ? 'attention' : ''}`} aria-hidden="true">{groups.length ? '!' : '✓'}</span><div><h3>{unavailable ? 'Workload status unavailable' : groups.length ? `${groups.length} workloads need attention` : 'No open workload incidents'}</h3><p>{unavailable ? 'Check the incident API connection.' : 'Correlated from Kubernetes readiness and alert signals.'}</p></div></div><button className="btn btn-secondary" onClick={() => onNavigate('incidents')}>Investigate →</button></section>
    {!compact && <section className="control-panel recent-incidents"><div className="panel-heading"><div><h3>Recently detected</h3><p>Related signals grouped by workload</p></div><span className="health-badge neutral">{unavailable ? '—' : groups.length} open</span></div>
      {groups.length ? <ul>{groups.slice(0, 3).map(r => <li key={r.key}><div><span className="health-badge attention">Needs attention</span><strong>{r.title}</strong><p>{r.key} · {r.detail}</p><small>{r.firstSeen ? `First detected ${new Date(r.firstSeen).toLocaleString()}` : 'Detected in current observation'} · {r.signals} related signals</small></div><button className="text-button" onClick={() => onNavigate('incidents', r.pod || undefined)}>Troubleshoot →</button></li>)}</ul> : <p className="muted-copy">{unavailable ? 'Recent detection history unavailable.' : 'No active incidents in the latest observations.'}</p>}
      {state?.recent?.length > 0 && <details className="incident-history-details"><summary>Detection history · {state.recent.length} observations</summary>{state.recent.map(r => <div key={r.id}><strong>{r.title}</strong><small>{r.state} · {r.source} · {new Date(r.lastSeen).toLocaleString()}{r.demo ? ' · Origin: controlled fault injection' : ''}</small><p>{r.detail}</p></div>)}<p>{state.historyScope}</p></details>}
    </section>}</>
}
export default function IncidentsPage({ session, onAuthorizationError, initialPod }) {
  const [state, setState] = useState(null), [error, setError] = useState(null), [pod, setPod] = useState(initialPod || '')
  const [podFilter, setPodFilter] = useState('attention')
  const [evidence, setEvidence] = useState(null), [result, setResult] = useState(null), [busy, setBusy] = useState(false), [consent, setConsent] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => fetch('/api/incidents', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }).then(async r => { if (!r.ok) throw Error(); const d = await r.json(); if (!Array.isArray(d.pods)) throw Error(); return d }).then(d => { if (!controller.signal.aborted) { setState(d); setPod(old => old || d.pods.find(p => !p.ready)?.name || d.pods[0]?.name || '') } }).catch(() => { if (!controller.signal.aborted) setError('Kubernetes incident data unavailable. Check the backend and context.') })
    refresh(); const timer = setInterval(refresh, 15000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [])
  async function post(path, body) {
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/incidents/${path}`, { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(60000), headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf || '' }, body: JSON.stringify(body) })
      const data = await r.json()
      if (r.status === 401 || r.status === 403) onAuthorizationError()
      if (!r.ok) throw Error(data.message || 'Incident request failed')
      return data
    } catch (e) { setError(e.message); return null } finally { setBusy(false) }
  }
  const localAnalysis = state?.ai?.provider === 'Local analysis'
  const selected = state?.pods?.find(p => p.name === pod), failed = state?.pods?.filter(p => !p.ready).length
  const visiblePods = state?.pods?.filter(p => podFilter === 'all' || !p.ready || p.name === pod) || []
  return <section className="section incidents-workspace">
    <div className="page-heading"><div><p className="eyebrow">INCIDENT RESPONSE</p><h2>AI Troubleshooting</h2><p className="page-description">Find the cause. Review the evidence. Decide the next step.</p></div><span className="health-badge neutral">Read-only assistant</span></div>
    <div className="incident-overview-bar"><div><span className="incident-dot good"/><strong>{state ? state.pods.length - failed : '—'}</strong><span>healthy pods</span></div><div><span className="incident-dot attention"/><strong>{failed ?? '—'}</strong><span>need attention</span></div><div className="incident-provider"><span className={`incident-dot ${state?.ai?.enabled ? 'good' : ''}`}/><span>{state?.ai?.provider || 'Analysis provider'}</span><strong>{state?.ai?.enabled ? 'Connected' : 'Setup required'}</strong></div></div>
    <div className="incident-workspace-grid"><aside className="control-panel incident-scope"><div className="panel-heading"><div><h3>Workloads</h3><p>{state?.namespace || 'Connecting…'}</p></div></div>
      <div className="incident-filters" aria-label="Filter workloads"><button aria-pressed={podFilter === 'attention'} onClick={() => setPodFilter('attention')}>Needs attention ({failed ?? '—'})</button><button aria-pressed={podFilter === 'all'} onClick={() => setPodFilter('all')}>All ({state?.pods?.length ?? '—'})</button></div>
      <div className="incident-pods">{visiblePods.map(p => <button key={p.uid || p.name} className={`incident-pod ${p.name === pod ? 'selected' : ''}`} aria-pressed={p.name === pod} disabled={busy} onClick={() => { setPod(p.name); setEvidence(null); setResult(null); setConsent(false) }}><span className="incident-pod-top"><strong>{workloadName(p.name)}</strong><span className={`incident-dot ${p.ready ? 'good' : 'attention'}`}/></span><span className={`health-badge ${p.ready ? 'good' : 'attention'}`}>{p.ready ? 'Ready' : p.reason || p.phase}</span><small>{p.restarts} restarts · {p.ready ? 'Ready' : 'Not ready'}</small></button>)}</div>{state && !visiblePods.length && <p className="muted-copy">No workloads match this filter.</p>}
      <p className="incident-scope-note">Select a workload to inspect its current evidence.</p>
    </aside><div className="incident-investigation">
    <section className="control-panel incident-evidence"><div className="panel-heading"><div><p className="incident-step-label">01 / EVIDENCE</p><h3>{selected ? workloadName(selected.name) : 'Select a workload'}</h3><p className="incident-pod-id">{selected?.name || 'Choose a pod from the workload list.'}</p></div><button className="btn btn-secondary" disabled={!selected || busy || session.state !== 'authorized'} onClick={async () => { setEvidence(null); setResult(null); setConsent(false); const e = await post('evidence', { pod, namespace: state.namespace }); if (e) setEvidence(e) }}>{busy ? 'Working…' : evidence ? 'Refresh evidence' : 'Collect pod evidence'}</button></div>
      {selected && <div className="incident-selected-status"><span className={`health-badge ${selected.ready ? 'good' : 'attention'}`}>{selected.ready ? 'Ready' : selected.reason || selected.phase}</span><span>{selected.restarts} restarts</span><details><summary>Workload metadata</summary><p>Namespace: {selected.namespace || state?.namespace}</p><p>Pod phase: {selected.phase || 'Unknown'}</p><p>Origin: {selected.demo ? 'Controlled fault injection' : 'Application workload'}</p></details></div>}
      {session.state !== 'authorized' && <p className="state-warning">Connect a local session in Settings to collect logs or request AI analysis.</p>}
      {!evidence && <div className="incident-evidence-empty"><span aria-hidden="true">⌕</span><h4>Start with the evidence</h4><p>Collect pod status, events, logs and monitoring signals. Review the snapshot before requesting a diagnosis.</p></div>}
      {evidence && <><div className="incident-snapshot"><span>{evidence.sections.filter(s => s.available !== false).length}/{evidence.sections.length} sources available</span><span>Captured {new Date(evidence.collectedAt).toLocaleTimeString()}</span></div><div className="incident-sections">{evidence.sections.map(s => <details key={`${evidence.id}-${s.id}`} id={`evidence-${s.id}`}><summary><span>{s.title}</span><span className={`incident-source-state ${s.available === false ? 'missing' : ''}`}>{s.available === false ? 'Unavailable' : s.id.startsWith('logs-') || s.id.startsWith('previous-') ? `${s.content.split('\n').length} lines` : 'Collected'}</span></summary><pre>{s.content}</pre></details>)}</div></>}
    </section>
    <section className="control-panel incident-consent"><p className="incident-step-label">02 / ANALYSIS</p><div className="panel-heading"><h3>{localAnalysis ? 'Diagnose workload' : 'Diagnose with OpenAI'}</h3><span className="health-badge neutral">{state?.ai?.model || 'Model unavailable'}</span></div><p>Get a likely cause, supporting evidence and recommended next checks. Suggestions are never executed automatically.</p>
      {!state?.ai?.enabled && <div className="incident-setup-note"><strong>Connect an AI provider to continue</strong><p>Evidence collection works independently. An operator must configure the OpenAI connection on the server.</p><details><summary>Connection requirements</summary><p>Set OPENAI_API_KEY and DEPLOYFORGE_ENABLE_AI=true on the backend, then restart it. Never enter the key in the browser.</p></details></div>}
      {evidence ? <><label><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />{localAnalysis ? 'I reviewed this snapshot and approve local analysis.' : 'I reviewed this snapshot and approve sending it to OpenAI. API usage may incur charges.'}</label><button className="btn btn-primary" disabled={!consent || busy || !state?.ai?.enabled} onClick={async () => { setResult(null); const r = await post('analyze', { evidenceId: evidence.id, consent: true }); if (r) setResult(r) }}>{busy ? 'Analyzing…' : localAnalysis ? 'Analyze workload' : 'Analyze with OpenAI'}</button><details className="incident-privacy"><summary>{localAnalysis ? 'Analysis source' : 'What is shared?'}</summary><p>{localAnalysis ? 'Local evidence rules interpret this snapshot within the backend. No external provider receives it.' : 'Only this captured snapshot is sent.'} Known credential patterns are redacted; logs can still contain sensitive data. Expand and review the evidence first. Do not send private data. Secret resources, environment values and ConfigMap contents are excluded.</p></details></> : <p className="incident-waiting">Collect evidence to enable analysis.</p>}
    </section>
    {error && <p className="control-panel state-warning" role="alert">{error}</p>}
    {result && <section className="control-panel incident-diagnosis"><div className="panel-heading"><h3>{result.provider === 'Local analysis' ? 'Workload diagnosis' : 'AI diagnosis'}</h3><span className="health-badge neutral">{result.diagnosis.confidence} confidence</span></div><p>{result.diagnosis.summary}</p><h4>Likely cause — hypothesis</h4><p>{result.diagnosis.likelyCause}</p><div className="incident-citations">{result.diagnosis.evidenceIds.map(id => <a key={id} href={`#evidence-${id}`}>Evidence: {id} ↑</a>)}</div>{[['Suggested checks', 'checks'], ['Proposed remediation — review before acting', 'remediation'], ['Uncertainty and limits', 'caveats']].map(([title, field]) => <div key={field}><h4>{title}</h4><ul>{result.diagnosis[field].map((text, i) => <li key={i}>{text}</li>)}</ul></div>)}<p className="muted-copy">{result.provider} · {result.model} · {new Date(result.generatedAt).toLocaleString()} · Suggestions only; nothing was executed.</p></section>}
    </div></div>
  </section>
}
