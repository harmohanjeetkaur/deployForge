export default function StageLink({ title, href, onNavigate, section, hint }) {
  if (href) return <a className="release-step-title" href={href} target="_blank" rel="noopener noreferrer" title={hint}>{title}<span aria-hidden="true">↗</span></a>
  if (section && onNavigate) return <button className="release-step-title" type="button" title={hint} onClick={() => onNavigate('overview', section)}>{title}<span aria-hidden="true">→</span></button>
  return <strong>{title}</strong>
}
