const { Pool } = require('pg');
const NotificationService = require('./lib/notificationService');
require('dotenv').config();

async function checkMustafaNotifications() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const notificationService = new NotificationService();

  try {
    console.log('🔍 Checking notifications and invitations for mustafasurguli89@gmail.com...\n');

    // Get user ID for mustafasurguli89@gmail.com
    const userResult = await pool.query(`
      SELECT id, email, name FROM users
      WHERE email = 'mustafasurguli89@gmail.com'
    `);

    if (userResult.rows.length === 0) {
      console.log('❌ User mustafasurguli89@gmail.com not found');
      return;
    }

    const user = userResult.rows[0];
    console.log(`👤 User: ${user.email} (ID: ${user.id}, Name: ${user.name})\n`);

    // Check calendar invitations received
    console.log('📨 Calendar invitations received:');
    const invitationsResult = await pool.query(`
      SELECT ci.*, ce.title, ce.start_time, ce.end_time, ce.location,
             u.name as organizer_name, u.email as organizer_email
      FROM calendar_invitations ci
      JOIN calendar_events ce ON ci.event_id = ce.id
      LEFT JOIN users u ON ci.organizer_user_id = u.id
      WHERE ci.attendee_email = $1 OR ci.attendee_user_id = $2
      ORDER BY ci.invitation_sent_at DESC
    `, [user.email, user.id]);

    if (invitationsResult.rows.length === 0) {
      console.log('   ❌ No calendar invitations found');
    } else {
      console.log(`   ✅ Found ${invitationsResult.rows.length} calendar invitations:`);
      invitationsResult.rows.forEach((inv, index) => {
        console.log(`   ${index + 1}. "${inv.title}" from ${inv.organizer_email || 'Unknown'}`);
        console.log(`      Status: ${inv.status}, Event Date: ${inv.start_time}`);
        console.log(`      Invitation sent: ${inv.invitation_sent_at || 'Not recorded'}`);
        console.log(`      Response: ${inv.response_at ? 'Responded at ' + inv.response_at : 'No response yet'}`);
      });
    }

    // Check notifications using direct database query
    console.log('\n🔔 Notifications (direct database query):');
    const notificationsResult = await pool.query(`
      SELECT * FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [user.id]);

    if (notificationsResult.rows.length === 0) {
      console.log('   ❌ No notifications found');
    } else {
      console.log(`   ✅ Found ${notificationsResult.rows.length} notifications:`);
      notificationsResult.rows.forEach((notif, index) => {
        console.log(`   ${index + 1}. Type: ${notif.type}`);
        console.log(`      Title: "${notif.title}"`);
        console.log(`      Message: "${notif.message}"`);
        console.log(`      Read: ${notif.is_read}, Created: ${notif.created_at}`);
        if (notif.data) {
          console.log(`      Data: ${JSON.stringify(notif.data, null, 2)}`);
        }
        console.log('');
      });
    }

    // Check notifications using NotificationService
    console.log('🔔 Notifications (via NotificationService):');
    const serviceNotifications = await notificationService.getUserNotifications(user.id, 10);

    if (serviceNotifications.length === 0) {
      console.log('   ❌ No notifications found via service');
    } else {
      console.log(`   ✅ Found ${serviceNotifications.length} notifications via service:`);
      serviceNotifications.forEach((notif, index) => {
        console.log(`   ${index + 1}. ${notif.type}: "${notif.title}" (Read: ${notif.is_read})`);
      });
    }

    // Check notification count
    const unreadCount = await notificationService.getNotificationCount(user.id, true);
    const totalCount = await notificationService.getNotificationCount(user.id, false);
    console.log(`\n📊 Notification counts:`);
    console.log(`   📬 Unread: ${unreadCount}`);
    console.log(`   📋 Total: ${totalCount}`);

  } catch (error) {
    console.error('❌ Error checking notifications:', error);
  } finally {
    await pool.end();
  }
}

checkMustafaNotifications().catch(console.error);