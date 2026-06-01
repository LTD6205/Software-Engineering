/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Dump the local PostgreSQL database (running in the event_ops_db Docker
 * container) to a timestamped .sql file under event-ops-backend/backups/.
 *
 *   npm run db:backup
 *
 * Restore a snapshot with:  npm run db:restore  [path-to-file]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONTAINER = 'event_ops_db';
const DB = process.env.DB_NAME || 'event_ops';
const USER = process.env.DB_USERNAME || 'postgres';

const dir = path.join(__dirname, 'backups');
fs.mkdirSync(dir, { recursive: true });

const d = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const stamp =
  `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
  `-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
const file = path.join(dir, `${DB}_${stamp}.sql`);

const fd = fs.openSync(file, 'w');
// --clean --if-exists makes the dump self-restoring (drops+recreates objects).
const proc = spawn(
  'docker',
  ['exec', CONTAINER, 'pg_dump', '-U', USER, '--clean', '--if-exists', '-d', DB],
  { stdio: ['ignore', fd, 'inherit'] },
);

proc.on('error', (e) => {
  fs.closeSync(fd);
  console.error(`\n❌ Backup failed: ${e.message}`);
  console.error('   Is Docker running and the database container up?');
  process.exit(1);
});
proc.on('close', (code) => {
  fs.closeSync(fd);
  if (code === 0) {
    const kb = (fs.statSync(file).size / 1024).toFixed(1);
    console.log(`\n✅ Backup saved: ${file} (${kb} KB)`);
  } else {
    console.error(`\n❌ Backup failed (exit code ${code}).`);
    process.exit(1);
  }
});
