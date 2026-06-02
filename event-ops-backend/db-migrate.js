/**
 * Applies every SQL file in ./migrations (in filename order) to the database.
 *
 *   npm run db:migrate
 *
 * Reads DB settings from .env (same as seed.js). Each migration is written to be
 * idempotent, so this is safe to run repeatedly. Use it to upgrade a database
 * that was created from an older version of database_creating.txt.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) {
    console.log('No migrations/ folder — nothing to do.');
    return;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No .sql migrations found — nothing to do.');
    return;
  }

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'event_ops',
  });

  await client.connect();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    process.stdout.write(`→ ${file} ... `);
    // The whole file runs as one implicit transaction (simple query protocol),
    // so a failure rolls the file back rather than leaving it half-applied.
    await client.query(sql);
    console.log('done');
  }

  await client.end();
  console.log(`\n✅ Applied ${files.length} migration(s).`);
}

main().catch((err) => {
  console.error('\n❌ Migration failed:', err.message);
  console.error('   Is the database running and the schema applied?\n');
  process.exit(1);
});
