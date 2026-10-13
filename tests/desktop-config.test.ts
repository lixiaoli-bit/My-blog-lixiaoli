import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { loadDesktopConfig } = createRequire(import.meta.url)('../desktop/config.cjs');
describe('offline first desktop setup', () => {
  it('creates persistent unique local credentials without a cloud requirement', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'desktop-config-test-'));
    try {
      const file = path.join(dir, 'config.json');
      const first = loadDesktopConfig(file);
      expect(first.firstRun).toBe(true);
      expect(first.config.SYNC_DATABASE_URL).toBe('');
      expect(first.config.LOCAL_OWNER_AUTO_LOGIN).toBe(true);
      expect(first.config.ADMIN_PASSWORD.length).toBeGreaterThanOrEqual(32);
      expect(first.config.AUTH_SECRET).not.toBe(first.config.ADMIN_PASSWORD);
      expect(loadDesktopConfig(file)).toEqual({ config: first.config, firstRun: false });
    } finally { rmSync(dir, { recursive: true }); }
  });
  it('preserves existing settings and never opts existing users into auto login', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'desktop-config-test-'));
    try {
      const file = path.join(dir, 'config.json');
      const config = { ADMIN_PASSWORD: 'old-local', SYNC_DATABASE_URL: 'postgresql://fixture:fixture@localhost/db', LOCAL_DB_PATH: 'existing.db' };
      writeFileSync(file, JSON.stringify(config));
      const original = readFileSync(file, 'utf8');
      expect(loadDesktopConfig(file)).toEqual({ config, firstRun: false });
      expect(readFileSync(file, 'utf8')).toBe(original);
    } finally { rmSync(dir, { recursive: true }); }
  });
  it('reports invalid config without replacing it or its credentials', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'desktop-config-test-'));
    try {
      const file = path.join(dir, 'config.json'); writeFileSync(file, '{invalid');
      expect(() => loadDesktopConfig(file)).toThrow();
      expect(readFileSync(file, 'utf8')).toBe('{invalid');
    } finally { rmSync(dir, { recursive: true }); }
  });
});
