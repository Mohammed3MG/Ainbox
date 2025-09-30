-- Migration: Reminder System for Meeting Invitations
-- Purpose: Track sent reminders to prevent duplicate notifications

-- Create reminder_log table to track sent reminders
CREATE TABLE IF NOT EXISTS reminder_log (
  id SERIAL PRIMARY KEY,
  invitation_id INTEGER NOT NULL REFERENCES calendar_invitations(id) ON DELETE CASCADE,
  reminder_interval_hours INTEGER NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure we don't send duplicate reminders for the same interval
  UNIQUE(invitation_id, reminder_interval_hours)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_reminder_log_invitation_id ON reminder_log(invitation_id);
CREATE INDEX IF NOT EXISTS idx_reminder_log_sent_at ON reminder_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_reminder_log_interval ON reminder_log(reminder_interval_hours);

-- Add reminder preferences to notification_preferences table
ALTER TABLE notification_preferences
ADD COLUMN IF NOT EXISTS reminder_notifications BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS reminder_email BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS reminder_intervals TEXT DEFAULT '24,4,1'; -- Hours before event

-- Update existing notification_preferences records to include reminder settings
UPDATE notification_preferences
SET
  reminder_notifications = TRUE,
  reminder_email = TRUE,
  reminder_intervals = '24,4,1'
WHERE reminder_notifications IS NULL;