import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const PORTABLE_SLOTS = ['portable', 'portable2'];

export function bundlePath(release, name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(name)) throw new Error('便携包目录名不合法');
  const target = path.resolve(release, name);
  if (path.dirname(target) !== path.resolve(release)) throw new Error('便携包目录超出 release');
  return target;
}

export function readPortableProcesses() {
  if (process.platform !== 'win32') throw new Error('便携版运行检测需要 Windows');
  const command = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); @(Get-CimInstance Win32_Process -Filter "Name='白衣卿相.exe'" -ErrorAction Stop | Select-Object ProcessId,ExecutablePath) | ConvertTo-Json -Compress`;
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  }).trim().replace(/^\uFEFF/, '');
  const decoded = raw ? JSON.parse(raw) : [];
  const processes = Array.isArray(decoded) ? decoded : [decoded];
  if (processes.some(p => !p.ExecutablePath)) throw new Error('无法确定部分白衣卿相进程的路径，已停止打包以保护运行中的版本');
  return processes;
}

export function isBundleRunning(release, name, processes) {
  const dir = bundlePath(release, name).replaceAll('\\', '/').toLowerCase() + '/';
  return processes.some(p => {
    const executable = String(p.ExecutablePath || '').replaceAll('\\', '/').toLowerCase();
    return executable.startsWith(dir);
  });
}

export function selectPortableTarget(release, processes, requested = '') {
  if (requested) {
    bundlePath(release, requested);
    if (isBundleRunning(release, requested, processes)) throw new Error(`${requested} 正在运行，不能覆盖；请使用自动选择或另一个空闲目录`);
    return requested;
  }
  const busy = PORTABLE_SLOTS.map(name => isBundleRunning(release, name, processes));
  if (busy.every(Boolean)) throw new Error('便携版和便携版 2 都在运行，当前没有空闲打包目录；现有软件保持运行');
  return busy[0] ? 'portable2' : 'portable';
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

/** One build at a time; the orchestrator can lend its lock to its bundle child. */
export function acquirePortableLock(release) {
  fs.mkdirSync(release, {recursive: true});
  const file = path.join(release, '.portable-build.lock');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      const owner = {pid: process.pid, token: randomUUID()};
      try { fs.writeFileSync(fd, JSON.stringify(owner)); } finally { fs.closeSync(fd); }
      return {token: owner.token, release() {
        try {
          const current = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (current.token === owner.token) fs.unlinkSync(file);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }};
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Number.isSafeInteger(current.pid) || current.pid <= 0) throw new Error('便携构建锁不合法，请检查 release/.portable-build.lock');
      if (alive(current.pid)) {
        if (current.token === process.env.BYQX_PORTABLE_LOCK_TOKEN) return {token: current.token, release() {}};
        throw new Error(`已有便携构建正在运行（PID ${current.pid}），请等待它完成`);
      }
      fs.unlinkSync(file);
    }
  }
  throw new Error('无法取得便携构建锁');
}
