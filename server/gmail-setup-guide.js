console.log(`
🔧 GMAIL SETUP FOR PRODUCTION EMAIL SENDING
==========================================

Your app will send meeting invitations from: mohammedsurguli@gmail.com
To any user email address (no passwords needed from them!)

📝 STEPS TO ENABLE REAL EMAIL DELIVERY:

1. 🌐 Open Gmail Settings:
   → Go to: https://myaccount.google.com/security

2. 🔐 Enable 2-Factor Authentication:
   → If not already enabled, turn on 2FA

3. 🔑 Generate App Password:
   → Search for "App passwords" or go to:
   → https://myaccount.google.com/apppasswords
   → Select "Mail" and "Other (Custom name)"
   → Name it: "Ainbox Calendar App"
   → Copy the 16-character password

4. ⚙️  Update .env file:
   → Replace YOUR_APP_PASSWORD_HERE with the generated password

5. 🔄 Restart your server

📧 CURRENT STATUS:
→ SMTP Host: smtp.gmail.com
→ SMTP User: mohammedsurguli@gmail.com
→ SMTP Pass: [NEEDS YOUR APP PASSWORD]
→ From Address: Ainbox Calendar <mohammedsurguli@gmail.com>

✨ AFTER SETUP:
→ Any user can receive meeting invitations
→ Emails sent from your verified Gmail account
→ Professional delivery with calendar attachments
→ No passwords needed from your users!

⚡ Quick Test After Setup:
   node test-email.js
`);

// Test current SMTP configuration
const fs = require('fs');
const path = require('path');

try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const smtpPass = envFile.match(/SMTP_PASS=(.+)/);

  if (smtpPass && smtpPass[1] && smtpPass[1] !== 'YOUR_APP_PASSWORD_HERE') {
    console.log('✅ SMTP password is configured - testing email...');
    require('./test-email.js');
  } else {
    console.log('⚠️  SMTP password needs to be set in .env file');
    console.log('   Current SMTP_PASS:', smtpPass ? smtpPass[1] : 'not set');
  }
} catch (error) {
  console.log('📁 Please run this from the server directory');
}