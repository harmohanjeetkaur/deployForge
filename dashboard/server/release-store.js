import { mkdir, open, readFile, rename, unlink, lstat, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// One backend per journal. A process lock also covers legacy deploy/rollback.
// Atomic replacement + fsync commits state before an external mutation begins.
export async function openReleaseStore(directory) {
  const dir = resolve(directory);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || info.uid !== process.getuid()) throw new Error('Release state directory must be owner-only (0700)');
  const lock = join(dir, 'backend.lock');
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Serialize stale-lock recovery so two restarting processes cannot unlink
    // each other's newly acquired lock. A crash here fails closed for inspection.
    const recovery = join(dir, 'lock-recovery');
    await mkdir(recovery, { mode: 0o700 });
    try {
      const pid = Number(await readFile(lock, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid release lock; inspect it before recovery');
      try { process.kill(pid, 0); throw new Error('Another backend owns the release journal'); }
      catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
      await unlink(lock);
      handle = await open(lock, 'wx', 0o600);
    } finally { await rmdir(recovery); }
  }
  await handle.writeFile(String(process.pid)); await handle.sync();
  const file = join(dir, 'releases.json');
  let state = { version: 1, releases: [] };
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('Unsafe release journal permissions');
    state = JSON.parse(await readFile(file, 'utf8'));
    if (state.version !== 1 || !Array.isArray(state.releases)) throw new Error('Unsupported release journal');
  } catch (error) { if (error.code !== 'ENOENT') { await handle.close(); await unlink(lock); throw error; } }
  let queue = Promise.resolve();
  return {
    state,
    save() {
      const body = JSON.stringify(state, null, 2);
      const write = async () => {
        const temp = await open(join(dir, 'releases.tmp'), 'w', 0o600);
        try { await temp.writeFile(body); await temp.sync(); } finally { await temp.close(); }
        await rename(join(dir, 'releases.tmp'), file);
        const parent = await open(dir, 'r'); try { await parent.sync(); } finally { await parent.close(); }
      };
      const result = queue.then(write); queue = result.catch(() => {}); return result;
    },
    async close() { await queue; await handle.close(); await unlink(lock); },
  };
}
