// Debug webhook test to simulate Gmail push notifications
const axios = require('axios');

async function testWebhook() {
  try {
    console.log('🔥 [TEST] Simulating Gmail Push notification...');

    // Simulate a Gmail push notification payload
    const testPayload = {
      message: {
        data: Buffer.from(JSON.stringify({
          emailAddress: 'test@example.com', // Replace with your actual Gmail address
          historyId: '12345'
        })).toString('base64')
      }
    };

    const response = await axios.post('http://localhost:3000/webhooks/gmail/notifications', testPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('🔥 [TEST] Webhook response status:', response.status);
    console.log('🔥 [TEST] Webhook test completed');
  } catch (error) {
    console.error('🔥 [TEST] Webhook test failed:', error.message);
    if (error.response) {
      console.error('🔥 [TEST] Response status:', error.response.status);
      console.error('🔥 [TEST] Response data:', error.response.data);
    }
  }
}

// Run the test
testWebhook();