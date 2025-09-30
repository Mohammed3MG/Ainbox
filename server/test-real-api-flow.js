const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

async function testRealAPIFlow() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🧪 Testing Real Calendar API Flow...\n');

    // Step 1: Check current state before creating event
    console.log('1️⃣ Checking current state...');

    const beforeEvents = await pool.query('SELECT COUNT(*) as count FROM calendar_events');
    const beforeNotifications = await pool.query('SELECT COUNT(*) as count FROM notifications');
    const beforeInvitations = await pool.query('SELECT COUNT(*) as count FROM calendar_invitations');

    console.log(`📅 Events before: ${beforeEvents.rows[0].count}`);
    console.log(`🔔 Notifications before: ${beforeNotifications.rows[0].count}`);
    console.log(`📨 Invitations before: ${beforeInvitations.rows[0].count}\n`);

    // Step 2: Create a calendar event via API (this will fail without auth, but let's see server response)
    console.log('2️⃣ Testing calendar API endpoint...');

    const testEventData = {
      title: 'API Test Meeting - Real Flow',
      description: 'Testing actual API flow for notifications',
      start_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
      end_time: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), // 3 hours from now
      location: 'API Test Room',
      meeting_type: 'business',
      attendees: [
        {
          email: 'mustafasurguli89@gmail.com',
          name: 'Mustafa Surguli',
          role: 'required'
        }
      ]
    };

    console.log('📧 Event data to send:');
    console.log(JSON.stringify(testEventData, null, 2));

    try {
      // Try to POST to the calendar API endpoint
      const response = await axios.post('http://localhost:3000/api/calendar/events', testEventData, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      console.log('✅ API Response:', response.data);

      // Check what happened after API call
      console.log('\n3️⃣ Checking state after API call...');

      const afterEvents = await pool.query('SELECT COUNT(*) as count FROM calendar_events');
      const afterNotifications = await pool.query('SELECT COUNT(*) as count FROM notifications');
      const afterInvitations = await pool.query('SELECT COUNT(*) as count FROM calendar_invitations');

      console.log(`📅 Events after: ${afterEvents.rows[0].count} (change: +${afterEvents.rows[0].count - beforeEvents.rows[0].count})`);
      console.log(`🔔 Notifications after: ${afterNotifications.rows[0].count} (change: +${afterNotifications.rows[0].count - beforeNotifications.rows[0].count})`);
      console.log(`📨 Invitations after: ${afterInvitations.rows[0].count} (change: +${afterInvitations.rows[0].count - beforeInvitations.rows[0].count})`);

    } catch (apiError) {
      if (apiError.response) {
        console.log(`📊 Server responded with status: ${apiError.response.status}`);
        console.log(`📊 Error response:`, apiError.response.data);

        if (apiError.response.status === 401) {
          console.log('\n🔑 Expected: Authentication required');
          console.log('💡 This confirms the server is running and accessible');
        }
      } else if (apiError.code === 'ECONNREFUSED') {
        console.log('❌ Cannot connect to server on http://localhost:3000');
        console.log('💡 Make sure the server is running');
      } else {
        console.log('❌ Request failed:', apiError.message);
      }
    }

    // Step 3: Check if calendar route integration exists
    console.log('\n4️⃣ Checking calendar route integration...');

    // Let's see what's in the routes/calendar.js file around the integration
    const fs = require('fs');
    const path = require('path');

    try {
      const calendarRouteFile = path.join(__dirname, 'routes/calendar.js');
      const calendarContent = fs.readFileSync(calendarRouteFile, 'utf8');

      // Check if our integration code exists
      if (calendarContent.includes('notificationService.createMeetingInvitation')) {
        console.log('✅ Found notification integration in calendar route');

        // Extract the integration section
        const lines = calendarContent.split('\n');
        let integrationFound = false;
        let integrationLines = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes('Send notifications to attendees')) {
            integrationFound = true;
            console.log(`📍 Integration found at line ${i + 1}`);
          }
          if (integrationFound && line.includes('notificationService.createMeetingInvitation')) {
            integrationLines.push(`Line ${i + 1}: ${line.trim()}`);
          }
          if (integrationFound && line.includes('} catch (notificationError)')) {
            break;
          }
        }

        if (integrationLines.length > 0) {
          console.log('🔍 Integration code found:');
          integrationLines.forEach(line => console.log(`   ${line}`));
        }

      } else {
        console.log('❌ Notification integration NOT found in calendar route');
        console.log('💡 This explains why notifications are not sent');
      }
    } catch (fileError) {
      console.log('❌ Could not read calendar route file:', fileError.message);
    }

    // Step 4: Test direct database approach to understand the disconnect
    console.log('\n5️⃣ Understanding the disconnect...');

    // Check recent events and their attendees
    const recentEvents = await pool.query(`
      SELECT ce.id, ce.title, ce.user_id, ce.created_at
      FROM calendar_events ce
      ORDER BY ce.created_at DESC
      LIMIT 3
    `);

    console.log('📅 Recent calendar events:');
    for (const event of recentEvents.rows) {
      console.log(`   Event ${event.id}: "${event.title}" by user ${event.user_id}`);

      // Check attendees for this event
      const attendees = await pool.query(`
        SELECT email, name, role, response
        FROM meeting_attendees
        WHERE event_id = $1
      `, [event.id]);

      console.log(`      Attendees: ${attendees.rows.length}`);
      attendees.rows.forEach(att => {
        console.log(`         - ${att.email} (${att.role}, response: ${att.response || 'none'})`);
      });

      // Check invitations for this event
      const invitations = await pool.query(`
        SELECT attendee_email, status, invitation_sent_at
        FROM calendar_invitations
        WHERE event_id = $1
      `, [event.id]);

      console.log(`      Invitations: ${invitations.rows.length}`);
      invitations.rows.forEach(inv => {
        console.log(`         - ${inv.attendee_email} (status: ${inv.status}, sent: ${inv.invitation_sent_at || 'never'})`);
      });
    }

  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await pool.end();
  }
}

testRealAPIFlow().catch(console.error);