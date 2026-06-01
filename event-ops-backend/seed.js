/**
 * Seeds the login accounts so you can sign in.
 *
 *   npm run seed
 *
 * Safe to run repeatedly — existing accounts just get their password/role
 * reset (idempotent via ON CONFLICT). Reads DB settings from .env.
 *
 * Creates 3 managers and 10 staff:
 *   manager01@eventops.com ... manager03@eventops.com  -> password: manager123
 *   staff01@eventops.com   ... staff10@eventops.com    -> password: staff123
 */
require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcrypt');

const MANAGER_PASSWORD = 'manager123';
const STAFF_PASSWORD = 'staff123';

// Build the roster: 3 managers + 10 staff
const accounts = [
  { name: 'Manager 01', email: 'manager01@eventops.com', role: 'manager', password: MANAGER_PASSWORD },
  { name: 'Manager 02', email: 'manager02@eventops.com', role: 'manager', password: MANAGER_PASSWORD },
  { name: 'Manager 03', email: 'manager03@eventops.com', role: 'manager', password: MANAGER_PASSWORD },
];
for (let i = 1; i <= 10; i++) {
  const n = String(i).padStart(2, '0'); // 01, 02, ... 10
  accounts.push({
    name: `Staff ${n}`,
    email: `staff${n}@eventops.com`,
    role: 'staff',
    password: STAFF_PASSWORD,
  });
}

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'event_ops',
  });

  await client.connect();

  for (const a of accounts) {
    const hash = await bcrypt.hash(a.password, 10);
    await client.query(
      `INSERT INTO users (name, email, role, password_hash, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (email)
       DO UPDATE SET name = EXCLUDED.name,
                     role = EXCLUDED.role,
                     password_hash = EXCLUDED.password_hash,
                     is_active = true`,
      [a.name, a.email, a.role, hash],
    );
  }

  await client.end();

  console.log('\n✅ Seeded accounts:');
  console.log(`   Managers (password "${MANAGER_PASSWORD}"):`);
  accounts.filter((a) => a.role === 'manager').forEach((a) => console.log(`     - ${a.email}`));
  console.log(`   Staff (password "${STAFF_PASSWORD}"):`);
  accounts.filter((a) => a.role === 'staff').forEach((a) => console.log(`     - ${a.email}`));
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ Seeding failed:', err.message);
  console.error('   Is the database running (docker compose up -d) and the schema applied?\n');
  process.exit(1);
});
