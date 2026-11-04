// Trusted local operator helper. No credential value is placed in arguments or output.
import { readFile, stat } from 'node:fs/promises';
try {
  const path = process.env.HOME + '/.deployforge-secrets/deploy-token';
  const info = await stat(path), directory = await stat(process.env.HOME + '/.deployforge-secrets');
  if (info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || (directory.mode & 0o777) !== 0o700) throw new Error();
  const token = (await readFile(path, 'utf8')).trim();
  if (!token) throw new Error();
  const approvalId = process.argv[2];
  const headers = { Authorization: `Bearer ${token}`, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' };
  const base = 'http://127.0.0.1:3001/api/session';
  if (!approvalId) {
    const response = await fetch(`${base}/pending`, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error();
    const { pending } = await response.json();
    console.log(pending.length ? 'Match the browser connection code, then run npm run authorize -- <code>:\n' + pending.map(p => p.approvalId).join('\n') : 'No pending browser sessions. Open the dashboard first.');
  } else {
    if (!/^[a-f0-9]{8}$/.test(approvalId)) throw new Error();
    const response = await fetch(`${base}/approve`, { method: 'POST', headers, body: JSON.stringify({ approvalId }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error();
    console.log('Local browser session approved. No deployment was requested.');
  }
} catch { console.error('Local session approval failed. Check the private credential, backend, and unexpired browser code.'); process.exitCode = 1; }
