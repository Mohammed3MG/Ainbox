-- Migration: Enhance calendar_events for invitation integration
-- Purpose: Add fields to track events created from invitations

-- Add new columns to calendar_events table
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS created_from_invitation BOOLEAN DEFAULT FALSE;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS original_event_id INTEGER;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS invitation_response VARCHAR(20);

-- Add index for invitation-created events
CREATE INDEX IF NOT EXISTS idx_calendar_events_invitation ON calendar_events(created_from_invitation);
CREATE INDEX IF NOT EXISTS idx_calendar_events_original ON calendar_events(original_event_id);

-- Add foreign key constraint to original_event_id (self-referencing)
ALTER TABLE calendar_events
ADD CONSTRAINT fk_calendar_events_original_event_id
FOREIGN KEY (original_event_id) REFERENCES calendar_events(id) ON DELETE SET NULL;