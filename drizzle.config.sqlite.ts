/**
 * Drizzle Kit 配置 —— SQLite（开发环境）
 *
 * 用法：pnpm db:push:dev（推送 schema 到本地库）
 */
import { defineConfig } from 'drizzle-kit';
import { isPostgresUrl, readDatabaseUrl } from './db/dialect';

const url = readDatabaseUrl();
if (isPostgresUrl(url)) throw new Error('db:push:dev 仅用于 SQLite。PostgreSQL 请使用 db:migrate:pg。');

export default defineConfig({
  dialect: 'sqlite',
  schema: './db/schema.sqlite.ts',
  out: './db/migrations/sqlite',
  dbCredentials: {
    url,
  },
  verbose: true,
  strict: true,
});
