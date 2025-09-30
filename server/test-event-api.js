const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function testEventAPI() {
  try {
    // Get the most recent event
    const eventQuery = await pool.query(`
      SELECT id, title, user_id
      FROM calendar_events
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (eventQuery.rows.length === 0) {
      console.log('❌ No events found');
      return;
    }

    const event = eventQuery.rows[0];
    console.log('📅 Testing event:', event);

    // Get user email for the event owner
    const userQuery = await pool.query(`
      SELECT id, email FROM users WHERE id = $1
    `, [event.user_id]);

    const user = userQuery.rows[0];
    console.log('👤 Event owner:', user);

    // Simulate the GET /events/:id query
    const apiQuery = `
      SELECT
        e.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', a.id,
              'email', a.email,
              'name', a.name,
              'role', a.role,
              'response', a.response,
              'responded_at', a.response_time,
              'response_note', a.response_note
            ) ORDER BY a.id
          ) FILTER (WHERE a.id IS NOT NULL),
          '[]'::json
        ) as attendees,
        r.name as room_name,
        r.location as room_location,
        r.capacity as room_capacity,
        r.equipment as room_equipment,
        u.name as organizer_name,
        u.email as organizer_email,
        CASE
          WHEN e.user_id = $1 THEN 'organizer'
          ELSE 'attendee'
        END as user_role,
        CASE
          WHEN e.user_id = $1 THEN true
          ELSE false
        END as can_edit
      FROM calendar_events e
      LEFT JOIN meeting_attendees a ON e.id = a.event_id
      LEFT JOIN conference_rooms r ON e.room_id = r.id
      LEFT JOIN users u ON e.user_id = u.id
      WHERE e.id = $2
        AND (
          e.user_id = $1
          OR EXISTS (
            SELECT 1 FROM meeting_attendees ma
            WHERE ma.event_id = e.id AND ma.email = $3
          )
        )
      GROUP BY e.id, r.name, r.location, r.capacity, r.equipment, u.name, u.email
    `;

    // Test as organizer
    console.log('\n--- Testing as ORGANIZER ---');
    const organizerResult = await pool.query(apiQuery, [event.user_id, event.id, user.email]);
    if (organizerResult.rows.length > 0) {
      const data = organizerResult.rows[0];
      console.log('✅ Event retrieved successfully');
      console.log('📋 Title:', data.title);
      console.log('👤 Organizer Name:', data.organizer_name);
      console.log('📧 Organizer Email:', data.organizer_email);
      console.log('👥 Attendees:', JSON.stringify(data.attendees, null, 2));
      console.log('🎭 User Role:', data.user_role);
      console.log('✏️ Can Edit:', data.can_edit);
    } else {
      console.log('❌ No data returned');
    }

    // Get an attendee to test as invitee
    const attendeeQuery = await pool.query(`
      SELECT DISTINCT ma.email, u.id as user_id
      FROM meeting_attendees ma
      LEFT JOIN users u ON ma.email = u.email
      WHERE ma.event_id = $1
      LIMIT 1
    `, [event.id]);

    if (attendeeQuery.rows.length > 0) {
      const attendee = attendeeQuery.rows[0];
      console.log('\n--- Testing as INVITEE ---');
      console.log('📧 Invitee email:', attendee.email);

      if (attendee.user_id) {
        const inviteeResult = await pool.query(apiQuery, [attendee.user_id, event.id, attendee.email]);
        if (inviteeResult.rows.length > 0) {
          const data = inviteeResult.rows[0];
          console.log('✅ Event retrieved successfully');
          console.log('📋 Title:', data.title);
          console.log('👤 Organizer Name:', data.organizer_name);
          console.log('📧 Organizer Email:', data.organizer_email);
          console.log('👥 Attendees:', JSON.stringify(data.attendees, null, 2));
          console.log('🎭 User Role:', data.user_role);
          console.log('✏️ Can Edit:', data.can_edit);
        } else {
          console.log('❌ No data returned for invitee');
        }
      } else {
        console.log('⚠️ Invitee is not a registered user');
      }
    } else {
      console.log('\n⚠️ No attendees found for this event');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

testEventAPI();
