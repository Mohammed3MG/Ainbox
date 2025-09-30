const express = require('express');
const router = express.Router();
const ConflictDetectionService = require('../lib/conflictDetectionService');
const { requireAuth } = require('../middleware/auth');

const conflictService = new ConflictDetectionService();

// Check conflicts for a specific time slot
router.post('/check', requireAuth, async (req, res) => {
  try {
    const { start_time, end_time, exclude_event_id } = req.body;

    if (!start_time || !end_time) {
      return res.status(400).json({
        success: false,
        message: 'start_time and end_time are required'
      });
    }

    const conflicts = await conflictService.findTimeConflicts(
      req.user.id,
      start_time,
      end_time,
      exclude_event_id
    );

    const analysis = {
      hasConflicts: conflicts.length > 0,
      conflicts: conflicts,
      severity: conflicts.length > 0 ? conflictService.calculateConflictSeverity(conflicts) : 'none',
      conflictCount: conflicts.length
    };

    res.json({
      success: true,
      ...analysis
    });
  } catch (error) {
    console.error('Error checking conflicts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check conflicts'
    });
  }
});

// Validate a new event for conflicts
router.post('/validate', requireAuth, async (req, res) => {
  try {
    const eventData = req.body;

    if (!eventData.start_time || !eventData.end_time) {
      return res.status(400).json({
        success: false,
        message: 'Event start_time and end_time are required'
      });
    }

    const validation = await conflictService.validateNewEvent(req.user.id, eventData);

    res.json({
      success: true,
      ...validation
    });
  } catch (error) {
    console.error('Error validating event:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate event'
    });
  }
});

// Get conflict statistics for the user
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const stats = await conflictService.getConflictStats(req.user.id, parseInt(days));

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error fetching conflict stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conflict statistics'
    });
  }
});

// Bulk conflict check for multiple events
router.post('/bulk-check', requireAuth, async (req, res) => {
  try {
    const { events } = req.body;

    if (!Array.isArray(events)) {
      return res.status(400).json({
        success: false,
        message: 'events must be an array'
      });
    }

    const results = await conflictService.checkBulkConflicts(req.user.id, events);

    res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('Error in bulk conflict check:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check bulk conflicts'
    });
  }
});

// Check conflicts for a specific invitation before accepting
router.post('/invitation/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required'
      });
    }

    // Get invitation details first
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const invitationQuery = `
      SELECT ci.*, ce.title, ce.start_time, ce.end_time, ce.location
      FROM calendar_invitations ci
      JOIN calendar_events ce ON ci.event_id = ce.id
      WHERE ci.response_token = $1
    `;

    const invitationResult = await pool.query(invitationQuery, [token]);

    if (invitationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Invitation not found'
      });
    }

    const invitation = invitationResult.rows[0];
    const eventData = {
      title: invitation.title,
      start_time: invitation.start_time,
      end_time: invitation.end_time,
      location: invitation.location
    };

    const conflicts = await conflictService.checkInvitationConflicts(userId, eventData);

    res.json({
      success: true,
      invitation: eventData,
      ...conflicts
    });
  } catch (error) {
    console.error('Error checking invitation conflicts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check invitation conflicts'
    });
  }
});

module.exports = router;