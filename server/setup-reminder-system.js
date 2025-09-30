const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

async function setupReminderSystem() {
  console.log('🔔 Setting up reminder system...');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'migrations', '004_reminder_system.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Execute the migration
    await pool.query(migrationSQL);

    console.log('✅ Reminder system setup completed!');
    console.log('📋 Created reminder_log table and updated notification_preferences');
    console.log('🔔 Reminder service is ready to track and send automated reminders');

  } catch (error) {
    console.error('❌ Error setting up reminder system:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  setupReminderSystem().catch(console.error);
}

module.exports = setupReminderSystem;