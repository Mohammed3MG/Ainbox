const { Pool } = require('pg');

class CalendarService {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
    // Lazy load to avoid circular dependencies
    this._conflictDetectionService = null;
  }

  get conflictDetectionService() {
    if (!this._conflictDetectionService) {
      const ConflictDetectionService = require('./conflictDetectionService');
      this._conflictDetectionService = new ConflictDetectionService();
    }
    return this._conflictDetectionService;
  }

  // Create a calendar event from an accepted invitation
  async createEventFromInvitation(userId, eventData, invitationData) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Check if user already has this event in their calendar
      const existingEventQuery = `
        SELECT id FROM calendar_events
        WHERE user_id = $1 AND title = $2 AND start_time = $3
      `;

      const existingResult = await client.query(existingEventQuery, [
        userId,
        eventData.title,
        eventData.start_time
      ]);

      if (existingResult.rows.length > 0) {
        console.log(`📅 Event already exists in user ${userId}'s calendar`);
        await client.query('COMMIT');
        return existingResult.rows[0];
      }

      // Create the event in user's calendar
      const eventQuery = `
        INSERT INTO calendar_events (
          user_id, title, description, start_time, end_time, location,
          meeting_type, color, timezone, created_from_invitation, original_event_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;

      const eventResult = await client.query(eventQuery, [
        userId,
        eventData.title,
        eventData.description || '',
        eventData.start_time,
        eventData.end_time,
        eventData.location || '',
        eventData.meeting_type || 'client', // Default to client meeting for invitations
        eventData.color || '#10B981', // Green color for accepted invitations
        'UTC',
        true, // Mark as created from invitation
        eventData.id // Reference to original event
      ]);

      const newEvent = eventResult.rows[0];

      // Add the inviter as an attendee to the user's calendar event
      if (invitationData.organizer_email) {
        const attendeeQuery = `
          INSERT INTO event_attendees (event_id, email, name, status, role)
          VALUES ($1, $2, $3, $4, $5)
        `;

        await client.query(attendeeQuery, [
          newEvent.id,
          invitationData.organizer_email,
          invitationData.organizer_name || invitationData.organizer_email,
          'accepted', // Organizer is always accepted
          'organizer'
        ]);
      }

      // Add the user as an attendee to their own event
      const userQuery = `
        SELECT email, name FROM users WHERE id = $1
      `;
      const userResult = await client.query(userQuery, [userId]);

      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];
        const attendeeQuery = `
          INSERT INTO event_attendees (event_id, email, name, status, role)
          VALUES ($1, $2, $3, $4, $5)
        `;

        await client.query(attendeeQuery, [
          newEvent.id,
          user.email,
          user.name || user.email,
          'accepted',
          'attendee'
        ]);
      }

      await client.query('COMMIT');

      console.log(`📅 Created calendar event "${eventData.title}" for user ${userId}`);

      // Check for conflicts after creating the event
      try {
        await this.conflictDetectionService.checkInvitationConflicts(userId, eventData);
      } catch (conflictError) {
        console.error('⚠️ Error checking conflicts after event creation:', conflictError);
      }

      return newEvent;

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error creating calendar event from invitation:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Update event status when invitation response changes
  async updateEventFromInvitationResponse(userId, eventId, response) {
    try {
      if (response === 'declined') {
        // Remove the event from user's calendar if they decline
        const deleteQuery = `
          DELETE FROM calendar_events
          WHERE user_id = $1 AND original_event_id = $2 AND created_from_invitation = true
        `;

        const result = await this.pool.query(deleteQuery, [userId, eventId]);

        if (result.rowCount > 0) {
          console.log(`📅 Removed declined event from user ${userId}'s calendar`);
        }

        return null;
      } else {
        // For 'accepted' or 'maybe', ensure event exists in calendar
        const eventQuery = `
          SELECT * FROM calendar_events WHERE id = $1
        `;

        const eventResult = await this.pool.query(eventQuery, [eventId]);

        if (eventResult.rows.length > 0) {
          const eventData = eventResult.rows[0];
          const invitationData = { organizer_email: null }; // Will be filled from invitation data

          return await this.createEventFromInvitation(userId, eventData, invitationData);
        }
      }
    } catch (error) {
      console.error('❌ Error updating calendar event from invitation response:', error);
      throw error;
    }
  }

  // Check for scheduling conflicts
  async checkSchedulingConflicts(userId, startTime, endTime, excludeEventId = null) {
    try {
      let query = `
        SELECT id, title, start_time, end_time, location
        FROM calendar_events
        WHERE user_id = $1
        AND (
          (start_time <= $2 AND end_time > $2) OR
          (start_time < $3 AND end_time >= $3) OR
          (start_time >= $2 AND end_time <= $3)
        )
      `;

      const params = [userId, startTime, endTime];

      if (excludeEventId) {
        query += ` AND id != $4`;
        params.push(excludeEventId);
      }

      const result = await this.pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('❌ Error checking scheduling conflicts:', error);
      return [];
    }
  }

  // Get user's calendar events for a date range
  async getUserEvents(userId, startDate, endDate) {
    try {
      const query = `
        SELECT * FROM calendar_events
        WHERE user_id = $1
        AND start_time >= $2
        AND start_time <= $3
        ORDER BY start_time ASC
      `;

      const result = await this.pool.query(query, [userId, startDate, endDate]);
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching user events:', error);
      return [];
    }
  }
}

module.exports = CalendarService;