/**
 * Creates the first ADMIN user from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 * in .env. Idempotent — safe to re-run; skips if that email already exists.
 * Run once after `npm run migrate`: node packages/database/seed-admin.js
 */
const { Client } = require("pg");
const bcrypt = require("bcryptjs");

async function main() {
  const { DATABASE_URL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } = process.env;
  if (!DATABASE_URL || !SEED_ADMIN_EMAIL || !SEED_ADMIN_PASSWORD) {
    console.error("DATABASE_URL, SEED_ADMIN_EMAIL, and SEED_ADMIN_PASSWORD must be set.");
    process.exit(1);
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [SEED_ADMIN_EMAIL]);
    if (existing.rows.length > 0) {
      console.log(`Admin user ${SEED_ADMIN_EMAIL} already exists — skipping.`);
      return;
    }

    const passwordHash = await bcrypt.hash(SEED_ADMIN_PASSWORD, 12);
    await client.query(
      `INSERT INTO users (email, password_hash, role, is_active) VALUES ($1, $2, 'ADMIN', true)`,
      [SEED_ADMIN_EMAIL, passwordHash]
    );
    console.log(`Created admin user: ${SEED_ADMIN_EMAIL}. Log in and change the password.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
