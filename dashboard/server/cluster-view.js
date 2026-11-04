// Read-only presentation metadata; never used to decide or execute a release.
export function argoSummary(application, name) {
  return {
    application: name,
    sync: application.status?.sync?.status || 'Unknown',
    health: application.status?.health?.status || 'Unknown',
    revision: application.status?.sync?.revision || null,
    operation: application.status?.operationState?.phase || null,
    conditions: (application.status?.conditions || []).map(({ type }) => ({ type }))
  };
}
