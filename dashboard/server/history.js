import { isDeepStrictEqual } from 'node:util';
import { isRollbackCandidate } from './deployment.js';

export function buildDeploymentHistory(deployment, replicaSets) {
  const name = deployment.metadata.name;
  const currentImage = deployment.spec.template.spec.containers.find(c => c.name === name)?.image;
  const normalize = template => {
    const labels = { ...template.metadata?.labels };
    delete labels['pod-template-hash'];
    return { labels, annotations: template.metadata?.annotations || {}, spec: template.spec };
  };
  return replicaSets.filter(rs => (rs.metadata.ownerReferences || []).some(ref =>
    ref.kind === 'Deployment' && ref.name === name && ref.uid === deployment.metadata.uid
  )).map(rs => {
    const entry = {
      deploymentRevision: deployment.metadata.annotations?.['deployment.kubernetes.io/revision'] || 'unknown',
      replicaSetName: rs.metadata.name,
      revision: rs.metadata.annotations?.['deployment.kubernetes.io/revision'] || 'unknown',
      containerImage: rs.spec.template.spec.containers.find(c => c.name === name)?.image || 'unknown',
      creationTimestamp: rs.metadata.creationTimestamp,
      desiredReplicas: rs.spec.replicas || 0,
      readyReplicas: rs.status?.readyReplicas || 0,
      isCurrent: isDeepStrictEqual(normalize(deployment.spec.template), normalize(rs.spec.template))
    };
    return { ...entry, rollbackEligible: isRollbackCandidate(entry, currentImage) };
  }).sort((a, b) => (parseInt(b.revision) || 0) - (parseInt(a.revision) || 0));
}
