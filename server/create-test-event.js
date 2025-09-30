const axios = require('axios');
require('dotenv').config();

async function createTestEvent() {
  try {
    console.log('🧪 Creating test calendar event with notification...');

    // We need a valid JWT token for user 1 (mohammedsorguli@gmail.com)
    // For testing purposes, let's create a simple event first without authentication

    const testEventData = {
      title: 'Test Meeting - Debug Notification',
      description: 'Testing if notifications are sent when creating calendar events',
      start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
      end_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
      location: 'Video Conference',
      meeting_type: 'business',
      attendees: [
        {
          email: 'mustafasurguli89@gmail.com',
          name: 'Mustafa Surguli',
          role: 'required'
        }
      ]
    };

    console.log('📧 Event will be created with attendee:', testEventData.attendees[0].email);
    console.log('📅 Event details:', {
      title: testEventData.title,
      start: testEventData.start_time,
      end: testEventData.end_time
    });

    // Try to make a direct request to test if the endpoint works
    // Note: This will fail without authentication, but we can see if the server responds
    try {
      const response = await axios.post('http://localhost:3001/api/calendar/events', testEventData);
      console.log('✅ Event created successfully:', response.data);
    } catch (error) {
      if (error.response) {
        console.log('📊 Server responded with status:', error.response.status);
        console.log('📊 Error message:', error.response.data);

        if (error.response.status === 401) {
          console.log('🔑 Expected: Authentication required. Server is working!');
        }
      } else {
        console.error('❌ Request failed:', error.message);
      }
    }

    // Now let's check what's actually in the database
    console.log('\n🔍 Let\'s check the database after server startup...');

  } catch (error) {
    console.error('❌ Test error:', error);
  }
}

createTestEvent();