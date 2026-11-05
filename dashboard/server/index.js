import { monitoringStatus } from './monitoring.js';
import { openReleaseStore } from './release-store.js';
import { createGitHub } from './github.js';
import { createReleaseService, createReleaseRouter } from './releases.js';
import express from 'express';
import { createLocalSessions } from './local-session.js';
import { argoSummary } from './cluster-view.js';
import { createOperationRouter } from './operations.js';
import { buildDeploymentHistory } from './history.js';
import { verifyImageTag } from './registry.js';
import cors from 'cors';
import { execFile } from 'child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'util';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDeployer, enabled, convergenceStatus, validateGit, VALUES } from './deployment.js';

const execFileAsync = promisify(execFile);
const app = express();
const PORT = 3001;
const REAL_DEPLOYMENT = enabled(process.env.DEPLOYFORGE_ENABLE_DEPLOY);

// Deployment token from environment variable
const DEPLOY_TOKEN = process.env.DEPLOYFORGE_DEPLOY_TOKEN;

if (!DEPLOY_TOKEN) {
  console.warn('WARNING: DEPLOYFORGE_DEPLOY_TOKEN environment variable not set. Deployment endpoint will reject all requests.');
  console.warn('Set it with: export DEPLOYFORGE_DEPLOY_TOKEN=<your-token>');
}

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

app.get('/api/monitoring/status', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await monitoringStatus());
});


const NAMESPACE = 'deployforge-gitops';
const DEPLOYMENT_NAME = 'deployforge';
const KUBE_CONTEXT = process.env.DEPLOYFORGE_KUBE_CONTEXT || 'docker-desktop';
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function executeKubectl(args) {
  try {
    const { stdout } = await execFileAsync('kubectl', ['--context', KUBE_CONTEXT, ...args], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch {
    throw new Error('kubectl read failed or timed out; check local context, permissions and resource names');
  }
}

async function executeGit(args, cwd = PROJECT_ROOT) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd, timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    return stdout;
  } catch {
    // Do not return stderr: remotes and credential helpers may include secrets.
    throw new Error(`git ${args.includes('push') ? 'push' : args.includes('commit') ? 'commit' : args[0]} failed or timed out. Check remote access, branch synchronization and Git identity locally.`);
  }
}

const deployer = createDeployer({
  git: executeGit,
  read: () => readFile(`${PROJECT_ROOT}/${VALUES}`, 'utf8'),
  write: content => writeFile(`${PROJECT_ROOT}/${VALUES}`, content, 'utf8'),
  verify: verifyImageTag,
  history: getDeploymentHistory,
  live: async () => (await getDeploymentStatus()).currentImage,
  real: REAL_DEPLOYMENT,
  convergence: async (tag, commit) => {
    const deployment = JSON.parse(await executeKubectl(['get', 'deployment', DEPLOYMENT_NAME, '-n', NAMESPACE, '-o', 'json']));
    const argo = JSON.parse(await executeKubectl(['get', 'application', process.env.DEPLOYFORGE_ARGOCD_APP || 'deployforge', '-n', process.env.DEPLOYFORGE_ARGOCD_NAMESPACE || 'argocd', '-o', 'json']));
    return convergenceStatus(deployment, argo, tag, commit);
  }
});

async function getDeploymentStatus() {
  try {
    // Get deployment info
    const deploymentJson = await executeKubectl([
      'get',
      'deployment',
      DEPLOYMENT_NAME,
      '-n',
      NAMESPACE,
      '-o',
      'json'
    ]);
    const deployment = JSON.parse(deploymentJson);

    const desiredReplicas = deployment.spec.replicas || 0;
    const readyReplicas = deployment.status.readyReplicas || 0;
    const containerImage = deployment.spec.template.spec.containers[0]?.image || 'unknown';

    // Get pods
    const podsJson = await executeKubectl([
      'get',
      'pods',
      '-n',
      NAMESPACE,
      '-l',
      `app.kubernetes.io/name=${DEPLOYMENT_NAME}`,
      '-o',
      'json'
    ]);
    const podsData = JSON.parse(podsJson);

    const pods = podsData.items.map(pod => ({
      name: pod.metadata.name,
      status: pod.status.phase,
      ready: `${pod.status.containerStatuses?.[0]?.ready ? '1' : '0'}/1`,
      restarts: pod.status.containerStatuses?.[0]?.restartCount || 0,
      node: pod.spec.nodeName || null,
      reason: pod.status.containerStatuses?.[0]?.state?.waiting?.reason || pod.status.containerStatuses?.[0]?.state?.terminated?.reason || null
    }));

    return {
      deploymentName: DEPLOYMENT_NAME,
      namespace: NAMESPACE,
      desiredReplicas,
      readyReplicas,
      updatedReplicas: deployment.status.updatedReplicas ?? 0,
      availableReplicas: deployment.status.availableReplicas ?? 0,
      revision: deployment.metadata.annotations?.['deployment.kubernetes.io/revision'] || null,
      conditions: (deployment.status.conditions || []).map(({ type, status, reason }) => ({ type, status, reason })),
      currentImage: containerImage,
      pods
    };
  } catch (error) {
    console.error('Error getting deployment status:', error);
    throw error;
  }
}

async function getDeploymentHistory() {
  const deployment = JSON.parse(await executeKubectl([
    'get', 'deployment', DEPLOYMENT_NAME, '-n', NAMESPACE, '-o', 'json'
  ]));
  const replicaSets = JSON.parse(await executeKubectl([
    'get', 'replicasets', '-n', NAMESPACE, '-o', 'json'
  ]));
  return buildDeploymentHistory(deployment, replicaSets.items);
}

app.get('/api/kubernetes/status', async (req, res) => {
  try {
    const status = await getDeploymentStatus();
    // Optional ArgoCD metadata must not hide otherwise available workload data.
    const name = process.env.DEPLOYFORGE_ARGOCD_APP || 'deployforge';
    let argo = null;
    try { argo = argoSummary(JSON.parse(await executeKubectl(['get', 'application', name, '-n', process.env.DEPLOYFORGE_ARGOCD_NAMESPACE || 'argocd', '-o', 'json'])), name); } catch { /* rendered as unavailable */ }
    res.set('Cache-Control', 'no-store');
    res.json({ ...status, argo });
  } catch (error) {
    console.error('Error in /api/kubernetes/status:', error);
    res.status(500).json({
      error: 'Failed to get Kubernetes status',
      message: error.message
    });
  }
});

app.get('/api/kubernetes/history', async (req, res) => {
  try {
    const history = await getDeploymentHistory();
    res.json(history);
  } catch (error) {
    console.error('Error in /api/kubernetes/history:', error);
    res.status(500).json({
      error: 'Failed to get deployment history',
      message: error.message
    });
  }
});

app.get('/api/images/verify/:tag', async (req, res) => {
  try {
    const { tag } = req.params;
    const result = await verifyImageTag(tag);
    res.json(result);
  } catch (error) {
    console.error('Error in /api/images/verify:', error);
    res.status(500).json({
      error: 'Failed to verify image',
      message: error.message
    });
  }
});

const sessions = createLocalSessions({ token: DEPLOY_TOKEN });
app.use('/api', sessions.router);
let releaseService;
app.use('/api', createOperationRouter({ deployer, token: DEPLOY_TOKEN, sessions, real: REAL_DEPLOYMENT, environment: KUBE_CONTEXT, releaseBusy: () => Boolean(releaseService?.busy) }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use((error, req, res, next) => {
  if (!error) return next();
  res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid request body', message: 'Send a valid JSON object containing an image tag' });
});

export { app };

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  const store = await openReleaseStore(process.env.DEPLOYFORGE_STATE_DIR || `${PROJECT_ROOT}/.deployforge-state`);
  // No credential files are read. Both switches and server credentials are mandatory.
  const workflowDigest = createHash('sha256').update(await readFile(`${PROJECT_ROOT}/.github/workflows/ci.yaml`)).digest('hex');
  const github = createGitHub({ token: process.env.DEPLOYFORGE_GITHUB_TOKEN, workflowDigest });
  releaseService = createReleaseService({ store, github, verify: tag => verifyImageTag(tag, fetch, true), deployer,
    preflight: async repository => {
      if (repository.adapter !== 'deployforge' || repository.environment !== KUBE_CONTEXT) throw new Error('Registered promotion adapter or target mismatch');
      await validateGit(executeGit);
      await getDeploymentStatus();
    },
    enabled: REAL_DEPLOYMENT && enabled(process.env.DEPLOYFORGE_ENABLE_RELEASE) && Boolean(DEPLOY_TOKEN) && Boolean(process.env.DEPLOYFORGE_GITHUB_TOKEN) && KUBE_CONTEXT === 'docker-desktop',
    observe: async (tag, commit) => {
      const remote = await executeGit(['ls-remote', 'origin', 'refs/heads/main']);
      if (remote.split(/\s/)[0] !== commit) return { healthy: false, failure: 'Remote Git revision differs; operator review required' };
      const deployment = JSON.parse(await executeKubectl(['get', 'deployment', DEPLOYMENT_NAME, '-n', NAMESPACE, '-o', 'json']));
      const argo = JSON.parse(await executeKubectl(['get', 'application', process.env.DEPLOYFORGE_ARGOCD_APP || 'deployforge', '-n', process.env.DEPLOYFORGE_ARGOCD_NAMESPACE || 'argocd', '-o', 'json']));
      return convergenceStatus(deployment, argo, tag, commit);
    },
  });
  // Mounted after the error handler; router owns its async error responses.
  app.use('/api', createReleaseRouter({ service: releaseService, github, token: DEPLOY_TOKEN, sessions }));
  const releaseTimer = setInterval(() => { releaseService.tick().catch(() => { console.error('Release journal unavailable; execution paused'); clearInterval(releaseTimer); }); }, 10000);
  releaseTimer.unref();
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`DeployForge dashboard server running on http://127.0.0.1:${PORT}`);
  });
}
