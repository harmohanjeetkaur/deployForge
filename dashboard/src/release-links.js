// Construct destinations from the registered repository, never from arbitrary
// URLs in release history. Opening evidence must remain a read-only action.
export function releaseLinks(release, repository) {
  if (!repository || repository.id !== release.repository
    || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(repository.owner || '')
    || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(repository.repo || '')) return {}
  const base = `https://github.com/${repository.owner}/${repository.repo}`
  const tag = typeof release.tag === 'string' && release.tag.length <= 100 ? release.tag : null
  const runId = Number(release.run?.id)
  const run = Number.isSafeInteger(runId) && runId > 0 ? `${base}/actions/runs/${runId}` : null
  const workflow = /^[A-Za-z0-9_.-]+\.ya?ml$/.test(repository.workflow || '')
    ? `${base}/actions/workflows/${encodeURIComponent(repository.workflow)}${tag ? `?${new URLSearchParams({ query: `branch:${tag}` })}` : ''}` : null
  const image = /^ghcr\.io\/([a-z0-9-]+)\/([a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*)$/.exec(repository.image || '')
  return {
    tag: tag ? `${base}/tree/${encodeURIComponent(tag)}` : null,
    source: /^[a-f0-9]{40}$/.test(release.sha || '') ? `${base}/commit/${release.sha}` : null,
    ci: run || workflow,
    run,
    image: image && image[1] === repository.owner.toLowerCase()
      ? `${base}/pkgs/container/${encodeURIComponent(image[2])}` : null,
    promotion: release.promotion?.pushed === true && /^[a-f0-9]{40}$/.test(release.promotion?.commit || '')
      ? `${base}/commit/${release.promotion.commit}` : null,
  }
}
