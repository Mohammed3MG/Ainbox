/**
 * Meeting Templates API Routes
 * Handles meeting templates for recurring events and quick scheduling
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');

/**
 * Get all meeting templates for user
 * GET /api/calendar/templates
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);

    const query = `
      SELECT
        t.*,
        COUNT(e.id) as usage_count,
        MAX(e.created_at) as last_used
      FROM meeting_templates t
      LEFT JOIN calendar_events e ON t.id = e.template_id
      WHERE t.user_id = $1 AND t.is_active = true
      GROUP BY t.id
      ORDER BY t.meeting_type, t.name
    `;

    const result = await pool.query(query, [userId]);

    const templates = result.rows.map(template => ({
      ...template,
      attendee_emails: template.attendee_emails || [],
      settings: template.settings || {},
      ai_suggestions: template.ai_suggestions || {}
    }));

    res.json({
      success: true,
      templates,
      count: templates.length
    });

  } catch (error) {
    console.error('Error fetching meeting templates:', error);
    res.status(500).json({
      error: 'Internal server error fetching templates'
    });
  }
});

/**
 * Get a specific meeting template
 * GET /api/calendar/templates/:id
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const templateId = parseInt(req.params.id);

    const query = `
      SELECT * FROM meeting_templates
      WHERE id = $1 AND user_id = $2 AND is_active = true
    `;

    const result = await pool.query(query, [templateId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Template not found'
      });
    }

    const template = result.rows[0];
    template.attendee_emails = template.attendee_emails || [];
    template.settings = template.settings || {};
    template.ai_suggestions = template.ai_suggestions || {};

    res.json({
      success: true,
      template
    });

  } catch (error) {
    console.error('Error fetching meeting template:', error);
    res.status(500).json({
      error: 'Internal server error fetching template'
    });
  }
});

/**
 * Create a new meeting template
 * POST /api/calendar/templates
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const {
      name,
      meeting_type,
      default_duration = 30,
      default_agenda,
      default_location,
      recurrence_pattern,
      attendee_emails = [],
      settings = {}
    } = req.body;

    // Validation
    if (!name || !meeting_type) {
      return res.status(400).json({
        error: 'Name and meeting type are required'
      });
    }

    // Check for duplicate names
    const existingTemplate = await pool.query(
      'SELECT id FROM meeting_templates WHERE user_id = $1 AND name = $2 AND is_active = true',
      [userId, name]
    );

    if (existingTemplate.rows.length > 0) {
      return res.status(409).json({
        error: 'Template with this name already exists'
      });
    }

    const query = `
      INSERT INTO meeting_templates (
        user_id, name, meeting_type, default_duration, default_agenda,
        default_location, recurrence_pattern, attendee_emails, settings
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const result = await pool.query(query, [
      userId, name, meeting_type, default_duration, default_agenda,
      default_location, recurrence_pattern, attendee_emails, JSON.stringify(settings)
    ]);

    const template = result.rows[0];
    template.attendee_emails = template.attendee_emails || [];
    template.settings = template.settings || {};

    res.status(201).json({
      success: true,
      message: 'Template created successfully',
      template
    });

  } catch (error) {
    console.error('Error creating meeting template:', error);
    res.status(500).json({
      error: 'Internal server error creating template'
    });
  }
});

/**
 * Update a meeting template
 * PUT /api/calendar/templates/:id
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const templateId = parseInt(req.params.id);
    const {
      name,
      meeting_type,
      default_duration,
      default_agenda,
      default_location,
      recurrence_pattern,
      attendee_emails,
      settings
    } = req.body;

    // Check if template exists and user owns it
    const existingTemplate = await pool.query(
      'SELECT * FROM meeting_templates WHERE id = $1 AND user_id = $2 AND is_active = true',
      [templateId, userId]
    );

    if (existingTemplate.rows.length === 0) {
      return res.status(404).json({
        error: 'Template not found'
      });
    }

    // Check for duplicate names (excluding current template)
    if (name) {
      const duplicateCheck = await pool.query(
        'SELECT id FROM meeting_templates WHERE user_id = $1 AND name = $2 AND id != $3 AND is_active = true',
        [userId, name, templateId]
      );

      if (duplicateCheck.rows.length > 0) {
        return res.status(409).json({
          error: 'Template with this name already exists'
        });
      }
    }

    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    const fieldsToUpdate = {
      name, meeting_type, default_duration, default_agenda,
      default_location, recurrence_pattern, attendee_emails, settings
    };

    Object.entries(fieldsToUpdate).forEach(([field, value]) => {
      if (value !== undefined) {
        if (field === 'settings') {
          updateFields.push(`${field} = $${paramIndex}`);
          updateValues.push(JSON.stringify(value));
        } else {
          updateFields.push(`${field} = $${paramIndex}`);
          updateValues.push(value);
        }
        paramIndex++;
      }
    });

    updateFields.push(`updated_at = NOW()`);

    const updateQuery = `
      UPDATE meeting_templates
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
      RETURNING *
    `;

    updateValues.push(templateId, userId);

    const result = await pool.query(updateQuery, updateValues);
    const template = result.rows[0];
    template.attendee_emails = template.attendee_emails || [];
    template.settings = template.settings || {};

    res.json({
      success: true,
      message: 'Template updated successfully',
      template
    });

  } catch (error) {
    console.error('Error updating meeting template:', error);
    res.status(500).json({
      error: 'Internal server error updating template'
    });
  }
});

/**
 * Delete a meeting template (soft delete)
 * DELETE /api/calendar/templates/:id
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const templateId = parseInt(req.params.id);

    // Check if template exists and user owns it
    const existingTemplate = await pool.query(
      'SELECT * FROM meeting_templates WHERE id = $1 AND user_id = $2 AND is_active = true',
      [templateId, userId]
    );

    if (existingTemplate.rows.length === 0) {
      return res.status(404).json({
        error: 'Template not found'
      });
    }

    // Soft delete (mark as inactive)
    await pool.query(
      'UPDATE meeting_templates SET is_active = false, updated_at = NOW() WHERE id = $1',
      [templateId]
    );

    res.json({
      success: true,
      message: 'Template deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting meeting template:', error);
    res.status(500).json({
      error: 'Internal server error deleting template'
    });
  }
});

/**
 * Create event from template
 * POST /api/calendar/templates/:id/create-event
 */
router.post('/:id/create-event', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const templateId = parseInt(req.params.id);
    const { start_time, end_time, overrides = {} } = req.body;

    if (!start_time) {
      return res.status(400).json({
        error: 'Start time is required'
      });
    }

    // Get template
    const templateQuery = await pool.query(
      'SELECT * FROM meeting_templates WHERE id = $1 AND user_id = $2 AND is_active = true',
      [templateId, userId]
    );

    if (templateQuery.rows.length === 0) {
      return res.status(404).json({
        error: 'Template not found'
      });
    }

    const template = templateQuery.rows[0];

    // Calculate end time if not provided
    let eventEndTime = end_time;
    if (!eventEndTime) {
      const startDate = new Date(start_time);
      const endDate = new Date(startDate.getTime() + (template.default_duration * 60000));
      eventEndTime = endDate.toISOString();
    }

    // Create event from template
    const eventData = {
      title: overrides.title || template.name,
      description: overrides.description || template.default_agenda,
      start_time,
      end_time: eventEndTime,
      location: overrides.location || template.default_location,
      meeting_type: template.meeting_type,
      template_id: templateId,
      attendees: overrides.attendees || template.attendee_emails?.map(email => ({
        email,
        role: 'required'
      })) || []
    };

    // Forward to event creation endpoint
    const eventCreationResponse = await fetch(`${req.protocol}://${req.get('host')}/api/calendar/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.authorization
      },
      body: JSON.stringify(eventData)
    });

    if (eventCreationResponse.ok) {
      const eventResult = await eventCreationResponse.json();
      res.status(201).json({
        success: true,
        message: 'Event created from template successfully',
        event: eventResult.event,
        template: template
      });
    } else {
      const errorResult = await eventCreationResponse.json();
      res.status(eventCreationResponse.status).json(errorResult);
    }

  } catch (error) {
    console.error('Error creating event from template:', error);
    res.status(500).json({
      error: 'Internal server error creating event from template'
    });
  }
});

/**
 * Get template usage analytics
 * GET /api/calendar/templates/:id/analytics
 */
router.get('/:id/analytics', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const templateId = parseInt(req.params.id);

    // Check if template exists and user owns it
    const templateQuery = await pool.query(
      'SELECT * FROM meeting_templates WHERE id = $1 AND user_id = $2 AND is_active = true',
      [templateId, userId]
    );

    if (templateQuery.rows.length === 0) {
      return res.status(404).json({
        error: 'Template not found'
      });
    }

    // Get usage analytics
    const analyticsQuery = `
      SELECT
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as events_last_30_days,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as events_last_7_days,
        AVG(EXTRACT(EPOCH FROM (end_time - start_time))/60) as avg_duration_minutes,
        MAX(created_at) as last_used,
        COUNT(DISTINCT DATE(start_time)) as unique_days_used
      FROM calendar_events
      WHERE template_id = $1 AND user_id = $2
    `;

    const analyticsResult = await pool.query(analyticsQuery, [templateId, userId]);
    const analytics = analyticsResult.rows[0];

    // Get most common attendees
    const attendeesQuery = `
      SELECT
        a.email,
        a.name,
        COUNT(*) as frequency
      FROM calendar_events e
      JOIN meeting_attendees a ON e.id = a.event_id
      WHERE e.template_id = $1 AND e.user_id = $2
      GROUP BY a.email, a.name
      ORDER BY frequency DESC
      LIMIT 10
    `;

    const attendeesResult = await pool.query(attendeesQuery, [templateId, userId]);

    res.json({
      success: true,
      template: templateQuery.rows[0],
      analytics: {
        ...analytics,
        total_events: parseInt(analytics.total_events),
        events_last_30_days: parseInt(analytics.events_last_30_days),
        events_last_7_days: parseInt(analytics.events_last_7_days),
        avg_duration_minutes: parseFloat(analytics.avg_duration_minutes) || 0,
        unique_days_used: parseInt(analytics.unique_days_used)
      },
      frequent_attendees: attendeesResult.rows
    });

  } catch (error) {
    console.error('Error fetching template analytics:', error);
    res.status(500).json({
      error: 'Internal server error fetching analytics'
    });
  }
});

module.exports = router;