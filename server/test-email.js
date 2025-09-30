require('dotenv').config();
const EmailService = require('./lib/emailService');
const RSVPTokenManager = require('./lib/rsvpTokens');

async function testEmail() {
  console.log('🧪 Testing email functionality...');

  try {
    const emailService = new EmailService();
    const rsvpTokenManager = new RSVPTokenManager();

    // Mock event data
    const event = {
      id: 1,
      title: 'Test Meeting - Email Verification',
      description: 'This is a test to verify email functionality is working',
      start_time: new Date('2024-01-15T10:00:00Z'),
      end_time: new Date('2024-01-15T11:00:00Z'),
      location: 'Conference Room A',
      organizer_email: 'mohammedsurguli@gmail.com'
    };

    // Mock attendee data
    const attendee = {
      email: 'mohammedsurguli@gmail.com',
      name: 'Test Attendee',
      role: 'required',
      response: 'pending'
    };

    console.log('📧 Attempting to send test email...');

    // Generate RSVP token
    const rsvpToken = 'test-token-' + Date.now();

    // Send test email
    await emailService.sendMeetingInvitation(event, attendee, rsvpToken);

    console.log('✅ Email sent successfully!');
    console.log('📮 Check your email at:', attendee.email);

  } catch (error) {
    console.error('❌ Email test failed:', error.message);
    console.error('🔍 Full error:', error);

    if (error.code === 'EAUTH') {
      console.log('🔑 Gmail authentication failed. You need to:');
      console.log('   1. Enable 2-factor authentication on your Gmail account');
      console.log('   2. Generate an App Password for this application');
      console.log('   3. Use the App Password in SMTP_PASS instead of your regular password');
    }
  }
}

testEmail();