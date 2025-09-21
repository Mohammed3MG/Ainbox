#!/usr/bin/env node

// Test script to simulate Gmail webhook notifications
const https = require('https');

// Test data - simulates a Gmail Pub/Sub notification
const testData = {
  message: {
    data: Buffer.from(JSON.stringify({
      emailAddress: "mohammedsurguli@gmail.com", // Replace with your email
      historyId: Date.now().toString() // Use current timestamp as history ID
    })).toString('base64'),
    messageId: `test-${Date.now()}`,
    publishTime: new Date().toISOString(),
    attributes: {}
  },
  subscription: "projects/ainbox-471417/subscriptions/fylApp_push"
};

// Test endpoints
const endpoints = [
  'https://fylappdev.loca.lt/webhooks/gmail/notifications',
  'http://localhost:3000/webhooks/gmail/notifications'
];

async function testWebhook(url) {
  console.log(`\n🧪 Testing webhook: ${url}`);

  const postData = JSON.stringify(testData);

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': postData.length,
      'User-Agent': 'APIs-Google; (+https://developers.google.com/webmasters/APIs-Google.html)'
    }
  };

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : require('http');

    const req = client.request(url, options, (res) => {
      let data = '';

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`✅ Response: ${res.statusCode} ${res.statusMessage}`);
        console.log(`📊 Headers:`, res.headers);
        if (data) console.log(`📦 Body:`, data);
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', (error) => {
      console.error(`❌ Request failed:`, error.message);
      reject(error);
    });

    console.log(`📤 Sending test notification...`);
    console.log(`📧 Simulated data:`, JSON.parse(Buffer.from(testData.message.data, 'base64').toString()));

    req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('🚀 Starting Gmail Webhook Tests');
  console.log('=' .repeat(50));

  for (const endpoint of endpoints) {
    try {
      await testWebhook(endpoint);
    } catch (error) {
      console.error(`❌ Test failed for ${endpoint}:`, error.message);
    }
  }

  console.log('\n🏁 Tests completed!');
  console.log('\n💡 Next steps:');
  console.log('1. Check your server console for webhook logs');
  console.log('2. Open browser dev tools and look for color flip logs');
  console.log('3. Enable email color debugging: window.debugEmailColors = true');
}

// Run tests
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testWebhook, testData };