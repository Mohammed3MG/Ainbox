/**
 * Email to Event Conversion API Routes
 * Handles converting emails into calendar events with AI assistance
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { generateText } = require('../lib/ollama');

/**
 * Convert email to calendar event
 * POST /api/calendar/convert-email
 */
router.post('/convert-email', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);
    const { emailId, messageId, emailContent, suggestions = {} } = req.body;

    if (!emailContent) {
      return res.status(400).json({
        error: 'Email content is required'
      });
    }

    // Extract event information using AI
    const eventData = await extractEventFromEmail(emailContent, suggestions);

    // If we have a messageId, try to get additional context from the database
    let emailContext = null;
    if (messageId) {
      try {
        const emailQuery = await pool.query(
          'SELECT subject, sender_email, sender_name, received_at FROM messages WHERE id = $1 AND user_id = $2',
          [messageId, userId]
        );

        if (emailQuery.rows.length > 0) {
          emailContext = emailQuery.rows[0];
        }
      } catch (error) {
        console.warn('Could not fetch email context:', error.message);
      }
    }

    // Enhance event data with email context
    if (emailContext) {
      eventData.title = eventData.title || emailContext.subject;
      eventData.description = eventData.description ||
        `Event created from email from ${emailContext.sender_name || emailContext.sender_email}`;

      // Add sender as attendee if not already present
      if (emailContext.sender_email &&
          !eventData.attendees?.some(a => a.email === emailContext.sender_email)) {
        eventData.attendees = eventData.attendees || [];
        eventData.attendees.push({
          email: emailContext.sender_email,
          name: emailContext.sender_name || emailContext.sender_email,
          role: 'required'
        });
      }
    }

    // Set defaults for required fields
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    const finalEventData = {
      title: eventData.title || 'Event from Email',
      description: eventData.description || '',
      start_time: eventData.start_time || now.toISOString(),
      end_time: eventData.end_time || oneHourLater.toISOString(),
      location: eventData.location || '',
      meeting_type: eventData.meeting_type || 'personal',
      attendees: eventData.attendees || [],
      email_thread_id: messageId || null,
      source: 'email_conversion'
    };

    res.json({
      success: true,
      message: 'Email converted to event successfully',
      event_data: finalEventData,
      ai_extracted: eventData,
      email_context: emailContext
    });

  } catch (error) {
    console.error('Error converting email to event:', error);
    res.status(500).json({
      error: 'Internal server error converting email to event'
    });
  }
});

/**
 * Get email conversion suggestions
 * POST /api/calendar/email-suggestions
 */
router.post('/email-suggestions', requireAuth, async (req, res) => {
  try {
    const { emailContent } = req.body;

    if (!emailContent) {
      return res.status(400).json({
        error: 'Email content is required'
      });
    }

    // Generate suggestions using AI
    const suggestions = await generateEventSuggestions(emailContent);

    res.json({
      success: true,
      suggestions
    });

  } catch (error) {
    console.error('Error generating email suggestions:', error);
    res.status(500).json({
      error: 'Internal server error generating suggestions'
    });
  }
});

/**
 * Extract event information from email content using AI
 */
async function extractEventFromEmail(emailContent, userSuggestions = {}) {
  try {
    const prompt = `
You are an AI assistant that extracts calendar event information from emails.
Analyze the following email content and extract event details in JSON format.

Email Content:
${emailContent}

Extract the following information if available:
- title: Event title/subject
- description: Event description/agenda
- start_time: Start date and time (ISO format)
- end_time: End date and time (ISO format)
- location: Event location (physical or virtual)
- meeting_type: Type of meeting (one-on-one, team, client, interview, follow-up, personal)
- attendees: Array of attendee objects with email, name, and role
- urgency: Priority level (low, medium, high)

Rules:
1. If no specific time is mentioned, don't include start_time/end_time
2. Extract attendee emails from To/CC/mentioned in content
3. Infer meeting type from context
4. Be conservative - only extract information you're confident about
5. Return valid JSON only

Response format:
{
  "title": "extracted title",
  "description": "extracted description",
  "start_time": "2024-01-01T10:00:00Z",
  "end_time": "2024-01-01T11:00:00Z",
  "location": "extracted location",
  "meeting_type": "team",
  "attendees": [{"email": "user@email.com", "name": "User Name", "role": "required"}],
  "urgency": "medium"
}
`;

    const response = await generateText(prompt);

    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const extracted = JSON.parse(jsonMatch[0]);

        // Merge with user suggestions
        return {
          ...extracted,
          ...userSuggestions
        };
      }
    } catch (parseError) {
      console.warn('Failed to parse AI response as JSON:', parseError.message);
    }

    // Fallback to basic extraction
    return {
      title: extractTitle(emailContent),
      description: extractDescription(emailContent),
      meeting_type: 'personal',
      ...userSuggestions
    };

  } catch (error) {
    console.error('Error in AI event extraction:', error);
    return {
      title: 'Event from Email',
      meeting_type: 'personal',
      ...userSuggestions
    };
  }
}

/**
 * Generate event suggestions using AI
 */
async function generateEventSuggestions(emailContent) {
  try {
    const prompt = `
Analyze this email and suggest improvements or alternatives for creating a calendar event:

Email Content:
${emailContent}

Provide suggestions for:
1. Better event titles
2. Suggested meeting durations
3. Optimal meeting times
4. Recommended attendees
5. Meeting preparation items
6. Follow-up actions

Format as JSON:
{
  "titles": ["suggestion 1", "suggestion 2"],
  "durations": [30, 60, 90],
  "times": ["morning", "afternoon"],
  "attendees": ["email1@example.com"],
  "preparation": ["item 1", "item 2"],
  "follow_up": ["action 1", "action 2"]
}
`;

    const response = await generateText(prompt);

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.warn('Failed to parse suggestions response:', parseError.message);
    }

    return {
      titles: ["Meeting", "Discussion", "Follow-up"],
      durations: [30, 60],
      times: ["morning", "afternoon"],
      attendees: [],
      preparation: [],
      follow_up: []
    };

  } catch (error) {
    console.error('Error generating suggestions:', error);
    return {
      titles: [],
      durations: [30, 60],
      times: [],
      attendees: [],
      preparation: [],
      follow_up: []
    };
  }
}

/**
 * Simple title extraction fallback
 */
function extractTitle(emailContent) {
  // Look for subject line
  const subjectMatch = emailContent.match(/Subject:\s*(.+)/i);
  if (subjectMatch) {
    return subjectMatch[1].trim();
  }

  // Look for meeting-related keywords
  const meetingKeywords = [
    /meeting\s+(?:about|regarding|for)\s+(.+)/i,
    /discussion\s+(?:about|on|regarding)\s+(.+)/i,
    /call\s+(?:about|regarding)\s+(.+)/i
  ];

  for (const pattern of meetingKeywords) {
    const match = emailContent.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return 'Meeting from Email';
}

/**
 * Simple description extraction fallback
 */
function extractDescription(emailContent) {
  // Get first few lines as description
  const lines = emailContent.split('\n').filter(line => line.trim());
  const descriptionLines = lines.slice(0, 3);
  return descriptionLines.join('\n').substring(0, 500);
}

module.exports = router;