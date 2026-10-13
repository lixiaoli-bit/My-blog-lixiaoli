const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
/** New installations can start offline, with a unique local owner identity. */
function loadDesktopConfig(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file)) return { config: JSON.parse(readFileSync(file, 'utf8')), firstRun: false };
  const config = {
    ADMIN_PASSWORD: randomBytes(32).toString('base64url'), AUTH_SECRET: randomBytes(32).toString('base64url'),
    LOCAL_OWNER_AUTO_LOGIN: true, SYNC_DATABASE_URL: '', SYNC_DATABASE_URL_FALLBACK: '',
    R2_ACCOUNT_ID: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET: '', R2_PUBLIC_BASE_URL: '', R2_S3_ENDPOINT: '',
    TOP_ADMIN_PASSWORD: '', PORT: '43217',
  };
  writeFileSync(file, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
  return { config, firstRun: true };
}
module.exports = { loadDesktopConfig };
