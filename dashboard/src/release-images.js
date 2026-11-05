// Only registered, CI-approved, registry-verified releases become candidates.
// Publication is independent of whether subsequent GitOps promotion succeeded.
export function releaseImages(releases, repositories) {
  const images = new Map()
  for (const r of releases) {
    const repo = repositories.find(item => item.id === r.repository && item.enabled === true)
    if (repo?.adapter !== 'deployforge' || repo.image !== 'ghcr.io/harmohanjeetkaur/deployforge'
      || !/^[a-f0-9]{40}$/.test(r.sha || '') || !/^sha256:[a-f0-9]{64}$/.test(r.digest || '')
      || r.run?.conclusion !== 'success' || !/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(r.tag || '')) continue
    const image = `${repo.image}:${r.sha}`
    if (images.has(image)) {
      const candidate = images.get(image)
      if (!candidate.tags.includes(r.tag)) candidate.tags.push(r.tag)
      candidate.displayName = `${candidate.tags.join(', ')} · ${r.sha.slice(0, 12)}`
    } else images.set(image, { id: `release-${r.sha}`, containerImage: image, type: 'available', tags: [r.tag], displayName: `${r.tag} · ${r.sha.slice(0, 12)}` })
  }
  return [...images.values()]
}
