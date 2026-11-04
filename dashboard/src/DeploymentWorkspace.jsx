import ExecutionStatus from './ExecutionStatus.jsx'

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
  environment, executionConfig, configError, configCheckedAt, onRefreshConfig, lastOperation, onSelect, onRefresh, onNew, onUseTag, onVerify,
  onPreview, onRequest, onSelectRollback, formatTimestamp
}) {
  const verified = verification?.valid && verification?.exists && verification?.platformsSupported
  const displayedResult = phase !== 'idle' ? result : result || lastOperation
  const displayedPhase = phase !== 'idle' ? phase : lastOperation?.state || phase
  const label = (phase !== 'idle' ? operation : displayedResult?.operation || operation) === 'rollback' ? 'Rollback' : 'Deployment'
  const status = { idle: 'Ready', submitting: 'Submitting request', 'authorization-error': 'Authorization required', requested: `${label} requested`, 'in-progress': `${label} in progress`, succeeded: `${label} healthy`, failed: `${label} failed` }[displayedPhase] || 'Ready'
  const current = selected?.containerImage === data?.currentImage
  return (
    <div className="deployments-workspace">
      <div className="workspace-heading">
        <div><p className="eyebrow">RELEASE MANAGEMENT</p><h2>Deploy a Version</h2><p>Ship a verified image through GitOps. Track it all the way to a healthy rollout.</p></div>
        <div className="workspace-actions"><button className="btn btn-secondary" onClick={onRefresh} disabled={historyLoading || busy || verifying}>Refresh Versions</button><button className="btn btn-secondary" onClick={onNew} disabled={busy || verifying}>Deploy New Version</button></div>
      </div>
      <ExecutionStatus config={executionConfig} error={configError} checkedAt={configCheckedAt} onRefresh={onRefreshConfig} />
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
        <div className="authorization-row compact-authorization"><div><label htmlFor="deployment-token">Authorize Deployment</label><p className="release-hint">{token.trim() ? 'Token provided; validated by the server on submission.' : 'Use your local deployment token. Memory only; cleared when you leave this page.'}</p></div><div className="token-input"><input id="deployment-token" aria-label="Deployment token" placeholder="Deployment token" type="password" value={token} onChange={e => setToken(e.target.value)} disabled={busy} autoComplete="off" spellCheck="false" /><button className="btn btn-secondary" onClick={() => setToken('')} disabled={busy || !token}>Clear token</button></div></div>
        <div className="release-actions"><button className="btn btn-secondary preview-btn" onClick={onPreview} disabled={!selected || current || verifying || busy}>Preview Version Change</button><button className="btn btn-primary" data-testid="rollback-action" onClick={() => onRequest(operation)} disabled={blockers.length > 0 || (operation === 'rollback' && Boolean(rollbackBlocker))} aria-describedby="gitops-requirements rollback-requirements">{busy ? operation === 'rollback' ? 'Rolling back...' : 'Deploying...' : operation === 'rollback' && selected?.revision ? `Rollback to Revision ${selected.revision}` : 'Deploy Version'}</button></div>
        <div id="gitops-requirements" className="operation-requirements">{blockers.length > 0 && <ul>{blockers.map(reason => <li key={reason}>{reason}</li>)}</ul>}</div><p id="rollback-requirements" className="operation-requirements">{operation === 'rollback' ? rollbackBlocker : ''}</p>
        {previewError && <p className="preview-error">{previewError}</p>}
        {preview && selected && <div className="preview-section"><h3>Proposed image change</h3><div className="preview-comparison"><div className="preview-side current"><h4>Current</h4><code className="preview-image">{data?.currentImage}</code></div><span className="config-arrow" aria-hidden="true">→</span><div className="preview-side target"><h4>Target</h4><code className="preview-image">{selected.containerImage}</code><span className="unverified-label">{verified ? 'Image verified in GHCR for both required platforms' : 'Image availability has not been verified'}</span></div></div><p className="release-hint">One image-tag change in the GitOps repository. ArgoCD reconciles the commit; success requires a healthy target rollout.</p></div>}
      </section>
      <section className="release-card deployment-progress" aria-label="Deployment progress"><div className="release-card-heading"><h3>Deployment Progress</h3><span role="status" aria-live="polite" className={`release-pill ${displayedPhase === 'succeeded' ? 'is-good' : ['failed', 'authorization-error'].includes(displayedPhase) ? 'is-failed' : 'is-muted'}`}>{status}</span></div>
        <p className="release-hint">{displayedResult ? `Last ${displayedResult.operation || 'deployment'} · ${displayedResult.startedAt ? formatTimestamp(displayedResult.startedAt) : 'Timestamp unavailable from this backend'}` : 'No operation reported by this backend process.'} Operation history is held in memory and is lost when the backend restarts.</p>
        <ol className="progress-steps">{steps.map(([key, title, stage], index) => {const done = displayedResult?.progress?.[key] === true; const failed = displayedPhase === 'failed' && (displayedResult?.failureStage === stage || (!displayedResult?.failureStage && index === 0)); const active = !done && !failed && displayedResult?.stage === stage; return <li key={key} className={done ? 'step-complete' : failed ? 'step-failed' : active ? 'step-active' : ''}><span className="step-marker">{done ? '✓' : failed ? '!' : index + 1}</span><strong>{title}</strong><small>{done ? 'Complete' : failed ? 'Failed' : active ? 'In progress' : displayedResult ? 'Waiting' : 'Not started'}</small></li>})}</ol>
        {displayedResult?.commit && <p className="commit-reference">GitOps commit <code>{displayedResult.commit}</code>{displayedResult.pushed ? ' · pushed to origin/main' : ' · push pending'}</p>}
        {displayedResult?.observation && <p className="release-hint">ArgoCD: {displayedResult.observation.argoSynced ? 'Synced at target commit' : 'Synchronization pending'} · Ready replicas: {displayedResult.observation.readyReplicas ?? 0}/{displayedResult.observation.desiredReplicas ?? 0}</p>}
        {error && <div className="preview-error" role="alert">{error}</div>}
        {!error && displayedResult?.state === 'failed' && <div className="preview-error" role="alert">{displayedResult.message || 'The last operation failed; inspect Git and cluster state before retrying.'}</div>}
        {displayedPhase === 'succeeded' && <div className="verification-result success"><strong>{label} healthy</strong><p>The target image is ready and ArgoCD is Synced/Healthy at the requested commit.</p></div>}
      </section>
      <section className="release-card"><div className="release-card-heading"><h3>Deployment History</h3><span className="release-hint">Retained Kubernetes revisions</span></div><div className="table-container"><table className="table"><thead><tr><th>Revision</th><th>Image tag</th><th>ReplicaSet created</th><th>Status</th><th>Rollback eligibility</th><th>Action</th></tr></thead><tbody>{(history || []).map(entry => <tr key={entry.revision}><td><strong>#{entry.revision}</strong></td><td><code title={entry.containerImage}>{shortTag(entry.containerImage)}</code></td><td>{formatTimestamp(entry.creationTimestamp)}</td><td><span className={`release-pill ${entry.isCurrent ? 'is-good' : 'is-muted'}`}>{entry.isCurrent ? 'Current' : 'Previous'}</span></td><td>{typeof entry.rollbackEligible !== 'boolean' ? 'Unknown — refresh API metadata' : entry.rollbackEligible ? 'Eligible' : 'Not eligible'}</td><td><button className="history-rollback" aria-label={`Select revision ${entry.revision} for rollback`} onClick={() => onSelectRollback(entry)} disabled={entry.rollbackEligible !== true || busy || verifying}>Rollback to Revision {entry.revision}</button></td></tr>)}</tbody></table></div>{!historyLoading && !history?.length && <p className="release-hint">No retained revisions available.</p>}</section>
    </div>
  )
}
