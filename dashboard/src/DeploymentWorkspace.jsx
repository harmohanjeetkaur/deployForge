import ExecutionStatus from './ExecutionStatus.jsx'
import { executionState } from './execution-state.js'

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
  busy, candidateTag, setCandidateTag, candidateError, operation,
  phase, result, error, blockers, rollbackBlocker, eligibility,
  environment, executionConfig, configError, configCheckedAt, onRefreshConfig, lastOperation, onSelect, onRefresh, onUseTag, onVerify,
  onRequest, onSelectRollback, formatTimestamp, onMode, preflightError
}) {
  const execution = executionState(executionConfig, configError)
  const verified = verification?.valid && verification?.exists && verification?.platformsSupported
  const displayedResult = phase !== 'idle' ? result : result || lastOperation
  const displayedPhase = phase !== 'idle' ? phase : lastOperation?.state || phase
  const label = (phase !== 'idle' ? operation : displayedResult?.operation || operation) === 'rollback' ? 'Rollback' : 'Deployment'
  const status = { idle: 'Ready', submitting: 'Submitting request', 'authorization-error': 'Authorization required', requested: `${label} requested`, 'in-progress': `${label} in progress`, succeeded: `${label} healthy`, failed: `${label} failed` }[displayedPhase] || 'Ready'
  return (
    <div className="deployments-workspace">
      <div className="workspace-heading">
        <div><p className="eyebrow">RELEASE MANAGEMENT</p><h2>Deployments</h2><p>Choose an operation, select a version, verify it, and confirm.</p></div>
        <button className="btn btn-secondary" onClick={onRefresh}>Refresh Versions</button>
      </div>
      <details className="workflow-config"><summary>{environment || 'Environment unavailable'} · {execution.ready === true ? 'Live execution enabled' : execution.label}</summary><ExecutionStatus config={executionConfig} error={configError} checkedAt={configCheckedAt} onRefresh={onRefreshConfig} /></details>
      <section className="release-card release-workflow">
        <div className="operation-switch" aria-label="Release operation">
          <button className={`operation-choice ${operation === 'deploy' ? 'selected' : ''}`} aria-pressed={operation === 'deploy'} onClick={() => onMode('deploy')}>Deploy a version</button>
          <button className={`operation-choice ${operation === 'rollback' ? 'selected' : ''}`} aria-pressed={operation === 'rollback'} onClick={() => onMode('rollback')}>Roll back a version</button>
        </div>
        <p className="release-hint current-release">Currently deployed: <code>{shortTag(data?.currentImage)}</code> · {data ? `${data.readyReplicas}/${data.desiredReplicas} replicas ready` : 'Workload status unavailable'}</p>
        <label htmlFor="version-select">{operation === 'rollback' ? 'Revision to restore' : 'Image version'}</label>
        <select id="version-select" value={selected ? selected.type === 'available' ? `ghcr-${selected.id}` : `k8s-${selected.revision}` : ''} onChange={e => onSelect(e.target.value)} className="version-select">
          <option value="">Select a version</option>
          {operation === 'rollback' ? (history || []).map(entry => <option key={entry.revision} value={`k8s-${entry.revision}`}>Revision {entry.revision} · {shortTag(entry.containerImage)}{entry.isCurrent ? ' (Current)' : entry.rollbackEligible === true ? ' (Previous)' : ' (Not eligible)'}</option>) : images.map(image => <option key={image.id} value={`ghcr-${image.id}`}>{image.displayName}{image.containerImage === data?.currentImage ? ' (Current)' : ''}</option>)}
        </select>
        {operation === 'deploy' && <details className="image-entry"><summary>Use another image SHA</summary><div className="image-candidate-input"><label htmlFor="image-sha-input">Image SHA tag</label><input id="image-sha-input" value={candidateTag} onChange={e => setCandidateTag(e.target.value)} placeholder="40-character image SHA" autoComplete="off" /><button className="btn btn-secondary" onClick={onUseTag}>Use Image Tag</button>{candidateError && <p className="error-text">{candidateError}</p>}</div></details>}
        {historyLoading && <p className="release-hint">Loading versions…</p>}
        {historyError && <p className="error-text">Could not load revisions: {historyError}</p>}
        {operation === 'rollback' && !historyLoading && !history?.length && <p className="release-hint">No retained Kubernetes revisions are available for rollback.</p>}
        {selected && <div className="version-details">
          <div className="version-info"><code>{selected.containerImage}</code>{operation === 'rollback' && <p><strong>Rollback eligible:</strong> {eligibility}</p>}</div>
          {verification && <div className={`verification-result ${verified ? 'success' : 'error'}`}><strong>{verified ? '✓ Image verified in GHCR' : `✗ ${verification.error || 'Image unavailable or missing a required platform'}`}</strong><div className="platforms-supported">{['linux/amd64', 'linux/arm64'].map(platform => <span key={platform} className={`platform-badge ${(verification.platforms?.includes(platform) || verified) ? 'is-good' : 'is-muted'}`}>{platform}{(verification.platforms?.includes(platform) || verified) ? ' ✓' : ' · unavailable'}</span>)}</div>{verification.digest && <p className="digest-info">Digest: {verification.digest}</p>}</div>}
        </div>}
        <div className="release-actions"><button className="btn btn-secondary" onClick={onVerify}>{verifying ? 'Verifying...' : 'Verify Image Availability'}</button><button className="btn btn-primary" data-testid="rollback-action" onClick={() => onRequest(operation)}>{busy ? operation === 'rollback' ? 'Rolling back...' : 'Deploying...' : operation === 'rollback' ? 'Rollback' : 'Deploy Version'}</button></div>
        <p className="release-hint">{operation === 'rollback' ? 'Restore a retained version with a new GitOps commit.' : 'Deploy the selected image through GitOps.'} You will review the current and target images before confirming.</p>
        {preflightError && <div className="workflow-error" role="alert">{preflightError}</div>}
        {selected && <details className="release-requirements"><summary>View readiness checks</summary><div id="gitops-requirements" className="operation-requirements">{blockers.length ? <ul>{blockers.map(reason => <li key={reason}>{reason}</li>)}</ul> : <p>Ready to review and confirm.</p>}</div><p id="rollback-requirements" className="operation-requirements">{operation === 'rollback' ? rollbackBlocker : ''}</p></details>}
      </section>
      <section className="release-card deployment-progress" aria-label="Deployment progress"><div className="release-card-heading"><h3>Deployment Progress</h3><span role="status" aria-live="polite" className={`release-pill ${displayedPhase === 'succeeded' ? 'is-good' : ['failed', 'authorization-error'].includes(displayedPhase) ? 'is-failed' : 'is-muted'}`}>{status}</span></div>
        <p className="release-hint">{displayedResult ? `Last ${displayedResult.operation || 'deployment'} · ${displayedResult.startedAt ? formatTimestamp(displayedResult.startedAt) : 'Timestamp unavailable from this backend'}` : 'No operation reported by this backend process.'}</p>
        <ol className="progress-steps">{steps.map(([key, title, stage], index) => {const done = displayedResult?.progress?.[key] === true; const failed = displayedPhase === 'failed' && (displayedResult?.failureStage === stage || (!displayedResult?.failureStage && index === 0)); const active = !done && !failed && displayedResult?.stage === stage; return <li key={key} className={done ? 'step-complete' : failed ? 'step-failed' : active ? 'step-active' : ''}><span className="step-marker">{done ? '✓' : failed ? '!' : index + 1}</span><strong>{title}</strong><small>{done ? 'Complete' : failed ? 'Failed' : active ? 'In progress' : displayedResult ? 'Waiting' : 'Not started'}</small></li>})}</ol>
        {displayedResult?.commit && <p className="commit-reference">GitOps commit <code>{displayedResult.commit}</code>{displayedResult.pushed ? ' · pushed to origin/main' : ' · push pending'}</p>}
        {displayedResult?.observation && <p className="release-hint">ArgoCD: {displayedResult.observation.argoSynced ? 'Synced at target commit' : 'Synchronization pending'} · Ready replicas: {displayedResult.observation.readyReplicas ?? 0}/{displayedResult.observation.desiredReplicas ?? 0}</p>}
        {error && <div className="preview-error" role="alert">{error}</div>}
        {!error && displayedResult?.state === 'failed' && <div className="preview-error" role="alert">{displayedResult.message || 'The last operation failed; inspect Git and cluster state before retrying.'}</div>}
        {displayedPhase === 'succeeded' && <div className="verification-result success"><strong>{label} healthy</strong><p>The target image is ready and ArgoCD is Synced/Healthy at the requested commit.</p></div>}
      </section>
      <section className="release-card"><div className="release-card-heading"><h3>Deployment History</h3><span className="release-hint">Retained Kubernetes revisions</span></div><div className="table-container"><table className="table"><thead><tr><th>Revision</th><th>Image tag</th><th>ReplicaSet created</th><th>Status</th><th>Rollback eligibility</th><th>Action</th></tr></thead><tbody>{(history || []).map(entry => <tr key={entry.revision}><td><strong>#{entry.revision}</strong></td><td><code title={entry.containerImage}>{shortTag(entry.containerImage)}</code></td><td>{formatTimestamp(entry.creationTimestamp)}</td><td><span className={`release-pill ${entry.isCurrent ? 'is-good' : 'is-muted'}`}>{entry.isCurrent ? 'Current' : 'Previous'}</span></td><td>{typeof entry.rollbackEligible !== 'boolean' ? 'Unknown — refresh API metadata' : entry.rollbackEligible ? 'Eligible' : 'Not eligible'}</td><td><button className="history-rollback" aria-label={`Select revision ${entry.revision} for rollback`} onClick={() => onSelectRollback(entry)}>Rollback to Revision {entry.revision}</button></td></tr>)}</tbody></table></div>{!historyLoading && !history?.length && <p className="release-hint">No retained revisions available.</p>}</section>
    </div>
  )
}
