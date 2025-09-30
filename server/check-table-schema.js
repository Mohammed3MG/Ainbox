const { Pool } = require('pg');
require('dotenv').config();

async function checkTableSchema() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🔍 Checking table schemas...\n');

    // Check meeting_attendees table structure
    const attendeesSchema = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'meeting_attendees'
      ORDER BY ordinal_position
    `);

    console.log('📋 meeting_attendees table structure:');
    if (attendeesSchema.rows.length === 0) {
      console.log('   ❌ Table does not exist or has no columns');
    } else {
      attendeesSchema.rows.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
      });
    }

    // Check calendar_events table structure
    const eventsSchema = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'calendar_events'
      ORDER BY ordinal_position
    `);

    console.log('\n📅 calendar_events table structure:');
    if (eventsSchema.rows.length === 0) {
      console.log('   ❌ Table does not exist or has no columns');
    } else {
      eventsSchema.rows.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
      });
    }

    // Check calendar_invitations table structure
    const invitationsSchema = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'calendar_invitations'
      ORDER BY ordinal_position
    `);

    console.log('\n📨 calendar_invitations table structure:');
    if (invitationsSchema.rows.length === 0) {
      console.log('   ❌ Table does not exist or has no columns');
    } else {
      invitationsSchema.rows.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
      });
    }

    // Check notifications table structure
    const notificationsSchema = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'notifications'
      ORDER BY ordinal_position
    `);

    console.log('\n🔔 notifications table structure:');
    if (notificationsSchema.rows.length === 0) {
      console.log('   ❌ Table does not exist or has no columns');
    } else {
      notificationsSchema.rows.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
      });
    }

    // Check what data currently exists
    console.log('\n📊 Current data:');

    const eventCount = await pool.query('SELECT COUNT(*) as count FROM calendar_events');
    console.log(`   📅 Calendar events: ${eventCount.rows[0].count}`);

    const notificationCount = await pool.query('SELECT COUNT(*) as count FROM notifications');
    console.log(`   🔔 Notifications: ${notificationCount.rows[0].count}`);

    const invitationCount = await pool.query('SELECT COUNT(*) as count FROM calendar_invitations');
    console.log(`   📨 Calendar invitations: ${invitationCount.rows[0].count}`);

    try {
      const attendeeCount = await pool.query('SELECT COUNT(*) as count FROM meeting_attendees');
      console.log(`   📋 Meeting attendees: ${attendeeCount.rows[0].count}`);
    } catch (error) {
      console.log(`   📋 Meeting attendees: Error - ${error.message}`);
    }

  } catch (error) {
    console.error('❌ Error checking schema:', error);
  } finally {
    await pool.end();
  }
}

checkTableSchema().catch(console.error);