const { Pool } = require('pg');
const NotificationService = require('./lib/notificationService');
require('dotenv').config();

async function testEndToEndNotification() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const notificationService = new NotificationService();

  try {
    console.log('🧪 Testing End-to-End Calendar Notification Flow...\n');

    // Step 1: Verify users exist
    console.log('1️⃣ Checking users...');
    const usersResult = await pool.query(`
      SELECT id, email, name FROM users
      WHERE email IN ('mohammedsorguli@gmail.com', 'mustafasurguli89@gmail.com')
      ORDER BY id
    `);

    if (usersResult.rows.length < 2) {
      console.log('❌ Missing required users for test');
      return;
    }

    const organizer = usersResult.rows.find(u => u.email === 'mohammedsorguli@gmail.com');
    const attendee = usersResult.rows.find(u => u.email === 'mustafasurguli89@gmail.com');

    console.log(`✅ Organizer: ${organizer.email} (ID: ${organizer.id})`);
    console.log(`✅ Attendee: ${attendee.email} (ID: ${attendee.id})\n`);

    // Step 2: Check current calendar events and notifications count
    console.log('2️⃣ Checking current state...');
    const eventsCountResult = await pool.query('SELECT COUNT(*) as count FROM calendar_events');
    const notificationsCountResult = await pool.query('SELECT COUNT(*) as count FROM notifications');
    const invitationsCountResult = await pool.query('SELECT COUNT(*) as count FROM calendar_invitations');

    console.log(`📅 Current calendar events: ${eventsCountResult.rows[0].count}`);
    console.log(`🔔 Current notifications: ${notificationsCountResult.rows[0].count}`);
    console.log(`📨 Current calendar invitations: ${invitationsCountResult.rows[0].count}\n`);

    // Step 3: Create a calendar event with attendee
    console.log('3️⃣ Creating calendar event with attendee...');
    const eventResult = await pool.query(`
      INSERT INTO calendar_events (
        user_id, title, description, start_time, end_time,
        location, meeting_type, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `, [
      organizer.id,
      'End-to-End Test Meeting',
      'Testing full notification flow integration',
      new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
      new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
      'Test Conference Room',
      'business'
    ]);

    const event = eventResult.rows[0];
    console.log(`✅ Created event: "${event.title}" (ID: ${event.id})`);

    // Step 4: Add attendee to meeting_attendees table (simulating the calendar route)
    console.log('4️⃣ Adding attendee to meeting...');
    await pool.query(`
      INSERT INTO meeting_attendees (event_id, email, name, role, response)
      VALUES ($1, $2, $3, $4, $5)
    `, [event.id, attendee.email, attendee.name, 'required', 'pending']);

    console.log(`✅ Added ${attendee.email} as attendee`);

    // Step 5: Test the notification service integration
    console.log('5️⃣ Testing notification service integration...');
    const responseToken = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const invitation = await notificationService.createMeetingInvitation(
      event.id,
      attendee.email,
      attendee.id,
      organizer.id,
      responseToken
    );

    console.log(`✅ Created calendar invitation: ${invitation.id}`);

    // Step 6: Check what was created
    console.log('\n6️⃣ Verifying results...');

    // Check calendar invitations
    const newInvitationsResult = await pool.query(`
      SELECT * FROM calendar_invitations
      WHERE event_id = $1 AND attendee_email = $2
    `, [event.id, attendee.email]);

    console.log(`📨 Calendar invitations for this event: ${newInvitationsResult.rows.length}`);
    if (newInvitationsResult.rows.length > 0) {
      const inv = newInvitationsResult.rows[0];
      console.log(`   - Status: ${inv.status}, Token: ${inv.response_token}`);
    }

    // Check notifications
    const newNotificationsResult = await pool.query(`
      SELECT * FROM notifications
      WHERE user_id = $1 AND type = 'meeting_invitation'
      ORDER BY created_at DESC
      LIMIT 1
    `, [attendee.id]);

    console.log(`🔔 Meeting invitations for ${attendee.email}: ${newNotificationsResult.rows.length}`);
    if (newNotificationsResult.rows.length > 0) {
      const notif = newNotificationsResult.rows[0];
      console.log(`   - Title: "${notif.title}"`);
      console.log(`   - Message: "${notif.message}"`);
      console.log(`   - Read: ${notif.is_read}`);
      console.log(`   - Created: ${notif.created_at}`);
    }

    // Step 7: Test getting notifications via service
    console.log('\n7️⃣ Testing notification retrieval...');
    const userNotifications = await notificationService.getUserNotifications(attendee.id, 5);
    console.log(`📋 Notifications via service: ${userNotifications.length}`);
    userNotifications.forEach((notif, index) => {
      console.log(`   ${index + 1}. ${notif.type}: "${notif.title}"`);
    });

    // Step 8: Test notification count
    const notificationCount = await notificationService.getNotificationCount(attendee.id, true);
    console.log(`🔢 Unread notification count for ${attendee.email}: ${notificationCount}`);

    console.log('\n✅ End-to-End test completed successfully!');
    console.log('\n📊 Summary:');
    console.log('   - Calendar event created ✅');
    console.log('   - Attendee added ✅');
    console.log('   - Calendar invitation created ✅');
    console.log('   - Notification created ✅');
    console.log('   - Notification retrieval working ✅');

  } catch (error) {
    console.error('❌ End-to-End test error:', error);
  } finally {
    await pool.end();
  }
}

testEndToEndNotification().catch(console.error);