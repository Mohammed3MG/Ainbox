#!/usr/bin/env node

// Debug UI Test - Simulate email status changes to test frontend
const https = require('https');

async function testEmailStatusChange(messageId, isRead = true) {
  console.log(`\n🧪 Testing email status change: ${messageId} → ${isRead ? 'READ' : 'UNREAD'}`);

  // Test data that mimics what your backend sends
  const testData = {
    message: {
      data: Buffer.from(JSON.stringify({
        emailAddress: "mohammedsurguli@gmail.com", // Your email
        historyId: Date.now().toString() // Current timestamp as history ID
      })).toString('base64'),
      messageId: `test-${Date.now()}`,
      publishTime: new Date().toISOString()
    },
    subscription: "projects/ainbox-471417/subscriptions/fylApp_push"
  };

  console.log(`📧 Decoded notification data:`, JSON.parse(Buffer.from(testData.message.data, 'base64').toString()));

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'APIs-Google; (+https://developers.google.com/webmasters/APIs-Google.html)'
    }
  };

  const endpoints = [
    'https://fylappdev.loca.lt/webhooks/gmail/notifications',
    'http://localhost:3000/webhooks/gmail/notifications'
  ];

  for (const url of endpoints) {
    try {
      console.log(`📤 Sending webhook to: ${url}`);
      const result = await sendWebhook(url, testData, options);
      console.log(`✅ Response: ${result.status}`);
    } catch (error) {
      console.error(`❌ Failed for ${url}:`, error.message);
    }
  }
}

function sendWebhook(url, data, options) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : require('http');
    const postData = JSON.stringify(data);

    const req = client.request(url, {
      ...options,
      headers: {
        ...options.headers,
        'Content-Length': postData.length
      }
    }, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data: responseData }));
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runDebugTests() {
  console.log('🚀 Starting UI Debug Tests');
  console.log('=' .repeat(50));

  // Test with a few different scenarios
  console.log('\n📋 Instructions:');
  console.log('1. Open your frontend app in browser');
  console.log('2. Open browser Developer Tools → Console');
  console.log('3. Watch for these debug logs after running this test:');
  console.log('   - 🔥 Socket.IO emailUpdated received');
  console.log('   - 🔍 Looking for email with ID');
  console.log('   - ✅ MATCH FOUND or ❌ NO MATCH FOUND');
  console.log('   - 🎨 COLOR FLIP logs');
  console.log('   - 🎨 EmailList: Rendering email logs');

  // Simulate marking an email as read
  await testEmailStatusChange('test-message-123', true);

  console.log('\n💡 Next steps:');
  console.log('1. Check your server console for webhook processing logs');
  console.log('2. Check browser console for frontend debug logs');
  console.log('3. Mark a real email as read/unread in Gmail and compare logs');
}

if (require.main === module) {
  runDebugTests().catch(console.error);
}

module.exports = { testEmailStatusChange };