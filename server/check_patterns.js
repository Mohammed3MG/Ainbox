#!/usr/bin/env node

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkPatterns() {
  try {
    console.log('🔍 Checking pattern learning data in database...\n');

    // Check user_patterns table
    console.log('📊 USER PATTERNS:');
    const patternsResult = await pool.query(`
      SELECT
        up.id,
        u.email as user_email,
        up.pattern_text,
        up.pattern_type,
        up.frequency,
        up.acceptance_rate,
        up.total_shown,
        up.total_accepted,
        up.last_used,
        up.created_at
      FROM user_patterns up
      LEFT JOIN users u ON up.user_id = u.id
      ORDER BY up.created_at DESC
      LIMIT 10
    `);

    if (patternsResult.rows.length === 0) {
      console.log('❌ No patterns found in database yet.');
    } else {
      console.log(`✅ Found ${patternsResult.rows.length} patterns:`);
      patternsResult.rows.forEach((pattern, index) => {
        console.log(`\n  ${index + 1}. Pattern: "${pattern.pattern_text}"`);
        console.log(`     User: ${pattern.user_email || 'Unknown'}`);
        console.log(`     Type: ${pattern.pattern_type}`);
        console.log(`     Frequency: ${pattern.frequency}`);
        console.log(`     Acceptance Rate: ${pattern.acceptance_rate}%`);
        console.log(`     Shown: ${pattern.total_shown} times, Accepted: ${pattern.total_accepted} times`);
        console.log(`     Last Used: ${pattern.last_used}`);
        console.log(`     Created: ${pattern.created_at}`);
      });
    }

    // Check suggestion_metrics table
    console.log('\n📈 SUGGESTION METRICS:');
    const metricsResult = await pool.query(`
      SELECT
        sm.id,
        u.email as user_email,
        sm.suggestion_text,
        sm.action,
        sm.response_time_ms,
        sm.cursor_position,
        sm.text_length,
        sm.created_at
      FROM suggestion_metrics sm
      LEFT JOIN users u ON sm.user_id = u.id
      ORDER BY sm.created_at DESC
      LIMIT 10
    `);

    if (metricsResult.rows.length === 0) {
      console.log('❌ No suggestion metrics found in database yet.');
    } else {
      console.log(`✅ Found ${metricsResult.rows.length} recent metrics:`);
      metricsResult.rows.forEach((metric, index) => {
        console.log(`\n  ${index + 1}. Suggestion: "${metric.suggestion_text}"`);
        console.log(`     User: ${metric.user_email || 'Unknown'}`);
        console.log(`     Action: ${metric.action}`);
        console.log(`     Response Time: ${metric.response_time_ms}ms`);
        console.log(`     Cursor Position: ${metric.cursor_position}`);
        console.log(`     Text Length: ${metric.text_length}`);
        console.log(`     Created: ${metric.created_at}`);
      });
    }

    // Summary stats
    console.log('\n📊 SUMMARY STATISTICS:');
    const summaryResult = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM user_patterns) as total_patterns,
        (SELECT COUNT(*) FROM suggestion_metrics) as total_metrics,
        (SELECT COUNT(*) FROM suggestion_metrics WHERE action = 'shown') as total_shown,
        (SELECT COUNT(*) FROM suggestion_metrics WHERE action = 'accepted') as total_accepted,
        (SELECT COUNT(*) FROM suggestion_metrics WHERE action = 'rejected') as total_rejected
    `);

    const stats = summaryResult.rows[0];
    console.log(`  • Total Patterns: ${stats.total_patterns}`);
    console.log(`  • Total Metrics: ${stats.total_metrics}`);
    console.log(`  • Suggestions Shown: ${stats.total_shown}`);
    console.log(`  • Suggestions Accepted: ${stats.total_accepted}`);
    console.log(`  • Suggestions Rejected: ${stats.total_rejected}`);

    if (stats.total_shown > 0) {
      const acceptanceRate = ((stats.total_accepted / stats.total_shown) * 100).toFixed(2);
      console.log(`  • Overall Acceptance Rate: ${acceptanceRate}%`);
    }

  } catch (error) {
    console.error('❌ Error checking patterns:', error.message);

    if (error.message.includes('relation "user_patterns" does not exist')) {
      console.log('\n💡 Tables don\'t exist yet. Did you run the migrations?');
    }
  } finally {
    await pool.end();
  }
}

checkPatterns();