const { Pool } = require('pg');
require('dotenv').config();

async function debugSchema() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🔍 Checking database schema...');

    // Get calendar_events table structure
    const eventsSchema = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'calendar_events'
      ORDER BY ordinal_position
    `);

    console.log('\n📅 calendar_events table structure:');
    eventsSchema.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
    });

    // Get calendar_invitations table structure
    const invitationsSchema = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'calendar_invitations'
      ORDER BY ordinal_position
    `);

    console.log('\n📨 calendar_invitations table structure:');
    invitationsSchema.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
    });

    // Check recent calendar events with correct columns
    console.log('\n📅 Recent calendar events:');
    const eventsResult = await pool.query(`
      SELECT ce.id, ce.title, ce.user_id, u.email as organizer_email,
             ce.start_time, ce.end_time, ce.created_at
      FROM calendar_events ce
      JOIN users u ON ce.user_id = u.id
      ORDER BY ce.created_at DESC
      LIMIT 5
    `);

    eventsResult.rows.forEach(event => {
      console.log(`  - Event: "${event.title}" by ${event.organizer_email} (User ID: ${event.user_id})`);
      console.log(`    Start: ${event.start_time}, Created: ${event.created_at}`);
    });

    // Check calendar invitations
    console.log('\n📨 Recent calendar invitations:');
    const invitationsResult = await pool.query(`
      SELECT ci.id, ci.event_id, ci.attendee_email, ci.status,
             ce.title, u.email as organizer_email, ci.created_at
      FROM calendar_invitations ci
      JOIN calendar_events ce ON ci.event_id = ce.id
      JOIN users u ON ce.user_id = u.id
      ORDER BY ci.created_at DESC
      LIMIT 5
    `);

    invitationsResult.rows.forEach(inv => {
      console.log(`  - Invitation: "${inv.title}" to ${inv.attendee_email}`);
      console.log(`    From: ${inv.organizer_email}, Status: ${inv.status}, Created: ${inv.created_at}`);
    });

    // Check notifications related to calendar/meetings
    console.log('\n🔔 Recent calendar notifications:');
    const notificationsResult = await pool.query(`
      SELECT n.id, n.user_id, n.type, n.title, n.message, n.read,
             u.email, n.created_at
      FROM notifications n
      JOIN users u ON n.user_id = u.id
      WHERE n.type LIKE '%calendar%' OR n.type LIKE '%meeting%' OR n.type LIKE '%invitation%'
      ORDER BY n.created_at DESC
      LIMIT 5
    `);

    console.log(`Found ${notificationsResult.rows.length} calendar-related notifications:`);
    notificationsResult.rows.forEach(notif => {
      console.log(`  - ${notif.type}: "${notif.title}" to ${notif.email}`);
      console.log(`    Read: ${notif.read}, Created: ${notif.created_at}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

debugSchema().catch(console.error);