const nodemailer = require('nodemailer');
const ical = require('ical-generator').default;
const { v4: uuidv4 } = require('uuid');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      // Configure your email provider here
      // For development, you can use ethereal email or Gmail
      host: process.env.SMTP_HOST || 'smtp.ethereal.email',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  // Generate calendar invitation (.ics file)
  generateCalendarInvite(event, attendeeEmail, rsvpToken) {
    const calendar = ical({
      domain: process.env.DOMAIN || 'ainbox.com',
      name: 'Ainbox Calendar',
      prodId: {
        company: 'Ainbox',
        product: 'Calendar System',
        language: 'EN'
      }
    });

    const startDate = new Date(event.start_time);
    const endDate = new Date(event.end_time);

    const calendarEvent = calendar.createEvent({
      start: startDate,
      end: endDate,
      summary: event.title,
      description: event.description || '',
      location: event.location || '',
      uid: `${event.id}-${attendeeEmail}@ainbox.com`,
      sequence: 0,
      status: 'CONFIRMED',
      organizer: {
        name: event.organizer_name || 'Ainbox Calendar',
        email: event.organizer_email || process.env.SMTP_FROM || 'noreply@ainbox.com'
      },
      attendees: [{
        name: attendeeEmail.split('@')[0],
        email: attendeeEmail,
        rsvp: true,
        status: 'NEEDS-ACTION'
      }],
      method: 'REQUEST'
    });

    // Add RSVP links as event URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    calendarEvent.url(`${baseUrl}/api/calendar/rsvp?token=${rsvpToken}&action=view`);

    return calendar.toString();
  }

  // Professional HTML email template
  generateInvitationEmail(event, attendee, rsvpToken) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const acceptUrl = `${baseUrl}/api/calendar/rsvp?token=${rsvpToken}&action=accept`;
    const declineUrl = `${baseUrl}/api/calendar/rsvp?token=${rsvpToken}&action=decline`;
    const tentativeUrl = `${baseUrl}/api/calendar/rsvp?token=${rsvpToken}&action=tentative`;

    const startDate = new Date(event.start_time);
    const endDate = new Date(event.end_time);

    const formatDate = (date) => {
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    const formatTime = (date) => {
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short'
      });
    };

    const duration = Math.round((endDate - startDate) / (1000 * 60)); // minutes
    const formatDuration = (minutes) => {
      if (minutes < 60) return `${minutes} minutes`;
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours} hour${hours > 1 ? 's' : ''}`;
    };

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Meeting Invitation - ${event.title}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f8fafc;
        }
        .container {
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
        }
        .header p {
            margin: 8px 0 0 0;
            opacity: 0.9;
            font-size: 16px;
        }
        .content {
            padding: 30px;
        }
        .meeting-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 24px;
            margin: 20px 0;
        }
        .meeting-title {
            font-size: 20px;
            font-weight: 600;
            color: #1e293b;
            margin: 0 0 16px 0;
        }
        .meeting-details {
            display: grid;
            gap: 12px;
        }
        .detail-item {
            display: flex;
            align-items: flex-start;
            gap: 12px;
        }
        .detail-icon {
            width: 20px;
            height: 20px;
            margin-top: 2px;
            flex-shrink: 0;
        }
        .detail-content {
            flex: 1;
        }
        .detail-label {
            font-weight: 500;
            color: #475569;
            font-size: 14px;
        }
        .detail-value {
            color: #1e293b;
            font-size: 16px;
            margin-top: 2px;
        }
        .description {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 16px;
            margin-top: 20px;
            color: #475569;
            line-height: 1.5;
        }
        .rsvp-section {
            margin: 30px 0;
            text-align: center;
        }
        .rsvp-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 16px;
            color: #1e293b;
        }
        .rsvp-buttons {
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
        }
        .rsvp-button {
            display: inline-block;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 500;
            font-size: 14px;
            transition: all 0.2s;
            min-width: 80px;
            text-align: center;
        }
        .btn-accept {
            background-color: #22c55e;
            color: white;
        }
        .btn-accept:hover {
            background-color: #16a34a;
        }
        .btn-decline {
            background-color: #ef4444;
            color: white;
        }
        .btn-decline:hover {
            background-color: #dc2626;
        }
        .btn-tentative {
            background-color: #f59e0b;
            color: white;
        }
        .btn-tentative:hover {
            background-color: #d97706;
        }
        .footer {
            background: #f8fafc;
            padding: 24px 30px;
            border-top: 1px solid #e2e8f0;
            font-size: 14px;
            color: #64748b;
            text-align: center;
        }
        .calendar-attachment {
            background: #eff6ff;
            border: 1px solid #bfdbfe;
            border-radius: 6px;
            padding: 16px;
            margin: 20px 0;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .calendar-icon {
            width: 24px;
            height: 24px;
            color: #3b82f6;
        }
        .meeting-type-badge {
            display: inline-block;
            background: #e0e7ff;
            color: #3730a3;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 500;
            text-transform: capitalize;
            margin-top: 8px;
        }
        @media (max-width: 480px) {
            .rsvp-buttons {
                flex-direction: column;
                align-items: center;
            }
            .rsvp-button {
                width: 200px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📅 Meeting Invitation</h1>
            <p>You've been invited to join a meeting</p>
        </div>

        <div class="content">
            <div class="meeting-card">
                <h2 class="meeting-title">${event.title}</h2>
                ${event.meeting_type ? `<span class="meeting-type-badge">${event.meeting_type.replace('-', ' ')}</span>` : ''}

                <div class="meeting-details">
                    <div class="detail-item">
                        <svg class="detail-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                        </svg>
                        <div class="detail-content">
                            <div class="detail-label">Date</div>
                            <div class="detail-value">${formatDate(startDate)}</div>
                        </div>
                    </div>

                    <div class="detail-item">
                        <svg class="detail-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <div class="detail-content">
                            <div class="detail-label">Time</div>
                            <div class="detail-value">${formatTime(startDate)} - ${formatTime(endDate)}</div>
                            <div class="detail-label" style="margin-top: 4px;">Duration: ${formatDuration(duration)}</div>
                        </div>
                    </div>

                    ${event.location ? `
                    <div class="detail-item">
                        <svg class="detail-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                        </svg>
                        <div class="detail-content">
                            <div class="detail-label">Location</div>
                            <div class="detail-value">${event.location}</div>
                        </div>
                    </div>
                    ` : ''}

                    <div class="detail-item">
                        <svg class="detail-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                        </svg>
                        <div class="detail-content">
                            <div class="detail-label">Organizer</div>
                            <div class="detail-value">${event.organizer_name || 'Meeting Organizer'}</div>
                        </div>
                    </div>
                </div>

                ${event.description ? `
                <div class="description">
                    <strong>About this meeting:</strong><br>
                    ${event.description.replace(/\n/g, '<br>')}
                </div>
                ` : ''}
            </div>

            <div class="calendar-attachment">
                <svg class="calendar-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                </svg>
                <div>
                    <strong>Calendar invitation attached</strong><br>
                    <small>Add this meeting to your calendar by opening the .ics attachment</small>
                </div>
            </div>

            <div class="rsvp-section">
                <h3 class="rsvp-title">Will you attend this meeting?</h3>
                <div class="rsvp-buttons">
                    <a href="${acceptUrl}" class="rsvp-button btn-accept">✓ Accept</a>
                    <a href="${tentativeUrl}" class="rsvp-button btn-tentative">? Maybe</a>
                    <a href="${declineUrl}" class="rsvp-button btn-decline">✗ Decline</a>
                </div>
            </div>
        </div>

        <div class="footer">
            <p>This invitation was sent by Ainbox Calendar System</p>
            <p>If you have any questions about this meeting, please contact the organizer directly.</p>
        </div>
    </div>
</body>
</html>`;
  }

  // Send meeting invitation email
  async sendMeetingInvitation(event, attendee, rsvpToken) {
    try {
      const icsContent = this.generateCalendarInvite(event, attendee.email, rsvpToken);
      const htmlContent = this.generateInvitationEmail(event, attendee, rsvpToken);

      const mailOptions = {
        from: process.env.SMTP_FROM || 'Ainbox Calendar <noreply@ainbox.com>',
        to: attendee.email,
        subject: `📅 Meeting Invitation: ${event.title}`,
        html: htmlContent,
        attachments: [{
          filename: `meeting-${event.id}.ics`,
          content: icsContent,
          contentType: 'text/calendar; charset=utf-8; method=REQUEST'
        }],
        headers: {
          'X-Mailer': 'Ainbox Calendar System',
          'X-Meeting-ID': event.id.toString(),
          'X-RSVP-Token': rsvpToken
        }
      };

      const result = await this.transporter.sendMail(mailOptions);

      console.log(`📧 Meeting invitation sent successfully to ${attendee.email}`);
      console.log(`📧 Message ID: ${result.messageId}`);

      return {
        success: true,
        messageId: result.messageId,
        recipient: attendee.email
      };
    } catch (error) {
      console.error('❌ Failed to send meeting invitation:', error);
      throw error;
    }
  }

  // Send meeting update notification
  async sendMeetingUpdate(event, attendee, rsvpToken, changeDescription) {
    try {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const viewUrl = `${baseUrl}/api/calendar/rsvp?token=${rsvpToken}&action=view`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Meeting Update - ${event.title}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f59e0b; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: white; padding: 20px; border: 1px solid #ddd; border-radius: 0 0 8px 8px; }
        .update-notice { background: #fef3c7; border: 1px solid #f59e0b; padding: 15px; border-radius: 6px; margin: 15px 0; }
        .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 5px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📝 Meeting Updated</h1>
    </div>
    <div class="content">
        <div class="update-notice">
            <strong>⚠️ This meeting has been updated:</strong><br>
            ${changeDescription}
        </div>
        <h2>${event.title}</h2>
        <p><strong>Date:</strong> ${new Date(event.start_time).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        <p><strong>Time:</strong> ${new Date(event.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} - ${new Date(event.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</p>
        ${event.location ? `<p><strong>Location:</strong> ${event.location}</p>` : ''}
        ${event.description ? `<p><strong>Description:</strong> ${event.description}</p>` : ''}
        <p style="text-align: center;">
            <a href="${viewUrl}" class="button">View Updated Meeting Details</a>
        </p>
    </div>
</body>
</html>`;

      const icsContent = this.generateCalendarInvite(event, attendee.email, rsvpToken);

      const mailOptions = {
        from: process.env.SMTP_FROM || 'Ainbox Calendar <noreply@ainbox.com>',
        to: attendee.email,
        subject: `📝 Meeting Update: ${event.title}`,
        html: htmlContent,
        attachments: [{
          filename: `meeting-update-${event.id}.ics`,
          content: icsContent,
          contentType: 'text/calendar; charset=utf-8; method=REQUEST'
        }]
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(`📧 Meeting update sent to ${attendee.email}`);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('❌ Failed to send meeting update:', error);
      throw error;
    }
  }

  // Send meeting reminder
  async sendMeetingReminder(event, attendee, reminderTime = '1 hour') {
    try {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const viewUrl = `${baseUrl}/calendar/events/${event.id}`;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Meeting Reminder - ${event.title}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #8b5cf6; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: white; padding: 20px; border: 1px solid #ddd; border-radius: 0 0 8px 8px; }
        .reminder-notice { background: #f3e8ff; border: 1px solid #8b5cf6; padding: 15px; border-radius: 6px; margin: 15px 0; }
        .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 5px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>⏰ Meeting Reminder</h1>
    </div>
    <div class="content">
        <div class="reminder-notice">
            <strong>🔔 Reminder: You have a meeting starting in ${reminderTime}</strong>
        </div>
        <h2>${event.title}</h2>
        <p><strong>Date:</strong> ${new Date(event.start_time).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        <p><strong>Time:</strong> ${new Date(event.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} - ${new Date(event.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</p>
        ${event.location ? `<p><strong>Location:</strong> ${event.location}</p>` : ''}
        ${event.description ? `<p><strong>Description:</strong> ${event.description}</p>` : ''}
        <p style="text-align: center;">
            <a href="${viewUrl}" class="button">View Meeting Details</a>
        </p>
    </div>
</body>
</html>`;

      const mailOptions = {
        from: process.env.SMTP_FROM || 'Ainbox Calendar <noreply@ainbox.com>',
        to: attendee.email,
        subject: `⏰ Reminder: ${event.title} starts in ${reminderTime}`,
        html: htmlContent
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(`📧 Meeting reminder sent to ${attendee.email}`);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('❌ Failed to send meeting reminder:', error);
      throw error;
    }
  }
}

module.exports = EmailService;