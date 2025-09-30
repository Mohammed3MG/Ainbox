const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

async function testCompleteIntegration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🧪 Testing Complete Calendar Integration (In-App + Email)...\n');

    // Step 1: Check current notification state
    console.log('1️⃣ Checking current notification state...');
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', ['mustafasurguli89@gmail.com']);

    if (userResult.rows.length === 0) {
      console.log('❌ mustafasurguli89@gmail.com not found in users table');
      return;
    }

    const mustafaUserId = userResult.rows[0].id;
    const beforeNotifications = await pool.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1', [mustafaUserId]);
    console.log(`🔔 Notifications before: ${beforeNotifications.rows[0].count}`);

    // Step 2: Create a test event via direct database to trigger notifications
    console.log('\n2️⃣ Creating test event directly in database...');

    const eventResult = await pool.query(`
      INSERT INTO calendar_events (
        user_id, title, description, start_time, end_time,
        location, meeting_type, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `, [
      1, // mohammedsorguli@gmail.com user ID
      'Complete Integration Test',
      'Testing both in-app and email notifications',
      new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
      new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), // 3 hours from now
      'Integration Test Room',
      'business'
    ]);

    const newEvent = eventResult.rows[0];
    console.log(`✅ Created event: "${newEvent.title}" (ID: ${newEvent.id})`);

    // Step 3: Add attendee via API to trigger our integration
    console.log('\n3️⃣ Adding attendee via API to trigger notifications...');

    try {
      const response = await axios.post(
        `http://localhost:3000/api/calendar/events/${newEvent.id}/attendees`,
        {
          email: 'mustafasurguli89@gmail.com',
          name: 'Mustafa Surguli',
          role: 'required'
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer fake-token' // This might cause auth issues, but let's see
          },
          timeout: 5000
        }
      );

      console.log('✅ API Response:', response.data);

    } catch (apiError) {
      if (apiError.response) {
        console.log(`📊 API Error Status: ${apiError.response.status}`);
        console.log(`📊 API Error Response:`, apiError.response.data);
      } else {
        console.log('❌ API Request failed:', apiError.message);
      }
    }

    // Step 4: Check results
    console.log('\n4️⃣ Checking integration results...');

    const afterNotifications = await pool.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1', [mustafaUserId]);
    const newNotificationCount = afterNotifications.rows[0].count - beforeNotifications.rows[0].count;

    console.log(`🔔 Notifications after: ${afterNotifications.rows[0].count} (change: +${newNotificationCount})`);

    // Check the latest notification
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
      console.log(`   Sent At: ${inv.invitation_sent_at || 'Not recorded'}`);
    }

    // Summary
    console.log('\n📊 Integration Test Summary:');
    console.log(`   ✅ Event Created: YES (ID: ${newEvent.id})`);
    console.log(`   🔔 In-App Notification: ${newNotificationCount > 0 ? 'YES' : 'NO'}`);
    console.log(`   📨 Calendar Invitation: ${invitations.rows.length > 0 ? 'YES' : 'NO'}`);
    console.log(`   📧 Email Notification: Check server logs`);

    if (newNotificationCount > 0 && invitations.rows.length > 0) {
      console.log('\n🎉 SUCCESS: Both in-app and invitation system working!');
    } else {
      console.log('\n❌ PARTIAL: Some components not working properly');
    }

  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await pool.end();
  }
}

testCompleteIntegration().catch(console.error);