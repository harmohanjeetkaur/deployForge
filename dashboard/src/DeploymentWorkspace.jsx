const shortTag = image => image?.split(':').at(-1) || 'Not selected'
const steps = [
  ['requestAccepted', 'Request accepted', 'request-accepted'],
  ['commitCreated', 'GitOps commit', 'gitops-commit'],
  ['argoSynced', 'ArgoCD sync', 'argocd-sync'],
  ['rolloutReady', 'Kubernetes rollout', 'kubernetes-rollout'],
  ['healthy', 'Health verification', 'health-verification']
]

export default function DeploymentWorkspace({
  data, selected, images, history, historyLoading, historyError, verification, verifying,
  busy, token, setToken, candidateTag, setCandidateTag, candidateError, operation,
  phase, result, error, blockers, rollbackBlocker, eligibility, preview, previewError,
  environment, executionReady, onSelect, onRefresh, onNew, onUseTag, onVerify,
  onPreview, onRequest, onSelectRollback, formatTimestamp
}) {
  const verified = verification?.valid && verification?.exists && verification?.platformsSupported
  const label = operation === 'rollback' ? 'Rollback' : 'Deployment'
  const status = { idle: 'Ready', requested: `${label} requested`, 'in-progress': `${label} in progress`, succeeded: `${label} healthy`, failed: `${label} failed` }[phase] || 'Ready'
  const current = selected?.containerImage === data?.currentImage
  return (
    <div className="deployments-workspace">
      <div className="workspace-heading">
        <div><p className="eyebrow">RELEASE MANAGEMENT</p><h2>Deploy a Version</h2><p>Ship a verified image through GitOps. Track it all the way to a healthy rollout.</p></div>
        <div className="workspace-actions"><button className="btn btn-secondary" onClick={onRefresh} disabled={historyLoading || busy || verifying}>Refresh Versions</button><button className="btn btn-primary" onClick={onNew} disabled={busy || verifying}>Deploy New Version</button></div>
      </div>
      {executionReady !== true && <div id="execution-requirements" className="execution-notice" role="alert"><strong>Deployment execution unavailable</strong><p>{executionReady === null ? 'Check the local API connection and refresh.' : 'Ask your platform operator to enable GitOps execution and configure deployment credentials on the local API. No deployment request will run until it is configured.'}</p></div>}
      <p className="selection-mode">{operation === 'rollback' ? 'Rollback mode' : 'Deployment mode'}</p>
      <div className="release-summary">
        <article><span>Current deployed version</span><code>{shortTag(data?.currentImage)}</code><small>{data?.readyReplicas ?? 0}/{data?.desiredReplicas ?? 0} replicas ready</small></article>
        <article><span>Selected target version</span><code>{selected ? shortTag(selected.containerImage) : 'Choose a version below'}</code><small>{operation === 'rollback' && selected ? `Rollback target · Revision ${selected.revision}` : current ? 'Already deployed' : 'Deployment target'}</small></article>
        <article><span>Target environment</span><strong>{environment || 'Unavailable'}</strong><small>{data?.namespace || 'deployforge-gitops'}</small></article>
      </div>
      <section className="release-card">
        <div className="release-card-heading"><h3>1. Select and verify</h3><span className={`release-pill ${verified ? 'is-good' : 'is-muted'}`}>{verifying ? 'Verifying image…' : verified ? 'Image verified' : 'Verification required'}</span></div>
        <label htmlFor="version-select">Version</label>
        <select id="version-select" value={selected ? selected.type === 'available' ? `ghcr-${selected.id}` : `k8s-${selected.revision}` : ''} onChange={e => onSelect(e.target.value)} className="version-select">
          <option value="">Select a target version</option>
          <optgroup label="Kubernetes revisions">{(history || []).map(entry => <option key={entry.revision} value={`k8s-${entry.revision}`}>Revision {entry.revision} · {shortTag(entry.containerImage)}{entry.isCurrent ? ' (Current)' : ''}</option>)}</optgroup>
          <optgroup label="GHCR image candidates">{images.map(image => <option key={image.id} value={`ghcr-${image.id}`}>{image.displayName}{image.containerImage === data?.currentImage ? ' (Current)' : ''}</option>)}</optgroup>
        </select>
        <details className="image-entry"><summary>Use another image SHA</summary><div className="image-candidate-input"><label htmlFor="image-sha-input">Image SHA tag</label><input id="image-sha-input" value={candidateTag} onChange={e => setCandidateTag(e.target.value)} placeholder="40-character image SHA" autoComplete="off" /><button className="btn btn-secondary" onClick={onUseTag} disabled={busy || verifying}>Use Image Tag</button>{candidateError && <p className="error-text">{candidateError}</p>}</div></details>
        {historyLoading && <p className="release-hint">Loading version metadata…</p>}
        {historyError && <p className="error-text">Could not load history: {historyError}</p>}
        {selected && <div className="version-details">
          <div className="version-info"><span>Selected image</span><code>{selected.containerImage}</code>{selected.type !== 'available' && <p><strong>Rollback eligible:</strong> {eligibility}</p>}</div>
          <div className="verification-bar"><button className="btn btn-secondary" onClick={onVerify} disabled={verifying || busy}>{verifying ? 'Verifying...' : 'Verify Image Availability'}</button><div className="platforms-supported">{['linux/amd64', 'linux/arm64'].map(platform => <span key={platform} className={`platform-badge ${verified ? 'is-good' : 'is-muted'}`}>{platform}{verified ? ' ✓' : ''}</span>)}</div></div>
          {verification && <div className={`verification-result ${verified ? 'success' : 'error'}`}><strong>{verified ? '✓ Image verified in GHCR' : `✗ ${verification.error || 'Image is unavailable or does not support both required platforms'}`}</strong>{verification.digest && <p className="digest-info">Digest: {verification.digest}</p>}</div>}
        </div>}
      </section>
      <section className="release-card">
        <div className="release-card-heading"><h3>2. Preview and authorize</h3><span className={`release-pill ${preview ? 'is-good' : 'is-muted'}`}>{preview ? 'Changes reviewed' : 'Review required'}</span></div>
        <div className="authorization-row"><div><label htmlFor="deployment-token">Deployment token</label><p className="release-hint">Authorizes changes to the selected environment. Kept only in this browser session’s memory.</p></div><div className="token-input"><input id="deployment-token" type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" spellCheck="false" /><button className="btn btn-secondary" onClick={() => setToken('')} disabled={busy || !token}>Clear token</button></div></div>
        <div className="release-actions"><button className="btn btn-secondary preview-btn" onClick={onPreview} disabled={!selected || current || verifying || busy}>Preview Version Change</button><button className="btn btn-primary" onClick={() => onRequest('deploy')} disabled={blockers.length > 0} aria-describedby="execution-requirements gitops-requirements">{busy && operation === 'deploy' ? 'Deploying...' : 'Deploy Version'}</button><button className="btn btn-secondary" data-testid="rollback-action" onClick={() => onRequest('rollback')} disabled={blockers.length > 0 || Boolean(rollbackBlocker)} aria-describedby="execution-requirements gitops-requirements rollback-requirements">{busy && operation === 'rollback' ? 'Rolling back...' : selected?.revision ? `Rollback to Revision ${selected.revision}` : 'Rollback'}</button></div>
        <div id="gitops-requirements" className="operation-requirements">{blockers.length > 0 && <ul>{blockers.filter(reason => !reason.startsWith('GitOps execution') && !reason.startsWith('Deployment configuration')).map(reason => <li key={reason}>{reason}</li>)}</ul>}</div><p id="rollback-requirements" className="operation-requirements">{rollbackBlocker}</p>
        {previewError && <p className="preview-error">{previewError}</p>}
        {preview && selected && <div className="preview-section"><h3>Proposed image change</h3><div className="preview-comparison"><div className="preview-side current"><h4>Current</h4><code className="preview-image">{data?.currentImage}</code></div><span className="config-arrow" aria-hidden="true">→</span><div className="preview-side target"><h4>Target</h4><code className="preview-image">{selected.containerImage}</code><span className="unverified-label">{verified ? 'Image verified in GHCR for both required platforms' : 'Image availability has not been verified'}</span></div></div><p className="release-hint">One image-tag change in the GitOps repository. ArgoCD reconciles the commit; success requires a healthy target rollout.</p></div>}
      </section>
      <section className="release-card deployment-progress" aria-label="Deployment progress"><div className="release-card-heading"><h3>Deployment Progress</h3><span role="status" aria-live="polite" className={`release-pill ${phase === 'succeeded' ? 'is-good' : phase === 'failed' ? 'is-failed' : 'is-muted'}`}>{status}</span></div>
        <ol className="progress-steps">{steps.map(([key, title, stage], index) => {const done = result?.progress?.[key] === true; const failed = phase === 'failed' && (result?.failureStage === stage || (!result?.failureStage && index === 0)); const active = !done && !failed && result?.stage === stage; return <li key={key} className={done ? 'step-complete' : failed ? 'step-failed' : active ? 'step-active' : ''}><span className="step-marker">{done ? '✓' : failed ? '!' : index + 1}</span><strong>{title}</strong><small>{done ? 'Complete' : failed ? 'Failed' : active ? 'In progress' : 'Waiting'}</small></li>})}</ol>
        {result?.commit && <p className="commit-reference">GitOps commit <code>{result.commit}</code>{result.pushed ? ' · pushed to origin/main' : ' · push pending'}</p>}
        {result?.observation && <p className="release-hint">ArgoCD: {result.observation.argoSynced ? 'Synced at target commit' : 'Synchronization pending'} · Ready replicas: {result.observation.readyReplicas ?? 0}/{result.observation.desiredReplicas ?? 0}</p>}
        {error && <div className="preview-error" role="alert">{error}</div>}
        {phase === 'succeeded' && <div className="verification-result success"><strong>{label} healthy</strong><p>The target image is ready and ArgoCD is Synced/Healthy at the requested commit.</p></div>}
      </section>
      <section className="release-card"><div className="release-card-heading"><h3>Deployment History</h3><span className="release-hint">Retained Kubernetes revisions</span></div><div className="table-container"><table className="table"><thead><tr><th>Revision</th><th>Image tag</th><th>Deployed</th><th>Status</th><th>Rollback eligibility</th><th>Action</th></tr></thead><tbody>{(history || []).map(entry => <tr key={entry.revision}><td><strong>#{entry.revision}</strong></td><td><code title={entry.containerImage}>{shortTag(entry.containerImage)}</code></td><td>{formatTimestamp(entry.creationTimestamp)}</td><td><span className={`release-pill ${entry.isCurrent ? 'is-good' : 'is-muted'}`}>{entry.isCurrent ? 'Current' : 'Previous'}</span></td><td>{typeof entry.rollbackEligible !== 'boolean' ? 'Unknown — refresh API metadata' : entry.rollbackEligible ? 'Eligible' : 'Not eligible'}</td><td><button className="history-rollback" aria-label={`Select revision ${entry.revision} for rollback`} onClick={() => onSelectRollback(entry)} disabled={entry.rollbackEligible !== true || busy || verifying}>Rollback to Revision {entry.revision}</button></td></tr>)}</tbody></table></div>{!historyLoading && !history?.length && <p className="release-hint">No retained revisions available.</p>}</section>
    </div>
  )
}
