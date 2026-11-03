import express from 'express';
import { verifyImageTag } from './registry.js';
import cors from 'cors';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDeployer, enabled, ready, VALUES } from './deployment.js';

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

const NAMESPACE = 'deployforge-gitops';
const DEPLOYMENT_NAME = 'deployforge';
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function executeKubectl(args) {
  try {
    const { stdout } = await execFileAsync('kubectl', args, { timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
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
  live: async () => (await getDeploymentStatus()).currentImage,
  real: REAL_DEPLOYMENT,
  convergence: async (tag, commit) => {
    const deployment = JSON.parse(await executeKubectl(['get', 'deployment', DEPLOYMENT_NAME, '-n', NAMESPACE, '-o', 'json']));
    const argo = JSON.parse(await executeKubectl(['get', 'application', process.env.DEPLOYFORGE_ARGOCD_APP || 'deployforge', '-n', process.env.DEPLOYFORGE_ARGOCD_NAMESPACE || 'argocd', '-o', 'json']));
    return ready(deployment, argo, tag, commit);
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
      restarts: pod.status.containerStatuses?.[0]?.restartCount || 0
    }));

    return {
      deploymentName: DEPLOYMENT_NAME,
      namespace: NAMESPACE,
      desiredReplicas,
      readyReplicas,
      currentImage: containerImage,
      pods
    };
  } catch (error) {
    console.error('Error getting deployment status:', error);
    throw error;
  }
}

async function getDeploymentHistory() {
  try {
    // Get deployment to find current ReplicaSet
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

    // Get all ReplicaSets in the namespace
    const replicaSetsJson = await executeKubectl([
      'get',
      'replicasets',
      '-n',
      NAMESPACE,
      '-o',
      'json'
    ]);
    const replicaSetsData = JSON.parse(replicaSetsJson);

    // Filter ReplicaSets owned by this deployment
    const ownedReplicaSets = replicaSetsData.items.filter(rs => {
      const ownerRefs = rs.metadata.ownerReferences || [];
      return ownerRefs.some(ref =>
        ref.kind === 'Deployment' &&
        ref.name === DEPLOYMENT_NAME
      );
    });

    // Function to compare templates (excluding pod-template-hash)
    const templatesMatch = (deploymentTemplate, replicaSetTemplate) => {
      const depLabels = { ...deploymentTemplate.metadata.labels };
      const rsLabels = { ...replicaSetTemplate.metadata.labels };

      // Remove pod-template-hash from comparison
      delete depLabels['pod-template-hash'];
      delete rsLabels['pod-template-hash'];

      const depTemplateForComparison = {
        metadata: {
          labels: depLabels,
          annotations: deploymentTemplate.metadata.annotations || {}
        },
        spec: deploymentTemplate.spec
      };

      const rsTemplateForComparison = {
        metadata: {
          labels: rsLabels,
          annotations: replicaSetTemplate.metadata.annotations || {}
        },
        spec: replicaSetTemplate.spec
      };

      return JSON.stringify(depTemplateForComparison) === JSON.stringify(rsTemplateForComparison);
    };

    // Build history entries
    const history = ownedReplicaSets.map(rs => {
      const revision = rs.metadata.annotations?.['deployment.kubernetes.io/revision'] || 'unknown';
      const containerImage = rs.spec.template.spec.containers[0]?.image || 'unknown';
      const creationTimestamp = rs.metadata.creationTimestamp;
      const desiredReplicas = rs.spec.replicas || 0;
      const readyReplicas = rs.status.readyReplicas || 0;

      // Compare pod templates to determine current ReplicaSet
      const isCurrent = templatesMatch(deployment.spec.template, rs.spec.template);

      return {
        replicaSetName: rs.metadata.name,
        revision,
        containerImage,
        creationTimestamp,
        desiredReplicas,
        readyReplicas,
        isCurrent
      };
    });

    // Sort by revision number (descending)
    history.sort((a, b) => {
      const revA = parseInt(a.revision) || 0;
      const revB = parseInt(b.revision) || 0;
      return revB - revA;
    });

    return history;
  } catch (error) {
    console.error('Error getting deployment history:', error);
    throw error;
  }
}

app.get('/api/kubernetes/status', async (req, res) => {
  try {
    const status = await getDeploymentStatus();
    res.json(status);
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

app.post('/api/deploy', async (req, res) => {
  try {
    // Check deployment token
    if (!DEPLOY_TOKEN) {
      return res.status(500).json({
        error: 'Server configuration error',
        message: 'Deployment token not configured on server'
      });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Deployment token required'
      });
    }

    const providedToken = authHeader.substring(7); // Remove 'Bearer ' prefix
    if (providedToken !== DEPLOY_TOKEN) {
      console.error('Unauthorized deployment attempt: invalid token');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid deployment token'
      });
    }

    // Server-side Origin check (defense in depth, not authentication)
    const origin = req.headers.origin;
    if (origin !== 'http://localhost:5173') {
      console.error('Rejected deployment request from unexpected origin:', origin);
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Deployment requests are only allowed from the local dashboard'
      });
    }

    const { tag } = req.body || {};

    if (!tag) {
      return res.status(400).json({
        error: 'Tag is required'
      });
    }

    const result = await deployer.request(tag);
    res.status(result.state === 'failed' ? 400 : result.dryRun ? 200 : 202).json(result);
  } catch (error) {
    console.error('Error in /api/deploy:', error);
    res.status(error.statusCode || 500).json({
      error: 'Deployment failed',
      message: error.message
    });
  }
});

app.get('/api/deploy/status/:tag', async (req, res) => {
  try {
    const { tag } = req.params;
    const status = deployer.status;
    if (!status || status.tag !== tag || (req.query.id && req.query.id !== status.id)) return res.status(404).json({ message: 'Deployment job not found; inspect Git and cluster state before retrying' });
    res.json(status);
  } catch (error) {
    console.error('Error in /api/deploy/status:', error);
    res.status(500).json({
      error: 'Failed to check deployment status',
      message: error.message
    });
  }
});

app.get('/api/deploy/config', (req, res) => res.json({ dryRun: !REAL_DEPLOYMENT }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use((error, req, res, next) => {
  if (!error) return next();
  res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid request body', message: 'Send a valid JSON object containing an image tag' });
});

export { app };

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`DeployForge dashboard server running on http://127.0.0.1:${PORT}`);
  });
}
