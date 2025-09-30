const { Pool } = require('pg');
const NotificationService = require('./lib/notificationService');
const EmailService = require('./lib/emailService');
require('dotenv').config();

async function testDirectNotificationFlow() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🧪 Testing Direct Notification Flow (No Auth Required)...\n');

    const notificationService = new NotificationService();
    const emailService = new EmailService();

    // Step 1: Check current state
    console.log('1️⃣ Checking current state...');
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', ['mustafasurguli89@gmail.com']);

    if (userResult.rows.length === 0) {
      console.log('❌ mustafasurguli89@gmail.com not found in users table');
      return;
    }

    const mustafaUserId = userResult.rows[0].id;
    const beforeNotifications = await pool.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1', [mustafaUserId]);
    console.log(`🔔 Notifications before: ${beforeNotifications.rows[0].count}`);

    // Step 2: Create a test event
    console.log('\n2️⃣ Creating test event...');
    const eventResult = await pool.query(`
      INSERT INTO calendar_events (
        user_id, title, description, start_time, end_time,
        location, meeting_type, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `, [
      1, // mohammedsorguli@gmail.com user ID
      'Direct Notification Test',
      'Testing direct notification flow bypass auth',
      new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      'Direct Test Room',
      'business'
    ]);

    const newEvent = eventResult.rows[0];
    console.log(`✅ Created event: "${newEvent.title}" (ID: ${newEvent.id})`);

    // Step 3: Add attendee directly to meeting_attendees table
    console.log('\n3️⃣ Adding attendee directly...');
    const attendeeResult = await pool.query(`
      INSERT INTO meeting_attendees (event_id, email, name, role, response)
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING *
    `, [newEvent.id, 'mustafasurguli89@gmail.com', 'Mustafa Surguli', 'required']);

    console.log(`✅ Added attendee: ${attendeeResult.rows[0].email}`);

    // Step 4: Generate RSVP token
    console.log('\n4️⃣ Generating RSVP token...');
    const rsvpToken = `direct_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`🎫 Generated token: ${rsvpToken}`);

    // Step 5: Test in-app notification creation
    console.log('\n5️⃣ Creating in-app notification...');
    try {
      await notificationService.createMeetingInvitation(
        newEvent.id,
        'mustafasurguli89@gmail.com',
        mustafaUserId,
        1, // organizer user ID (mohammedsorguli@gmail.com)
        rsvpToken
      );
      console.log('✅ In-app notification created successfully');
    } catch (notificationError) {
      console.error('❌ In-app notification failed:', notificationError.message);
    }

    // Step 6: Test email notification
    console.log('\n6️⃣ Testing email notification...');
    try {
      // Get organizer details
      const organizerResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [1]);
      const organizer = organizerResult.rows[0] || { name: 'Unknown', email: 'noreply@example.com' };

      await emailService.sendMeetingInvitation(
        {
          ...newEvent,
          organizer_name: organizer.name,
          organizer_email: organizer.email
        },
        {
          email: 'mustafasurguli89@gmail.com',
          name: 'Mustafa Surguli'
        },
        rsvpToken
      );
      console.log('✅ Email notification sent successfully');
    } catch (emailError) {
      console.error('❌ Email notification failed:', emailError.message);
    }

    // Step 7: Verify results
    console.log('\n7️⃣ Verifying results...');

    const afterNotifications = await pool.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1', [mustafaUserId]);
    const newNotificationCount = afterNotifications.rows[0].count - beforeNotifications.rows[0].count;

    console.log(`🔔 Notifications after: ${afterNotifications.rows[0].count} (change: +${newNotificationCount})`);

    // Check latest notification
    if (newNotificationCount > 0) {
      const latestNotification = await pool.query(`
        SELECT * FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [mustafaUserId]);

      const notif = latestNotification.rows[0];
      console.log(`\n📢 Latest notification:`);
      console.log(`   Type: ${notif.type}`);
      console.log(`   Title: "${notif.title}"`);
      console.log(`   Message: "${notif.message}"`);
      console.log(`   Created: ${notif.created_at}`);

      if (notif.data) {
        const data = typeof notif.data === 'string' ? JSON.parse(notif.data) : notif.data;
        console.log(`   RSVP Token: ${data.responseToken}`);
      }
    }

    // Check calendar invitations
    const invitations = await pool.query(`
      SELECT * FROM calendar_invitations
      WHERE event_id = $1 AND attendee_email = 'mustafasurguli89@gmail.com'
    `, [newEvent.id]);

    console.log(`\n📨 Calendar invitations: ${invitations.rows.length}`);
    if (invitations.rows.length > 0) {
      const inv = invitations.rows[0];
      console.log(`   Status: ${inv.status}`);
      console.log(`   Response Token: ${inv.response_token}`);
    }

    // Summary
    console.log('\n📊 Direct Flow Test Summary:');
    console.log(`   ✅ Event Created: YES (ID: ${newEvent.id})`);
    console.log(`   👤 Attendee Added: YES`);
    console.log(`   🔔 In-App Notification: ${newNotificationCount > 0 ? 'YES' : 'NO'}`);
    console.log(`   📨 Calendar Invitation: ${invitations.rows.length > 0 ? 'YES' : 'NO'}`);
    console.log(`   📧 Email Service Test: Check above logs`);

    if (newNotificationCount > 0 && invitations.rows.length > 0) {
      console.log('\n🎉 SUCCESS: Complete notification flow working!');
      console.log('💡 The issue is likely authentication in the API endpoints');
    } else {
      console.log('\n❌ ISSUE: Notification services have problems');
    }

  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await pool.end();
  }
}

testDirectNotificationFlow().catch(console.error);