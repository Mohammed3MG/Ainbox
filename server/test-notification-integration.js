const { Pool } = require('pg');
const NotificationService = require('./lib/notificationService');
require('dotenv').config();

async function testNotificationIntegration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const notificationService = new NotificationService();

  try {
    console.log('🧪 Testing notification integration directly...');

    // First, check if the users exist
    console.log('\n1️⃣ Checking users...');
    const usersResult = await pool.query(`
      SELECT id, email, name FROM users
      WHERE email IN ('mohammedsorguli@gmail.com', 'mustafasurguli89@gmail.com')
      ORDER BY id
    `);

    console.log('Found users:');
    usersResult.rows.forEach(user => {
      console.log(`  - ${user.email} (ID: ${user.id}, Name: ${user.name})`);
    });

    if (usersResult.rows.length < 2) {
      console.log('❌ Missing required users for test');
      return;
    }

    const organizer = usersResult.rows.find(u => u.email === 'mohammedsorguli@gmail.com');
    const attendee = usersResult.rows.find(u => u.email === 'mustafasurguli89@gmail.com');

    // 2. Create a test calendar event
    console.log('\n2️⃣ Creating test calendar event...');
    const eventResult = await pool.query(`
      INSERT INTO calendar_events (
        user_id, title, description, start_time, end_time,
        location, meeting_type, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `, [
      organizer.id,
      'Test Meeting - Direct Integration',
      'Testing notification integration directly',
      new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
      new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
      'Video Conference',
      'business'
    ]);

    const event = eventResult.rows[0];
    console.log(`✅ Created event: "${event.title}" (ID: ${event.id})`);

    // 3. Test NotificationService.createMeetingInvitation directly
    console.log('\n3️⃣ Testing NotificationService.createMeetingInvitation...');

    // Generate a simple response token
    const responseToken = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      const invitation = await notificationService.createMeetingInvitation(
        event.id,
        attendee.email,
        attendee.id,
        organizer.id,
        responseToken
      );

      console.log('✅ Meeting invitation created:', invitation);
    } catch (inviteError) {
      console.error('❌ Error creating meeting invitation:', inviteError);
    }

    // 4. Check what was created in the database
    console.log('\n4️⃣ Checking database results...');

    // Check calendar_invitations
    const invitationsResult = await pool.query(`
      SELECT * FROM calendar_invitations
      WHERE event_id = $1 AND attendee_email = $2
    `, [event.id, attendee.email]);

    console.log(`Found ${invitationsResult.rows.length} calendar invitations:`);
    invitationsResult.rows.forEach(inv => {
      console.log(`  - Event ${inv.event_id} → ${inv.attendee_email} (Status: ${inv.status})`);
    });

    // Check notifications
    const notificationsResult = await pool.query(`
      SELECT * FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 3
    `, [attendee.id]);

    console.log(`\nFound ${notificationsResult.rows.length} notifications for ${attendee.email}:`);
    notificationsResult.rows.forEach(notif => {
      console.log(`  - Type: ${notif.type}, Title: "${notif.title}"`);
      console.log(`    Message: "${notif.message}"`);
      console.log(`    Read: ${notif.is_read}, Created: ${notif.created_at}`);
    });

    // 5. Test getting notifications via service
    console.log('\n5️⃣ Testing NotificationService.getUserNotifications...');
    const userNotifications = await notificationService.getUserNotifications(attendee.id, 5);
    console.log(`Found ${userNotifications.length} notifications via service:`);
    userNotifications.forEach(notif => {
      console.log(`  - ${notif.type}: "${notif.title}" (Read: ${notif.is_read})`);
    });

  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await pool.end();
  }
}

testNotificationIntegration().catch(console.error);