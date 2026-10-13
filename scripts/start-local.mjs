/** Local first-run setup and startup. Existing databases are never schema-pushed automatically. */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT = path.resolve(import.meta.dirname, '..');

export function ensureLocalEnvironment(root, log = console.log) {
  const file = path.join(root, '.env'), existed = existsSync(file);
  const template = path.join(root, '.env.example');
  let text = existed ? readFileSync(file, 'utf8') : existsSync(template)
    ? readFileSync(template, 'utf8') : '# 本地配置，由 pnpm start 自动生成\n';
  const values = parseEnv(text.replace(/^\uFEFF/, ''));
  const defaults = { DATABASE_URL: 'file:./data/blog.db', ADMIN_PASSWORD: randomBytes(12).toString('hex'),
    AUTH_SECRET: randomBytes(32).toString('hex'), PUBLIC_SITE_URL: 'http://localhost:4321' };
  let changed = !existed, passwordCreated = false;
  for (const [key, fallback] of Object.entries(defaults)) {
    if (values[key]?.trim() && !(key === 'ADMIN_PASSWORD' && !existed && values[key] === 'change-me-please')) continue;
    const line = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, 'gm');
    if (line.test(text)) text = text.replace(line, `${key}=${fallback}`);
    else text += `${text.endsWith('\n') ? '' : '\n'}${key}=${fallback}\n`;
    values[key] = fallback; changed = true;
    if (key === 'ADMIN_PASSWORD') passwordCreated = true;
  }
  if (changed) writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 });
  if (passwordCreated) log(`[启动] 已生成管理员登录密码：${values.ADMIN_PASSWORD}（保存在 .env 的 ADMIN_PASSWORD）`);
  return values;
}

/**
 * Invoke package bins through Node, avoiding Windows .cmd/shell quoting problems.
 * @returns {void | Promise<void>}
 */
export function runLocalCommand(root, name, args, env) {
  const manifest = path.join(root, 'node_modules', name, 'package.json');
  if (!existsSync(manifest)) throw new Error('缺少依赖，请先运行 pnpm install，再运行 pnpm start。');
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[name];
  if (!bin) throw new Error(`找不到 ${name} 的命令入口。请重新运行 pnpm install。`);
  const commandArgs = [path.resolve(path.dirname(manifest), bin), ...args];
  const options = { cwd: root, env, stdio: 'inherit', windowsHide: true };
  const finish = status => {
    if (status === 0) return;
    const error = new Error(`${name} ${args[0]} 未成功完成；已停止后续步骤，修正上方报错后重新运行即可。`);
    error.exitCode = status ?? 1; throw error;
  };
  // Keep the launcher responsive while the long-running development server runs.
  if (name === 'astro') return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, commandArgs, options);
    child.once('error', reject);
    child.once('exit', status => { try { finish(status); resolve(); } catch (error) { reject(error); } });
  });
  const result = spawnSync(process.execPath, commandArgs, options);
  if (result.error) throw result.error;
  finish(result.status);
}

export function prepareLocal(root = ROOT, { run = runLocalCommand, log = console.log } = {}) {
  const config = ensureLocalEnvironment(root, log);
  const env = { ...process.env, ...config, DESKTOP_MODE: '0' };
  if (/^postgres(?:ql)?:\/\//i.test(config.DATABASE_URL)) {
    log('[启动] 已配置 PostgreSQL，保留现有连接；不自动迁移或写入演示数据。');
    return env;
  }
  const source = config.DATABASE_URL.replace(/^file:/, '');
  if (!source || source === ':memory:' || /^[a-z]+:\/\//i.test(source)) throw new Error('自动初始化需要本地 SQLite 文件路径，请检查 .env 的 DATABASE_URL。');
  const file = path.resolve(root, source);
  const require = createRequire(path.join(root, 'package.json'));
  let tables = [];
  if (existsSync(file)) {
    const Database = require('better-sqlite3');
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try { tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name); }
    finally { db.close(); }
  }
  const stateDir = path.join(root, '.diag');
  const pending = path.join(stateDir, `local-setup-${createHash('sha256').update(file).digest('hex')}.pending`);
  const phase = existsSync(pending) ? readFileSync(pending, 'utf8').trim() : '';
  if (tables.length && !tables.includes('articles') && phase !== 'schema') throw new Error('已有数据库缺少 articles 表，未自动修改。请核对数据库路径和结构后重试。');
  const initialize = tables.length === 0 || phase === 'schema';
  if (initialize || existsSync(pending)) {
    mkdirSync(path.dirname(file), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(pending, initialize ? 'schema\n' : 'seed\n');
    // Setup only writes to this SQLite database, never an inherited cloud fallback.
    const localEnv = { ...env, DATABASE_URL_FALLBACK: '' };
    if (initialize) {
      log('[启动] 首次初始化本地 SQLite 数据库…');
      run(root, 'drizzle-kit', ['push', '--config=drizzle.config.sqlite.ts', '--force'], localEnv);
      writeFileSync(pending, 'seed\n');
    }
    log('[启动] 写入演示文章（已存在的文章跳过）…');
    run(root, 'tsx', ['db/seed.ts'], localEnv);
    unlinkSync(pending);
  } else log('[启动] 使用已有数据库，跳过初始化和演示数据。');
  return env;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const env = prepareLocal();
    if (process.argv.includes('--setup')) console.log('[启动] 配置与数据库已准备好，运行 pnpm start 即可启动网站。');
    else await runLocalCommand(ROOT, 'astro', ['dev', ...process.argv.slice(2)], env);
  } catch (error) {
    console.error(`[启动失败] ${error.message}`);
    process.exitCode = error.exitCode || 1;
  }
}
