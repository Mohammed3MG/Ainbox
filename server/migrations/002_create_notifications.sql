-- Migration: Create notifications system
-- Purpose: Handle calendar notifications and RSVP responses

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP,
    expires_at TIMESTAMP,

    CONSTRAINT fk_notifications_user_id
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create calendar_invitations table for attendee invitations
CREATE TABLE IF NOT EXISTS calendar_invitations (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    attendee_email VARCHAR(255) NOT NULL,
    attendee_user_id INTEGER,
    organizer_user_id INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    response_token VARCHAR(255) UNIQUE,
    invitation_sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    response_at TIMESTAMP,

    CONSTRAINT fk_calendar_invitations_event_id
        FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
    CONSTRAINT fk_calendar_invitations_attendee_user_id
        FOREIGN KEY (attendee_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_calendar_invitations_organizer_user_id
        FOREIGN KEY (organizer_user_id) REFERENCES users(id) ON DELETE CASCADE,

    UNIQUE(event_id, attendee_email)
);

-- Create notification preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL,
    email_notifications BOOLEAN DEFAULT TRUE,
    in_app_notifications BOOLEAN DEFAULT TRUE,
    meeting_invitations BOOLEAN DEFAULT TRUE,
    rsvp_responses BOOLEAN DEFAULT TRUE,
    conflict_alerts BOOLEAN DEFAULT TRUE,
    reminders BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_notification_preferences_user_id
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

CREATE INDEX IF NOT EXISTS idx_calendar_invitations_attendee_user_id ON calendar_invitations(attendee_user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_invitations_organizer_user_id ON calendar_invitations(organizer_user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_invitations_status ON calendar_invitations(status);
CREATE INDEX IF NOT EXISTS idx_calendar_invitations_response_token ON calendar_invitations(response_token);