const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function clearTestData() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('🧹 Clearing test data...');

    // Clear notifications
    const notifResult = await client.query('DELETE FROM notifications');
    console.log(`✓ Cleared ${notifResult.rowCount} notifications`);

    // Clear calendar invitations
    const inviteResult = await client.query('DELETE FROM calendar_invitations');
    console.log(`✓ Cleared ${inviteResult.rowCount} calendar invitations`);

    // Clear meeting attendees
    const attendeeResult = await client.query('DELETE FROM meeting_attendees');
    console.log(`✓ Cleared ${attendeeResult.rowCount} meeting attendees`);

    // Clear room bookings (if any)
    const roomResult = await client.query('DELETE FROM room_bookings');
    console.log(`✓ Cleared ${roomResult.rowCount} room bookings`);

    // Clear calendar events
    const eventResult = await client.query('DELETE FROM calendar_events');
    console.log(`✓ Cleared ${eventResult.rowCount} calendar events`);

    await client.query('COMMIT');
    console.log('\n✅ All test data cleared successfully!');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error clearing test data:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

clearTestData().catch(console.error);