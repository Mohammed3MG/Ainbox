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

  // Drop existing V2 tables if they have wrong structure (UUID instead of INTEGER)
  await query(`DROP TABLE IF EXISTS sync_events;`);
  await query(`DROP TABLE IF EXISTS messages;`);
  await query(`DROP TABLE IF EXISTS gmail_mailbox_state;`);

  // Create Gmail mailbox state table for real-time sync v2
  await query(`
    CREATE TABLE IF NOT EXISTS gmail_mailbox_state (
      user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      last_history_id TEXT,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Create messages table for email storage
  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id            BIGSERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider      TEXT NOT NULL CHECK (provider IN ('gmail')),
      message_id    TEXT NOT NULL,
      thread_id     TEXT NOT NULL,
      is_read       BOOLEAN NOT NULL DEFAULT FALSE,
      internal_date BIGINT,
      label_ids     TEXT[] NOT NULL DEFAULT '{}',
      UNIQUE (user_id, provider, message_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_messages_user_provider_read ON messages(user_id, provider, is_read);`);

  // Create sync events table for idempotency
  await query(`
    CREATE TABLE IF NOT EXISTS sync_events (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider   TEXT NOT NULL,
      history_id TEXT NOT NULL,
      message_id TEXT NOT NULL DEFAULT '',
      change     TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, provider, history_id, message_id)
    );
  `);
}

module.exports = { runMigrations };

