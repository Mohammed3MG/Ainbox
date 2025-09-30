const { Pool } = require('pg');
const NotificationService = require('./notificationService');

class ConflictDetectionService {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
    this.notificationService = new NotificationService();
  }

  // Detect conflicts when accepting meeting invitations
  async checkInvitationConflicts(userId, eventData) {
    try {
      const conflicts = await this.findTimeConflicts(
        userId,
        eventData.start_time,
        eventData.end_time
      );

      if (conflicts.length > 0) {
        await this.createConflictNotification(userId, eventData, conflicts);
        return {
          hasConflicts: true,
          conflicts: conflicts,
          severity: this.calculateConflictSeverity(conflicts)
        };
      }

      return { hasConflicts: false, conflicts: [] };
    } catch (error) {
      console.error('❌ Error checking invitation conflicts:', error);
      return { hasConflicts: false, conflicts: [] };
    }
  }

  // Find time conflicts for a specific time period
  async findTimeConflicts(userId, startTime, endTime, excludeEventId = null) {
    try {
      let query = `
        SELECT
          ce.*,
          array_agg(
            json_build_object(
              'email', ea.email,
              'name', ea.name,
              'status', ea.status,
              'role', ea.role
            )
          ) as attendees
        FROM calendar_events ce
        LEFT JOIN event_attendees ea ON ce.id = ea.event_id
        WHERE ce.user_id = $1
        AND (
          (ce.start_time < $3 AND ce.end_time > $2) OR
          (ce.start_time >= $2 AND ce.start_time < $3) OR
          (ce.end_time > $2 AND ce.end_time <= $3)
        )
      `;

      const params = [userId, startTime, endTime];

      if (excludeEventId) {
        query += ` AND ce.id != $4`;
        params.push(excludeEventId);
      }

      query += ` GROUP BY ce.id ORDER BY ce.start_time ASC`;

      const result = await this.pool.query(query, params);
      return result.rows.map(row => ({
        ...row,
        attendees: row.attendees.filter(a => a.email !== null) // Remove null attendees
      }));
    } catch (error) {
      console.error('❌ Error finding time conflicts:', error);
      return [];
    }
  }

  // Calculate conflict severity based on overlap and meeting types
  calculateConflictSeverity(conflicts) {
    let maxSeverity = 'low';

    for (const conflict of conflicts) {
      // High priority meeting types
      if (conflict.meeting_type === 'client' || conflict.meeting_type === 'important') {
        maxSeverity = 'high';
      }
      // Medium priority if we haven't found high priority yet
      else if (maxSeverity === 'low' &&
               (conflict.meeting_type === 'team' || conflict.meeting_type === 'interview')) {
        maxSeverity = 'medium';
      }
    }

    return maxSeverity;
  }

  // Create conflict notification for the user
  async createConflictNotification(userId, newEvent, conflicts) {
    try {
      const conflictCount = conflicts.length;
      const severityEmoji = {
        'high': '🚨',
        'medium': '⚠️',
        'low': '📅'
      };

      const severity = this.calculateConflictSeverity(conflicts);
      const title = `${severityEmoji[severity]} Scheduling Conflict Detected`;

      const conflictList = conflicts.map(c =>
        `• ${c.title} (${this.formatTime(c.start_time)} - ${this.formatTime(c.end_time)})`
      ).join('\n');

      const message = `The event "${newEvent.title}" conflicts with ${conflictCount} existing event${conflictCount > 1 ? 's' : ''}:\n\n${conflictList}`;

      const data = {
        type: 'scheduling_conflict',
        newEvent: {
          title: newEvent.title,
          start_time: newEvent.start_time,
          end_time: newEvent.end_time,
          location: newEvent.location
        },
        conflicts: conflicts.map(c => ({
          id: c.id,
          title: c.title,
          start_time: c.start_time,
          end_time: c.end_time,
          location: c.location,
          meeting_type: c.meeting_type
        })),
        severity,
        conflictCount
      };

      await this.notificationService.createNotification(
        userId,
        'conflict',
        title,
        message,
        data,
        new Date(Date.now() + 24 * 60 * 60 * 1000) // Expires in 24 hours
      );

      console.log(`🚨 Created conflict notification for user ${userId}: ${conflictCount} conflict(s) detected`);
    } catch (error) {
      console.error('❌ Error creating conflict notification:', error);
    }
  }

  // Check for conflicts when creating new events
  async validateNewEvent(userId, eventData) {
    try {
      const conflicts = await this.findTimeConflicts(
        userId,
        eventData.start_time,
        eventData.end_time
      );

      const conflictAnalysis = {
        hasConflicts: conflicts.length > 0,
        conflicts: conflicts,
        severity: conflicts.length > 0 ? this.calculateConflictSeverity(conflicts) : 'none',
        recommendations: this.generateRecommendations(conflicts, eventData)
      };

      // Create notification for high severity conflicts
      if (conflictAnalysis.severity === 'high') {
        await this.createConflictNotification(userId, eventData, conflicts);
      }

      return conflictAnalysis;
    } catch (error) {
      console.error('❌ Error validating new event:', error);
      return { hasConflicts: false, conflicts: [], severity: 'none', recommendations: [] };
    }
  }

  // Generate smart recommendations for conflict resolution
  generateRecommendations(conflicts, newEvent) {
    const recommendations = [];

    if (conflicts.length === 0) return recommendations;

    // Analyze gaps between conflicts for rescheduling suggestions
    const sortedConflicts = conflicts.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    const newEventDuration = new Date(newEvent.end_time) - new Date(newEvent.start_time);

    // Check for gaps before the first conflict
    const firstConflict = sortedConflicts[0];
    const gapBeforeFirst = new Date(firstConflict.start_time) - new Date(newEvent.start_time);

    if (gapBeforeFirst >= newEventDuration) {
      recommendations.push({
        type: 'reschedule',
        suggestion: 'Move earlier',
        timeSlot: {
          start: new Date(new Date(firstConflict.start_time) - newEventDuration),
          end: new Date(firstConflict.start_time)
        }
      });
    }

    // Check for gaps between conflicts
    for (let i = 0; i < sortedConflicts.length - 1; i++) {
      const currentEnd = new Date(sortedConflicts[i].end_time);
      const nextStart = new Date(sortedConflicts[i + 1].start_time);
      const gap = nextStart - currentEnd;

      if (gap >= newEventDuration) {
        recommendations.push({
          type: 'reschedule',
          suggestion: `Move to gap between conflicts`,
          timeSlot: {
            start: currentEnd,
            end: new Date(currentEnd.getTime() + newEventDuration)
          }
        });
      }
    }

    // Check for gaps after the last conflict
    const lastConflict = sortedConflicts[sortedConflicts.length - 1];
    const gapAfterLast = new Date(newEvent.end_time) - new Date(lastConflict.end_time);

    if (gapAfterLast >= 0) {
      recommendations.push({
        type: 'reschedule',
        suggestion: 'Move later',
        timeSlot: {
          start: new Date(lastConflict.end_time),
          end: new Date(new Date(lastConflict.end_time).getTime() + newEventDuration)
        }
      });
    }

    // Suggest shortening if conflicts are not critical
    const nonCriticalConflicts = conflicts.filter(c =>
      c.meeting_type !== 'client' && c.meeting_type !== 'important'
    );

    if (nonCriticalConflicts.length > 0 && nonCriticalConflicts.length < conflicts.length) {
      recommendations.push({
        type: 'modify',
        suggestion: 'Consider rescheduling non-critical conflicting meetings',
        conflicts: nonCriticalConflicts.map(c => ({ id: c.id, title: c.title }))
      });
    }

    return recommendations.slice(0, 3); // Limit to 3 recommendations
  }

  // Format time for display in notifications
  formatTime(dateString) {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  }

  // Get conflict statistics for a user
  async getConflictStats(userId, dateRange = 30) {
    try {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + dateRange);

      const query = `
        SELECT
          COUNT(*) as total_events,
          COUNT(CASE WHEN created_from_invitation = true THEN 1 END) as invitation_events,
          AVG(EXTRACT(EPOCH FROM (end_time - start_time))/3600) as avg_duration_hours
        FROM calendar_events
        WHERE user_id = $1
        AND start_time BETWEEN $2 AND $3
      `;

      const result = await this.pool.query(query, [userId, startDate, endDate]);
      const stats = result.rows[0];

      // Calculate conflict density
      const events = await this.pool.query(`
        SELECT start_time, end_time FROM calendar_events
        WHERE user_id = $1 AND start_time BETWEEN $2 AND $3
        ORDER BY start_time
      `, [userId, startDate, endDate]);

      let conflictCount = 0;
      for (let i = 0; i < events.rows.length - 1; i++) {
        const current = events.rows[i];
        const next = events.rows[i + 1];

        if (new Date(current.end_time) > new Date(next.start_time)) {
          conflictCount++;
        }
      }

      return {
        totalEvents: parseInt(stats.total_events),
        invitationEvents: parseInt(stats.invitation_events),
        avgDurationHours: parseFloat(stats.avg_duration_hours) || 0,
        conflictCount,
        conflictRate: stats.total_events > 0 ? (conflictCount / stats.total_events * 100).toFixed(1) : 0
      };
    } catch (error) {
      console.error('❌ Error getting conflict stats:', error);
      return {
        totalEvents: 0,
        invitationEvents: 0,
        avgDurationHours: 0,
        conflictCount: 0,
        conflictRate: 0
      };
    }
  }

  // Bulk conflict check for multiple events
  async checkBulkConflicts(userId, events) {
    try {
      const results = [];

      for (const event of events) {
        const conflicts = await this.findTimeConflicts(
          userId,
          event.start_time,
          event.end_time,
          event.id // Exclude the event itself if it's an update
        );

        results.push({
          eventId: event.id || null,
          eventTitle: event.title,
          hasConflicts: conflicts.length > 0,
          conflicts: conflicts,
          severity: conflicts.length > 0 ? this.calculateConflictSeverity(conflicts) : 'none'
        });
      }

      return results;
    } catch (error) {
      console.error('❌ Error in bulk conflict check:', error);
      return [];
    }
  }
}

module.exports = ConflictDetectionService;