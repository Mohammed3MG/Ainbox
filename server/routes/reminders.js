const express = require('express');
const router = express.Router();
const ReminderService = require('../lib/reminderService');
const { requireAuth } = require('../middleware/auth');

const reminderService = new ReminderService();

// Get reminder statistics
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const stats = await reminderService.getReminderStats(parseInt(days));

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error fetching reminder stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reminder statistics'
    });
  }
});

// Manually trigger reminder processing (admin/testing)
router.post('/process', requireAuth, async (req, res) => {
  try {
    // Optional: Add admin check here
    const remindersSent = await reminderService.processOverdueReminders();

    res.json({
      success: true,
      remindersSent,
      message: `Processed reminders, sent ${remindersSent} reminder(s)`
    });
  } catch (error) {
    console.error('Error processing reminders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process reminders'
    });
  }
});

// Send test reminder for specific invitation
router.post('/test/:invitationId', requireAuth, async (req, res) => {
  try {
    const { invitationId } = req.params;
    const { intervalHours = 24 } = req.body;

    await reminderService.sendTestReminder(
      parseInt(invitationId),
      parseInt(intervalHours)
    );

    res.json({
      success: true,
      message: `Test reminder sent for invitation ${invitationId}`
    });
  } catch (error) {
    console.error('Error sending test reminder:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send test reminder'
    });
  }
});

// Get pending invitations that need reminders
router.get('/pending', requireAuth, async (req, res) => {
  try {
    const pendingInvitations = await reminderService.getPendingInvitations();

    // Filter to only show invitations for this user's events (if organizer)
    const userInvitations = pendingInvitations.filter(
      invitation => invitation.organizer_user_id === req.user.id
    );

    res.json({
      success: true,
      invitations: userInvitations
    });
  } catch (error) {
    console.error('Error fetching pending invitations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending invitations'
    });
  }
});

// Get reminder log for specific invitation
router.get('/log/:invitationId', requireAuth, async (req, res) => {
  try {
    const { invitationId } = req.params;

    const query = `
      SELECT
        rl.*,
        ci.organizer_user_id,
        ce.title as event_title
      FROM reminder_log rl
      JOIN calendar_invitations ci ON rl.invitation_id = ci.id
      JOIN calendar_events ce ON ci.event_id = ce.id
      WHERE rl.invitation_id = $1
      AND ci.organizer_user_id = $2
      ORDER BY rl.sent_at DESC
    `;

    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const result = await pool.query(query, [invitationId, req.user.id]);

    res.json({
      success: true,
      reminderLog: result.rows
    });
  } catch (error) {
    console.error('Error fetching reminder log:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reminder log'
    });
  }
});

// Update user's reminder preferences
router.post('/preferences', requireAuth, async (req, res) => {
  try {
    const {
      reminder_notifications = true,
      reminder_email = true,
      reminder_intervals = '24,4,1'
    } = req.body;

    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const query = `
      INSERT INTO notification_preferences (
        user_id, reminder_notifications, reminder_email, reminder_intervals
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id)
      DO UPDATE SET
        reminder_notifications = EXCLUDED.reminder_notifications,
        reminder_email = EXCLUDED.reminder_email,
        reminder_intervals = EXCLUDED.reminder_intervals,
        updated_at = NOW()
      RETURNING *
    `;

    const result = await pool.query(query, [
      req.user.id,
      reminder_notifications,
      reminder_email,
      reminder_intervals
    ]);

    res.json({
      success: true,
      preferences: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating reminder preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update reminder preferences'
    });
  }
});

// Get user's reminder preferences
router.get('/preferences', requireAuth, async (req, res) => {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const query = `
      SELECT reminder_notifications, reminder_email, reminder_intervals
      FROM notification_preferences
      WHERE user_id = $1
    `;

    const result = await pool.query(query, [req.user.id]);

    if (result.rows.length === 0) {
      // Return default preferences if none exist
      res.json({
        success: true,
        preferences: {
          reminder_notifications: true,
          reminder_email: true,
          reminder_intervals: '24,4,1'
        }
      });
    } else {
      res.json({
        success: true,
        preferences: result.rows[0]
      });
    }
  } catch (error) {
    console.error('Error fetching reminder preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reminder preferences'
    });
  }
});

module.exports = router;