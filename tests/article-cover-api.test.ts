import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BlogDb } from '../db';
const state = vi.hoisted(() => ({ db: undefined as unknown as BlogDb, denied: false }));
vi.mock('../db', () => ({ dbWrite: (run: (db: BlogDb) => unknown) => run(state.db) }));
vi.mock('../src/lib/api', async original => ({ ...await original<object>(), guardManager: async () => state.denied ? new Response('', { status: 403 }) : null }));
import { PUT } from '../src/pages/api/articles/[id]/cover';
let sqlite: InstanceType<typeof Database>;
beforeEach(() => {
  state.denied = false; sqlite = new Database(':memory:'); state.db = drizzle(sqlite) as unknown as BlogDb;
  sqlite.exec("CREATE TABLE articles(id TEXT PRIMARY KEY, cover TEXT, title TEXT, content TEXT, updated_at INTEGER); INSERT INTO articles VALUES('a', '/api/images/old', 'title', 'body', 0)");
});
afterEach(() => sqlite.close());
const request = (body: unknown) => PUT({ request: new Request('https://fixture.test/api/articles/a/cover', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), params: { id: 'a' }, cookies: {} } as unknown as Parameters<typeof PUT>[0]);
describe('article cover partial update', () => {
  it('uploads apply without overwriting title or body; deletion only clears the reference', async () => {
    expect((await request({ url: '/api/images/new', expectedCover: '/api/images/old' })).status).toBe(200);
    expect(sqlite.prepare('SELECT title,content,cover FROM articles').get()).toEqual({ title: 'title', content: 'body', cover: '/api/images/new' });
    expect((await request({ url: '', expectedCover: '/api/images/new' })).status).toBe(200);
    expect(sqlite.prepare('SELECT title,content,cover FROM articles').get()).toEqual({ title: 'title', content: 'body', cover: null });
  });
  it('rejects stale cover changes and preserves the current cover', async () => {
    expect((await request({ url: '/api/images/new', expectedCover: 'stale' })).status).toBe(409);
    expect((sqlite.prepare('SELECT cover FROM articles').get() as { cover: string }).cover).toBe('/api/images/old');
  });
  it('guards the route and refuses external/active URLs', async () => {
    state.denied = true; expect((await request({ url: '', expectedCover: '/api/images/old' })).status).toBe(403);
    state.denied = false;
    for (const url of ['javascript:alert(1)', 'https://example.test/a.png', '/api/images/../../secret']) expect((await request({ url, expectedCover: '/api/images/old' })).status).toBe(400);
  });
});
