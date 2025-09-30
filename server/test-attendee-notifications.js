const { Pool } = require('pg');
require('dotenv').config();

async function testAttendeeNotifications() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🧪 Testing Attendee Notification Flow...\n');

    // Step 1: Get existing calendar events
    console.log('1️⃣ Finding existing calendar events...');
    const eventsResult = await pool.query(`
      SELECT id, title, user_id, start_time
      FROM calendar_events
      ORDER BY id DESC
      LIMIT 3
    `);

    if (eventsResult.rows.length === 0) {
      console.log('❌ No calendar events found. Creating one first...');

      // Create a test event
      const createEventResult = await pool.query(`
        INSERT INTO calendar_events (
          user_id, title, description, start_time, end_time,
          location, meeting_type, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING *
      `, [
        1, // mohammedsorguli@gmail.com user ID
        'Notification Test Event',
        'Testing attendee notification integration',
        new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
        new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
        'Test Room',
        'business'
      ]);

      const newEvent = createEventResult.rows[0];
      console.log(`✅ Created test event: "${newEvent.title}" (ID: ${newEvent.id})`);
      eventsResult.rows.unshift(newEvent);
    }

    const testEvent = eventsResult.rows[0];
    console.log(`📅 Using event: "${testEvent.title}" (ID: ${testEvent.id})`);

    // Step 2: Check current notification count for mustafasurguli89@gmail.com
    console.log('\n2️⃣ Checking current notification state...');
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', ['mustafasurguli89@gmail.com']);

    if (userResult.rows.length === 0) {
      console.log('❌ mustafasurguli89@gmail.com not found in users table');
      return;
    }

    const mustafaUserId = userResult.rows[0].id;
    const beforeNotifications = await pool.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1', [mustafaUserId]);
    const beforeInvitations = await pool.query('SELECT COUNT(*) as count FROM calendar_invitations WHERE attendee_user_id = $1', [mustafaUserId]);

    console.log(`👤 Mustafa user ID: ${mustafaUserId}`);
    console.log(`🔔 Notifications before: ${beforeNotifications.rows[0].count}`);
    console.log(`📨 Invitations before: ${beforeInvitations.rows[0].count}`);

    // Step 3: Simulate the API call that UI makes to add attendee
    console.log('\n3️⃣ Simulating attendee addition API call...');
    console.log(`📡 Would call: POST /api/calendar/events/${testEvent.id}/attendees`);
    console.log('📧 Attendee: mustafasurguli89@gmail.com');

    // We'll simulate this by directly calling the database operations and notification service
    // similar to what the attendees endpoint does

    // Check if attendee already exists
    const existingAttendee = await pool.query(
      'SELECT id FROM meeting_attendees WHERE event_id = $1 AND email = $2',
      [testEvent.id, 'mustafasurguli89@gmail.com']
    );

    let attendeeId;
    if (existingAttendee.rows.length > 0) {
      console.log('⚠️ Attendee already exists, using existing record');
      attendeeId = existingAttendee.rows[0].id;
    } else {
      // Add attendee to meeting_attendees table
      const insertAttendeeResult = await pool.query(`
        INSERT INTO meeting_attendees (event_id, email, name, role, response)
        VALUES ($1, $2, $3, $4, 'pending')
        RETURNING *
      `, [testEvent.id, 'mustafasurguli89@gmail.com', 'Mustafa Surguli', 'required']);

      attendeeId = insertAttendeeResult.rows[0].id;
      console.log(`✅ Added attendee to meeting_attendees table (ID: ${attendeeId})`);
    }

    // Generate RSVP token (simulating the RSVP token manager)
    const rsvpToken = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`🎫 Generated RSVP token: ${rsvpToken}`);

    // Now create the notification invitation using NotificationService
    const NotificationService = require('./lib/notificationService');
    const notificationService = new NotificationService();

    console.log('🔔 Creating notification invitation...');
    await notificationService.createMeetingInvitation(
      testEvent.id,
      'mustafasurguli89@gmail.com',
      mustafaUserId,
      testEvent.user_id, // organizer user ID
      rsvpToken
    );
    console.log('✅ Notification invitation created');

    // Step 4: Verify the results
    console.log('\n4️⃣ Verifying results...');

    const afterNotifications = await pool.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1', [mustafaUserId]);
    const afterInvitations = await pool.query('SELECT COUNT(*) as count FROM calendar_invitations WHERE attendee_user_id = $1', [mustafaUserId]);

    console.log(`🔔 Notifications after: ${afterNotifications.rows[0].count} (change: +${afterNotifications.rows[0].count - beforeNotifications.rows[0].count})`);
    console.log(`📨 Invitations after: ${afterInvitations.rows[0].count} (change: +${afterInvitations.rows[0].count - beforeInvitations.rows[0].count})`);

    // Check the latest notification
    const latestNotification = await pool.query(`
      SELECT * FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [mustafaUserId]);

    if (latestNotification.rows.length > 0) {
      const notif = latestNotification.rows[0];
      console.log(`\n📢 Latest notification:`);
      console.log(`   Type: ${notif.type}`);
      console.log(`   Title: "${notif.title}"`);
      console.log(`   Message: "${notif.message}"`);
      console.log(`   Created: ${notif.created_at}`);
      console.log(`   Read: ${notif.is_read}`);

      if (notif.data) {
        const data = typeof notif.data === 'string' ? JSON.parse(notif.data) : notif.data;
        console.log(`   Event: "${data.event?.title || 'Unknown'}"`);
        console.log(`   Response Token: ${data.responseToken}`);
      }
    }

    console.log('\n✅ Attendee notification test completed!');

    if (afterNotifications.rows[0].count > beforeNotifications.rows[0].count) {
      console.log('🎉 SUCCESS: Notification was created!');
    } else {
      console.log('❌ FAILURE: No new notification was created');
    }

  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await pool.end();
  }
}

testAttendeeNotifications().catch(console.error);