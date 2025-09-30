const { v4: uuidv4 } = require('uuid');
const { query } = require('./db');

class RSVPTokenManager {
  // Generate and store RSVP token
  async generateToken(eventId, attendeeEmail) {
    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // Token expires in 30 days

    await query(`
      INSERT INTO rsvp_tokens (token, event_id, attendee_email, expires_at, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (event_id, attendee_email)
      DO UPDATE SET
        token = $1,
        expires_at = $4,
        created_at = NOW()
    `, [token, eventId, attendeeEmail, expiresAt]);

    return token;
  }

  // Validate and retrieve token information
  async validateToken(token) {
    const result = await query(`
      SELECT
        rt.*,
        e.title as event_title,
        e.start_time,
        e.end_time,
        e.location,
        e.description,
        ma.response as current_response
      FROM rsvp_tokens rt
      JOIN calendar_events e ON rt.event_id = e.id
      LEFT JOIN meeting_attendees ma ON rt.event_id = ma.event_id AND rt.attendee_email = ma.email
      WHERE rt.token = $1 AND rt.expires_at > NOW()
    `, [token]);

    return result.rows[0] || null;
  }

  // Update attendee response
  async updateResponse(token, response) {
    const tokenInfo = await this.validateToken(token);
    if (!tokenInfo) {
      throw new Error('Invalid or expired token');
    }

    // Update the attendee response
    await query(`
      UPDATE meeting_attendees
      SET response = $1, updated_at = NOW()
      WHERE event_id = $2 AND email = $3
    `, [response, tokenInfo.event_id, tokenInfo.attendee_email]);

    // Log the RSVP action
    await query(`
      INSERT INTO rsvp_responses (token, event_id, attendee_email, response, responded_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, [token, tokenInfo.event_id, tokenInfo.attendee_email, response]);

    return {
      success: true,
      eventId: tokenInfo.event_id,
      attendeeEmail: tokenInfo.attendee_email,
      response: response,
      eventTitle: tokenInfo.event_title
    };
  }

  // Get RSVP statistics for an event
  async getEventRSVPStats(eventId) {
    const result = await query(`
      SELECT
        response,
        COUNT(*) as count
      FROM meeting_attendees
      WHERE event_id = $1
      GROUP BY response
    `, [eventId]);

    const stats = {
      accepted: 0,
      declined: 0,
      tentative: 0,
      pending: 0,
      total: 0
    };

    result.rows.forEach(row => {
      stats[row.response] = parseInt(row.count);
      stats.total += parseInt(row.count);
    });

    return stats;
  }

  // Clean up expired tokens
  async cleanupExpiredTokens() {
    const result = await query(`
      DELETE FROM rsvp_tokens
      WHERE expires_at < NOW()
      RETURNING token
    `);

    console.log(`🧹 Cleaned up ${result.rowCount} expired RSVP tokens`);
    return result.rowCount;
  }
}

module.exports = RSVPTokenManager;