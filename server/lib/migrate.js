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

  // ✅ CALENDAR TABLES ARE NOW PERSISTENT AND WILL NOT BE DROPPED
  // This allows calendar events and notifications to persist across server restarts
  console.log('🔧 Calendar tables preservation mode ACTIVE - tables will NOT be dropped');

  // Now drop the email tables
  await query(`DROP TABLE IF EXISTS sync_events CASCADE;`);
  await query(`DROP TABLE IF EXISTS messages CASCADE;`);
  await query(`DROP TABLE IF EXISTS gmail_mailbox_state CASCADE;`);
  console.log('📧 Dropped email tables');

  // Clean up any leftover type definitions that might be cached
  try {
    await query(`DROP TYPE IF EXISTS gmail_mailbox_state CASCADE;`);
    await query(`DROP TYPE IF EXISTS messages CASCADE;`);
    await query(`DROP TYPE IF EXISTS sync_events CASCADE;`);
    console.log('🧹 Cleaned up type definitions');
  } catch (error) {
    console.log('Type definitions may not exist, continuing...');
  }

  // Check if table exists first to avoid conflicts
  try {
    const { rows: existing } = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'gmail_mailbox_state'
    `);

    if (existing.length === 0) {
      // Create Gmail mailbox state table for real-time sync v2
      try {
        await query(`
          CREATE TABLE gmail_mailbox_state (
            user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            last_history_id TEXT,
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);
        console.log('📧 Created gmail_mailbox_state table');
      } catch (error) {
        if (error.code === '23505') {
          console.log('📧 gmail_mailbox_state type already exists, skipping creation');
        } else {
          console.log('📧 gmail_mailbox_state table may already exist:', error.message);
        }
      }
    } else {
      console.log('📧 gmail_mailbox_state table already exists');
    }
  } catch (error) {
    console.log('📧 Skipping gmail_mailbox_state creation due to system catalog issue:', error.code);
  }

  // Create messages table for email storage if it doesn't exist
  try {
    const { rows: existingMessages } = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'messages'
    `);

    if (existingMessages.length === 0) {
      try {
        await query(`
          CREATE TABLE messages (
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
        await query(`CREATE INDEX idx_messages_user_provider_read ON messages(user_id, provider, is_read);`);
        console.log('📧 Created messages table');
      } catch (error) {
        if (error.code === '23505') {
          console.log('📧 messages type already exists, skipping creation');
        } else {
          console.log('📧 messages table may already exist:', error.message);
        }
      }
    } else {
      console.log('📧 messages table already exists');
    }
  } catch (error) {
    console.log('📧 Skipping messages creation due to system catalog issue:', error.code);
  }

  // Create sync events table for idempotency if it doesn't exist
  try {
    const { rows: existingSyncEvents } = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sync_events'
    `);

    if (existingSyncEvents.length === 0) {
      try {
        await query(`
          CREATE TABLE sync_events (
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            provider   TEXT NOT NULL,
            history_id TEXT NOT NULL,
            message_id TEXT NOT NULL DEFAULT '',
            change     TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, provider, history_id, message_id)
          );
        `);
        console.log('📧 Created sync_events table');
      } catch (error) {
        if (error.code === '23505') {
          console.log('📧 sync_events type already exists, skipping creation');
        } else {
          console.log('📧 sync_events table may already exist:', error.message);
        }
      }
    } else {
      console.log('📧 sync_events table already exists');
    }
  } catch (error) {
    console.log('📧 Skipping sync_events creation due to system catalog issue:', error.code);
  }

  // Run calendar schema setup
  const fs = require('fs');
  const path = require('path');
  try {
    const calendarSchema = fs.readFileSync(path.join(__dirname, '../setup_calendar_db.sql'), 'utf8');
    await query(calendarSchema);
    console.log('📅 Calendar schema created successfully');
  } catch (error) {
    if (error.code === '23505') {
      console.log('📅 Calendar types already exist, schema setup complete');
    } else {
      console.log('📅 Calendar schema may already exist:', error.message);
    }
  }
}

module.exports = { runMigrations };

