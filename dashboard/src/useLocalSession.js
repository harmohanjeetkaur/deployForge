import { useEffect, useRef, useState } from 'react'

export default function useLocalSession() {
  const [session, setSession] = useState({ state: 'loading' })
  const requestRef = useRef(0)
  async function refresh() {
    const id = ++requestRef.current
    try {
      const options = { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) }
      let response = await fetch('/api/session', options)
      if (!response.ok) throw new Error('Local sessions are unavailable. The backend needs the session-enabled code.')
      let data = await response.json()
      if (id !== requestRef.current) return
      if (data.state === 'none') {
        response = await fetch('/api/session/request', { ...options, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        if (!response.ok) throw new Error('Could not establish a local browser connection')
        data = await response.json()
      }
      if (!['pending', 'authorized'].includes(data.state) || (data.state === 'authorized' && !data.csrf) || (data.state === 'pending' && !/^[a-f0-9]{8}$/.test(data.approvalId))) throw new Error('Invalid local session response')
      if (id === requestRef.current) setSession(data)
    } catch (error) { if (id === requestRef.current) setSession({ state: 'unavailable', message: error.message }) }
  }
  useEffect(() => {
    const start = setTimeout(refresh, 0)
    const timer = setInterval(refresh, 5000)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    const ref = requestRef
    return () => { ref.current++; clearTimeout(start); clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [])
  const reject = () => { requestRef.current++; setSession({ state: 'unavailable', message: 'Local session rejected. Reconnect in Settings.' }) }
  async function logout() {
    try {
      const response = await fetch('/api/session/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf || '' }, body: '{}' })
      if (!response.ok) throw new Error()
      setSession({ state: 'unavailable', message: 'Local session disconnected. Reconnect when ready.' })
    } catch { reject() }
  }
  return { session, refresh, reject, logout }
}
