const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

async function setupNotificationsDB() {
  console.log('🔔 Setting up notifications database...');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'migrations', '002_create_notifications.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Execute the migration
    await pool.query(migrationSQL);

    console.log('✅ Notifications database setup completed!');
    console.log('📋 Created tables:');
    console.log('   - notifications');
    console.log('   - calendar_invitations');
    console.log('   - notification_preferences');

  } catch (error) {
    console.error('❌ Error setting up notifications database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  setupNotificationsDB().catch(console.error);
}

module.exports = setupNotificationsDB;