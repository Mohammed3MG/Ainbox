require('dotenv').config();

async function testCalendarNotification() {
  try {
    console.log('🧪 Testing calendar event creation with notifications...');

    // You'll need to get a valid JWT token from the user (mohammedsorguli@gmail.com, ID: 1)
    // For testing, we'll use a mock request
    const testEventData = {
      title: 'Test Meeting - Notification Debug',
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

    // Note: In a real test, you would:
    // 1. Authenticate as user 1 (mohammedsorguli@gmail.com)
    // 2. POST to http://localhost:3000/api/calendar/events
    // 3. Check if mustafasurguli89@gmail.com (user ID 240) receives notification

    console.log('');
    console.log('🔧 To test this manually:');
    console.log('1. Get JWT token for mohammedsorguli@gmail.com (user ID: 1)');
    console.log('2. POST to /api/calendar/events with the event data above');
    console.log('3. Check if mustafasurguli89@gmail.com (user ID: 240) gets notification');
    console.log('4. Check database for calendar_invitations and notifications records');

    console.log('');
    console.log('📊 Event data to send:');
    console.log(JSON.stringify(testEventData, null, 2));

  } catch (error) {
    console.error('❌ Test error:', error);
  }
}

testCalendarNotification();