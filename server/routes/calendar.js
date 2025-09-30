/**
 * Calendar API Routes
 * Handles calendar events, meetings, and related functionality
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const EmailService = require('../lib/emailService');
const RSVPTokenManager = require('../lib/rsvpTokens');
const NotificationService = require('../lib/notificationService');

// Initialize services
const emailService = new EmailService();
const rsvpTokenManager = new RSVPTokenManager();
const notificationService = new NotificationService();

// Mount templates routes
const templatesRouter = require('./templates');
router.use('/templates', templatesRouter);

// Mount email-to-event conversion routes
const emailToEventRouter = require('./emailToEvent');
router.use('/', emailToEventRouter);

// Mount smart scheduling routes
const smartSchedulingRouter = require('./smartScheduling');
router.use('/', smartSchedulingRouter);

/**
 * Get calendar events for a date range
 * GET /api/calendar/events
 */
router.get('/events', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const { start, end, view } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        error: 'Start and end dates are required'
      });
    }

    // Get user email for attendee matching
    const userEmailQuery = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    const userEmail = userEmailQuery.rows[0]?.email;

    const query = `
      SELECT
        e.*,
        COALESCE(
          json_agg(
            json_build_object(
              'email', a.email,
              'name', a.name,
              'role', a.role,
              'response', a.response
            ) ORDER BY a.id
          ) FILTER (WHERE a.id IS NOT NULL),
          '[]'::json
        ) as attendees,
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
      LEFT JOIN users u ON e.user_id = u.id
      WHERE (
        e.user_id = $1
        OR EXISTS (
          SELECT 1 FROM meeting_attendees ma
          WHERE ma.event_id = e.id AND ma.email = $4
        )
      )
        AND e.start_time >= $2::timestamptz
        AND e.start_time <= $3::timestamptz
        AND e.status != 'cancelled'
      GROUP BY e.id, u.name, u.email
      ORDER BY e.start_time ASC
    `;

    const result = await pool.query(query, [userId, start, end, userEmail]);

    // Process events to add computed properties
    const events = result.rows.map(event => ({
      ...event,
      attendee_count: event.attendees ? event.attendees.length : 0,
      is_all_day: event.end_time && event.start_time &&
        (new Date(event.end_time) - new Date(event.start_time)) >= 24 * 60 * 60 * 1000
    }));

    res.json({
      success: true,
      events,
      count: events.length,
      view,
      dateRange: { start, end }
    });

  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({
      error: 'Internal server error fetching events'
    });
  }
});

/**
 * Get a specific calendar event
 * GET /api/calendar/events/:id
 */
router.get('/events/:id', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const eventId = parseInt(req.params.id);

    // Get user email for attendee matching
    const userEmailQuery = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    const userEmail = userEmailQuery.rows[0]?.email;

    const query = `
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
      LEFT JOIN users u ON e.user_id = u.id
      WHERE e.id = $1
        AND (
          e.user_id = $2
          OR EXISTS (
            SELECT 1 FROM meeting_attendees ma
            WHERE ma.event_id = e.id AND ma.email = $3
          )
        )
      GROUP BY e.id, u.name, u.email
    `;

    const result = await pool.query(query, [eventId, userId, userEmail]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Event not found or you do not have access to this event'
      });
    }

    res.json({
      success: true,
      event: result.rows[0]
    });

  } catch (error) {
    console.error('Error fetching calendar event:', error);
    res.status(500).json({
      error: 'Internal server error fetching event'
    });
  }
});

/**
 * Create a new calendar event
 * POST /api/calendar/events
 */
router.post('/events', requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userId = parseInt(req.auth.sub);
    const {
      title,
      description,
      start_time,
      end_time,
      location,
      meeting_type = 'personal',
      color = '#3B82F6',
      attendees = [],
      agenda,
      template_id
    } = req.body;

    // Validation
    if (!title || !start_time || !end_time) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Title, start time, and end time are required'
      });
    }

    const startDate = new Date(start_time);
    const endDate = new Date(end_time);

    if (endDate <= startDate) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'End time must be after start time'
      });
    }

    // Create the event
    const eventQuery = `
      INSERT INTO calendar_events (
        user_id, title, description, start_time, end_time, location,
        meeting_type, color, agenda, template_id, timezone
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const eventResult = await client.query(eventQuery, [
      userId, title, description, start_time, end_time, location,
      meeting_type, color, agenda, template_id, 'UTC'
    ]);

    const event = eventResult.rows[0];

    // Add attendees
    if (attendees && attendees.length > 0) {
      const attendeeValues = attendees.map((attendee, index) => {
        const offset = index * 4;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
      }).join(', ');

      const attendeeParams = attendees.flatMap(attendee => [
        event.id,
        attendee.email,
        attendee.name || '',
        attendee.role || 'required'
      ]);

      const attendeeQuery = `
        INSERT INTO meeting_attendees (event_id, email, name, role)
        VALUES ${attendeeValues}
        RETURNING *
      `;

      await client.query(attendeeQuery, attendeeParams);
    }

    await client.query('COMMIT');

    // Fetch the complete event with relationships
    const completeEventQuery = `
      SELECT
        e.*,
        COALESCE(
          json_agg(
            json_build_object(
              'email', a.email,
              'name', a.name,
              'role', a.role,
              'response', a.response
            )
          ) FILTER (WHERE a.id IS NOT NULL),
          '[]'::json
        ) as attendees
      FROM calendar_events e
      LEFT JOIN meeting_attendees a ON e.id = a.event_id
      WHERE e.id = $1
      GROUP BY e.id
    `;

    const completeEvent = await pool.query(completeEventQuery, [event.id]);
    const eventWithAttendees = completeEvent.rows[0];

    // Send notifications to attendees if there are any
    if (attendees && attendees.length > 0) {
      console.log(`📧 Sending calendar invitations for event: ${title}`);

      try {
        // Get organizer details for email notifications
        const organizerQuery = await pool.query(
          'SELECT name, email FROM users WHERE id = $1',
          [userId]
        );
        const organizer = organizerQuery.rows[0] || { name: 'Unknown', email: 'noreply@example.com' };
        for (const attendee of attendees) {
          if (attendee.email) {
            console.log(`📧 Creating invitation for ${attendee.email}`);

            // Find attendee user ID if they're a registered user
            const attendeeUserQuery = await pool.query(
              'SELECT id FROM users WHERE email = $1 LIMIT 1',
              [attendee.email]
            );

            const attendeeUserId = attendeeUserQuery.rows.length > 0
              ? attendeeUserQuery.rows[0].id
              : null;

            // Generate response token for RSVP
            const responseToken = await rsvpTokenManager.generateToken(event.id, attendee.email);

            // Create calendar invitation and notification using NotificationService
            await notificationService.createMeetingInvitation(
              event.id,
              attendee.email,
              attendeeUserId,
              userId,
              responseToken
            );

            // Also send email invitation
            try {
              await emailService.sendMeetingInvitation(
                {
                  ...event,
                  organizer_name: organizer.name,
                  organizer_email: organizer.email
                },
                {
                  email: attendee.email,
                  name: attendee.name || attendee.email.split('@')[0]
                },
                responseToken
              );
              console.log(`📧 Email invitation sent to ${attendee.email}`);
            } catch (emailError) {
              console.error(`❌ Failed to send email to ${attendee.email}:`, emailError.message);
            }

            console.log(`✅ Created invitation for ${attendee.email} (User ID: ${attendeeUserId || 'guest'})`);
          }
        }

        console.log(`✅ Successfully sent ${attendees.length} calendar invitations`);

        // Note: No notification created for organizer per requirements
        // Organizers do not receive notifications when creating events
      } catch (notificationError) {
        console.error('❌ Error sending calendar invitations:', notificationError);
        // Don't fail the request, just log the error
      }
    }

    res.status(201).json({
      success: true,
      message: 'Event created successfully',
      event: eventWithAttendees,
      invitationsSent: attendees ? attendees.length : 0
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating calendar event:', error);
    res.status(500).json({
      error: 'Internal server error creating event'
    });
  } finally {
    client.release();
  }
});

/**
 * Update a calendar event
 * PUT /api/calendar/events/:id
 */
router.put('/events/:id', requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userId = parseInt(req.auth.sub);
    const eventId = parseInt(req.params.id);
    const {
      title,
      description,
      start_time,
      end_time,
      location,
      meeting_type,
      color,
      attendees,
      agenda,
      status = 'confirmed'
    } = req.body;

    // Check if event exists and user owns it (only organizer can edit)
    const existingEvent = await client.query(
      'SELECT * FROM calendar_events WHERE id = $1 AND user_id = $2',
      [eventId, userId]
    );

    if (existingEvent.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'You do not have permission to edit this event. Only the organizer can edit events.'
      });
    }

    // Validate times if provided
    if (start_time && end_time) {
      const startDate = new Date(start_time);
      const endDate = new Date(end_time);

      if (endDate <= startDate) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'End time must be after start time'
        });
      }
    }

    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    const fieldsToUpdate = {
      title, description, start_time, end_time, location,
      meeting_type, color, agenda, status
    };

    Object.entries(fieldsToUpdate).forEach(([field, value]) => {
      if (value !== undefined) {
        updateFields.push(`${field} = $${paramIndex}`);
        updateValues.push(value);
        paramIndex++;
      }
    });

    updateFields.push(`updated_at = NOW()`);

    const updateQuery = `
      UPDATE calendar_events
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
      RETURNING *
    `;

    updateValues.push(eventId, userId);

    const eventResult = await client.query(updateQuery, updateValues);

    // Update attendees if provided
    if (attendees) {
      // Remove existing attendees
      await client.query('DELETE FROM meeting_attendees WHERE event_id = $1', [eventId]);

      // Add new attendees
      if (attendees.length > 0) {
        const attendeeValues = attendees.map((attendee, index) => {
          const offset = index * 4;
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
        }).join(', ');

        const attendeeParams = attendees.flatMap(attendee => [
          eventId,
          attendee.email,
          attendee.name || '',
          attendee.role || 'required'
        ]);

        const attendeeQuery = `
          INSERT INTO meeting_attendees (event_id, email, name, role)
          VALUES ${attendeeValues}
        `;

        await client.query(attendeeQuery, attendeeParams);
      }
    }

    await client.query('COMMIT');

    // Fetch updated event with relationships
    const completeEventQuery = `
      SELECT
        e.*,
        COALESCE(
          json_agg(
            json_build_object(
              'email', a.email,
              'name', a.name,
              'role', a.role,
              'response', a.response
            )
          ) FILTER (WHERE a.id IS NOT NULL),
          '[]'::json
        ) as attendees
      FROM calendar_events e
      LEFT JOIN meeting_attendees a ON e.id = a.event_id
      WHERE e.id = $1
      GROUP BY e.id
    `;

    const completeEvent = await pool.query(completeEventQuery, [eventId]);

    res.json({
      success: true,
      message: 'Event updated successfully',
      event: completeEvent.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating calendar event:', error);
    res.status(500).json({
      error: 'Internal server error updating event'
    });
  } finally {
    client.release();
  }
});

/**
 * Delete a calendar event
 * DELETE /api/calendar/events/:id
 */
router.delete('/events/:id', requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userId = parseInt(req.auth.sub);
    const eventId = parseInt(req.params.id);

    // Check if event exists and user owns it
    const existingEvent = await client.query(
      'SELECT * FROM calendar_events WHERE id = $1 AND user_id = $2',
      [eventId, userId]
    );

    if (existingEvent.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'You do not have permission to delete this event. Only the organizer can delete events.'
      });
    }

    // Delete related records (cascade should handle this, but being explicit)
    await client.query('DELETE FROM meeting_attendees WHERE event_id = $1', [eventId]);
    await client.query('DELETE FROM room_bookings WHERE event_id = $1', [eventId]);
    await client.query('DELETE FROM calendar_notifications WHERE event_id = $1', [eventId]);
    await client.query('DELETE FROM calendar_invitations WHERE event_id = $1', [eventId]);

    // Delete the event
    await client.query('DELETE FROM calendar_events WHERE id = $1', [eventId]);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting calendar event:', error);
    res.status(500).json({
      error: 'Internal server error deleting event'
    });
  } finally {
    client.release();
  }
});

/**
 * Update attendee RSVP response
 * PUT /api/calendar/events/:eventId/attendees/:attendeeId/rsvp
 */
router.put('/events/:eventId/attendees/:attendeeId/rsvp', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const eventId = parseInt(req.params.eventId);
    const attendeeId = parseInt(req.params.attendeeId);
    const { response, response_note } = req.body;

    // Validate response
    const validResponses = ['pending', 'accepted', 'declined', 'tentative'];
    if (!validResponses.includes(response)) {
      return res.status(400).json({
        error: 'Invalid response. Must be one of: pending, accepted, declined, tentative'
      });
    }

    // Check if event exists and user has access (owner or attendee)
    const eventQuery = `
      SELECT e.*,
        CASE
          WHEN e.user_id = $1 THEN 'organizer'
          WHEN a.id IS NOT NULL THEN 'attendee'
          ELSE NULL
        END as user_role
      FROM calendar_events e
      LEFT JOIN meeting_attendees a ON e.id = a.event_id AND a.email = (
        SELECT email FROM users WHERE id = $1 LIMIT 1
      )
      WHERE e.id = $2
    `;

    const eventResult = await pool.query(eventQuery, [userId, eventId]);

    if (eventResult.rows.length === 0 || !eventResult.rows[0].user_role) {
      return res.status(404).json({
        error: 'Event not found or access denied'
      });
    }

    // Update attendee response
    const updateQuery = `
      UPDATE meeting_attendees
      SET response = $1, response_note = $2, responded_at = NOW()
      WHERE id = $3 AND event_id = $4
      RETURNING *
    `;

    const updateResult = await pool.query(updateQuery, [
      response, response_note, attendeeId, eventId
    ]);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Attendee not found for this event'
      });
    }

    const updatedAttendee = updateResult.rows[0];

    res.json({
      success: true,
      message: 'RSVP updated successfully',
      attendee: updatedAttendee,
      event_id: eventId
    });

  } catch (error) {
    console.error('Error updating RSVP:', error);
    res.status(500).json({
      error: 'Internal server error updating RSVP'
    });
  }
});

/**
 * Get event attendees with RSVP status
 * GET /api/calendar/events/:eventId/attendees
 */
router.get('/events/:eventId/attendees', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const eventId = parseInt(req.params.eventId);

    // Check if user has access to this event
    const accessQuery = `
      SELECT e.*,
        CASE
          WHEN e.user_id = $1 THEN 'organizer'
          ELSE 'attendee'
        END as user_role
      FROM calendar_events e
      WHERE e.id = $2
    `;

    const accessResult = await pool.query(accessQuery, [userId, eventId]);

    if (accessResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Event not found'
      });
    }

    // Get all attendees for the event
    const attendeesQuery = `
      SELECT
        a.*,
        u.name as user_name
      FROM meeting_attendees a
      LEFT JOIN users u ON a.email = u.email
      WHERE a.event_id = $1
      ORDER BY a.role DESC, a.name ASC
    `;

    const attendeesResult = await pool.query(attendeesQuery, [eventId]);

    // Get response summary
    const summaryQuery = `
      SELECT
        response,
        COUNT(*) as count
      FROM meeting_attendees
      WHERE event_id = $1
      GROUP BY response
    `;

    const summaryResult = await pool.query(summaryQuery, [eventId]);

    const responseSummary = summaryResult.rows.reduce((acc, row) => {
      acc[row.response] = parseInt(row.count);
      return acc;
    }, { pending: 0, accepted: 0, declined: 0, tentative: 0 });

    res.json({
      success: true,
      event: accessResult.rows[0],
      attendees: attendeesResult.rows,
      response_summary: responseSummary,
      total_attendees: attendeesResult.rows.length,
      user_role: accessResult.rows[0].user_role
    });

  } catch (error) {
    console.error('Error fetching event attendees:', error);
    res.status(500).json({
      error: 'Internal server error fetching attendees'
    });
  }
});

/**
 * Add attendee to event
 * POST /api/calendar/events/:eventId/attendees
 */
router.post('/events/:eventId/attendees', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const eventId = parseInt(req.params.eventId);
    const { email, name, role = 'required' } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required'
      });
    }

    // Check if user is the event organizer
    const eventQuery = await pool.query(
      'SELECT * FROM calendar_events WHERE id = $1 AND user_id = $2',
      [eventId, userId]
    );

    if (eventQuery.rows.length === 0) {
      return res.status(404).json({
        error: 'Event not found or you are not the organizer'
      });
    }

    // Check if attendee already exists
    const existingAttendee = await pool.query(
      'SELECT id FROM meeting_attendees WHERE event_id = $1 AND email = $2',
      [eventId, email]
    );

    if (existingAttendee.rows.length > 0) {
      return res.status(409).json({
        error: 'Attendee already added to this event'
      });
    }

    // Add attendee
    const insertQuery = `
      INSERT INTO meeting_attendees (event_id, email, name, role, response)
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING *
    `;

    const result = await pool.query(insertQuery, [eventId, email, name, role]);
    const attendee = result.rows[0];

    // Get the full event details for email invitation
    const eventDetails = await pool.query(`
      SELECT
        e.*,
        u.name as organizer_name,
        u.email as organizer_email
      FROM calendar_events e
      LEFT JOIN users u ON e.user_id = u.id
      WHERE e.id = $1
    `, [eventId]);

    const event = eventDetails.rows[0];

    // Send email invitation
    try {
      // Generate RSVP token
      const rsvpToken = await rsvpTokenManager.generateToken(eventId, email);

      // Send invitation email
      await emailService.sendMeetingInvitation(event, attendee, rsvpToken);
      console.log(`📧 Email invitation sent to ${attendee.email} for event: ${event.title}`);

      // 🔔 CREATE NOTIFICATION INVITATION
      try {
        // Find attendee user ID if they're a registered user
        const attendeeUserQuery = await pool.query(
          'SELECT id FROM users WHERE email = $1 LIMIT 1',
          [email]
        );
        const attendeeUserId = attendeeUserQuery.rows.length > 0
          ? attendeeUserQuery.rows[0].id
          : null;

        // Create calendar invitation and notification using NotificationService
        if (attendeeUserId) {
          console.log(`📧 Creating notification invitation for user ${attendeeUserId} (${email})`);
          await notificationService.createMeetingInvitation(
            eventId,
            email,
            attendeeUserId,
            userId, // organizer user ID
            rsvpToken
          );
          console.log(`✅ Calendar invitation and notification created for ${email}`);
        } else {
          console.log(`📧 User ${email} not found in system - only email invitation sent`);
        }
      } catch (notificationError) {
        console.error('❌ Error creating calendar invitation:', notificationError);
      }

      console.log(`📧 Meeting invitation sent to ${email} for event: ${event.title}`);

      res.status(201).json({
        success: true,
        message: 'Attendee added successfully and invitation sent',
        attendee: attendee,
        emailSent: true
      });
    } catch (emailError) {
      console.error('❌ Failed to send invitation email:', emailError);

      // Still return success since attendee was added, but note email failure
      res.status(201).json({
        success: true,
        message: 'Attendee added successfully, but invitation email failed to send',
        attendee: attendee,
        emailSent: false,
        emailError: emailError.message
      });
    }

  } catch (error) {
    console.error('Error adding attendee:', error);
    res.status(500).json({
      error: 'Internal server error adding attendee'
    });
  }
});

/**
 * Remove attendee from event
 * DELETE /api/calendar/events/:eventId/attendees/:attendeeId
 */
router.delete('/events/:eventId/attendees/:attendeeId', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const eventId = parseInt(req.params.eventId);
    const attendeeId = parseInt(req.params.attendeeId);

    // Check if user is the event organizer
    const eventQuery = await pool.query(
      'SELECT * FROM calendar_events WHERE id = $1 AND user_id = $2',
      [eventId, userId]
    );

    if (eventQuery.rows.length === 0) {
      return res.status(404).json({
        error: 'Event not found or you are not the organizer'
      });
    }

    // Remove attendee
    const deleteResult = await pool.query(
      'DELETE FROM meeting_attendees WHERE id = $1 AND event_id = $2 RETURNING email',
      [attendeeId, eventId]
    );

    if (deleteResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Attendee not found'
      });
    }

    res.json({
      success: true,
      message: 'Attendee removed successfully',
      removed_email: deleteResult.rows[0].email
    });

  } catch (error) {
    console.error('Error removing attendee:', error);
    res.status(500).json({
      error: 'Internal server error removing attendee'
    });
  }
});

/**
 * RSVP Response Handler
 * GET /api/calendar/rsvp?token=xxx&action=accept|decline|tentative|view
 */
router.get('/rsvp', async (req, res) => {
  try {
    const { token, action } = req.query;

    if (!token) {
      return res.status(400).send(`
        <html>
          <head><title>Invalid RSVP Link</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1>❌ Invalid RSVP Link</h1>
            <p>This RSVP link is missing required information.</p>
          </body>
        </html>
      `);
    }

    // Validate token and get event information
    const tokenInfo = await rsvpTokenManager.validateToken(token);

    if (!tokenInfo) {
      return res.status(404).send(`
        <html>
          <head><title>RSVP Link Expired</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1>⏰ RSVP Link Expired</h1>
            <p>This RSVP link has expired or is invalid.</p>
            <p>Please contact the meeting organizer for assistance.</p>
          </body>
        </html>
      `);
    }

    // Handle different actions
    if (!action || action === 'view') {
      // Show RSVP form
      const startDate = new Date(tokenInfo.start_time);
      const endDate = new Date(tokenInfo.end_time);

      return res.send(`
        <html>
          <head>
            <title>RSVP - ${tokenInfo.event_title}</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f8fafc; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
              .content { padding: 30px; }
              .event-details { background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0; }
              .buttons { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin: 30px 0; }
              .btn { padding: 12px 24px; border: none; border-radius: 6px; text-decoration: none; font-weight: 500; cursor: pointer; transition: all 0.2s; }
              .btn-accept { background: #22c55e; color: white; }
              .btn-decline { background: #ef4444; color: white; }
              .btn-tentative { background: #f59e0b; color: white; }
              .btn:hover { transform: translateY(-1px); }
              .current-response { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 15px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>📅 Meeting Invitation</h1>
                <p>You're invited to join this meeting</p>
              </div>
              <div class="content">
                <div class="event-details">
                  <h2>${tokenInfo.event_title}</h2>
                  <p><strong>📅 Date:</strong> ${startDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  <p><strong>🕒 Time:</strong> ${startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} - ${endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</p>
                  ${tokenInfo.location ? `<p><strong>📍 Location:</strong> ${tokenInfo.location}</p>` : ''}
                  ${tokenInfo.description ? `<p><strong>📝 Description:</strong> ${tokenInfo.description}</p>` : ''}
                </div>

                ${tokenInfo.current_response && tokenInfo.current_response !== 'pending' ? `
                <div class="current-response">
                  <strong>Your current response:</strong> ${tokenInfo.current_response.charAt(0).toUpperCase() + tokenInfo.current_response.slice(1)}
                  <br><small>You can change your response using the buttons below.</small>
                </div>
                ` : ''}

                <div class="buttons">
                  <a href="?token=${token}&action=accept" class="btn btn-accept">✓ Accept</a>
                  <a href="?token=${token}&action=tentative" class="btn btn-tentative">? Maybe</a>
                  <a href="?token=${token}&action=decline" class="btn btn-decline">✗ Decline</a>
                </div>
              </div>
            </div>
          </body>
        </html>
      `);
    }

    // Handle RSVP responses
    if (['accept', 'decline', 'tentative'].includes(action)) {
      const responseMap = {
        'accept': 'accepted',
        'decline': 'declined',
        'tentative': 'tentative'
      };

      const response = responseMap[action];

      // Update the response
      const result = await rsvpTokenManager.updateResponse(token, response);

      // Get updated stats
      const stats = await rsvpTokenManager.getEventRSVPStats(result.eventId);

      const responseEmoji = {
        'accepted': '✅',
        'declined': '❌',
        'tentative': '🤔'
      };

      return res.send(`
        <html>
          <head>
            <title>RSVP Confirmed</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f8fafc; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden; }
              .header { background: #22c55e; color: white; padding: 30px; text-align: center; }
              .content { padding: 30px; text-align: center; }
              .stats { background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0; }
              .stat-item { display: inline-block; margin: 0 15px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>${responseEmoji[response]} RSVP Confirmed</h1>
                <p>Thank you for your response!</p>
              </div>
              <div class="content">
                <h2>${result.eventTitle}</h2>
                <p>Your response has been recorded as: <strong>${response.charAt(0).toUpperCase() + response.slice(1)}</strong></p>

                <div class="stats">
                  <h3>Current Responses</h3>
                  <div class="stat-item">✅ Accepted: ${stats.accepted}</div>
                  <div class="stat-item">❌ Declined: ${stats.declined}</div>
                  <div class="stat-item">🤔 Maybe: ${stats.tentative}</div>
                  <div class="stat-item">⏳ Pending: ${stats.pending}</div>
                </div>

                <p><small>You can change your response anytime by clicking the original RSVP link.</small></p>
              </div>
            </div>
          </body>
        </html>
      `);
    }

    // Invalid action
    return res.status(400).send(`
      <html>
        <head><title>Invalid Action</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1>❌ Invalid Action</h1>
          <p>The requested action is not supported.</p>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('Error handling RSVP:', error);
    return res.status(500).send(`
      <html>
        <head><title>RSVP Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1>❌ Something went wrong</h1>
          <p>We couldn't process your RSVP at this time. Please try again later.</p>
        </body>
      </html>
    `);
  }
});

/**
 * Get RSVP statistics for an event
 * GET /api/calendar/events/:eventId/rsvp-stats
 */
router.get('/events/:eventId/rsvp-stats', requireAuth, async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const stats = await rsvpTokenManager.getEventRSVPStats(eventId);

    res.json({
      success: true,
      stats: stats
    });
  } catch (error) {
    console.error('Error getting RSVP stats:', error);
    res.status(500).json({
      error: 'Failed to get RSVP statistics'
    });
  }
});

/**
 * Update invitee's RSVP response from event modal
 * POST /api/calendar/events/:eventId/respond
 */
router.post('/events/:eventId/respond', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const eventId = parseInt(req.params.eventId);
    const { response } = req.body;

    // Validate response
    const validResponses = ['accepted', 'declined', 'tentative'];
    if (!validResponses.includes(response)) {
      return res.status(400).json({
        error: 'Invalid response. Must be one of: accepted, declined, tentative'
      });
    }

    // Get user email
    const userEmailQuery = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    const userEmail = userEmailQuery.rows[0]?.email;

    if (!userEmail) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Check if user is an attendee of this event
    const attendeeQuery = `
      SELECT id FROM meeting_attendees
      WHERE event_id = $1 AND email = $2
    `;
    const attendeeResult = await pool.query(attendeeQuery, [eventId, userEmail]);

    if (attendeeResult.rows.length === 0) {
      return res.status(403).json({
        error: 'You are not an attendee of this event'
      });
    }

    const attendeeId = attendeeResult.rows[0].id;

    // Update meeting_attendees table
    const updateAttendeeQuery = `
      UPDATE meeting_attendees
      SET response = $1, response_time = NOW()
      WHERE id = $2 AND event_id = $3
      RETURNING *
    `;
    await pool.query(updateAttendeeQuery, [response, attendeeId, eventId]);

    // Update calendar_invitations table
    const updateInvitationQuery = `
      UPDATE calendar_invitations
      SET status = $1, response_at = NOW()
      WHERE event_id = $2 AND attendee_email = $3
      RETURNING *
    `;
    await pool.query(updateInvitationQuery, [response, eventId, userEmail]);

    // Mark the invitation notification as read
    await pool.query(`
      UPDATE notifications
      SET is_read = TRUE, read_at = NOW()
      WHERE user_id = $1
        AND type = 'meeting_invitation'
        AND data->>'eventId' = $2
    `, [userId, String(eventId)]);

    // Get updated event with attendees
    const eventQuery = `
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
              'responded_at', a.response_time
            ) ORDER BY a.id
          ) FILTER (WHERE a.id IS NOT NULL),
          '[]'::json
        ) as attendees,
        u.name as organizer_name,
        u.email as organizer_email
      FROM calendar_events e
      LEFT JOIN meeting_attendees a ON e.id = a.event_id
      LEFT JOIN users u ON e.user_id = u.id
      WHERE e.id = $1
      GROUP BY e.id, u.name, u.email
    `;

    const eventResult = await pool.query(eventQuery, [eventId]);

    console.log(`✅ User ${userEmail} responded "${response}" to event ${eventId}`);

    res.json({
      success: true,
      message: `You have ${response} the invitation`,
      response,
      event: eventResult.rows[0]
    });

  } catch (error) {
    console.error('Error updating RSVP response:', error);
    res.status(500).json({
      error: 'Failed to update RSVP response'
    });
  }
});

module.exports = router;