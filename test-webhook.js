// Quick webhook test script
const fetch = require('node-fetch');

async function testWebhook() {
  const webhookUrl = 'https://twenty-knives-shake.loca.lt/webhooks/gmail/notifications';

  const testData = {
    message: {
      data: Buffer.from(JSON.stringify({
        emailAddress: 'test@example.com',
        historyId: '12345'
      })).toString('base64'),
      messageId: 'test-message-id',
      publishTime: new Date().toISOString()
    }
  };

  try {
    console.log('🧪 Testing webhook endpoint...');
    console.log('URL:', webhookUrl);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData)
    });

    const result = await response.text();

    console.log('✅ Response Status:', response.status);
    console.log('📦 Response Body:', result);

    if (response.ok) {
      console.log('🎉 Webhook is working!');
    } else {
      console.log('❌ Webhook test failed');
    }

  } catch (error) {
    console.error('❌ Error testing webhook:', error.message);
  }
}

testWebhook();