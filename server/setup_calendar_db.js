#!/usr/bin/env node

/**
 * Calendar Database Setup Script
 * Sets up all tables for the AI-powered calendar system
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function setupCalendarDatabase() {
  console.log('🏗️  Setting up Calendar Database...\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Read the SQL file
    const sqlFile = path.join(__dirname, 'setup_calendar_db.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');

    // Execute the SQL
    console.log('📊 Creating calendar tables...');
    await pool.query(sql);

    console.log('✅ Calendar database setup completed successfully!');
    console.log('\n📋 Created tables:');
    console.log('   • conference_rooms - Meeting room management');
    console.log('   • meeting_templates - Reusable meeting templates');
    console.log('   • calendar_events - Core calendar events');
    console.log('   • meeting_attendees - RSVP tracking');
    console.log('   • room_bookings - Room reservation system');
    console.log('   • calendar_tasks - AI-powered task management');
    console.log('   • ai_scheduling_patterns - ML learning data');
    console.log('   • calendar_notifications - Reminder system');
    console.log('   • calendar_settings - User preferences');

    console.log('\n🎯 Features enabled:');
    console.log('   • AI-powered event suggestions');
    console.log('   • Meeting type classification');
    console.log('   • Conference room booking');
    console.log('   • RSVP tracking system');
    console.log('   • Task extraction from emails');
    console.log('   • Smart scheduling algorithms');
    console.log('   • Email-calendar integration');

    // Verify tables were created
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE 'calendar_%'
        OR table_name IN ('conference_rooms', 'meeting_templates', 'meeting_attendees', 'room_bookings')
      ORDER BY table_name
    `);

    console.log('\n✅ Verified tables:');
    result.rows.forEach(row => {
      console.log(`   ✓ ${row.table_name}`);
    });

    console.log('\n🚀 Ready to start building calendar features!');

  } catch (error) {
    console.error('❌ Error setting up calendar database:', error.message);
    console.error('\nStack trace:', error.stack);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  setupCalendarDatabase();
}

module.exports = setupCalendarDatabase;