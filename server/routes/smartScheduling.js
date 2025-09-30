/**
 * Smart Scheduling API Routes
 * AI-powered scheduling assistance and conflict detection
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { generateText } = require('../lib/ollama');

/**
 * Get smart scheduling suggestions
 * POST /api/calendar/smart-suggestions
 */
router.post('/smart-suggestions', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const {
      title,
      duration = 60, // minutes
      preferred_times = [],
      attendee_emails = [],
      meeting_type = 'personal',
      urgency = 'medium'
    } = req.body;

    // Get user's calendar data for analysis
    const calendarData = await getUserCalendarAnalytics(userId);

    // Get attendee availability if provided
    const attendeeAvailability = await getAttendeeAvailability(attendee_emails);

    // Generate AI-powered suggestions
    const suggestions = await generateSmartSchedulingSuggestions({
      title,
      duration,
      preferred_times,
      attendee_emails,
      meeting_type,
      urgency,
      user_analytics: calendarData,
      attendee_availability: attendeeAvailability
    });

    res.json({
      success: true,
      suggestions,
      analytics: calendarData
    });

  } catch (error) {
    console.error('Error generating smart suggestions:', error);
    res.status(500).json({
      error: 'Internal server error generating suggestions'
    });
  }
});

/**
 * Detect scheduling conflicts
 * POST /api/calendar/conflict-detection
 */
router.post('/conflict-detection', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const { start_time, end_time, attendee_emails = [], exclude_event_id = null } = req.body;

    if (!start_time || !end_time) {
      return res.status(400).json({
        error: 'Start time and end time are required'
      });
    }

    // Check for user conflicts
    const userConflicts = await detectUserConflicts(userId, start_time, end_time, exclude_event_id);

    // Check for room conflicts if room is specified
    let roomConflicts = [];
    if (req.body.room_id) {
      roomConflicts = await detectRoomConflicts(req.body.room_id, start_time, end_time, exclude_event_id);
    }

    // Check for attendee conflicts (if we have access to their calendars)
    const attendeeConflicts = await detectAttendeeConflicts(attendee_emails, start_time, end_time);

    const hasConflicts = userConflicts.length > 0 || roomConflicts.length > 0 || attendeeConflicts.length > 0;

    // Generate alternative suggestions if there are conflicts
    let alternatives = [];
    if (hasConflicts) {
      alternatives = await generateAlternativeTimeSlots({
        original_start: start_time,
        original_end: end_time,
        duration: new Date(end_time) - new Date(start_time),
        attendee_emails,
        room_id: req.body.room_id,
        user_id: userId
      });
    }

    res.json({
      success: true,
      has_conflicts: hasConflicts,
      conflicts: {
        user: userConflicts,
        room: roomConflicts,
        attendees: attendeeConflicts
      },
      alternatives,
      conflict_score: calculateConflictScore(userConflicts, roomConflicts, attendeeConflicts)
    });

  } catch (error) {
    console.error('Error detecting conflicts:', error);
    res.status(500).json({
      error: 'Internal server error detecting conflicts'
    });
  }
});

/**
 * Get optimal meeting times
 * POST /api/calendar/optimal-times
 */
router.post('/optimal-times', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const {
      duration = 60,
      date_range = 7, // days
      attendee_emails = [],
      meeting_type = 'personal',
      time_preferences = {}
    } = req.body;

    // Analyze user's schedule patterns
    const schedulePatterns = await analyzeUserSchedulePatterns(userId);

    // Get attendee patterns if available
    const attendeePatterns = await analyzeAttendeePatterns(attendee_emails);

    // Find optimal time slots
    const optimalTimes = await findOptimalTimeSlots({
      user_id: userId,
      duration,
      date_range,
      attendee_emails,
      meeting_type,
      time_preferences,
      user_patterns: schedulePatterns,
      attendee_patterns: attendeePatterns
    });

    res.json({
      success: true,
      optimal_times: optimalTimes,
      schedule_patterns: schedulePatterns,
      recommendations: await generateTimeRecommendations(optimalTimes, schedulePatterns)
    });

  } catch (error) {
    console.error('Error finding optimal times:', error);
    res.status(500).json({
      error: 'Internal server error finding optimal times'
    });
  }
});

/**
 * Get user calendar analytics
 */
async function getUserCalendarAnalytics(userId) {
  try {
    const analyticsQuery = `
      SELECT
        COUNT(*) as total_events,
        AVG(EXTRACT(EPOCH FROM (end_time - start_time))/60) as avg_duration_minutes,
        EXTRACT(HOUR FROM start_time) as start_hour,
        EXTRACT(DOW FROM start_time) as day_of_week,
        meeting_type,
        COUNT(*) as type_count
      FROM calendar_events
      WHERE user_id = $1
        AND start_time >= NOW() - INTERVAL '30 days'
        AND status != 'cancelled'
      GROUP BY EXTRACT(HOUR FROM start_time), EXTRACT(DOW FROM start_time), meeting_type
      ORDER BY type_count DESC
    `;

    const result = await pool.query(analyticsQuery, [userId]);

    // Process analytics data
    const analytics = {
      total_events: 0,
      avg_duration: 60,
      preferred_hours: [],
      preferred_days: [],
      meeting_type_distribution: {},
      busy_patterns: []
    };

    if (result.rows.length > 0) {
      // Calculate totals and averages
      analytics.total_events = result.rows.reduce((sum, row) => sum + parseInt(row.type_count), 0);
      analytics.avg_duration = Math.round(result.rows[0].avg_duration_minutes || 60);

      // Analyze preferred hours and days
      const hourCounts = {};
      const dayCounts = {};

      result.rows.forEach(row => {
        const hour = parseInt(row.start_hour);
        const day = parseInt(row.day_of_week);
        const type = row.meeting_type;
        const count = parseInt(row.type_count);

        hourCounts[hour] = (hourCounts[hour] || 0) + count;
        dayCounts[day] = (dayCounts[day] || 0) + count;
        analytics.meeting_type_distribution[type] = (analytics.meeting_type_distribution[type] || 0) + count;
      });

      // Get top preferred hours and days
      analytics.preferred_hours = Object.entries(hourCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([hour]) => parseInt(hour));

      analytics.preferred_days = Object.entries(dayCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([day]) => parseInt(day));
    }

    return analytics;

  } catch (error) {
    console.error('Error getting user analytics:', error);
    return {
      total_events: 0,
      avg_duration: 60,
      preferred_hours: [9, 10, 14],
      preferred_days: [1, 2, 3],
      meeting_type_distribution: {},
      busy_patterns: []
    };
  }
}

/**
 * Generate smart scheduling suggestions using AI
 */
async function generateSmartSchedulingSuggestions(data) {
  try {
    const prompt = `
You are a smart scheduling assistant. Based on the following data, suggest optimal meeting times and provide scheduling insights.

Meeting Details:
- Title: ${data.title}
- Duration: ${data.duration} minutes
- Type: ${data.meeting_type}
- Urgency: ${data.urgency}
- Attendees: ${data.attendee_emails.length}

User Calendar Analytics:
- Total events (last 30 days): ${data.user_analytics.total_events}
- Average meeting duration: ${data.user_analytics.avg_duration} minutes
- Preferred hours: ${data.user_analytics.preferred_hours.join(', ')}
- Preferred days: ${data.user_analytics.preferred_days.join(', ')}

Provide suggestions in JSON format:
{
  "best_times": [
    {
      "day": "Monday",
      "time": "10:00 AM",
      "confidence": 0.9,
      "reason": "Matches your preferred morning schedule"
    }
  ],
  "insights": [
    "Your most productive meeting times are...",
    "Consider shorter duration for this type of meeting..."
  ],
  "preparation_suggestions": [
    "Send agenda 24 hours in advance",
    "Book a quiet conference room"
  ]
}
`;

    const response = await generateText(prompt);

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.warn('Failed to parse AI suggestions:', parseError.message);
    }

    // Fallback suggestions
    return {
      best_times: [
        {
          day: "Tuesday",
          time: "10:00 AM",
          confidence: 0.8,
          reason: "Mid-week mornings are typically most productive"
        },
        {
          day: "Wednesday",
          time: "2:00 PM",
          confidence: 0.7,
          reason: "Post-lunch timing works well for team meetings"
        }
      ],
      insights: [
        "Schedule important meetings during your peak hours",
        "Consider the meeting type when choosing duration"
      ],
      preparation_suggestions: [
        "Prepare agenda in advance",
        "Ensure all attendees have calendar access"
      ]
    };

  } catch (error) {
    console.error('Error generating AI suggestions:', error);
    return { best_times: [], insights: [], preparation_suggestions: [] };
  }
}

/**
 * Detect user scheduling conflicts
 */
async function detectUserConflicts(userId, startTime, endTime, excludeEventId = null) {
  try {
    let query = `
      SELECT id, title, start_time, end_time, location
      FROM calendar_events
      WHERE user_id = $1
        AND status != 'cancelled'
        AND (
          (start_time <= $2 AND end_time > $2) OR
          (start_time < $3 AND end_time >= $3) OR
          (start_time >= $2 AND end_time <= $3)
        )
    `;

    const params = [userId, startTime, endTime];

    if (excludeEventId) {
      query += ' AND id != $4';
      params.push(excludeEventId);
    }

    const result = await pool.query(query, params);
    return result.rows;

  } catch (error) {
    console.error('Error detecting user conflicts:', error);
    return [];
  }
}

/**
 * Detect room conflicts
 */
async function detectRoomConflicts(roomId, startTime, endTime, excludeEventId = null) {
  try {
    let query = `
      SELECT e.id, e.title, e.start_time, e.end_time, r.name as room_name
      FROM calendar_events e
      JOIN conference_rooms r ON e.room_id = r.id
      WHERE e.room_id = $1
        AND e.status != 'cancelled'
        AND (
          (e.start_time <= $2 AND e.end_time > $2) OR
          (e.start_time < $3 AND e.end_time >= $3) OR
          (e.start_time >= $2 AND e.end_time <= $3)
        )
    `;

    const params = [roomId, startTime, endTime];

    if (excludeEventId) {
      query += ' AND e.id != $4';
      params.push(excludeEventId);
    }

    const result = await pool.query(query, params);
    return result.rows;

  } catch (error) {
    console.error('Error detecting room conflicts:', error);
    return [];
  }
}

/**
 * Detect attendee conflicts (placeholder - would require integration with attendee calendars)
 */
async function detectAttendeeConflicts(attendeeEmails, startTime, endTime) {
  // This would require integration with external calendar systems
  // For now, return empty array
  return [];
}

/**
 * Calculate conflict severity score
 */
function calculateConflictScore(userConflicts, roomConflicts, attendeeConflicts) {
  let score = 0;

  // User conflicts are most serious
  score += userConflicts.length * 10;

  // Room conflicts are moderately serious
  score += roomConflicts.length * 5;

  // Attendee conflicts depend on implementation
  score += attendeeConflicts.length * 3;

  return Math.min(score, 100); // Cap at 100
}

/**
 * Generate alternative time slots
 */
async function generateAlternativeTimeSlots(options) {
  try {
    const { original_start, original_end, duration, user_id } = options;

    const originalDate = new Date(original_start);
    const alternatives = [];

    // Generate 5 alternative time slots
    for (let i = 1; i <= 5; i++) {
      // Try same day, different times
      const altTime1 = new Date(originalDate);
      altTime1.setHours(originalDate.getHours() + i);

      const altTime2 = new Date(originalDate);
      altTime2.setDate(originalDate.getDate() + i);

      // Check if these times are free
      const conflicts1 = await detectUserConflicts(user_id, altTime1.toISOString(), new Date(altTime1.getTime() + duration).toISOString());
      const conflicts2 = await detectUserConflicts(user_id, altTime2.toISOString(), new Date(altTime2.getTime() + duration).toISOString());

      if (conflicts1.length === 0) {
        alternatives.push({
          start_time: altTime1.toISOString(),
          end_time: new Date(altTime1.getTime() + duration).toISOString(),
          confidence: 0.8,
          reason: 'Same day alternative'
        });
      }

      if (conflicts2.length === 0) {
        alternatives.push({
          start_time: altTime2.toISOString(),
          end_time: new Date(altTime2.getTime() + duration).toISOString(),
          confidence: 0.9,
          reason: 'Next day option'
        });
      }
    }

    return alternatives.slice(0, 3); // Return top 3 alternatives

  } catch (error) {
    console.error('Error generating alternatives:', error);
    return [];
  }
}

/**
 * Analyze user schedule patterns
 */
async function analyzeUserSchedulePatterns(userId) {
  // Implementation would analyze historical data to find patterns
  return {
    peak_hours: [9, 10, 14, 15],
    busy_days: [2, 3, 4], // Tuesday, Wednesday, Thursday
    average_meeting_length: 60,
    preferred_break_duration: 15
  };
}

/**
 * Analyze attendee patterns (placeholder)
 */
async function analyzeAttendeePatterns(attendeeEmails) {
  // Would require external calendar integration
  return {};
}

/**
 * Find optimal time slots
 */
async function findOptimalTimeSlots(options) {
  const { user_id, duration, date_range, user_patterns } = options;
  const optimal_times = [];

  const today = new Date();

  for (let day = 1; day <= date_range; day++) {
    const checkDate = new Date(today);
    checkDate.setDate(today.getDate() + day);

    // Check peak hours for this day
    for (const hour of user_patterns.peak_hours) {
      const slotStart = new Date(checkDate);
      slotStart.setHours(hour, 0, 0, 0);

      const slotEnd = new Date(slotStart.getTime() + duration * 60000);

      // Check for conflicts
      const conflicts = await detectUserConflicts(user_id, slotStart.toISOString(), slotEnd.toISOString());

      if (conflicts.length === 0) {
        optimal_times.push({
          start_time: slotStart.toISOString(),
          end_time: slotEnd.toISOString(),
          confidence: 0.9,
          day_name: slotStart.toLocaleDateString('en-US', { weekday: 'long' }),
          time_label: slotStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        });
      }
    }
  }

  return optimal_times.slice(0, 10); // Return top 10 options
}

/**
 * Generate time recommendations
 */
async function generateTimeRecommendations(optimalTimes, patterns) {
  return [
    "Morning meetings tend to have higher engagement",
    "Consider 15-minute buffers between back-to-back meetings",
    "Tuesday-Thursday are your most productive meeting days"
  ];
}

module.exports = router;