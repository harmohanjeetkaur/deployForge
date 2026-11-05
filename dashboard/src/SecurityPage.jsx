import { useEffect, useRef, useState } from 'react'

export default function SecurityPage() {
  const [releases, setReleases] = useState([]), [selected, setSelected] = useState('')
  const [data, setData] = useState(null), [error, setError] = useState(null), [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const request = useRef(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/releases', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
      .then(async r => { if (!r.ok) throw Error(); const body = await r.json(); if (!Array.isArray(body.releases)) throw Error(); return body.releases })
      .then(items => { if (!controller.signal.aborted) { setReleases(items); setSelected(old => items.some(r => r.id === old) ? old : items[0]?.id || ''); if (!items.length) setLoading(false) } })
      .catch(() => { if (!controller.signal.aborted) { setError('Release history unavailable. Check the backend connection and refresh.'); setLoading(false) } })
    return () => controller.abort()
  }, [refresh])
  useEffect(() => {
    if (!selected) return
    const id = ++request.current, controller = new AbortController()
    Promise.resolve().then(async () => {
      if (controller.signal.aborted) return
      setLoading(true); setError(null); setData(null)
      try {
        const r = await fetch(`/api/security/releases/${encodeURIComponent(selected)}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) })
        if (!r.ok) throw Error(r.status === 409 ? 'Waiting for the release workflow and scan reports.' : 'Security reports unavailable. Check server GitHub Actions read permission, artifact retention, and that the backend has loaded the security API.')
        const body = await r.json()
        if (!Array.isArray(body.platforms) || !['passed', 'failed', 'unknown'].includes(body.policy)) throw Error('Invalid security response')
        if (id === request.current && !controller.signal.aborted) setData(body)
      } catch (e) { if (id === request.current && !controller.signal.aborted) setError(e.message) }
      finally { if (id === request.current && !controller.signal.aborted) setLoading(false) }
    })
    return () => controller.abort()
  }, [selected, refresh])
  const available = data?.platforms.filter(p => p.status === 'available') || []
  const complete = data && available.length === 2
  const count = severity => complete ? available.reduce((sum, p) => sum + (p.counts?.[severity] || 0), 0) : '—'
  const tone = data?.policy === 'passed' ? 'pass' : data?.policy === 'failed' ? 'fail' : 'unknown'
  return <section className="section security-workspace">
    <div className="page-heading"><div><p className="eyebrow">SOFTWARE SUPPLY CHAIN</p><h2>Security</h2><p className="security-subtitle">Release security, backed by CI evidence.</p></div><button className="btn btn-secondary" onClick={() => setRefresh(v => v + 1)}>↻ Refresh scans</button></div>
    <div className="security-toolbar control-panel">
      <div className="security-selector"><label htmlFor="security-release">Release to inspect</label>
      <select id="security-release" className="version-select" value={selected} onChange={e => { setData(null); setError(null); setLoading(Boolean(e.target.value)); setSelected(e.target.value) }}><option value="">Select a release</option>{releases.map(r => <option key={r.id} value={r.id}>{r.tag} · {r.repository} · {r.sha?.slice(0, 12)}</option>)}</select></div>
      <div className="security-scanner"><span className="security-scanner-dot" aria-hidden="true"/><div><strong>Trivy</strong><span>Container vulnerability scanner</span></div></div>
    </div>
    {loading && <div className="control-panel security-state" role="status">Loading security evidence…</div>}
    {error && <div role="alert" className="control-panel security-state state-warning">{error}</div>}
    {!loading && !error && !releases.length && <div className="control-panel security-state">No release scan reports yet. Create a release to generate CI evidence.</div>}
    {data && <>
      <section className={`security-summary security-${tone}`} aria-label="Release security summary">
        <span className="security-result-icon" aria-hidden="true">{tone === 'pass' ? '✓' : tone === 'fail' ? '!' : '?'}</span>
        <div className="security-summary-copy"><p className="security-overline">CI SCAN RESULTS · {data.tag}</p><h3>{tone === 'pass' ? 'Release meets security policy' : tone === 'fail' ? 'Security findings need attention' : 'More evidence is needed'}</h3><p>{tone === 'pass' ? 'Both architecture scans passed the HIGH / CRITICAL gate.' : tone === 'fail' ? 'Review the reported vulnerabilities and available fixes below.' : 'Both architecture reports are required to confirm policy compliance.'}</p></div>
        <span className={`health-badge ${tone === 'pass' ? 'good' : tone === 'fail' ? 'attention' : 'neutral'}`}>{tone === 'pass' ? 'Policy passed' : tone === 'fail' ? 'Policy failed' : 'Evidence incomplete'}</span>
      </section>
      <div className="security-metrics" aria-label="Scan summary">
        <article><span className="severity-dot critical" aria-hidden="true"/><p>Critical findings</p><strong>{count('CRITICAL')}</strong><small>Across both platform reports</small></article>
        <article><span className="severity-dot high" aria-hidden="true"/><p>High findings</p><strong>{count('HIGH')}</strong><small>Across both platform reports</small></article>
        <article><span className="severity-dot coverage" aria-hidden="true"/><p>Reports available</p><strong>{available.length}<span> / 2</span></strong><small>AMD64 and ARM64</small></article>
      </div>
      <div className="security-section-heading"><div><h3>Architecture reports</h3><p>Independent scan evidence for each container image.</p></div><a className="security-run-link" href={`https://github.com/harmohanjeetkaur/deployForge/actions/runs/${Number(data.run.id)}/attempts/${Number(data.run.attempt)}`} target="_blank" rel="noopener noreferrer">Open scan run {data.run.id} · attempt {data.run.attempt} ↗</a></div>
      <div className="security-platforms">{data.platforms.map(p => <article className="security-platform control-panel release-wrap" key={p.arch}>
        <div className="security-platform-heading"><div className="security-platform-name"><span className="security-arch-icon" aria-hidden="true">▦</span><div><h3>linux/{p.arch}</h3><p>Container image scan</p></div></div><span className={`health-badge ${p.status === 'available' && p.policy === 'passed' ? 'good' : p.policy === 'failed' ? 'attention' : 'neutral'}`}>{p.status !== 'available' ? 'Unavailable' : p.policy === 'passed' ? 'Policy passed' : p.policy === 'failed' ? 'Policy failed' : 'Policy unknown'}</span></div>
        {p.status !== 'available' ? <p className="security-platform-empty state-warning">Report missing or expired. Policy unknown.</p> : <>
          <div className="security-severities">{['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'].map(severity => <div key={severity}><span className={`severity-dot ${severity.toLowerCase()}`} aria-hidden="true"/><span>{severity === 'UNKNOWN' ? 'Other' : severity[0] + severity.slice(1).toLowerCase()}</span><strong>{p.counts[severity]}</strong></div>)}</div>
          <div className={`security-findings-note ${p.total ? 'has-findings' : ''}`}><span aria-hidden="true">{p.total ? '!' : '✓'}</span><div><strong>{p.total ? `${p.total} reported findings` : 'No findings at configured severities'}</strong><p>{p.total ? 'See vulnerability details and available fixes below.' : 'HIGH / CRITICAL scan completed without reported findings.'}</p></div></div>
          <div className="security-scan-time"><span>Scan completed</span><time dateTime={p.scannedAt || undefined}>{p.scannedAt ? new Date(p.scannedAt).toLocaleString() : 'Unavailable in report'}</time></div>
          {p.findings.length > 0 && <div className="security-table-wrap"><table className="security-table"><thead><tr><th>Vulnerability</th><th>Severity</th><th>Package</th><th>Installed</th><th>Fixed in</th></tr></thead><tbody>{p.findings.map((v, i) => <tr key={i}><td>{/^CVE-\d{4}-\d+$/.test(v.id) ? <a href={`https://nvd.nist.gov/vuln/detail/${v.id}`} target="_blank" rel="noopener noreferrer">{v.id} ↗</a> : v.id}<small>{v.title}</small></td><td><span className={`security-severity-label ${v.severity.toLowerCase()}`}>{v.severity}</span></td><td>{v.package}<small>{v.target}</small></td><td>{v.installed}</td><td>{v.fixed || 'No fix listed'}</td></tr>)}</tbody></table></div>}
          {p.truncated && <p>Showing the first 500 findings. Download the full report from the GitHub Actions run.</p>}
          <details className="security-identity"><summary>Scanned image identity</summary><p><code>{p.image}</code></p><p>Platform image ID: <code>{p.imageId || 'Unavailable'}</code></p></details>
        </>}
      </article>)}</div>
      <details className="security-evidence control-panel"><summary><span>Release provenance</span><small>Source commit & verified image digest</small></summary><dl className="stacked-facts release-wrap"><div><dt>Source commit</dt><dd><code>{data.sha}</code></dd></div><div><dt>Verified release index digest</dt><dd><code>{data.digest || 'Not verified / not published'}</code></dd></div></dl></details>
      <div className="security-policy-note"><span aria-hidden="true">ⓘ</span><p><strong>Policy scope</strong> · HIGH and CRITICAL findings block the release, including unfixed vulnerabilities. Counts reflect retained CI reports and may repeat a vulnerability across architectures. A passed policy is not a complete inventory of all vulnerabilities; missing evidence remains unknown.</p></div>
    </>}
  </section>
}
