/**
 * Seeds the login accounts so you can sign in.
 *
 *   npm run seed
 *
 * Safe to run repeatedly — existing accounts just get their password/role
 * reset (idempotent via ON CONFLICT). Reads DB settings from .env.
 *
 * Creates 1 admin, 3 organizers, 3 managers and 10 staff:
 *   admin01@eventops.com                                       -> password: admin123
 *   organizer01@eventops.com ... organizer03@eventops.com -> password: organizer123
 *   manager01@eventops.com      ... manager03@eventops.com      -> password: manager123
 *   staff01@eventops.com        ... staff10@eventops.com        -> password: staff123
 * Each staff is randomly assigned to one manager (manager_id).
 */
require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcrypt');

const ADMIN_PASSWORD = 'admin123';
const ORGANIZER_PASSWORD = 'organizer123';
const MANAGER_PASSWORD = 'manager123';
const STAFF_PASSWORD = 'staff123';

// Build the roster: 1 admin + 3 organizers + 3 managers + 10 staff
const accounts = [
  { name: 'Admin 01',          email: 'admin01@eventops.com',        role: 'admin',        password: ADMIN_PASSWORD },
  { name: 'Organizer 01',  email: 'organizer01@eventops.com', role: 'organizer', password: ORGANIZER_PASSWORD },
  { name: 'Organizer 02',  email: 'organizer02@eventops.com', role: 'organizer', password: ORGANIZER_PASSWORD },
  { name: 'Organizer 03',  email: 'organizer03@eventops.com', role: 'organizer', password: ORGANIZER_PASSWORD },
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

// Every account needs a 10-digit phone. Assign deterministic ones (0900000001…).
accounts.forEach((a, i) => {
  a.phone = '09' + String(i + 1).padStart(8, '0');
});

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
      `INSERT INTO users (name, email, role, phone, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (email)
       DO UPDATE SET name = EXCLUDED.name,
                     role = EXCLUDED.role,
                     phone = EXCLUDED.phone,
                     password_hash = EXCLUDED.password_hash,
                     is_active = true`,
      [a.name, a.email, a.role, a.phone, hash],
    );
  }

  // Randomly assign each unassigned staff to one manager.
  const { rows: managers } = await client.query(
    `SELECT user_id FROM users WHERE role = 'manager'`,
  );
  if (managers.length > 0) {
    const { rows: staff } = await client.query(
      `SELECT user_id FROM users WHERE role = 'staff' AND manager_id IS NULL`,
    );
    for (const s of staff) {
      const m = managers[Math.floor(Math.random() * managers.length)].user_id;
      await client.query(`UPDATE users SET manager_id = $1 WHERE user_id = $2`, [m, s.user_id]);
    }
  }

  await client.end();

  console.log('\n✅ Seeded accounts:');
  console.log(`   Admin (password "${ADMIN_PASSWORD}"):`);
  accounts.filter((a) => a.role === 'admin').forEach((a) => console.log(`     - ${a.email}`));
  console.log(`   Organizers (password "${ORGANIZER_PASSWORD}"):`);
  accounts.filter((a) => a.role === 'organizer').forEach((a) => console.log(`     - ${a.email}`));
  console.log(`   Managers (password "${MANAGER_PASSWORD}"):`);
  accounts.filter((a) => a.role === 'manager').forEach((a) => console.log(`     - ${a.email}`));
  console.log(`   Staff (password "${STAFF_PASSWORD}", each assigned to a manager):`);
  accounts.filter((a) => a.role === 'staff').forEach((a) => console.log(`     - ${a.email}`));
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ Seeding failed:', err.message);
  console.error('   Is the database running (docker compose up -d) and the schema applied?\n');
  process.exit(1);
});
