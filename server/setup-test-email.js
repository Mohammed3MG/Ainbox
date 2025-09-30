const nodemailer = require('nodemailer');

async function setupTestEmail() {
  console.log('🔧 Setting up test email credentials...');

  try {
    // Create a test account with Ethereal Email
    const testAccount = await nodemailer.createTestAccount();

    console.log('✅ Test email account created!');
    console.log('📧 SMTP Details:');
    console.log('   Host:', testAccount.smtp.host);
    console.log('   Port:', testAccount.smtp.port);
    console.log('   User:', testAccount.user);
    console.log('   Pass:', testAccount.pass);

    console.log('\n📝 Update your .env file with these credentials:');
    console.log(`SMTP_HOST=${testAccount.smtp.host}`);
    console.log(`SMTP_PORT=${testAccount.smtp.port}`);
    console.log(`SMTP_USER=${testAccount.user}`);
    console.log(`SMTP_PASS=${testAccount.pass}`);
    console.log(`SMTP_FROM=Ainbox Calendar <${testAccount.user}>`);

    // Test sending an email
    const transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });

    const info = await transporter.sendMail({
      from: `Ainbox Calendar <${testAccount.user}>`,
      to: testAccount.user, // Send to self for testing
      subject: 'Test Email - Ainbox Calendar',
      html: `
        <h2>🎉 Email Setup Successful!</h2>
        <p>This is a test email to verify that the Ainbox Calendar email system is working correctly.</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      `
    });

    console.log('\n✅ Test email sent successfully!');
    console.log('📮 Message ID:', info.messageId);
    console.log('🔗 Preview URL:', nodemailer.getTestMessageUrl(info));

    return {
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      user: testAccount.user,
      pass: testAccount.pass
    };

  } catch (error) {
    console.error('❌ Failed to setup test email:', error);
    throw error;
  }
}

if (require.main === module) {
  setupTestEmail();
}

module.exports = setupTestEmail;