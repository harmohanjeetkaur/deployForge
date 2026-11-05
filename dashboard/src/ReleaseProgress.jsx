import StageLink from './StageLink.jsx'
import { argoApplicationUrl } from './stage-links.js'
import { releaseLinks } from './release-links.js'

const stages = [
  { title: 'Tag creation', link: 'tag', hint: 'View the Git tag' },
  { title: 'CI and security', link: 'ci', hint: 'View GitHub Actions' },
  { title: 'Image publication', link: 'image', hint: 'View the GHCR package' },
  { title: 'GitOps promotion', link: 'promotion', hint: 'View the pushed GitOps commit' },
  { title: 'Rollout verification', hint: 'View live workload and ArgoCD health' },
]
const indices = { 'tag-creation': 0, ci: 1, security: 1, 'image-publication': 2,
  'gitops-promotion': 3, 'request-accepted': 3, 'helm-write': 3, 'gitops-commit': 3, 'git-push': 3,
  'argocd-sync': 4, 'kubernetes-rollout': 4, 'health-verification': 4, healthy: 4 }
const failures = { tag: 0, ci: 1, security: 1, image: 2, preflight: 3 }

export default function ReleaseProgress({ release, repository, onNavigate }) {
  const links = releaseLinks(release, repository)
  const healthy = release.state === 'succeeded'
  const failed = release.state === 'failed'
  const review = release.state === 'needs-review'
  const current = failed || review
    ? failures[release.failedStage] ?? indices[release.promotion?.failureStage] ?? indices[release.stage] ?? 3
    : indices[release.stage] ?? ({ 'tag-pending': 0, ci: 1, image: 2, promoting: 3 }[release.state] ?? 0)
  const complete = [current > 0, current > 1, Boolean(release.digest), release.promotion?.pushed === true, healthy]
  const label = healthy ? 'Release healthy' : failed ? 'Release failed' : review ? 'Review required'
    : ['Creating tag', release.run ? 'CI in progress' : 'Waiting for CI', 'Verifying publication', 'Promoting image', 'Verifying rollout'][current]
  return <section className="release-progress" aria-label={`Release progress for ${release.tag}`}>
    <div className="release-card-heading"><h4>Release Progress</h4><span role="status" className={`release-pill ${healthy ? 'is-good' : failed || review ? 'is-failed' : 'is-muted'}`}>{label}</span></div>
    <ol className="progress-steps release-progress-steps" aria-label={`Progress for ${release.tag}`}>
      {stages.map((stage, i) => {
        const problem = (failed || review) && current === i
        const done = !problem && (healthy || complete[i])
        const active = !done && !problem && current === i
        const href = i === 4 ? argoApplicationUrl(import.meta.env.VITE_ARGOCD_URL) : stage.link && (i !== 0 || complete[0] || healthy) ? links[stage.link] : null
        const status = problem ? review ? 'Review required' : 'Failed' : done ? 'Complete'
          : active ? i === 1 && !release.run ? 'Waiting for workflow' : 'In progress' : 'Waiting'
        return <li key={stage.title} className={problem ? 'step-failed' : done ? 'step-complete' : active ? 'step-active' : ''} aria-current={active ? 'step' : undefined}>
          <span className="step-marker" aria-hidden="true">{problem ? '!' : done ? '✓' : i + 1}</span>
          <StageLink title={stage.title} href={href} onNavigate={onNavigate} section={i === 4 ? 'workload-instances' : null} hint={i === 1 && !links.run ? 'Find the tag workflow while its run is discovered' : stage.hint} />
          <small>{status}</small>
        </li>
      })}
    </ol>
  </section>
}
