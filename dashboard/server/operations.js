import { Router } from 'express';

export function createOperationRouter({ deployer, token, real = false }) {
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
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Deployment token required'
        });
      }

      const providedToken = authHeader.substring(7); // Remove 'Bearer ' prefix
      if (providedToken !== token) {
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

  router.get('/deploy/config', (req, res) => res.json({ dryRun: !real }));

  return router;
}
