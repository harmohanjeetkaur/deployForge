import { executionState } from './execution-state.js'

export default function ExecutionStatus({ config, error, checkedAt, onRefresh }) {
  const state = executionState(config, error)
  return <section data-testid="execution-status" data-state={state.key}
    className={`execution-status ${state.ready === true ? 'backend-readiness' : 'execution-notice'}`}
    role={state.ready === true ? 'region' : 'alert'} aria-label="Backend execution configuration">
    <div className="execution-status-heading"><strong>{state.label}</strong>
      {onRefresh && <button className="btn btn-secondary" onClick={onRefresh}>Refresh configuration</button>}
    </div>
    {state.ready === true && <p>Execution enabled · {config.environment} · Server authentication {config.authenticationConfigured ? 'configured' : 'missing'}</p>}
    <p>{state.message}</p>
    <small>Server authentication: {config ? config.authenticationConfigured ? 'Configured' : 'Missing' : 'Unknown'} · Last checked: {checkedAt ? new Date(checkedAt).toLocaleTimeString() : 'Waiting for API response'}</small>
  </section>
}
