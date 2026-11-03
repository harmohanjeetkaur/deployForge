const GHCR_REPO = 'ghcr.io/harmohanjeetkaur/deployforge';
const REGISTRY_TIMEOUT = 10000;
export async function verifyImageTag(tag, fetch = globalThis.fetch) {
  // Validate tag format (40 hex characters)
  const shaPattern = /^[a-f0-9]{40}$/;
  if (!shaPattern.test(tag)) {
    return {
      valid: false,
      exists: false,
      platformsSupported: false,
      error: 'Invalid tag format. Must be a 40-character hexadecimal Git commit SHA.'
    };
  }

  let token = null;

  try {
    // Helper function to fetch manifest with optional token
    const fetchManifest = async (authToken = null) => {
      const imageUrl = `https://ghcr.io/v2/${GHCR_REPO.replace('ghcr.io/', '')}/manifests/${tag}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT);

      const headers = {
        'Accept': 'application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.index.v1+json'
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      try {
        const response = await fetch(imageUrl, { method: 'GET', headers, signal: controller.signal });
        const body = await response.text();
        return { ok: response.ok, status: response.status, headers: response.headers, json: async () => JSON.parse(body) };
      } finally { clearTimeout(timeoutId); }
    };

    // First attempt without authentication
    let response = await fetchManifest();

    // Handle 401 - need to authenticate
    if (response.status === 401) {
      const authHeader = response.headers.get('www-authenticate');
      if (authHeader) {
        // Parse Bearer realm from WWW-Authenticate header
        const bearerMatch = authHeader.match(/Bearer realm="([^"]+)",service="([^"]+)"/);
        if (bearerMatch) {
          const realm = bearerMatch[1];
          const service = bearerMatch[2];

          // Request anonymous token for pull access
          const tokenUrl = `${realm}?service=${service}&scope=repository:${GHCR_REPO.replace('ghcr.io/', '')}:pull`;
          if (realm !== 'https://ghcr.io/token' || service !== 'ghcr.io') throw new Error('Unexpected registry authentication endpoint');
          const tokenResponse = await fetch(tokenUrl, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT) });

          if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json();
            token = tokenData.token;

            // Retry with token
            response = await fetchManifest(token);
          }
        }
      }
    }

    if (response.status === 404) {
      return {
        valid: true,
        exists: false,
        platformsSupported: false,
        error: 'Image not found in registry'
      };
    }

    if (response.status === 401) {
      return {
        valid: true,
        exists: false,
        platformsSupported: false,
        error: 'Authentication required for this image'
      };
    }

    if (response.status === 429) {
      return {
        valid: true,
        exists: false,
        platformsSupported: false,
        error: 'Rate limited by registry'
      };
    }

    if (!response.ok) {
      return {
        valid: true,
        exists: false,
        platformsSupported: false,
        error: `Registry returned status ${response.status}`
      };
    }

    const manifest = await response.json();

    // Check for platform support
    const platforms = [];
    if (manifest.manifests) {
      for (const m of manifest.manifests) {
        const platform = m.platform;
        if (platform && platform.os && platform.architecture) {
          // Skip attestation manifests with unknown/unknown
          if (platform.os !== 'unknown' && platform.architecture !== 'unknown') {
            platforms.push(`${platform.os}/${platform.architecture}`);
          }
        }
      }
    }

    const hasAmd64 = platforms.includes('linux/amd64');
    const hasArm64 = platforms.includes('linux/arm64');
    const bothSupported = hasAmd64 && hasArm64;

    return {
      valid: true,
      exists: true,
      platformsSupported: bothSupported,
      platforms,
      digest: response.headers.get('docker-content-digest') || manifest.digest || null,
      hasAmd64,
      hasArm64
    };

  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return {
        valid: true,
        exists: false,
        platformsSupported: false,
        error: 'Registry request timed out'
      };
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return {
        valid: true,
        exists: false,
        platformsSupported: false,
        error: 'Network error - unable to reach registry'
      };
    }

    return {
      valid: true,
      exists: false,
      platformsSupported: false,
      error: 'Network error - unable to verify image availability'
    };
  }
}
