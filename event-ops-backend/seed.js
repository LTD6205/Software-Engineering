/**
 * Creates the first manager account so you can log in.
 *
 *   npm run seed
 *
 * Safe to run more than once — it just resets the password if the account
 * already exists. Reads DB settings from .env.
 */
require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcrypt');

const EMAIL = 'manager@eventops.com';
const PASSWORD = 'manager123';

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'event_ops',
  });

  await client.connect();

  const hash = await bcrypt.hash(PASSWORD, 10);
  await client.query(
    `INSERT INTO users (name, email, role, password_hash, is_active)
     VALUES ($1, $2, 'manager', $3, true)
     ON CONFLICT (email)
     DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true`,
    ['Default Manager', EMAIL, hash],
  );

  await client.end();

  console.log('\n✅ Manager account ready. Log in with:');
  console.log(`   email:    ${EMAIL}`);
  console.log(`   password: ${PASSWORD}\n`);
}

main().catch((err) => {
  console.error('\n❌ Seeding failed:', err.message);
  console.error('   Is the database running (docker compose up -d) and the schema applied?\n');
  process.exit(1);
});
