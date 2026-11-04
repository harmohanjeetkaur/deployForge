import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';

export function createOperationRouter({ deployer, token, real = false, environment = 'docker-desktop', sessions }) {
  const router = Router();
  for (const operation of ['deploy', 'rollback']) router.post(`/${operation}`, async (req, res) => {
    try {
      // Check deployment token
      if (!token) {
        return res.status(500).json({
          error: 'Server configuration error',
          message: 'Deployment token not configured on server'
        });
      }

      const authHeader = req.headers.authorization;
      if (!authHeader && sessions) {
        const rejected = sessions.authorize(req);
        if (rejected) return res.status(rejected.status).json({ error: 'Unauthorized', message: rejected.message });
      } else {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Deployment token required'
        });
      }

      const providedToken = authHeader.substring(7); // Remove 'Bearer ' prefix
      const provided = Buffer.from(providedToken);
      const expected = Buffer.from(token);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        console.error('Unauthorized deployment attempt: invalid token');
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid deployment token'
        });
      }

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

      if (real && req.body.execution !== 'real') return res.status(400).json({ message: 'Explicit real execution intent and target environment are required' });
      if (req.body.execution !== undefined && req.body.execution !== 'real') {
        return res.status(400).json({ message: 'Unknown execution intent' });
      }
      // Tooling can still use the default read-only path. The normal UI explicitly
      // requests real execution and must never receive a successful simulation.
      if (req.body.execution === 'real') {
        if (!real) return res.status(503).json({ message: 'GitOps execution is not enabled. Ask the platform operator to configure deployment execution on the local API.' });
        if (req.body.environment !== environment) return res.status(400).json({ message: 'Target environment does not match the configured Kubernetes context' });
      }

      const result = await deployer.request(tag, operation);
      res.status(result.state === 'failed' ? 400 : result.dryRun ? 200 : 202).json(result);
    } catch (error) {
      if (!error.statusCode || error.statusCode >= 500) console.error(`GitOps ${operation} request failed`);
      res.status(error.statusCode || 500).json({
        error: `${operation === 'rollback' ? 'Rollback' : 'Deployment'} failed`,
        message: error.message
      });
    }
  });

  router.get('/deploy/status/:tag', async (req, res) => {
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

  router.get('/deploy/config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ dryRun: !real, executionEnabled: real, authenticationConfigured: Boolean(token), environment, capabilities: { realRequests: true, rollback: true, localSession: Boolean(sessions) }, latestOperation: deployer.status || null });
  });

  return router;
}
