-- Migration: Drop conference_rooms and related functionality
-- Date: 2025-09-30
-- Description: Remove conference room booking system from the application

-- Drop foreign key constraint from calendar_events
ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_room_id_fkey;

-- Drop the room_id column from calendar_events
ALTER TABLE calendar_events DROP COLUMN IF EXISTS room_id;

-- Drop dependent tables first (due to foreign key constraints)
DROP TABLE IF EXISTS room_bookings CASCADE;
DROP TABLE IF EXISTS conference_rooms CASCADE;

-- Drop any related indexes
DROP INDEX IF EXISTS idx_room_bookings_time;

COMMENT ON TABLE calendar_events IS 'Core calendar events with AI integration (conference rooms removed)';
