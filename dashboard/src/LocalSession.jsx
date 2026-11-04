export default function LocalSession({ session, onRefresh, onLogout }) {
  const ready = session.state === 'authorized'
  return <section className="control-panel" aria-label="Local browser connection">
    <div className="panel-heading"><h3>Local browser connection</h3><span className={`health-badge ${ready ? 'good' : 'neutral'}`}>{ready ? 'Connected' : session.state === 'pending' ? 'Approval pending' : 'Disconnected'}</span></div>
    {ready ? <p className="muted-copy">This browser is authorized for local release operations. The session expires automatically and is lost when the backend restarts.</p> : <>
      <p className="muted-copy">Approve this browser once from your local terminal. No credentials need to be copied into the dashboard.</p>
      {session.approvalId && <><p className="field-caption">BROWSER CONNECTION CODE · NOT A SECRET</p><code>{session.approvalId}</code><pre className="command-block">npm run authorize --prefix dashboard/server -- {session.approvalId}</pre></>}
      {session.message && <p className="state-warning">{session.message}</p>}
    </>}
    <button className="btn btn-secondary" onClick={ready ? onLogout : onRefresh}>{ready ? 'Disconnect browser' : 'Refresh connection'}</button>
  </section>
}
