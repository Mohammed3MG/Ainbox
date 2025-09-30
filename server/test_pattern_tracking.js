#!/usr/bin/env node

require('dotenv').config();
const PatternLearning = require('./lib/patternLearning');

async function testPatternTracking() {
  console.log('🧪 Testing Pattern Learning System...\n');

  const patternLearning = new PatternLearning();
  const testUserId = 1; // Assuming you're user ID 1

  try {
    // Test 1: Track a suggestion being shown
    console.log('1️⃣ Testing suggestion shown tracking...');
    await patternLearning.trackSuggestionShown(
      testUserId,
      'Thank you for your email',
      {
        textLength: 50,
        cursorPosition: 50,
        emailType: 'compose'
      }
    );
    console.log('✅ Suggestion shown tracked successfully');

    // Test 2: Track suggestion acceptance
    console.log('\n2️⃣ Testing suggestion acceptance tracking...');
    await patternLearning.trackSuggestionAccepted(
      testUserId,
      'Thank you for your email',
      {
        textLength: 73,
        cursorPosition: 73,
        emailType: 'compose'
      },
      1250 // 1.25 second response time
    );
    console.log('✅ Suggestion acceptance tracked successfully');

    // Test 3: Track another suggestion shown
    console.log('\n3️⃣ Testing another suggestion...');
    await patternLearning.trackSuggestionShown(
      testUserId,
      'Best regards',
      {
        textLength: 100,
        cursorPosition: 100,
        emailType: 'compose'
      }
    );
    console.log('✅ Second suggestion shown tracked successfully');

    // Test 4: Track suggestion rejection
    console.log('\n4️⃣ Testing suggestion rejection...');
    await patternLearning.trackSuggestionRejected(
      testUserId,
      'Best regards',
      {
        textLength: 100,
        cursorPosition: 100,
        emailType: 'compose'
      },
      800 // 0.8 second response time
    );
    console.log('✅ Suggestion rejection tracked successfully');

    // Test 5: Get personalized suggestions
    console.log('\n5️⃣ Testing personalized suggestions retrieval...');
    const suggestions = await patternLearning.getPersonalizedSuggestions(
      testUserId,
      'Thank you',
      {
        emailType: 'compose'
      },
      3
    );
    console.log(`✅ Retrieved ${suggestions.length} personalized suggestions:`);
    suggestions.forEach((suggestion, index) => {
      console.log(`   ${index + 1}. "${suggestion.text}" (score: ${suggestion.score.toFixed(3)})`);
    });

    // Test 6: Get user stats
    console.log('\n6️⃣ Testing user statistics...');
    const stats = await patternLearning.getUserStats(testUserId);
    if (stats) {
      console.log('✅ User statistics retrieved:');
      console.log(`   • Total Patterns: ${stats.patterns.total_patterns}`);
      console.log(`   • Average Acceptance Rate: ${parseFloat(stats.patterns.avg_acceptance_rate || 0).toFixed(2)}%`);
      console.log(`   • Total Frequency: ${stats.patterns.total_frequency}`);

      console.log('\n   📊 Metrics by Action:');
      stats.metrics.forEach(metric => {
        console.log(`   • ${metric.action}: ${metric.count} times`);
      });
    }

    console.log('\n🎉 All pattern learning tests completed successfully!');
    console.log('💡 Now run: node check_patterns.js to see the saved data');

  } catch (error) {
    console.error('❌ Error testing pattern learning:', error.message);
    console.error('Stack:', error.stack);
  }
}

testPatternTracking();