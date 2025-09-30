const { Pool } = require('pg');
require('dotenv').config();

async function debugUsers() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🔍 Checking users...');

    // Check for specific users
    const usersResult = await pool.query(`
      SELECT id, email, created_at
      FROM users
      WHERE email LIKE '%mustafa%' OR email LIKE '%mohammed%'
      ORDER BY id
    `);

    console.log('\n📧 Users found:');
    usersResult.rows.forEach(user => {
      console.log(`  - ID: ${user.id}, Email: ${user.email}`);
    });

    // Check recent calendar events
    console.log('\n📅 Recent calendar events:');
    const eventsResult = await pool.query(`
      SELECT ce.id, ce.title, ce.organizer_user_id, u.email as organizer_email,
             ce.start_time, ce.end_time, ce.created_at
      FROM calendar_events ce
      JOIN users u ON ce.organizer_user_id = u.id
      ORDER BY ce.created_at DESC
      LIMIT 10
    `);

    eventsResult.rows.forEach(event => {
      console.log(`  - Event: "${event.title}" by ${event.organizer_email} (ID: ${event.organizer_user_id})`);
      console.log(`    Start: ${event.start_time}, Created: ${event.created_at}`);
    });

    // Check calendar invitations
    console.log('\n📨 Recent calendar invitations:');
    const invitationsResult = await pool.query(`
      SELECT ci.id, ci.event_id, ci.attendee_email, ci.status,
             ce.title, u.email as organizer_email, ci.created_at
      FROM calendar_invitations ci
      JOIN calendar_events ce ON ci.event_id = ce.id
      JOIN users u ON ce.organizer_user_id = u.id
      ORDER BY ci.created_at DESC
      LIMIT 10
    `);

    invitationsResult.rows.forEach(inv => {
      console.log(`  - Invitation: "${inv.title}" to ${inv.attendee_email}`);
      console.log(`    From: ${inv.organizer_email}, Status: ${inv.status}, Created: ${inv.created_at}`);
    });

    // Check notifications
    console.log('\n🔔 Recent notifications:');
    const notificationsResult = await pool.query(`
      SELECT n.id, n.user_id, n.type, n.title, n.message, n.read,
             u.email, n.created_at
      FROM notifications n
      JOIN users u ON n.user_id = u.id
      WHERE n.type LIKE '%calendar%' OR n.type LIKE '%meeting%'
      ORDER BY n.created_at DESC
      LIMIT 10
    `);

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

debugUsers().catch(console.error);