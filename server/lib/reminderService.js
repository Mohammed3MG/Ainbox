const { Pool } = require('pg');
const NotificationService = require('./notificationService');
const EmailService = require('./emailService');

class ReminderService {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
    this.notificationService = new NotificationService();
    this.emailService = new EmailService();
    this.reminderIntervals = [
      { hours: 24, label: '1 day' },
      { hours: 4, label: '4 hours' },
      { hours: 1, label: '1 hour' }
    ];
  }

  // Initialize reminder job scheduling
  async initializeReminderJobs() {
    try {
      // Run reminder check every hour
      setInterval(() => {
        this.processOverdueReminders().catch(error => {
          console.error('❌ Error processing overdue reminders:', error);
        });
      }, 60 * 60 * 1000); // Every hour

      console.log('🔔 Reminder service initialized');
    } catch (error) {
      console.error('❌ Error initializing reminder service:', error);
    }
  }

  // Process overdue reminders
  async processOverdueReminders() {
    try {
      console.log('🔔 Processing overdue reminders...');

      const pendingInvitations = await this.getPendingInvitations();
      let remindersSent = 0;

      for (const invitation of pendingInvitations) {
        const remindersSentCount = await this.sendReminderIfDue(invitation);
        remindersSent += remindersSentCount;
      }

      if (remindersSent > 0) {
        console.log(`📧 Sent ${remindersSent} reminder(s)`);
      }

      return remindersSent;
    } catch (error) {
      console.error('❌ Error processing overdue reminders:', error);
      return 0;
    }
  }

  // Get pending invitations that might need reminders
  async getPendingInvitations() {
    try {
      const query = `
        SELECT
          ci.*,
          ce.title as event_title,
          ce.description as event_description,
          ce.start_time,
          ce.end_time,
          ce.location,
          u_organizer.name as organizer_name,
          u_organizer.email as organizer_email,
          u_attendee.name as attendee_name,
          u_attendee.email as attendee_user_email
        FROM calendar_invitations ci
        JOIN calendar_events ce ON ci.event_id = ce.id
        JOIN users u_organizer ON ci.organizer_user_id = u_organizer.id
        LEFT JOIN users u_attendee ON ci.attendee_user_id = u_attendee.id
        WHERE ci.status = 'pending'
        AND ce.start_time > NOW()
        AND ce.start_time > NOW() + INTERVAL '30 minutes'
        ORDER BY ce.start_time ASC
      `;

      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching pending invitations:', error);
      return [];
    }
  }

  // Send reminder if it's due
  async sendReminderIfDue(invitation) {
    try {
      const eventStart = new Date(invitation.start_time);
      const now = new Date();
      const hoursUntilEvent = (eventStart - now) / (1000 * 60 * 60);

      let remindersSent = 0;

      for (const interval of this.reminderIntervals) {
        if (hoursUntilEvent <= interval.hours && hoursUntilEvent > 0) {
          const wasReminderSent = await this.checkIfReminderSent(
            invitation.id,
            interval.hours
          );

          if (!wasReminderSent) {
            await this.sendReminder(invitation, interval);
            await this.recordReminderSent(invitation.id, interval.hours);
            remindersSent++;
          }
        }
      }

      return remindersSent;
    } catch (error) {
      console.error('❌ Error checking/sending reminder:', error);
      return 0;
    }
  }

  // Check if reminder was already sent for this interval
  async checkIfReminderSent(invitationId, intervalHours) {
    try {
      const query = `
        SELECT id FROM reminder_log
        WHERE invitation_id = $1 AND reminder_interval_hours = $2
      `;

      const result = await this.pool.query(query, [invitationId, intervalHours]);
      return result.rows.length > 0;
    } catch (error) {
      console.error('❌ Error checking reminder log:', error);
      return true; // Assume sent to avoid spam
    }
  }

  // Record that a reminder was sent
  async recordReminderSent(invitationId, intervalHours) {
    try {
      const query = `
        INSERT INTO reminder_log (invitation_id, reminder_interval_hours, sent_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (invitation_id, reminder_interval_hours) DO NOTHING
      `;

      await this.pool.query(query, [invitationId, intervalHours]);
    } catch (error) {
      console.error('❌ Error recording reminder sent:', error);
    }
  }

  // Send actual reminder notification and email
  async sendReminder(invitation, interval) {
    try {
      const eventTime = this.formatEventTime(invitation.start_time);
      const title = `⏰ Reminder: Response Needed - ${invitation.event_title}`;

      let message;
      if (interval.hours >= 24) {
        message = `Your response is still needed for \"${invitation.event_title}\" tomorrow at ${eventTime}. Please respond to help the organizer plan accordingly.`;
      } else if (interval.hours >= 4) {
        message = `Urgent: \"${invitation.event_title}\" starts in ${interval.label} at ${eventTime}. Please respond now if you plan to attend.`;
      } else {
        message = `Final reminder: \"${invitation.event_title}\" starts in ${interval.label} at ${eventTime}. Last chance to respond!`;
      }

      const notificationData = {
        type: 'reminder',
        invitationId: invitation.id,
        eventId: invitation.event_id,
        responseToken: invitation.response_token,
        interval: interval,
        event: {
          title: invitation.event_title,
          start_time: invitation.start_time,
          end_time: invitation.end_time,
          location: invitation.location,
          description: invitation.event_description
        },
        organizer: {
          name: invitation.organizer_name,
          email: invitation.organizer_email
        }
      };

      // Send in-app notification if user is registered
      if (invitation.attendee_user_id) {
        await this.notificationService.createNotification(
          invitation.attendee_user_id,
          'reminder',
          title,
          message,
          notificationData,
          new Date(Date.now() + 6 * 60 * 60 * 1000) // Expires in 6 hours
        );
      }

      // Send email reminder
      await this.sendEmailReminder(invitation, interval, message);

      // Notify organizer about reminder sent (for urgent reminders only)
      if (interval.hours <= 4) {
        await this.notifyOrganizerAboutReminder(invitation, interval);
      }

      console.log(`📧 Sent ${interval.label} reminder for \"${invitation.event_title}\" to ${invitation.attendee_email}`);
    } catch (error) {
      console.error('❌ Error sending reminder:', error);
    }
  }

  // Send email reminder
  async sendEmailReminder(invitation, interval, message) {
    try {
      const eventTime = this.formatEventTime(invitation.start_time);
      const eventDate = this.formatEventDate(invitation.start_time);

      let urgencyLevel = 'normal';
      let subject = `Response Requested: ${invitation.event_title}`;

      if (interval.hours <= 1) {
        urgencyLevel = 'high';
        subject = `🔴 URGENT: Response Required - ${invitation.event_title} starts in 1 hour`;
      } else if (interval.hours <= 4) {
        urgencyLevel = 'medium';
        subject = `⏰ Response Needed Soon - ${invitation.event_title}`;
      }

      const emailContent = {
        subject: subject,
        html: this.generateReminderEmailHTML(invitation, interval, urgencyLevel),
        text: this.generateReminderEmailText(invitation, interval, message)
      };

      await this.emailService.sendEmail(
        invitation.attendee_email,
        invitation.attendee_name || invitation.attendee_email,
        emailContent.subject,
        emailContent.html,
        emailContent.text
      );
    } catch (error) {
      console.error('❌ Error sending email reminder:', error);
    }
  }

  // Generate HTML email for reminder
  generateReminderEmailHTML(invitation, interval, urgencyLevel) {
    const eventTime = this.formatEventTime(invitation.start_time);
    const eventDate = this.formatEventDate(invitation.start_time);
    const responseUrl = `${process.env.CLIENT_URL}/rsvp/${invitation.response_token}`;

    const urgencyColors = {
      high: { bg: '#FEE2E2', border: '#EF4444', button: '#DC2626' },
      medium: { bg: '#FEF3C7', border: '#F59E0B', button: '#D97706' },
      normal: { bg: '#DBEAFE', border: '#3B82F6', button: '#2563EB' }
    };

    const colors = urgencyColors[urgencyLevel];

    return `
      <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
        <div style="background: ${colors.bg}; border-left: 4px solid ${colors.border}; padding: 20px; margin-bottom: 20px;">
          <h2 style="margin: 0 0 10px 0; color: #1F2937;">
            ⏰ Reminder: Response Needed
          </h2>
          <p style="margin: 0; color: #374151; font-weight: 500;">
            ${interval.hours <= 1 ? 'Urgent: ' : ''}Your response is still needed for an upcoming meeting.
          </p>
        </div>

        <div style="background: white; border: 1px solid #E5E7EB; border-radius: 8px; padding: 24px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 16px 0; color: #1F2937; font-size: 20px;">
            ${invitation.event_title}
          </h3>

          <div style="margin-bottom: 12px;">
            <strong style="color: #374151;">📅 Date:</strong>
            <span style="color: #6B7280;">${eventDate}</span>
          </div>

          <div style="margin-bottom: 12px;">
            <strong style="color: #374151;">🕐 Time:</strong>
            <span style="color: #6B7280;">${eventTime}</span>
          </div>

          ${invitation.location ? `
          <div style="margin-bottom: 12px;">
            <strong style="color: #374151;">📍 Location:</strong>
            <span style="color: #6B7280;">${invitation.location}</span>
          </div>
          ` : ''}

          <div style="margin-bottom: 12px;">
            <strong style="color: #374151;">👤 Organizer:</strong>
            <span style="color: #6B7280;">${invitation.organizer_name}</span>
          </div>

          ${invitation.event_description ? `
          <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #E5E7EB;">
            <strong style="color: #374151;">Description:</strong>
            <p style="margin: 8px 0 0 0; color: #6B7280;">${invitation.event_description}</p>
          </div>
          ` : ''}
        </div>

        <div style="text-align: center; margin-bottom: 24px;">
          <p style="margin: 0 0 16px 0; color: #374151; font-size: 16px;">
            ${interval.hours <= 1 ?
              '🔴 <strong>This meeting starts in 1 hour!</strong> Please respond immediately.' :
              interval.hours <= 4 ?
              '⏰ This meeting starts soon. Please respond as soon as possible.' :
              'Please let the organizer know if you can attend.'
            }
          </p>

          <div style="display: inline-block;">
            <a href="${responseUrl}" style="display: inline-block; padding: 12px 24px; background: ${colors.button}; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; margin: 0 8px;">
              Respond Now
            </a>
          </div>
        </div>

        <div style="border-top: 1px solid #E5E7EB; padding-top: 16px; text-align: center;">
          <p style="margin: 0; color: #9CA3AF; font-size: 12px;">
            This is an automated reminder from Ainbox.
            <a href="${responseUrl}" style="color: #6B7280;">Click here to respond</a>
          </p>
        </div>
      </div>
    `;
  }

  // Generate text email for reminder
  generateReminderEmailText(invitation, interval, message) {
    const eventTime = this.formatEventTime(invitation.start_time);
    const eventDate = this.formatEventDate(invitation.start_time);
    const responseUrl = `${process.env.CLIENT_URL}/rsvp/${invitation.response_token}`;

    return `
REMINDER: Response Needed

${message}

Event Details:
- Title: ${invitation.event_title}
- Date: ${eventDate}
- Time: ${eventTime}
${invitation.location ? `- Location: ${invitation.location}` : ''}
- Organizer: ${invitation.organizer_name}

${invitation.event_description ? `Description: ${invitation.event_description}\n` : ''}

Please respond: ${responseUrl}

This is an automated reminder from Ainbox.
    `.trim();
  }

  // Notify organizer about reminder sent (for urgent reminders)
  async notifyOrganizerAboutReminder(invitation, interval) {
    try {
      if (interval.hours > 4) return; // Only for urgent reminders

      const title = `📧 Reminder Sent`;
      const message = `A ${interval.label} reminder was sent to ${invitation.attendee_email} for \"${invitation.event_title}\". They still haven't responded.`;

      const data = {
        type: 'reminder_sent',
        eventId: invitation.event_id,
        attendeeEmail: invitation.attendee_email,
        interval: interval,
        event: {
          title: invitation.event_title,
          start_time: invitation.start_time
        }
      };

      await this.notificationService.createNotification(
        invitation.organizer_user_id,
        'reminder',
        title,
        message,
        data,
        new Date(Date.now() + 2 * 60 * 60 * 1000) // Expires in 2 hours
      );
    } catch (error) {
      console.error('❌ Error notifying organizer:', error);
    }
  }

  // Get reminder statistics
  async getReminderStats(dateRange = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - dateRange);

      const query = `
        SELECT
          COUNT(*) as total_reminders,
          COUNT(DISTINCT invitation_id) as unique_invitations,
          AVG(reminder_interval_hours) as avg_reminder_interval,
          COUNT(CASE WHEN reminder_interval_hours = 24 THEN 1 END) as day_before_reminders,
          COUNT(CASE WHEN reminder_interval_hours = 4 THEN 1 END) as urgent_reminders,
          COUNT(CASE WHEN reminder_interval_hours = 1 THEN 1 END) as final_reminders
        FROM reminder_log
        WHERE sent_at >= $1
      `;

      const result = await this.pool.query(query, [startDate]);
      const stats = result.rows[0];

      return {
        totalReminders: parseInt(stats.total_reminders),
        uniqueInvitations: parseInt(stats.unique_invitations),
        avgReminderInterval: parseFloat(stats.avg_reminder_interval) || 0,
        dayBeforeReminders: parseInt(stats.day_before_reminders),
        urgentReminders: parseInt(stats.urgent_reminders),
        finalReminders: parseInt(stats.final_reminders),
        responseRate: await this.calculateResponseRate(dateRange)
      };
    } catch (error) {
      console.error('❌ Error getting reminder stats:', error);
      return {
        totalReminders: 0,
        uniqueInvitations: 0,
        avgReminderInterval: 0,
        dayBeforeReminders: 0,
        urgentReminders: 0,
        finalReminders: 0,
        responseRate: 0
      };
    }
  }

  // Calculate response rate after reminders
  async calculateResponseRate(dateRange) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - dateRange);

      const query = `
        SELECT
          COUNT(DISTINCT ci.id) as total_reminded_invitations,
          COUNT(DISTINCT CASE WHEN ci.status != 'pending' THEN ci.id END) as responded_after_reminder
        FROM calendar_invitations ci
        JOIN reminder_log rl ON ci.id = rl.invitation_id
        WHERE rl.sent_at >= $1
      `;

      const result = await this.pool.query(query, [startDate]);
      const stats = result.rows[0];

      const total = parseInt(stats.total_reminded_invitations);
      const responded = parseInt(stats.responded_after_reminder);

      return total > 0 ? ((responded / total) * 100).toFixed(1) : 0;
    } catch (error) {
      console.error('❌ Error calculating response rate:', error);
      return 0;
    }
  }

  // Manual trigger for testing
  async sendTestReminder(invitationId, intervalHours = 24) {
    try {
      const query = `
        SELECT
          ci.*,
          ce.title as event_title,
          ce.description as event_description,
          ce.start_time,
          ce.end_time,
          ce.location,
          u_organizer.name as organizer_name,
          u_organizer.email as organizer_email,
          u_attendee.name as attendee_name
        FROM calendar_invitations ci
        JOIN calendar_events ce ON ci.event_id = ce.id
        JOIN users u_organizer ON ci.organizer_user_id = u_organizer.id
        LEFT JOIN users u_attendee ON ci.attendee_user_id = u_attendee.id
        WHERE ci.id = $1
      `;

      const result = await this.pool.query(query, [invitationId]);

      if (result.rows.length === 0) {
        throw new Error('Invitation not found');
      }

      const invitation = result.rows[0];
      const interval = this.reminderIntervals.find(i => i.hours === intervalHours) ||
                      { hours: intervalHours, label: `${intervalHours} hours` };

      await this.sendReminder(invitation, interval);
      console.log(`✅ Test reminder sent for invitation ${invitationId}`);

      return true;
    } catch (error) {
      console.error('❌ Error sending test reminder:', error);
      throw error;
    }
  }

  // Format time for display
  formatEventTime(dateString) {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    }).format(date);
  }

  // Format date for display
  formatEventDate(dateString) {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(date);
  }
}

module.exports = ReminderService;