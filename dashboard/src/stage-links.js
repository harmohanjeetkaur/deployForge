export function argoApplicationUrl(base, application = 'deployforge') {
  if (!base) return null
  try {
    const url = new URL(base)
    if (url.username || url.password || url.search || url.hash) return null
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null
    return `${url.href.replace(/\/$/, '')}/applications/argocd/${encodeURIComponent(application)}`
  } catch { return null }
}
export function deploymentStageLinks(job) {
  const base = 'https://github.com/harmohanjeetkaur/deployForge'
  return {
    request: job?.id && /^[A-Za-z0-9-]{1,100}$/.test(job.id) && /^[a-f0-9]{40}$/.test(job.tag || '')
      ? `/api/deploy/status/${job.tag}?${new URLSearchParams({ id: job.id })}` : null,
    commit: job?.pushed === true && /^[a-f0-9]{40}$/.test(job.commit || '') ? `${base}/commit/${job.commit}` : null,
  }
}
