/** Build the inactive portable slot without shutting down the active client. */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquirePortableLock, readPortableProcesses, selectPortableTarget } from './portable-target.mjs';
const root = path.resolve(import.meta.dirname, '..');
const release = path.join(root, 'release');
const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
if (args.length && (args.length !== 2 || args[0] !== '--target')) throw new Error('用法：pnpm run build:portable [--target portable2]');
const requested = args[1] || process.env.BYQX_DESKTOP_BUNDLE_DIR || '';
const lock = acquirePortableLock(release);
try {
  const selected = selectPortableTarget(release, readPortableProcesses(), requested);
  console.log(`[build:portable] 当前空闲目标：release/${selected}；保留正在运行的版本`);
  const env = {...process.env, BYQX_PORTABLE_LOCK_TOKEN: lock.token, BYQX_DESKTOP_BUNDLE_DIR: requested};
  for (const script of ['make-desktop-template.mjs', 'build-desktop.mjs', 'make-desktop-bundle.mjs']) {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {cwd: root, env, stdio: 'inherit', windowsHide: true});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${script} 失败，未完成便携构建（退出码 ${result.status}）`);
  }
} finally { lock.release(); }
