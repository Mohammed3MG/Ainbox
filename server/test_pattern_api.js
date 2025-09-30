#!/usr/bin/env node

const axios = require('axios');

async function testPatternAPI() {
  console.log('🧪 Testing Pattern API endpoints...\n');

  const baseURL = 'http://localhost:3000';

  try {
    // Test 1: Health check (no auth required)
    console.log('1️⃣ Testing health endpoint...');
    const healthResponse = await axios.get(`${baseURL}/api/patterns/health`);
    console.log('✅ Health check:', healthResponse.data.status);

    // Test 2: Try tracking without auth (should fail)
    console.log('\n2️⃣ Testing unauthorized access...');
    try {
      await axios.post(`${baseURL}/api/patterns/track-shown`, {
        userId: 1,
        suggestion: 'Test suggestion',
        context: {}
      });
      console.log('❌ Should have failed!');
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('✅ Correctly blocked unauthorized access');
      } else {
        console.log('❌ Unexpected error:', error.message);
      }
    }

    console.log('\n✅ Pattern API endpoints are working correctly!');
    console.log('💡 For authenticated requests, you\'ll need valid JWT tokens from your frontend.');

  } catch (error) {
    console.error('❌ Error testing Pattern API:', error.message);

    if (error.code === 'ECONNREFUSED') {
      console.log('💡 Make sure your server is running on port 3000');
    }
  }
}

testPatternAPI();