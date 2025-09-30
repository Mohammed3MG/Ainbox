const { Pool } = require('pg');
// const EmailService = require('./emailService');
// const CalendarService = require('./calendarService');

class NotificationService {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
    // this.emailService = new EmailService();
    // this.calendarService = new CalendarService();
  }

  // Create a new notification
  async createNotification(userId, type, title, message, data = {}, expiresAt = null) {
    try {
      const query = `
        INSERT INTO notifications (user_id, type, title, message, data, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;

      const result = await this.pool.query(query, [
        userId, type, title, message, JSON.stringify(data), expiresAt
      ]);

      console.log(`📢 Created notification: ${title} for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error creating notification:', error);
      throw error;
    }
  }

  // Get notifications for a user
  async getUserNotifications(userId, limit = 50, unreadOnly = false) {
    try {
      let query = `
        SELECT * FROM notifications
        WHERE user_id = $1
        ${unreadOnly ? 'AND is_read = FALSE' : ''}
        AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY created_at DESC
        LIMIT $2
      `;

      const result = await this.pool.query(query, [userId, limit]);
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching notifications:', error);
      throw error;
    }
  }

  // Get notification count for a user
  async getNotificationCount(userId, unreadOnly = true) {
    try {
      const query = `
        SELECT COUNT(*) as count FROM notifications
        WHERE user_id = $1
        ${unreadOnly ? 'AND is_read = FALSE' : ''}
        AND (expires_at IS NULL OR expires_at > NOW())
      `;

      const result = await this.pool.query(query, [userId]);
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error('❌ Error counting notifications:', error);
      return 0;
    }
  }

  // Mark notification as read
  async markAsRead(notificationId, userId) {
    try {
      const query = `
        UPDATE notifications
        SET is_read = TRUE, read_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING *
      `;

      const result = await this.pool.query(query, [notificationId, userId]);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error marking notification as read:', error);
      throw error;
    }
  }

  // Mark all notifications as read for a user
  async markAllAsRead(userId) {
    try {
      const query = `
        UPDATE notifications
        SET is_read = TRUE, read_at = NOW()
        WHERE user_id = $1 AND is_read = FALSE
      `;

      await this.pool.query(query, [userId]);
      console.log(`✅ Marked all notifications as read for user ${userId}`);
    } catch (error) {
      console.error('❌ Error marking all notifications as read:', error);
      throw error;
    }
  }

  // Create a meeting invitation notification
  async createMeetingInvitation(eventId, attendeeEmail, attendeeUserId, organizerUserId, responseToken) {
    try {
      // Insert invitation record
      const invitationQuery = `
        INSERT INTO calendar_invitations
        (event_id, attendee_email, attendee_user_id, organizer_user_id, response_token)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (event_id, attendee_email)
        DO UPDATE SET response_token = EXCLUDED.response_token
        RETURNING *
      `;

      const invitationResult = await this.pool.query(invitationQuery, [
        eventId, attendeeEmail, attendeeUserId, organizerUserId, responseToken
      ]);

      // If attendee is a user of our system, create in-app notification
      if (attendeeUserId) {
        // Get event details
        const eventQuery = `
          SELECT title, start_time, location
          FROM calendar_events
          WHERE id = $1
        `;
        const eventResult = await this.pool.query(eventQuery, [eventId]);
        const event = eventResult.rows[0];

        if (event) {
          const title = 'New Meeting Invitation';
          const message = `You've been invited to "${event.title}" on ${new Date(event.start_time).toLocaleDateString()}`;
          const data = {
            type: 'meeting_invitation',
            eventId,
            responseToken,
            event
          };

          await this.createNotification(
            attendeeUserId,
            'meeting_invitation',
            title,
            message,
            data
          );
        }
      }

      return invitationResult.rows[0];
    } catch (error) {
      console.error('❌ Error creating meeting invitation:', error);
      throw error;
    }
  }

  // Handle RSVP response and notify organizer
  async handleRSVPResponse(responseToken, response, attendeeName = null) {
    try {
      // Update invitation status
      const updateQuery = `
        UPDATE calendar_invitations
        SET status = $1, response_at = NOW()
        WHERE response_token = $2
        RETURNING *
      `;

      const updateResult = await this.pool.query(updateQuery, [response, responseToken]);
      const invitation = updateResult.rows[0];

      if (!invitation) {
        throw new Error('Invalid response token');
      }

      // Get event and organizer details
      const eventQuery = `
        SELECT ce.*, u.email as organizer_email, u.name as organizer_name
        FROM calendar_events ce
        JOIN users u ON ce.user_id = u.id
        WHERE ce.id = $1
      `;

      const eventResult = await this.pool.query(eventQuery, [invitation.event_id]);
      const event = eventResult.rows[0];

      if (event) {
        // Update meeting_attendees table with response
        const attendeeDisplay = attendeeName || invitation.attendee_email;

        // Map response values: 'maybe' -> 'tentative' for database
        const dbResponse = response === 'maybe' ? 'tentative' : response;

        // Update or insert the meeting_attendees table
        await this.pool.query(`
          INSERT INTO meeting_attendees (event_id, email, name, response, response_time)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (event_id, email)
          DO UPDATE SET response = $4, response_time = NOW()
        `, [invitation.event_id, invitation.attendee_email, attendeeDisplay, dbResponse]);

        console.log(`✅ ${attendeeDisplay} ${response} invitation to "${event.title}"`);

        // Mark the notification as read
        if (invitation.attendee_user_id) {
          await this.pool.query(`
            UPDATE notifications
            SET is_read = TRUE, read_at = NOW()
            WHERE user_id = $1 AND data->>'eventId' = $2 AND type = 'meeting_invitation'
          `, [invitation.attendee_user_id, invitation.event_id.toString()]);
        }

        // Handle calendar integration for the attendee (no notification created)
        if (invitation.attendee_user_id) {
          await this.handleCalendarIntegration(invitation, event, response);
        }

        // Note: No in-app notifications are sent for RSVP responses per requirements
        // Organizers can view responses in the event details modal
      }

      return invitation;
    } catch (error) {
      console.error('❌ Error handling RSVP response:', error);
      throw error;
    }
  }

  // Get notification preferences for a user
  async getNotificationPreferences(userId) {
    try {
      const query = `SELECT * FROM notification_preferences WHERE user_id = $1`;
      const result = await this.pool.query(query, [userId]);

      if (result.rows.length === 0) {
        // Create default preferences
        return await this.createDefaultNotificationPreferences(userId);
      }

      return result.rows[0];
    } catch (error) {
      console.error('❌ Error fetching notification preferences:', error);
      return null;
    }
  }

  // Create default notification preferences
  async createDefaultNotificationPreferences(userId) {
    try {
      const query = `
        INSERT INTO notification_preferences (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
        RETURNING *
      `;

      const result = await this.pool.query(query, [userId]);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error creating notification preferences:', error);
      return null;
    }
  }

  // Get calendar invitations for a user
  async getUserInvitations(userId, status = null) {
    try {
      let query = `
        SELECT ci.*, ce.title, ce.description, ce.start_time, ce.end_time, ce.location,
               u.name as organizer_name, u.email as organizer_email
        FROM calendar_invitations ci
        JOIN calendar_events ce ON ci.event_id = ce.id
        JOIN users u ON ci.organizer_user_id = u.id
        WHERE ci.attendee_user_id = $1
      `;

      const params = [userId];

      if (status) {
        query += ` AND ci.status = $2`;
        params.push(status);
      }

      query += ` ORDER BY ci.invitation_sent_at DESC`;

      const result = await this.pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching user invitations:', error);
      return [];
    }
  }

  // Handle calendar integration for RSVP responses
  async handleCalendarIntegration(invitation, event, response) {
    try {
      const userId = invitation.attendee_user_id;

      if (response === 'accepted') {
        console.log(`📅 User ${userId} accepted event "${event.title}"`);
        // Response is already saved in calendar_invitations and meeting_attendees tables
        // No notification is created per requirements
      } else if (response === 'declined') {
        console.log(`📅 User ${userId} declined event "${event.title}"`);
        // Response is already saved in calendar_invitations and meeting_attendees tables
        // No notification is created per requirements
      } else if (response === 'maybe') {
        console.log(`📅 User ${userId} marked as maybe for event "${event.title}"`);
        // Response is already saved in calendar_invitations and meeting_attendees tables
        // No notification is created per requirements
      }

      // Note: No in-app notifications are created for RSVP responses
      // Users can view their response status and others' responses in the event details modal

    } catch (error) {
      console.error('❌ Error handling calendar integration:', error);
      // Don't create error notifications per requirements
    }
  }

  // Clean up expired notifications
  async cleanupExpiredNotifications() {
    try {
      const query = `
        DELETE FROM notifications
        WHERE expires_at IS NOT NULL AND expires_at < NOW()
      `;

      const result = await this.pool.query(query);
      console.log(`🧹 Cleaned up ${result.rowCount} expired notifications`);
      return result.rowCount;
    } catch (error) {
      console.error('❌ Error cleaning up notifications:', error);
      return 0;
    }
  }
}

module.exports = NotificationService;