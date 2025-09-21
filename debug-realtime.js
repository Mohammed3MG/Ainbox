// Debug script to test real-time Gmail updates
// Run this while your app is running to simulate Gmail changes

const testWebhook = async () => {
  const webhookUrl = 'https://twenty-knives-shake.loca.lt/webhooks/gmail/notifications';

  // Test marking an email as read
  const testReadUpdate = {
    message: {
      data: Buffer.from(JSON.stringify({
        emailAddress: 'your-test-email@gmail.com', // Replace with your actual email
        historyId: Date.now().toString() // Use current timestamp as history ID
      })).toString('base64'),
      messageId: 'test-message-' + Date.now(),
      publishTime: new Date().toISOString()
    }
  };

  try {
    console.log('🧪 Testing Gmail webhook notification...');
    console.log('URL:', webhookUrl);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testReadUpdate)
    });

    const result = await response.text();

    console.log('✅ Response Status:', response.status);
    console.log('📦 Response Body:', result);

    if (response.ok) {
      console.log('🎉 Webhook test successful!');
      console.log('📧 Check your frontend app - you should see email count updates');
    } else {
      console.log('❌ Webhook test failed');
    }

  } catch (error) {
    console.error('❌ Error testing webhook:', error.message);
  }
};

// Test the webhook
testWebhook();

// You can also test specific message IDs if you know them
const testSpecificEmail = async (messageId) => {
  const webhookUrl = 'https://twenty-knives-shake.loca.lt/webhooks/gmail/notifications';

  const testData = {
    message: {
      data: Buffer.from(JSON.stringify({
        emailAddress: 'your-test-email@gmail.com', // Replace with your actual email
        historyId: Date.now().toString()
      })).toString('base64'),
      messageId: 'test-' + messageId,
      publishTime: new Date().toISOString()
    }
  };

  try {
    console.log(`🧪 Testing specific email update for: ${messageId}`);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });

    console.log('Response:', response.status, await response.text());
  } catch (error) {
    console.error('Error:', error.message);
  }
};

console.log('🚀 Gmail Real-Time Debug Script');
console.log('📋 Available functions:');
console.log('  - testWebhook() - Test the webhook endpoint');
console.log('  - testSpecificEmail(messageId) - Test update for specific email');
console.log('');
console.log('💡 To test:');
console.log('  1. Make sure your server is running');
console.log('  2. Make sure localtunnel is running');
console.log('  3. Open your React app in browser');
console.log('  4. Watch browser console for real-time updates');
console.log('  5. Mark emails as read/unread in Gmail to see live changes');