const { query } = require('./db');

async function runMigrations() {
  // Add terms columns to users if missing
  await query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
  `);

  // Create accounts table if missing
  await query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id UUID PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      email TEXT NOT NULL,
      refresh_token_encrypted TEXT,
      scopes TEXT,
      token_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_user_provider ON accounts(user_id, provider);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);`);
}

module.exports = { runMigrations };

