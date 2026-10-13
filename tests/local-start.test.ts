import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { parseEnv } from 'node:util';
import { ensureLocalEnvironment, prepareLocal } from '../scripts/start-local.mjs';

const directories: string[] = [];
const fixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'blog local start ')); directories.push(root);
  symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'), 'junction');
  return root;
};
const envText = 'DATABASE_URL=file:./data/blog.db\nADMIN_PASSWORD=my-existing-password\nAUTH_SECRET=existing-session-secret\nPUBLIC_SITE_URL=http://localhost:4321\nCUSTOM=value\n';
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('local startup configuration', () => {
  it('works without an example file and keeps generated credentials stable on later starts', () => {
    const root = fixture(), log = vi.fn();
    const first = ensureLocalEnvironment(root, log), saved = readFileSync(path.join(root, '.env'), 'utf8');
    expect(first.AUTH_SECRET).toMatch(/^[a-f0-9]{64}$/);
    expect(first.ADMIN_PASSWORD).toMatch(/^[a-f0-9]{24}$/);
    expect(ensureLocalEnvironment(root, log)).toEqual(first);
    expect(readFileSync(path.join(root, '.env'), 'utf8')).toBe(saved);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).not.toContain(first.AUTH_SECRET);
  });
  it('uses the example but replaces its placeholder password and blank session secret', () => {
    const root = fixture();
    writeFileSync(path.join(root, '.env.example'), 'ADMIN_PASSWORD=change-me-please\nAUTH_SECRET=\nCUSTOM=keep-this\n');
    const config = ensureLocalEnvironment(root, vi.fn());
    expect(config.ADMIN_PASSWORD).not.toBe('change-me-please');
    expect(config.CUSTOM).toBe('keep-this');
    expect(config.AUTH_SECRET).toHaveLength(64);
  });
  it('preserves complete existing configuration byte for byte', () => {
    const root = fixture(); writeFileSync(path.join(root, '.env'), envText);
    ensureLocalEnvironment(root, vi.fn());
    expect(readFileSync(path.join(root, '.env'), 'utf8')).toBe(envText);
  });
  it('fills blank required values without changing a configured password or custom values', () => {
    const root = fixture(); writeFileSync(path.join(root, '.env'), envText.replace('AUTH_SECRET=existing-session-secret', 'AUTH_SECRET= # missing'));
    const config = ensureLocalEnvironment(root, vi.fn());
    expect(config.AUTH_SECRET).toHaveLength(64);
    expect(config.ADMIN_PASSWORD).toBe('my-existing-password');
    expect(config.CUSTOM).toBe('value');
    expect(parseEnv(readFileSync(path.join(root, '.env'), 'utf8')).AUTH_SECRET).toBe(config.AUTH_SECRET);
  });
});

describe('local database setup', () => {
  it('creates a custom SQLite parent, initializes once, and leaves existing articles unchanged', () => {
    const root = fixture(), file = path.join(root, 'notes', 'custom.db');
    writeFileSync(path.join(root, '.env'), envText.replace('file:./data/blog.db', 'file:./notes/custom.db'));
    const run = vi.fn((_: string, name: string, __: string[], env: Record<string, string>) => {
      expect(env.DATABASE_URL).toBe('file:./notes/custom.db');
      expect(env.DATABASE_URL_FALLBACK).toBe('');
      const db = new Database(file);
      if (name === 'drizzle-kit') db.exec('CREATE TABLE articles(id text PRIMARY KEY, content text)');
      else db.exec("INSERT INTO articles VALUES('keep','original body')");
      db.close();
    });
    prepareLocal(root, { run, log: vi.fn() });
    expect(run.mock.calls.map(call => call[1])).toEqual(['drizzle-kit', 'tsx']);
    prepareLocal(root, { run, log: vi.fn() });
    expect(run).toHaveBeenCalledTimes(2);
    const db = new Database(file); expect(db.prepare('SELECT content FROM articles').get()).toEqual({ content: 'original body' }); db.close();
  });
  it('retries an interrupted seed without pushing the existing schema again', () => {
    const root = fixture(), file = path.join(root, 'data', 'blog.db');
    writeFileSync(path.join(root, '.env'), envText);
    const first = vi.fn((_: string, name: string) => {
      if (name === 'tsx') throw Error('seed interrupted');
      const db = new Database(file); db.exec('CREATE TABLE articles(id text PRIMARY KEY)'); db.close();
    });
    expect(() => prepareLocal(root, { run: first, log: vi.fn() })).toThrow('seed interrupted');
    expect(readdirSync(path.join(root, '.diag'))).toHaveLength(1);
    const retry = vi.fn(); prepareLocal(root, { run: retry, log: vi.fn() });
    expect(retry.mock.calls.map(call => call[1])).toEqual(['tsx']);
    expect(readdirSync(path.join(root, '.diag'))).toHaveLength(0);
  });
  it('stops immediately on schema failure, retaining the retry marker', () => {
    const root = fixture(), run = vi.fn(() => { throw Error('schema failed'); });
    expect(() => prepareLocal(root, { run, log: vi.fn() })).toThrow('schema failed');
    expect(run).toHaveBeenCalledTimes(1);
    expect(readdirSync(path.join(root, '.diag'))).toHaveLength(1);
  });
  it('retries its own incomplete schema, even if a failed push created some tables', () => {
    const root = fixture(), file = path.join(root, 'data', 'blog.db');
    const failed = vi.fn(() => {
      const db = new Database(file); db.exec('CREATE TABLE partial(id text)'); db.close();
      throw Error('partial schema failure');
    });
    expect(() => prepareLocal(root, { run: failed, log: vi.fn() })).toThrow('partial schema failure');
    const retry = vi.fn((_: string, name: string) => {
      if (name !== 'drizzle-kit') return;
      const db = new Database(file); db.exec('CREATE TABLE articles(id text)'); db.close();
    });
    prepareLocal(root, { run: retry, log: vi.fn() });
    expect(retry.mock.calls.map(call => call[1])).toEqual(['drizzle-kit', 'tsx']);
  });
  it('does not schema-push an unrelated existing SQLite database', () => {
    const root = fixture(), run = vi.fn(), file = path.join(root, 'unrelated.db');
    writeFileSync(path.join(root, '.env'), envText.replace('file:./data/blog.db', 'file:./unrelated.db'));
    const db = new Database(file); db.exec("CREATE TABLE private_data(value text); INSERT INTO private_data VALUES('keep')"); db.close();
    expect(() => prepareLocal(root, { run, log: vi.fn() })).toThrow('已有数据库缺少 articles 表');
    expect(run).not.toHaveBeenCalled();
    const after = new Database(file); expect(after.prepare('SELECT value FROM private_data').get()).toEqual({ value: 'keep' }); after.close();
  });
  it('never auto-migrates or seeds a configured PostgreSQL database', () => {
    const root = fixture(), run = vi.fn();
    writeFileSync(path.join(root, '.env'), envText.replace('file:./data/blog.db', 'postgres://unused:unused@127.0.0.1:1/test'));
    prepareLocal(root, { run, log: vi.fn() });
    expect(run).not.toHaveBeenCalled(); expect(existsSync(path.join(root, 'data'))).toBe(false);
  });
});
