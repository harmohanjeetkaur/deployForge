import { useEffect, useRef, useState } from 'react'

const steps = ['Tag creation', 'CI and security', 'Image publication', 'GitOps promotion', 'Rollout verification']
const stageIndex = stage => stage === 'tag-creation' ? 0 : stage === 'ci' ? 1 : stage === 'image-publication' ? 2 : ['gitops-promotion', 'helm-write', 'gitops-commit', 'git-push'].includes(stage) ? 3 : 4

export default function CreateRelease({ session, onAuthorizationError }) {
  const [repositories, setRepositories] = useState([])
  const [repository, setRepository] = useState('deployforge')
  const [sources, setSources] = useState([])
  const [ref, setRef] = useState('main')
  const [tag, setTag] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [history, setHistory] = useState([])
  const [error, setError] = useState(null)
  const [connectionError, setConnectionError] = useState(null)
  const [sourceError, setSourceError] = useState(null)
  const [lookup, setLookup] = useState(null)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const intent = useRef(null)
  const active = history.some(r => !['failed', 'succeeded'].includes(r.state))
  const selected = repositories.find(r => r.id === repository)

  useEffect(() => {
    const controller = new AbortController()
    async function refresh() {
      try {
        const options = { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) }
        const [config, releases] = await Promise.all([fetch('/api/repositories', options), fetch('/api/releases', options)])
        if (!config.ok || !releases.ok) throw new Error('Release API unavailable. Check the backend connection.')
        const c = await config.json(), h = await releases.json()
        if (!Array.isArray(c.repositories) || !Array.isArray(h.releases)) throw new Error('Invalid release API response')
        if (controller.signal.aborted) return
        setRepositories(c.repositories); setEnabled(c.executionEnabled === true); setHistory(h.releases); setConnectionError(null)
      } catch (e) { if (!controller.signal.aborted) { setEnabled(false); setConnectionError(e.message) } }
    }
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/repositories/${encodeURIComponent(repository)}/sources`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) })
      .then(async r => { if (!r.ok) throw new Error('Branch lookup unavailable. Configure server GitHub access; you can enter a branch or full SHA.'); return r.json() })
      .then(data => { if (!controller.signal.aborted) setSources(data.sources || []) })
      .catch(e => { if (!controller.signal.aborted) setSourceError(e.message) })
    return () => controller.abort()
  }, [repository])

  async function inspectSource() {
    setError(null); setLookup(null)
    try {
      const response = await fetch(`/api/repositories/${encodeURIComponent(repository)}/source?${new URLSearchParams({ ref })}`, { signal: AbortSignal.timeout(10000) })
      const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Source lookup failed')
      setLookup(data)
    } catch (e) { setError(e.message) }
  }
  async function post(path, body) {
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf || '' }, body: JSON.stringify(body) })
    const data = await response.json()
    if (response.status === 401 || response.status === 403) onAuthorizationError()
    if (!response.ok) throw new Error(data.message || 'Release request failed')
    setHistory(old => [data, ...old.filter(r => r.id !== data.id)])
  }
  async function create(e) {
    e.preventDefault()
    if (submitting.current) return
    setError(null)
    if (!enabled) { setError('Release and deployment execution are disabled on the backend.'); return }
    if (session.state !== 'authorized') { setError('Connect your local browser session in Settings before creating a release.'); return }
    if (active) { setError('A release is active. Wait for completion or reconcile its state.'); return }
    submitting.current = true; setBusy(true)
    const key = JSON.stringify([repository, ref, tag])
    if (intent.current?.key !== key) intent.current = { key, requestId: crypto.randomUUID() }
    try { await post('/api/releases', { repository, ref, tag, requestId: intent.current.requestId, environment: selected.environment, execution: 'real' }) }
    catch (e) { setError(`${e.message}. If the response was lost, inspect release history or retry the same inputs; the request ID is reused.`) }
    finally { submitting.current = false; setBusy(false) }
  }
  async function retry(r) {
    if (submitting.current) return
    submitting.current = true; setBusy(true); setError(null)
    try { await post(`/api/releases/${encodeURIComponent(r.id)}/retry`, {}) } catch (e) { setError(e.message) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <section className="section release-workspace">
    <div className="page-heading"><div><p className="eyebrow">SOURCE → IMAGE → KUBERNETES</p><h2>Create Release</h2><p>One request creates a Git tag, verifies CI and the published image, then automatically deploys through GitOps.</p></div></div>
    <form className="control-panel release-form" onSubmit={create}>
      <label>Registered repository<select value={repository} onChange={e => { setRepository(e.target.value); setLookup(null) }} disabled={busy}>{repositories.length ? repositories.map(r => <option key={r.id} value={r.id}>{r.name} · {r.owner}/{r.repo}</option>) : <option value="deployforge">DeployForge</option>}</select></label>
      <label>Branch or full commit SHA<input required maxLength={200} list="release-sources" value={ref} onChange={e => { setRef(e.target.value); setLookup(null) }} disabled={busy}/></label>
      <datalist id="release-sources">{sources.map(s => <option key={s.branch} value={s.branch}>{s.sha}</option>)}</datalist>
      <button type="button" className="btn btn-secondary" onClick={inspectSource} disabled={busy}>Look up source commit</button>
      {lookup && <p className="release-wrap">Resolved commit: <code>{lookup.sha}</code> · {lookup.message}</p>}
      {sourceError && <p className="state-warning">{sourceError}</p>}
      <label>New release tag<input required placeholder="v1.2.0" maxLength={100} value={tag} onChange={e => setTag(e.target.value)} disabled={busy}/></label>
      <p>Target: {selected?.environment || 'docker-desktop'} / {selected?.namespace || 'deployforge-gitops'}. Clicking below authorizes tag creation and automatic deployment after all checks pass.</p>
      {!enabled && <p className="state-warning">Release execution disabled. No tag, workflow or deployment will be created.</p>}
      {session.state !== 'authorized' && <p>Connect a local session in Settings to authorize release creation.</p>}
      <button className="btn btn-primary" type="submit" disabled={busy || active || !enabled}>{busy ? 'Submitting…' : 'Create Tag & Deploy'}</button>
      {(error || connectionError) && <p role="alert" className="state-warning">{error || connectionError}</p>}
    </form>
    <h3>Release history</h3>
    {!history.length && <p>No releases recorded. Live CI/CD has not been verified.</p>}
    <div className="release-history">{history.map(r => <article className="control-panel" key={r.id}>
      <div className="panel-heading"><h3>{r.tag} · {r.repository}</h3><span className={`health-badge ${r.state === 'succeeded' ? 'good' : 'neutral'}`}>{r.state}</span></div>
      <ol className="release-steps" aria-label={`Progress for ${r.tag}`}>{steps.map((step, i) => <li key={step} aria-current={stageIndex(r.stage === 'failed' ? r.promotion?.failureStage || 'gitops-promotion' : r.stage) === i ? 'step' : undefined} className={r.state === 'succeeded' || i < stageIndex(r.stage === 'failed' ? r.promotion?.failureStage || 'gitops-promotion' : r.stage) ? 'complete' : ''}>{step}</li>)}</ol>
      <p role="status">{r.message}</p>
      {r.promotion?.state === 'failed' && <p className="state-warning">GitOps: {r.promotion.message || 'Promotion failed; inspect Git and cluster state.'}</p>}
      <dl className="stacked-facts release-wrap">
        <div><dt>Source commit</dt><dd><code>{r.sha}</code></dd></div>
        <div><dt>Image digest</dt><dd><code>{r.digest || 'Not verified'}</code></dd></div>
        <div><dt>GitHub Actions</dt><dd>{r.run ? <a href={r.run.url} target="_blank" rel="noreferrer">Run {r.run.id} · attempt {r.run.attempt} · {r.run.conclusion || r.run.status}</a> : 'Waiting for tag workflow'}</dd></div>
        <div><dt>GitOps commit</dt><dd><code>{r.promotion?.commit || 'Not created'}</code></dd></div>
        <div><dt>ArgoCD</dt><dd>{r.observation ? `${r.observation.argoSynced ? 'Synced at promoted commit' : 'Not synced'} · ${r.observation.argoHealth || 'Unknown'}` : 'Not observed'}</dd></div>
        <div><dt>Kubernetes health</dt><dd>{r.observation ? `${r.observation.readyReplicas ?? '—'}/${r.observation.desiredReplicas ?? '—'} ready · ${r.observation.healthy ? 'Healthy' : 'Not verified healthy'}` : 'Not observed'}</dd></div>
        <div><dt>Version observed at completion</dt><dd>{r.state === 'succeeded' ? `${r.tag} (${r.sha})` : 'Not confirmed'}</dd></div>
        <div><dt>Created</dt><dd>{new Date(r.createdAt).toLocaleString()}</dd></div>
      </dl>
      {['failed', 'needs-review'].includes(r.state) && <><p>Retry checks the same tag and actual workflow again. It never recreates a tag, reruns CI, or repeats an uncertain Git write. Fix CI and rerun it in GitHub when appropriate; use a new version for changed source.</p><button className="btn btn-secondary" disabled={busy || !enabled || session.state !== 'authorized'} onClick={() => retry(r)}>Retry reconciliation</button></>}
    </article>)}</div>
  </section>
}
