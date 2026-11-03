export const VALUES = 'helm/deployforge/values.yaml';
export const IMAGE = 'ghcr.io/harmohanjeetkaur/deployforge';
export const enabled = (value) => value === 'true';

// Match only the existing image block; fail closed on ambiguous configuration.
export function helmTag(content, replacement) {
  const blocks = [...content.matchAll(/^image:\s*\n((?:[ \t]+[^\n]*\n|\n)*)/gm)];
  if (blocks.length !== 1) throw new Error('Expected exactly one Helm image block');
  const block = blocks[0][0];
  const tags = [...block.matchAll(/^  tag: "([^"\n]+)"[ \t]*$/gm)];
  if (tags.length !== 1 || !block.includes(`  repository: ${IMAGE}\n`)) {
    throw new Error('Unexpected Helm image configuration');
  }
  return replacement === undefined ? tags[0][1] : content.replace(block, block.replace(tags[0][0], `  tag: "${replacement}"`));
}

export async function validateGit(git, fetchRemote = true) {
  if ((await git(['symbolic-ref', '--short', 'HEAD'])).trim() !== 'main') throw new Error('Deployment requires branch main');
  if ((await git(['status', '--porcelain', '-uno'])).trim()) throw new Error('Tracked or staged changes exist. Preserve and resolve them before deploying.');
  if (fetchRemote) await git(['fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
  const head = (await git(['rev-parse', 'HEAD'])).trim();
  if (head !== (await git(['rev-parse', 'refs/remotes/origin/main'])).trim()) throw new Error('main is not synchronized with origin/main');
  return head;
}

export function ready(deployment, argo, tag, commit) {
  const desired = deployment.spec.replicas ?? 1;
  const s = deployment.status || {};
  return deployment.spec.template.spec.containers.some(c => c.name === 'deployforge' && c.image === `${IMAGE}:${tag}`)
    && desired > 0 && s.observedGeneration >= deployment.metadata.generation
    && s.updatedReplicas === desired && s.readyReplicas === desired
    && s.availableReplicas === desired && s.replicas === desired
    && argo.status?.sync?.status === 'Synced' && argo.status?.sync?.revision === commit
    && argo.status?.health?.status === 'Healthy'
    && argo.status?.operationState?.phase !== 'Running';
}

// Retained history is authoritative; registry-only images cannot be rollback targets.
export function isRollbackCandidate(entry, currentImage) {
  return entry.isCurrent === false
    && /^[1-9][0-9]*$/.test(String(entry.revision))
    && /^[1-9][0-9]*$/.test(String(entry.deploymentRevision))
    && Number.isSafeInteger(Number(entry.revision))
    && Number.isSafeInteger(Number(entry.deploymentRevision))
    && Number(entry.revision) < Number(entry.deploymentRevision)
    && typeof entry.containerImage === 'string'
    && entry.containerImage.startsWith(`${IMAGE}:`)
    && /^[a-f0-9]{40}$/.test(entry.containerImage.slice(IMAGE.length + 1))
    && entry.containerImage !== currentImage;
}

export function createDeployer({ git, read, write, verify, live, history, convergence, real = false,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeout = 300000, now = Date.now }) {
  let active = false;
  let job = null;
  async function run(tag, result) {
    let phase = 'validation';
    const rollback = result.operation === 'rollback';
    const label = rollback ? 'Rollback' : 'Deployment';
    async function validateHistory(currentImage) {
      if (!rollback) return;
      if (!history || !(await history()).some(entry => isRollbackCandidate(entry, currentImage) && entry.containerImage === `${IMAGE}:${tag}`)) {
        throw new Error('Rollback target must be a previous retained deployment revision with a valid GHCR SHA image');
      }
    }
    try {
      if (typeof tag !== 'string' || !/^[a-f0-9]{40}$/.test(tag)) throw new Error('Tag must be a 40-character lowercase hexadecimal SHA');
      const image = await verify(tag);
      if (!image.valid || !image.exists || !image.platformsSupported) throw new Error(image.error || 'Image must exist in GHCR with linux/amd64 and linux/arm64');
      const original = await read();
      const currentTag = helmTag(original);
      const currentImage = await live();
      if (currentTag === tag || currentImage === `${IMAGE}:${tag}`) throw new Error('Target image is already deployed or selected in Helm');
      await validateHistory(currentImage);
      Object.assign(result, { currentTag, currentImage });
      const base = await validateGit(git, real);
      if (!real) return Object.assign(result, { state: 'dry-run', success: true, dryRun: true, currentTag, message: `${label} dry run — no files, commits, pushes or Kubernetes resources changed. Remote synchronization checked against cached origin/main.` });
      // Repeat checks just before writing. Never reset, stash, pull or overwrite on failure.
      if (rollback) await validateHistory(await live());
      if (await validateGit(git) !== base || await read() !== original) throw new Error('Repository changed during validation');
      phase = 'Helm update';
      const updated = helmTag(original, tag);
      await write(updated);
      phase = 'Git commit';
      if ((await git(['symbolic-ref', '--short', 'HEAD'])).trim() !== 'main' || (await git(['rev-parse', 'HEAD'])).trim() !== base || await read() !== updated) throw new Error('Repository changed before commit');
      // --only excludes unrelated staged paths; never stage the entire repository.
      await git(['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', `${rollback ? 'rollback' : 'deploy'}: update image tag to ${tag}`, '--', VALUES]);
      const commit = (await git(['rev-parse', 'HEAD'])).trim();
      result.commit = commit;
      const paths = (await git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit])).trim();
      if (paths !== VALUES || await read() !== updated
        || (await git(['rev-parse', `${commit}^`])).trim() !== base
        || await git(['show', `${commit}:${VALUES}`]) !== updated) {
        throw new Error('Unexpected commit parent or file contents; push refused');
      }
      phase = 'Git push';
      await git(['push', 'origin', `${commit}:refs/heads/main`]);
      result.state = 'in-progress';
      result.message = 'GitOps change pushed; waiting for Kubernetes and ArgoCD';
      phase = 'convergence';
      const deadline = now() + timeout;
      let lastError = '';
      while (now() < deadline) {
        try {
          if (await convergence(tag, commit)) return Object.assign(result, { state: 'succeeded', success: true, message: `${label} succeeded: target image ready and ArgoCD Synced/Healthy` });
          lastError = '';
        } catch (error) { lastError = error.message; }
        await sleep(5000);
      }
      throw new Error(`Timed out waiting for target image and ArgoCD Synced/Healthy${lastError ? `: ${lastError}` : ''}. The pushed change remains; no automatic rollback was performed.`);
    } catch (error) {
      Object.assign(result, { state: 'failed', success: false, message: `${phase} failed: ${error.message}. Local changes and any commit are preserved; inspect repository state before retrying.` });
    } finally { active = false; }
    return result;
  }
  return {
    get status() { return job; },
    async request(tag, operation = 'deploy') {
      if (!['deploy', 'rollback'].includes(operation)) throw Object.assign(new Error('Unknown GitOps operation'), { statusCode: 400 });
      if (active) throw Object.assign(new Error('A deployment is already in progress'), { statusCode: 409 });
      active = true;
      job = { id: crypto.randomUUID(), tag, operation, state: 'requested', dryRun: !real, success: false, message: `${operation === 'rollback' ? 'Rollback' : 'Deployment'} requested` };
      if (!real) return await run(tag, job);
      void run(tag, job);
      return { ...job };
    }
  };
}
