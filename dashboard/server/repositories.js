// Operator-reviewed allowlist. Adding an application requires a matching promotion
// adapter, workflow contract, image registry and independently reviewed target.
export const repositories = Object.freeze([
  Object.freeze({ id: 'deployforge', name: 'DeployForge', owner: 'harmohanjeetkaur', repo: 'deployForge',
    image: 'ghcr.io/harmohanjeetkaur/deployforge', workflow: 'ci.yaml', defaultBranch: 'main',
    environment: 'docker-desktop', namespace: 'deployforge-gitops', deployment: 'deployforge',
    adapter: 'deployforge', enabled: true }),
]);
export function approvedRepository(id) {
  const repository = repositories.find(item => item.id === id && item.enabled);
  if (!repository) throw Object.assign(new Error('Repository is not registered for deployment'), { statusCode: 400 });
  return repository;
}
