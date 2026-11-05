import { executionState } from './execution-state.js'

const shortImage = image => image?.split(':').at(-1) || 'Unavailable'
const value = data => data ?? 'Unavailable'
const healthyPods = pods => pods.filter(p => p.status === 'Running' && /^([1-9][0-9]*)\/\1$/.test(p.ready || ''))
export function Badge({ children, good, warning = false }) {
  return <span className={`health-badge ${good ? 'good' : warning ? 'attention' : 'neutral'}`}>{children}</span>
}
export function PageHeading({ eyebrow, title, children, action }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{children && <p className="page-description">{children}</p>}</div>{action}</div>
}
export function DataState({ loading, error, children, onRetry }) {
  return loading ? <div className="data-state" role="status">Loading live state…</div> : error ? <div className="data-state state-error" role="alert"><strong>Live data unavailable</strong><p>{error}. Previously loaded values may be stale.</p>{onRetry && <button className="btn btn-secondary" onClick={onRetry}>Retry connection</button>}</div> : children
}
function Metric({ label, children, detail, good }) {
  return <article className="metric-card"><h3>{label}</h3><p className={`metric-value ${good ? 'text-good' : ''}`}>{children}</p><p className="metric-detail">{detail}</p></article>
}
export function PodCards({ data }) {
  const pods = data?.pods || []
  return <div className="pod-grid">{pods.length ? pods.map(pod => {
    const ready = healthyPods([pod]).length === 1
    return <article className="pod-card" key={pod.name}><div className="panel-heading"><span className={`status-dot ${ready ? 'good' : 'attention'}`} /><Badge good={ready} warning={!ready}>{pod.status || 'Unknown'} · {pod.ready || 'Unknown'}</Badge></div><h3>{pod.name}</h3><dl className="inline-facts"><div><dt>Restarts</dt><dd>{value(pod.restarts)}</dd></div><div><dt>Node</dt><dd>{value(pod.node)}</dd></div></dl><p className="pod-diagnostic">{pod.reason || (ready ? 'Container readiness checks are passing.' : 'Check container state, events, and readiness probes.')}</p>{pod.message && <p className="pod-diagnostic">{pod.message}</p>}</article>
  }) : <div className="data-state">No pods reported for this deployment.</div>}</div>
}
export function Overview({ data, loading, error, history, lastOperation, config, configError, onRefresh, onNavigate }) {
  const argo = data?.argo
  const ready = data?.desiredReplicas > 0 && data?.readyReplicas === data?.desiredReplicas
  const revision = data?.revision ?? history?.find(entry => entry.isCurrent)?.revision
  return <>
    <PageHeading eyebrow="WORKSPACE OVERVIEW" title="Your platform, at a glance" action={<button className="btn btn-secondary" onClick={onRefresh}>Refresh status</button>}>Live workload state and release context in one place.</PageHeading>
    <DataState loading={loading} error={error} onRetry={onRefresh}>
      <section className="metric-grid" aria-label="Platform health">
        <Metric label="Replica readiness" good={ready} detail={ready ? 'All desired replicas are ready' : data?.desiredReplicas === 0 ? 'Deployment is scaled to zero' : 'Readiness requires attention'}>{value(data?.readyReplicas)}<span className="metric-denominator"> / {value(data?.desiredReplicas)}</span></Metric>
        <Metric label="ArgoCD sync" good={argo?.sync === 'Synced'} detail={argo?.health ? `Application health: ${argo.health}` : 'ArgoCD data unavailable'}>{argo?.sync || 'Unavailable'}</Metric>
        <Metric label="Kubernetes revision" detail="Deployment revision · not a Git commit">{revision ? `#${revision}` : 'Unavailable'}</Metric>
        <Metric label="Ready running pods" detail={`${data?.pods?.length ?? 0} pods reported`}>{healthyPods(data?.pods || []).length}</Metric>
      </section>
      <div className="overview-grid">
        <section className="control-panel"><div className="panel-heading"><h3>Current release</h3><Badge good={ready} warning={!ready}>{ready ? 'Replicas ready' : 'Attention'}</Badge></div><p className="field-caption">DEPLOYED IMAGE TAG</p><code className="release-image">{shortImage(data?.currentImage)}</code><dl className="facts-grid"><div><dt>Namespace</dt><dd>{value(data?.namespace)}</dd></div><div><dt>Deployment</dt><dd>{value(data?.deploymentName)}</dd></div><div><dt>Environment</dt><dd>{value(config?.environment)}</dd></div><div><dt>Execution mode</dt><dd>{executionState(config, configError).label}</dd></div></dl><button className="btn btn-secondary" onClick={() => onNavigate('deployments')}>Manage releases →</button></section>
        <section className="control-panel"><div className="panel-heading"><h3>GitOps reconciliation</h3><Badge good={argo?.health === 'Healthy'}>{argo?.health || 'Unavailable'}</Badge></div>{argo ? <><dl className="stacked-facts"><div><dt>Application</dt><dd>{value(argo.application)}</dd></div><div><dt>Synced Git revision</dt><dd><code>{value(argo.revision)}</code></dd></div><div><dt>Last sync operation</dt><dd>{value(argo.operation)}</dd></div></dl>{argo.conditions?.length > 0 && <p className="state-warning">ArgoCD reports: {argo.conditions.map(c => c.type).join(', ')}</p>}</> : <div className="data-state">Live ArgoCD state is unavailable. No sync or health status is inferred from pod readiness.</div>}</section>
        <section className="control-panel"><div className="panel-heading"><h3>Last observed operation</h3><Badge good={lastOperation?.state === 'succeeded'} warning={lastOperation?.state === 'failed'}>{lastOperation?.state || 'Not reported'}</Badge></div>{lastOperation ? <><p className="operation-title">{lastOperation.operation === 'rollback' ? 'Rollback' : 'Deployment'} · <code>{shortImage(lastOperation.tag)}</code></p><p className="muted-copy">{lastOperation.message}</p>{lastOperation.commit && <p className="commit-reference">Commit <code>{lastOperation.commit}</code></p>}</> : <p className="muted-copy">No recent operation is available.</p>}</section>
        <section className="control-panel"><div className="panel-heading"><h3>Observability & assurance</h3><Badge>Integration status</Badge></div><div className="integration-row"><div><strong>Monitoring</strong><p>Open Monitoring to check collector availability.</p></div><button className="text-button" onClick={() => onNavigate('monitoring')}>Inspect →</button></div><div className="integration-row"><div><strong>CI security findings</strong><p>No scan-results API is connected.</p></div><button className="text-button" onClick={() => onNavigate('security')}>Inspect →</button></div></section>
      </div>
      <section className="control-panel"><div className="panel-heading"><h3>Workload instances</h3></div><PodCards data={data} /></section>
    </DataState>
  </>
}
export function SecurityPage() {
  return <><PageHeading eyebrow="SOFTWARE SUPPLY CHAIN" title="Security">Evidence first. Missing scan data is never treated as a clean scan.</PageHeading><section className="control-panel"><div className="panel-heading"><h3>CI scan results</h3><Badge>Not connected</Badge></div><div className="data-state"><strong>Security results unavailable</strong><p>The dashboard has no connected API for vulnerability reports, scan timestamps, or image-to-scan provenance.</p></div><dl className="facts-grid"><div><dt>Vulnerability count</dt><dd>Unknown</dd></div><div><dt>Last scan</dt><dd>Unavailable</dd></div><div><dt>Scanned image digest</dt><dd>Unavailable</dd></div><div><dt>Policy result</dt><dd>Not evaluated</dd></div></dl><p className="muted-copy">Inspect the repository’s CI run and scan output directly. A passing workflow alone does not establish that an image has no vulnerabilities.</p><a className="btn btn-secondary" href="https://github.com/harmohanjeetkaur/deployForge/actions" target="_blank" rel="noreferrer">Open GitHub Actions ↗</a></section></>
}
export { MonitoringPage } from './MonitoringPage.jsx'
