/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Restore the local PostgreSQL database from a backup .sql file.
 *
 *   npm run db:restore               # restores the most recent backup
 *   npm run db:restore -- <file.sql> # restores a specific file
 *
 * Backups are created with `--clean`, so this replaces current data with the
 * snapshot's contents.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONTAINER = 'event_ops_db';
const DB = process.env.DB_NAME || 'event_ops';
const USER = process.env.DB_USERNAME || 'postgres';

const dir = path.join(__dirname, 'backups');
let file = process.argv[2];

if (!file) {
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    : [];
  if (!files.length) {
    console.error(`No backups found in ${dir}. Run "npm run db:backup" first.`);
    process.exit(1);
  }
  file = path.join(dir, files[files.length - 1]); // most recent
}
if (!fs.existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

console.log(`Restoring database from: ${file}`);
const fd = fs.openSync(file, 'r');
const proc = spawn(
  'docker',
  ['exec', '-i', CONTAINER, 'psql', '-U', USER, '-d', DB],
  { stdio: [fd, 'inherit', 'inherit'] },
);

proc.on('error', (e) => {
  fs.closeSync(fd);
  console.error(`\n❌ Restore failed: ${e.message}`);
  process.exit(1);
});
proc.on('close', (code) => {
  fs.closeSync(fd);
  if (code === 0) console.log('\n✅ Restore complete.');
  else process.exit(code || 1);
});
