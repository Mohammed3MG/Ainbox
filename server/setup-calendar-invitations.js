const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

async function setupCalendarInvitationsIntegration() {
  console.log('📅 Setting up calendar invitations integration...');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'migrations', '003_calendar_invitations_integration.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Execute the migration
    await pool.query(migrationSQL);

    console.log('✅ Calendar invitations integration setup completed!');
    console.log('📋 Enhanced calendar_events table with:');
    console.log('   - created_from_invitation column');
    console.log('   - original_event_id column');
    console.log('   - invitation_response column');
    console.log('   - Added indexes for performance');

  } catch (error) {
    console.error('❌ Error setting up calendar invitations integration:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  setupCalendarInvitationsIntegration().catch(console.error);
}

module.exports = setupCalendarInvitationsIntegration;