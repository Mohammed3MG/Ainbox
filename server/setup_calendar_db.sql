-- Calendar System Database Schema
-- Complete schema for AI-powered calendar with meeting management

-- Conference Rooms Table
CREATE TABLE IF NOT EXISTS conference_rooms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 1,
    location VARCHAR(255),
    equipment JSONB DEFAULT '[]'::jsonb, -- ["projector", "whiteboard", "video_conf"]
    is_available BOOLEAN DEFAULT true,
    booking_rules JSONB DEFAULT '{}'::jsonb, -- {"advance_booking_days": 30, "max_duration": 480}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Meeting Templates Table
CREATE TABLE IF NOT EXISTS meeting_templates (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    meeting_type VARCHAR(50) NOT NULL, -- 'one-on-one', 'team', 'client', 'interview', 'follow-up'
    default_duration INTEGER DEFAULT 30, -- minutes
    default_agenda TEXT,
    default_location VARCHAR(255),
    recurrence_pattern VARCHAR(50), -- 'daily', 'weekly', 'monthly', 'custom'
    attendee_emails TEXT[], -- default attendees
    settings JSONB DEFAULT '{}'::jsonb, -- room preferences, virtual meeting settings
    ai_suggestions JSONB DEFAULT '{}'::jsonb, -- AI-generated improvements
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Calendar Events Table (Enhanced)
CREATE TABLE IF NOT EXISTS calendar_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    meeting_type VARCHAR(50), -- 'one-on-one', 'team', 'client', 'interview', 'follow-up', 'personal'
    agenda TEXT,
    ai_generated_agenda BOOLEAN DEFAULT false,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    timezone VARCHAR(50) DEFAULT 'UTC',
    location VARCHAR(255),
    room_id INTEGER REFERENCES conference_rooms(id),
    virtual_meeting_info JSONB DEFAULT '{}'::jsonb, -- zoom/meet links, passwords, etc.
    color VARCHAR(7) DEFAULT '#3B82F6', -- hex color for calendar display
    category VARCHAR(50) DEFAULT 'general',
    priority VARCHAR(10) DEFAULT 'medium', -- low, medium, high
    status VARCHAR(20) DEFAULT 'confirmed', -- confirmed, tentative, cancelled
    visibility VARCHAR(20) DEFAULT 'private', -- private, public, confidential

    -- Recurrence
    is_recurring BOOLEAN DEFAULT false,
    recurrence_pattern JSONB DEFAULT '{}'::jsonb, -- {"frequency": "weekly", "interval": 1, "days": ["monday"], "ends": "2024-12-31"}
    recurrence_master_id INTEGER REFERENCES calendar_events(id), -- for recurring event instances

    -- Email Integration
    email_thread_id INTEGER, -- Reference to messages table (no FK constraint to avoid dependency issues)
    created_from_email BOOLEAN DEFAULT false,

    -- Template Integration
    template_id INTEGER REFERENCES meeting_templates(id),

    -- AI Integration
    ai_suggested BOOLEAN DEFAULT false,
    ai_confidence_score DECIMAL(3,2), -- 0.00 to 1.00
    ai_metadata JSONB DEFAULT '{}'::jsonb, -- AI analysis data

    -- Preparation
    preparation_time INTEGER DEFAULT 0, -- minutes before event for prep
    buffer_time INTEGER DEFAULT 0, -- minutes after event for buffer

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT valid_time_range CHECK (end_time > start_time),
    CONSTRAINT valid_priority CHECK (priority IN ('low', 'medium', 'high')),
    CONSTRAINT valid_status CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
    CONSTRAINT valid_visibility CHECK (visibility IN ('private', 'public', 'confidential'))
);

-- Meeting Attendees Table
CREATE TABLE IF NOT EXISTS meeting_attendees (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role VARCHAR(20) DEFAULT 'required', -- required, optional, organizer, presenter
    response VARCHAR(20) DEFAULT 'pending', -- accepted, declined, tentative, pending
    response_time TIMESTAMP WITH TIME ZONE,
    response_note TEXT, -- reason for decline, etc.

    -- Notifications
    reminder_sent BOOLEAN DEFAULT false,
    invitation_sent BOOLEAN DEFAULT false,

    -- AI Insights
    ai_availability_score DECIMAL(3,2), -- how likely they are to attend
    ai_suggested BOOLEAN DEFAULT false,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(event_id, email)
);

-- Room Bookings Table
CREATE TABLE IF NOT EXISTS room_bookings (
    id SERIAL PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES conference_rooms(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    booked_by INTEGER NOT NULL REFERENCES users(id),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) DEFAULT 'confirmed', -- confirmed, cancelled, pending
    special_requirements TEXT, -- catering, setup notes, etc.

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(room_id, event_id)
);

-- Calendar Tasks Table
CREATE TABLE IF NOT EXISTS calendar_tasks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    due_date TIMESTAMP WITH TIME ZONE,
    due_time TIME, -- specific time if needed
    priority VARCHAR(10) DEFAULT 'medium', -- low, medium, high, urgent
    status VARCHAR(20) DEFAULT 'todo', -- todo, in_progress, completed, cancelled
    category VARCHAR(50) DEFAULT 'general',

    -- Relationships
    event_id INTEGER REFERENCES calendar_events(id), -- task from meeting
    email_id INTEGER, -- Reference to messages table (no FK constraint to avoid dependency issues)
    parent_task_id INTEGER REFERENCES calendar_tasks(id), -- subtasks

    -- AI Integration
    ai_extracted BOOLEAN DEFAULT false, -- extracted by AI from email/meeting
    ai_priority_score DECIMAL(3,2), -- AI-determined priority
    ai_estimated_duration INTEGER, -- minutes
    ai_suggested_date TIMESTAMP WITH TIME ZONE, -- AI-suggested due date

    -- Progress Tracking
    estimated_duration INTEGER, -- minutes
    actual_duration INTEGER, -- minutes spent
    completion_percentage INTEGER DEFAULT 0, -- 0-100

    -- Reminders
    reminder_date TIMESTAMP WITH TIME ZONE,
    reminder_sent BOOLEAN DEFAULT false,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT valid_priority CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    CONSTRAINT valid_status CHECK (status IN ('todo', 'in_progress', 'completed', 'cancelled')),
    CONSTRAINT valid_percentage CHECK (completion_percentage >= 0 AND completion_percentage <= 100)
);

-- AI Scheduling Patterns Table (for learning user preferences)
CREATE TABLE IF NOT EXISTS ai_scheduling_patterns (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pattern_type VARCHAR(50) NOT NULL, -- 'meeting_time_preference', 'duration_preference', etc.
    meeting_type VARCHAR(50), -- 'one-on-one', 'team', etc.
    pattern_data JSONB NOT NULL, -- flexible storage for AI insights
    confidence_score DECIMAL(3,2), -- how confident the AI is in this pattern
    usage_count INTEGER DEFAULT 1, -- how many times this pattern was observed
    success_rate DECIMAL(3,2), -- how often this pattern leads to successful meetings

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(user_id, pattern_type, meeting_type)
);

-- Calendar Notifications Table
CREATE TABLE IF NOT EXISTS calendar_notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INTEGER REFERENCES calendar_events(id) ON DELETE CASCADE,
    task_id INTEGER REFERENCES calendar_tasks(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL, -- 'reminder', 'invitation', 'update', 'cancellation'
    delivery_method VARCHAR(20) NOT NULL, -- 'email', 'push', 'sms'
    scheduled_time TIMESTAMP WITH TIME ZONE NOT NULL,
    sent_time TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'pending', -- pending, sent, failed
    message_template VARCHAR(100), -- template used for message
    custom_message TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT valid_delivery_method CHECK (delivery_method IN ('email', 'push', 'sms')),
    CONSTRAINT valid_notification_status CHECK (status IN ('pending', 'sent', 'failed'))
);

-- Calendar Settings Table (user preferences)
CREATE TABLE IF NOT EXISTS calendar_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Display Preferences
    default_view VARCHAR(20) DEFAULT 'week', -- month, week, day, agenda
    week_start INTEGER DEFAULT 1, -- 0=Sunday, 1=Monday
    time_format VARCHAR(5) DEFAULT '12h', -- 12h, 24h
    timezone VARCHAR(50) DEFAULT 'UTC',
    theme VARCHAR(20) DEFAULT 'light', -- light, dark, auto

    -- Working Hours
    working_hours_start TIME DEFAULT '09:00',
    working_hours_end TIME DEFAULT '17:00',
    working_days INTEGER[] DEFAULT '{1,2,3,4,5}'::integer[], -- 0=Sun, 1=Mon, etc.

    -- Meeting Preferences
    default_meeting_duration INTEGER DEFAULT 30, -- minutes
    buffer_time INTEGER DEFAULT 0, -- minutes between meetings
    auto_decline_conflicts BOOLEAN DEFAULT false,
    require_room_for_in_person BOOLEAN DEFAULT true,

    -- AI Preferences
    ai_suggestions_enabled BOOLEAN DEFAULT true,
    ai_auto_schedule BOOLEAN DEFAULT false,
    ai_agenda_generation BOOLEAN DEFAULT true,
    ai_task_extraction BOOLEAN DEFAULT true,

    -- Notification Preferences
    email_reminders BOOLEAN DEFAULT true,
    push_notifications BOOLEAN DEFAULT true,
    reminder_times INTEGER[] DEFAULT '{15,60,1440}'::integer[], -- minutes before event
    daily_agenda_email BOOLEAN DEFAULT true,
    weekly_summary_email BOOLEAN DEFAULT false,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(user_id)
);

-- Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_time ON calendar_events(user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_calendar_events_recurring ON calendar_events(recurrence_master_id);
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_email ON meeting_attendees(email);
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_response ON meeting_attendees(event_id, response);
CREATE INDEX IF NOT EXISTS idx_room_bookings_time ON room_bookings(room_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_calendar_tasks_user_due ON calendar_tasks(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_calendar_tasks_status ON calendar_tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_patterns_user ON ai_scheduling_patterns(user_id, pattern_type);
CREATE INDEX IF NOT EXISTS idx_calendar_notifications_scheduled ON calendar_notifications(scheduled_time, status);

-- Insert Default Conference Rooms
INSERT INTO conference_rooms (name, capacity, location, equipment, booking_rules) VALUES
('Conference Room A', 8, 'First Floor', '["projector", "whiteboard", "video_conf", "phone"]'::jsonb, '{"advance_booking_days": 30, "max_duration": 480}'::jsonb),
('Conference Room B', 12, 'Second Floor', '["projector", "whiteboard", "video_conf"]'::jsonb, '{"advance_booking_days": 30, "max_duration": 480}'::jsonb),
('Small Meeting Room', 4, 'First Floor', '["whiteboard", "video_conf"]'::jsonb, '{"advance_booking_days": 14, "max_duration": 240}'::jsonb),
('Phone Booth 1', 1, 'Open Office', '["phone", "privacy"]'::jsonb, '{"advance_booking_days": 7, "max_duration": 60}'::jsonb),
('Phone Booth 2', 1, 'Open Office', '["phone", "privacy"]'::jsonb, '{"advance_booking_days": 7, "max_duration": 60}'::jsonb),
('Executive Boardroom', 20, 'Third Floor', '["projector", "whiteboard", "video_conf", "phone", "catering"]'::jsonb, '{"advance_booking_days": 60, "max_duration": 480, "approval_required": true}'::jsonb)
ON CONFLICT DO NOTHING;

-- Insert Default Meeting Templates for demo
INSERT INTO meeting_templates (user_id, name, meeting_type, default_duration, default_agenda, recurrence_pattern, settings)
SELECT
    u.id,
    'Weekly 1:1',
    'one-on-one',
    30,
    E'• Quick updates\n• Blockers and challenges\n• Goals for next week\n• Career development',
    'weekly',
    '{"preferred_time": "14:00", "virtual_meeting": true}'::jsonb
FROM users u
WHERE EXISTS (SELECT 1 FROM users LIMIT 1)
ON CONFLICT DO NOTHING;

INSERT INTO meeting_templates (user_id, name, meeting_type, default_duration, default_agenda, recurrence_pattern, settings)
SELECT
    u.id,
    'Team Standup',
    'team',
    15,
    E'• Yesterday''s progress\n• Today''s plan\n• Blockers\n• Quick announcements',
    'daily',
    '{"preferred_time": "09:00", "room_required": true}'::jsonb
FROM users u
WHERE EXISTS (SELECT 1 FROM users LIMIT 1)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE calendar_events IS 'Core calendar events with AI integration';
COMMENT ON TABLE meeting_attendees IS 'Event attendees with RSVP tracking';
COMMENT ON TABLE conference_rooms IS 'Bookable meeting rooms and resources';
COMMENT ON TABLE meeting_templates IS 'Reusable meeting templates';
COMMENT ON TABLE calendar_tasks IS 'AI-extracted and manual tasks';
COMMENT ON TABLE ai_scheduling_patterns IS 'Learned user scheduling preferences';
COMMENT ON TABLE calendar_notifications IS 'Scheduled reminders and notifications';
COMMENT ON TABLE calendar_settings IS 'User calendar preferences and settings';

-- RSVP Token Management Tables
CREATE TABLE IF NOT EXISTS rsvp_tokens (
  id SERIAL PRIMARY KEY,
  token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  attendee_email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, attendee_email)
);

CREATE TABLE IF NOT EXISTS rsvp_responses (
  id SERIAL PRIMARY KEY,
  token UUID NOT NULL REFERENCES rsvp_tokens(token) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  attendee_email TEXT NOT NULL,
  response TEXT NOT NULL CHECK (response IN ('accepted', 'declined', 'tentative')),
  responded_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

-- Indexes for RSVP performance
CREATE INDEX IF NOT EXISTS idx_rsvp_tokens_token ON rsvp_tokens(token);
CREATE INDEX IF NOT EXISTS idx_rsvp_tokens_event ON rsvp_tokens(event_id);
CREATE INDEX IF NOT EXISTS idx_rsvp_tokens_email ON rsvp_tokens(attendee_email);
CREATE INDEX IF NOT EXISTS idx_rsvp_tokens_expires ON rsvp_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_rsvp_responses_token ON rsvp_responses(token);
CREATE INDEX IF NOT EXISTS idx_rsvp_responses_event ON rsvp_responses(event_id);

COMMENT ON TABLE rsvp_tokens IS 'RSVP tokens for email-based meeting responses';
COMMENT ON TABLE rsvp_responses IS 'Log of RSVP responses via email links';