// One interpretation of the backend contract for every dashboard page.
export function validateExecutionConfig(config) {
  if (!config || typeof config.dryRun !== 'boolean'
    || typeof config.executionEnabled !== 'boolean'
    || typeof config.authenticationConfigured !== 'boolean'
    || typeof config.environment !== 'string' || !config.environment.trim()) {
    throw new Error('Invalid deployment configuration');
  }
  if (config.dryRun === config.executionEnabled) {
    throw new Error('Inconsistent backend execution flags; execution cannot be confirmed');
  }
  return config;
}

export function executionState(config, error) {
  if (!config) return {
    key: 'unavailable', label: 'Execution status unavailable', ready: null,
    message: `Cannot confirm backend readiness: ${error || 'waiting for the local API'}. Refresh configuration to retry.`
  };
  if (!config.executionEnabled) return {
    key: 'disabled', label: 'Real execution disabled', ready: false,
    message: 'Deployment execution unavailable: the backend is running with real execution disabled. Ask your platform operator to approve a controlled test and restart the local backend with DEPLOYFORGE_ENABLE_DEPLOY=true, then refresh configuration. This dashboard will not enable it automatically.'
  };
  if (config.capabilities?.realRequests !== true) return {
    key: 'unsupported', label: 'Execution API incompatible', ready: false,
    message: 'The backend does not confirm support for explicit real GitOps requests. Run compatible backend code, then refresh configuration.'
  };
  return {
    key: 'enabled', label: 'Execution enabled', ready: true,
    message: config.authenticationConfigured
      ? 'The backend confirms real execution is enabled. Image verification, authorization, preview, and confirmation are still required.'
      : 'Real execution is enabled, but server authentication is missing. Configure credentials securely on the backend before submitting an operation.'
  };
}
