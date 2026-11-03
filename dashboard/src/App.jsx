import { useState, useEffect, useRef } from 'react'
import './App.css'
import DeploymentWorkspace from './DeploymentWorkspace.jsx'

function App() {
  const [k8sData, setK8sData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState(null)
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [extraImages, setExtraImages] = useState([])
  const [candidateTag, setCandidateTag] = useState('')
  const [candidateError, setCandidateError] = useState(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewError, setPreviewError] = useState(null)
  const [verificationResult, setVerificationResult] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [currentPage, setCurrentPage] = useState('overview')
  const verificationRequestIdRef = useRef(0)
  const historyRequestIdRef = useRef(0)
  const [showDeployConfirm, setShowDeployConfirm] = useState(false)
  const [operation, setOperation] = useState('deploy')
  const [deploying, setDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState(null)
  const [deployError, setDeployError] = useState(null)
  const [deployPhase, setDeployPhase] = useState('idle')
  const [backendConfig, setBackendConfig] = useState(null)
  const executionReady = backendConfig === null ? null : backendConfig.capabilities?.realRequests === true && backendConfig.executionEnabled === true && backendConfig.dryRun === false
  const submissionLockRef = useRef(false)
  const [deployToken, setDeployToken] = useState('')
  const deployRequestRef = useRef(0)
  const deployControllerRef = useRef(null)

  useEffect(() => {
    fetchDeploymentConfig()
    const controllerRef = deployControllerRef
    const requestRef = deployRequestRef
    return () => { requestRef.current++; controllerRef.current?.abort() }
  }, [])

  const navigate = page => {
    if (page !== 'deployments') { setDeployToken(''); setShowDeployConfirm(false) }
    setCurrentPage(page)
  }

  // Image candidates are verified against GHCR before either operation.
  const seedImages = [
    {
      id: 'ghcr-210426be',
      containerImage: 'ghcr.io/harmohanjeetkaur/deployforge:210426be6d6da6c2e16f234db410f83a0c98bbd2',
      type: 'available',
      displayName: '210426be6d6da6c2e16f234db410f83a0c98bbd2'
    }
  ]

  useEffect(() => {
    fetchKubernetesStatus()
    const interval = setInterval(fetchKubernetesStatus, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    fetchDeploymentHistory()
  }, [])

  async function fetchDeploymentConfig() {
    try {
      const response = await fetch('/api/deploy/config', { cache: 'no-store' })
      if (!response.ok) throw new Error('Deployment mode unavailable')
      const config = await response.json()
      if (typeof config.dryRun !== 'boolean') throw new Error('Invalid deployment configuration')
      setBackendConfig(config)
    } catch { setBackendConfig(null) }
  }

  async function fetchKubernetesStatus() {
    try {
      const response = await fetch('/api/kubernetes/status', { cache: 'no-store' })
      if (!response.ok) {
        throw new Error('Failed to fetch Kubernetes status')
      }
      const data = await response.json()
      setK8sData(data)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchDeploymentHistory() {
    const requestId = ++historyRequestIdRef.current
    setHistoryLoading(true)
    try {
      const response = await fetch('/api/kubernetes/history', { cache: 'no-store' })
      if (!response.ok) {
        throw new Error('Failed to fetch deployment history')
      }
      const data = await response.json()
      if (requestId !== historyRequestIdRef.current) return
      if (!Array.isArray(data)) throw new Error('Invalid deployment history response')
      setHistory(data)
      // Refresh metadata for the selection rather than retaining a stale history object.
      setSelectedVersion(selection => {
        if (!selection || selection.type === 'available') return selection
        return data.find(entry => entry.revision === selection.revision && entry.containerImage === selection.containerImage) || null
      })
      setHistoryError(null)
    } catch (err) {
      if (requestId === historyRequestIdRef.current) setHistoryError(err.message)
    } finally {
      if (requestId === historyRequestIdRef.current) setHistoryLoading(false)
    }
  }

  const getImageShort = (fullImage) => {
    if (!fullImage) return 'unknown'
    const parts = fullImage.split(':')
    return parts[parts.length - 1] || fullImage
  }

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'unknown'
    return new Date(timestamp).toLocaleString()
  }

  const validateImageTag = (image) => {
    if (!image) return { valid: false, reason: 'No image provided' }

    const expectedRepo = 'ghcr.io/harmohanjeetkaur/deployforge'
    const parts = image.split(':')

    if (parts.length < 2) return { valid: false, reason: 'Image has no tag' }

    const repo = parts.slice(0, -1).join(':')
    const tag = parts[parts.length - 1]

    // Check repository
    if (repo !== expectedRepo) {
      return { valid: false, reason: `Image must be from ${expectedRepo}` }
    }

    // Reject mutable tags
    if (tag === 'latest') {
      return { valid: false, reason: 'Mutable tag "latest" is not allowed' }
    }

    // Reject local image patterns
    if (tag.startsWith('v') && /^\d+$/.test(tag.slice(1))) {
      return { valid: false, reason: 'Local version tags (e.g., v1) are not allowed' }
    }

    // Check for 40-char hex SHA
    const shaPattern = /^[a-f0-9]{40}$/
    if (!shaPattern.test(tag)) {
      return { valid: false, reason: 'Tag must be a 40-character Git commit SHA' }
    }

    return { valid: true, tag }
  }

  const isCurrentlyDeployed = (version) => {
    if (!version || !k8sData) return false
    const currentTag = getImageShort(k8sData.currentImage)
    const selectedTag = getImageShort(version.containerImage)
    return currentTag === selectedTag
  }

  const availableImages = [
    ...seedImages,
    ...(history || []).filter(entry => validateImageTag(entry.containerImage).valid).map(entry => ({
      id: `history-${getImageShort(entry.containerImage)}`, containerImage: entry.containerImage,
      type: 'available', displayName: getImageShort(entry.containerImage)
    })),
    ...extraImages
  ].filter((entry, index, images) => images.findIndex(image => image.containerImage === entry.containerImage) === index)

  const changeSelectedVersion = version => {
    setSelectedVersion(version)
    setVerificationResult(null)
    setShowPreview(false)
    setPreviewError(null)
    setDeployResult(null)
    setDeployError(null)
    setDeployPhase('idle')
    setOperation('deploy')
    setShowDeployConfirm(false)
    verificationRequestIdRef.current++
    setVerifying(false)
    deployRequestRef.current++
    deployControllerRef.current?.abort()
    setDeploying(false)
  }
  const handleDeployNewVersion = () => {
    changeSelectedVersion(availableImages.find(image => !isCurrentlyDeployed(image)) || null)
    document.getElementById('version-select')?.focus()
  }
  const handleUseImageTag = () => {
    const tag = candidateTag.trim()
    const containerImage = `ghcr.io/harmohanjeetkaur/deployforge:${tag}`
    const validation = validateImageTag(containerImage)
    if (!validation.valid) { setCandidateError(validation.reason); return }
    const candidate = availableImages.find(image => image.containerImage === containerImage)
      || { id: `input-${tag}`, containerImage, type: 'available', displayName: tag }
    setExtraImages(images => images.some(image => image.containerImage === containerImage) ? images : [...images, candidate])
    setCandidateError(null)
    changeSelectedVersion(candidate)
  }

  const commonBlockers = []
  if (deploying) commonBlockers.push('A GitOps operation is already in progress.')
  if (executionReady !== true) commonBlockers.push(executionReady === null ? 'Deployment configuration is unavailable. Refresh the API connection.' : 'GitOps execution is not configured. Ask your platform operator to enable execution on the local API.')
  if (backendConfig?.authenticationConfigured === false) commonBlockers.push('Configure deployment authentication on the local API.')
  if (!showPreview) commonBlockers.push('Preview the proposed image change before confirming.')
  if (!deployToken.trim()) commonBlockers.push('Enter the deployment token to authorize this request.')
  if (!selectedVersion) commonBlockers.push('Select a version.')
  if (!k8sData || error) commonBlockers.push('Current Kubernetes status is unavailable.')
  if (selectedVersion) {
    const validation = validateImageTag(selectedVersion.containerImage)
    if (!validation.valid) commonBlockers.push(validation.reason)
    if (isCurrentlyDeployed(selectedVersion)) commonBlockers.push('This image is already deployed. Select a different image.')
    if (verifying || !verificationResult?.valid || !verificationResult?.exists || !verificationResult?.platformsSupported) {
      commonBlockers.push('Verify image availability and both required platforms.')
    }
  }
  let rollbackBlocker = ''
  if (selectedVersion) {
    if (historyLoading || historyError) rollbackBlocker = 'Rollback history is unavailable. Refresh versions before continuing.'
    else if (selectedVersion.type === 'available') rollbackBlocker = 'Rollback requires a previous eligible Kubernetes revision.'
    else if (typeof selectedVersion.rollbackEligible !== 'boolean') rollbackBlocker = 'Rollback eligibility is unknown: the backend did not provide eligibility metadata. Load the latest backend code, then refresh versions.'
    else if (!selectedVersion.rollbackEligible) rollbackBlocker = 'This revision is not eligible for rollback.'
  }
  const rollbackEligibilityLabel = typeof selectedVersion?.rollbackEligible !== 'boolean'
    ? 'Unknown — backend eligibility metadata unavailable'
    : selectedVersion.rollbackEligible ? verificationResult?.valid && verificationResult?.exists && verificationResult?.platformsSupported ? 'Yes — image verified' : 'Yes — verify the image before continuing' : 'No'

  const handlePreview = () => {
    setPreviewError(null)

    if (!selectedVersion) {
      setPreviewError('Please select a version first')
      return
    }

    if (isCurrentlyDeployed(selectedVersion)) {
      setPreviewError('Cannot preview the currently deployed version')
      return
    }

    const validation = validateImageTag(selectedVersion.containerImage)
    if (!validation.valid) {
      setPreviewError(validation.reason)
      return
    }

    setShowPreview(true)
  }

  const handleVerifyImage = async () => {
    if (!selectedVersion) return

    const validation = validateImageTag(selectedVersion.containerImage)
    if (!validation.valid) {
      setVerificationResult({
        valid: false,
        error: validation.reason
      })
      return
    }

    // Increment request ID to track this specific verification
    const currentRequestId = ++verificationRequestIdRef.current

    setVerifying(true)
    setVerificationResult(null)

    try {
      const tag = getImageShort(selectedVersion.containerImage)
      const response = await fetch(`/api/images/verify/${tag}`, { signal: AbortSignal.timeout(40000) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || result.error || 'Failed to verify image availability')

      // Only update if this is still the most recent request
      if (currentRequestId === verificationRequestIdRef.current) {
        setVerificationResult(result)
      }
    } catch (err) {
      // Only update if this is still the most recent request
      if (currentRequestId === verificationRequestIdRef.current) {
        setVerificationResult({
          valid: true,
          exists: false,
          platformsSupported: false,
          error: err.name === 'TimeoutError' ? 'Image verification timed out' : err.message
        })
      }
    } finally {
      // Only clear verifying state if this is still the most recent request
      if (currentRequestId === verificationRequestIdRef.current) {
        setVerifying(false)
      }
    }
  }

  const handleDeployRequest = (requestedOperation = 'deploy') => {
    if (!selectedVersion) return
    if (commonBlockers.length || (requestedOperation === 'rollback' && rollbackBlocker)) {
      setDeployError(commonBlockers[0] || rollbackBlocker)
      return
    }
    setOperation(requestedOperation)
    setShowDeployConfirm(true)
    setDeployError(null)
  }

  const handleConfirmDeploy = async () => {
    if (submissionLockRef.current || !selectedVersion || commonBlockers.length || (operation === 'rollback' && rollbackBlocker)) return
    submissionLockRef.current = true
    const requestId = ++deployRequestRef.current
    const controller = new AbortController()
    deployControllerRef.current = controller
    const deadline = Date.now() + 420000
    setDeploying(true)
    setDeployPhase('requested')
    setDeployResult(null)
    setDeployError(null)
    setShowDeployConfirm(false)
    const current = () => requestId === deployRequestRef.current
    const request = async (url, options = {}) => {
      const response = await fetch(url, { ...options, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]) })
      const data = await response.json()
      if (!response.ok) {
        if (response.status === 401) setDeployToken('')
        throw Object.assign(new Error(data.message || data.error || 'Deployment request failed'), { result: data })
      }
      if (data.dryRun !== false || data.state === 'dry-run') throw new Error('No deployment was performed. The API returned a simulation instead of executing GitOps. Ask your platform operator to configure execution.')
      if (data.state === 'succeeded' && (data.success !== true || !data.progress?.healthy || !data.progress?.argoSynced || !data.progress?.rolloutReady)) throw new Error('The API did not confirm deployment health')
      if (!['requested', 'in-progress', 'succeeded', 'failed'].includes(data.state)) throw new Error('The API returned an unknown deployment state')
      return data
    }
    try {
      const tag = getImageShort(selectedVersion.containerImage)
      let result = await request(`/api/${operation}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deployToken.trim()}` },
        body: JSON.stringify({ tag, execution: 'real', environment: backendConfig.environment })
      })
      while (current()) {
        setDeployResult(result)
        setDeployPhase(result.state)
        if (result.state === 'failed') throw new Error(result.message)
        if (result.state === 'succeeded') break
        if (Date.now() >= deadline) throw new Error('Status polling timed out. The backend may still be deploying; inspect Git and cluster state before retrying.')
        await new Promise((resolve, reject) => {
          const onAbort = () => { clearTimeout(timer); reject(new Error('Status polling stopped')) }
          const timer = setTimeout(() => { controller.signal.removeEventListener('abort', onAbort); resolve() }, 3000)
          controller.signal.addEventListener('abort', onAbort, { once: true })
          if (controller.signal.aborted) onAbort()
        })
        result = await request(`/api/deploy/status/${tag}?id=${encodeURIComponent(result.id)}`)
      }
      if (current() && result.state === 'succeeded') {
        fetchKubernetesStatus()
        fetchDeploymentHistory()
      }
    } catch (err) {
      if (current()) {
        setDeployPhase('failed')
        if (err.result?.state === 'failed') setDeployResult(err.result)
        setDeployError(`${err.message}${['TimeoutError', 'AbortError'].includes(err.name) ? '. Request outcome is unknown; inspect Git and cluster state before retrying.' : ''}`)
      }
    } finally {
      submissionLockRef.current = false
      if (current()) setDeploying(false)
    }
  }

  const handleCancelDeploy = () => {
    setShowDeployConfirm(false)
  }

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>DeployForge</h2>
        </div>
        <nav className="sidebar-nav">
          <a href="#" className={`nav-item ${currentPage === 'overview' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); navigate('overview') }}>Overview</a>
          <a href="#" className={`nav-item ${currentPage === 'deployments' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); navigate('deployments') }}>Deployments</a>
          <a href="#" className={`nav-item ${currentPage === 'kubernetes' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); navigate('kubernetes') }}>Kubernetes</a>
          <a href="#" className={`nav-item ${currentPage === 'security' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); navigate('security') }}>Security</a>
          <a href="#" className={`nav-item ${currentPage === 'settings' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); navigate('settings') }}>Settings</a>
        </nav>
      </aside>

      <main className="main-content">
        <header className="header">
          <h1>DeployForge Control Center</h1>
          {error && <div className="error-badge">Connection Error</div>}
        </header>

        {currentPage === 'overview' && (
          <>
            <section className="summary-cards">
              <div className="card">
                <h3>Deployment Health</h3>
                {loading ? (
                  <p className="card-value">Loading...</p>
                ) : error ? (
                  <p className="card-value error">Unavailable</p>
                ) : (
                  <>
                    <p className={`card-value ${k8sData.readyReplicas === k8sData.desiredReplicas ? 'healthy' : 'warning'}`}>
                      {k8sData.readyReplicas === k8sData.desiredReplicas ? 'Healthy' : 'Degraded'}
                    </p>
                    <p className="card-label">{k8sData.readyReplicas}/{k8sData.desiredReplicas} replicas ready</p>
                  </>
                )}
              </div>
              <div className="card">
                <h3>Running Pods</h3>
                {loading ? (
                  <p className="card-value">Loading...</p>
                ) : error ? (
                  <p className="card-value error">-</p>
                ) : (
                  <>
                    <p className="card-value">{k8sData.pods.length}</p>
                    <p className="card-label">{k8sData.pods.filter(p => p.status === 'Running').length} running</p>
                  </>
                )}
              </div>
              <div className="card">
                <h3>Current Image Version</h3>
                {loading ? (
                  <p className="card-value">Loading...</p>
                ) : error ? (
                  <p className="card-value error">-</p>
                ) : (
                  <>
                    <p className="card-value">{getImageShort(k8sData.currentImage)}</p>
                    <p className="card-label">{k8sData.namespace}</p>
                  </>
                )}
              </div>
              <div className="card">
                <h3>Security Findings</h3>
                <p className="card-value warning">Demo Data</p>
                <p className="card-label">Not connected to CI</p>
              </div>
            </section>

            <section className="section">
              <h2>Quick Stats</h2>
              <div className="table-container">
                <table className="table">
                  <tbody>
                    <tr>
                      <td><strong>Namespace</strong></td>
                      <td>{k8sData?.namespace || 'Loading...'}</td>
                    </tr>
                    <tr>
                      <td><strong>Deployment</strong></td>
                      <td>{k8sData?.deploymentName || 'Loading...'}</td>
                    </tr>
                    <tr>
                      <td><strong>Desired Replicas</strong></td>
                      <td>{k8sData?.desiredReplicas || 'Loading...'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {currentPage === 'deployments' && <DeploymentWorkspace
          data={k8sData} selected={selectedVersion} images={availableImages}
          history={history} historyLoading={historyLoading} historyError={historyError}
          verification={verificationResult} verifying={verifying} busy={deploying}
          token={deployToken} setToken={setDeployToken} candidateTag={candidateTag}
          setCandidateTag={setCandidateTag} candidateError={candidateError}
          operation={operation} phase={deployPhase} result={deployResult} error={deployError}
          blockers={commonBlockers} rollbackBlocker={rollbackBlocker} eligibility={rollbackEligibilityLabel}
          preview={showPreview} previewError={previewError} environment={backendConfig?.environment}
          executionReady={executionReady}
          onSelect={value => {
            if (value.startsWith('k8s-')) changeSelectedVersion((history || []).find(h => h.revision === value.replace('k8s-', '')) || null)
            else if (value.startsWith('ghcr-')) changeSelectedVersion(availableImages.find(img => img.id === value.replace('ghcr-', '')) || null)
            else changeSelectedVersion(null)
          }}
          onRefresh={() => { fetchDeploymentConfig(); fetchDeploymentHistory(); fetchKubernetesStatus() }}
          onNew={handleDeployNewVersion} onUseTag={handleUseImageTag} onVerify={handleVerifyImage}
          onPreview={handlePreview} onRequest={handleDeployRequest} formatTimestamp={formatTimestamp}
          onSelectRollback={entry => { changeSelectedVersion(entry); setOperation('rollback'); document.getElementById('version-select')?.focus() }}
        />}

        {currentPage === 'kubernetes' && (
          <>
            <section className="section">
              <h2>Deployment Status</h2>
              {loading && <p className="loading-text">Loading deployment status...</p>}
              {error && <p className="error-text">Failed to load deployment status: {error}</p>}
              {!loading && !error && (
                <div className="table-container">
                  <table className="table">
                    <tbody>
                      <tr>
                        <td><strong>Deployment Name</strong></td>
                        <td>{k8sData.deploymentName}</td>
                      </tr>
                      <tr>
                        <td><strong>Namespace</strong></td>
                        <td>{k8sData.namespace}</td>
                      </tr>
                      <tr>
                        <td><strong>Desired Replicas</strong></td>
                        <td>{k8sData.desiredReplicas}</td>
                      </tr>
                      <tr>
                        <td><strong>Ready Replicas</strong></td>
                        <td>{k8sData.readyReplicas}</td>
                      </tr>
                      <tr>
                        <td><strong>Current Image</strong></td>
                        <td>{k8sData.currentImage}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="section">
              <h2>Kubernetes Pods</h2>
              {loading && <p className="loading-text">Loading pod information...</p>}
              {error && <p className="error-text">Failed to load pod information: {error}</p>}
              {!loading && !error && (
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Pod Name</th>
                        <th>Status</th>
                        <th>Ready</th>
                        <th>Restarts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {k8sData.pods.map((pod, index) => (
                        <tr key={index}>
                          <td>{pod.name}</td>
                          <td><span className={`status ${pod.status === 'Running' ? 'success' : 'warning'}`}>{pod.status}</span></td>
                          <td>{pod.ready}</td>
                          <td>{pod.restarts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {currentPage === 'security' && (
          <section className="section">
            <h2>Security Findings</h2>
            <div className="security-demo">
              <div className="demo-note">
                <strong>⚠️ Demo Mode</strong>
                <p>Security findings are not connected to CI/CD pipeline yet.</p>
                <p>Once integrated, this section will display:</p>
                <ul>
                  <li>Vulnerability scan results from Trivy</li>
                  <li>Container image security analysis</li>
                  <li>Dependency vulnerability reports</li>
                  <li>Security policy compliance status</li>
                </ul>
              </div>
            </div>
          </section>
        )}

        {currentPage === 'settings' && (
          <section className="section">
            <h2>Connection Settings</h2>
            <div className="table-container">
              <table className="table">
                <tbody>
                  <tr>
                    <td><strong>Backend API</strong></td>
                    <td>http://localhost:3001</td>
                  </tr>
                  <tr>
                    <td><strong>Kubernetes Namespace</strong></td>
                    <td>deployforge-gitops</td>
                  </tr>
                  <tr>
                    <td><strong>Deployment Name</strong></td>
                    <td>deployforge</td>
                  </tr>
                  <tr>
                    <td><strong>GHCR Repository</strong></td>
                    <td>ghcr.io/harmohanjeetkaur/deployforge</td>
                  </tr>
                  <tr>
                    <td><strong>Status Refresh Interval</strong></td>
                    <td>10 seconds</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {showDeployConfirm && selectedVersion && (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm GitOps operation">
            <h3>{operation === 'rollback' ? 'Confirm Rollback' : 'Confirm Deployment'}</h3>
            <p>{operation === 'rollback' ? 'Restore this previously deployed image with a new GitOps commit?' : 'Are you sure you want to deploy the following image?'}</p>
            <div className="deploy-confirm-details">
              <div className="deploy-confirm-row">
                <span className="deploy-confirm-label">Current Image:</span>
                <span className="deploy-confirm-value">{k8sData?.currentImage || 'Loading...'}</span>
              </div>
              <div className="deploy-confirm-row">
                <span className="deploy-confirm-label">Target Image:</span>
                <span className="deploy-confirm-value">{selectedVersion.containerImage}</span>
              </div>
            </div>
            <p className="deploy-confirm-warning">
              This will create and push an image-tag commit to origin/main. ArgoCD will reconcile the change to the selected environment. Success requires a healthy rollout.
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={handleCancelDeploy}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleConfirmDeploy}
                disabled={commonBlockers.length > 0 || (operation === 'rollback' && Boolean(rollbackBlocker))}
              >
                {deploying ? 'Working...' : operation === 'rollback' ? 'Confirm Rollback' : 'Confirm Deploy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
