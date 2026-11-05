const digest = /^sha256:[a-f0-9]{64}$/;
const text = (value, limit = 300) => typeof value === 'string' ? value.slice(0, limit) : '';
export function securitySummary(repository, release, artifacts) {
  const platforms = ['amd64', 'arm64'].map(arch => {
    const item = artifacts.find(a => a.arch === arch);
    if (item?.status !== 'available') return { arch, status: 'unavailable', policy: 'unknown', findings: [], message: 'Report missing or expired' };
    const report = item.report;
    const expected = `${repository.image}:${release.sha}-${release.run.id}-${release.run.attempt}-${arch}`;
    if (report?.SchemaVersion !== 2 || report.ArtifactType !== 'container_image' || report.ArtifactName !== expected || !Array.isArray(report.Results)
      || (report.Metadata?.ImageConfig?.architecture && report.Metadata.ImageConfig.architecture !== arch)) throw new Error('Invalid security report identity or schema');
    const findings = [];
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
    for (const result of report.Results) {
      if (result.Vulnerabilities !== undefined && !Array.isArray(result.Vulnerabilities)) throw new Error('Invalid vulnerability list');
      for (const v of result.Vulnerabilities || []) {
        const severity = Object.hasOwn(counts, v.Severity) ? v.Severity : 'UNKNOWN';
        counts[severity]++;
        if (findings.length < 500) findings.push({ id: text(v.VulnerabilityID), package: text(v.PkgName), installed: text(v.InstalledVersion), fixed: text(v.FixedVersion), severity, title: text(v.Title), target: text(result.Target) });
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { arch, status: 'available', policy: counts.HIGH + counts.CRITICAL ? 'failed' : item.scanConclusion === 'success' ? 'passed' : 'unknown', counts, total, findings, truncated: total > findings.length,
      scannedAt: typeof report.CreatedAt === 'string' && Number.isFinite(Date.parse(report.CreatedAt)) ? report.CreatedAt : null,
      image: expected, imageId: digest.test(report.Metadata?.ImageID || '') ? report.Metadata.ImageID : null };
  });
  return { repository: repository.id, tag: release.tag, sha: release.sha,
    digest: digest.test(release.digest || '') ? release.digest : null,
    run: { id: release.run.id, attempt: release.run.attempt, url: `https://github.com/${repository.owner}/${repository.repo}/actions/runs/${release.run.id}/attempts/${release.run.attempt}` },
    policy: platforms.some(p => p.policy === 'failed') ? 'failed' : platforms.every(p => p.policy === 'passed') ? 'passed' : 'unknown', platforms,
    scope: 'Reports include findings retained by CI; the blocking threshold is HIGH/CRITICAL, including unfixed vulnerabilities.' };
}
