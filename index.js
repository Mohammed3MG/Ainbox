require('dotenv').config();
const express = require('express');
const passport = require('passport');
const { redirectIfAuthenticated } = require('./middleware/auth');
const authRouter = require('./routes/auth');
const gmailRouter = require('./routes/gmail');
const { configureGoogleStrategy, router: googleRouter } = require('./auth/google');
const mailRouter = require('./routes/mail');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const app = express();
app.use(helmet());
app.use(cors({
  origin: true, // adjust to your frontend origin in prod
  credentials: true
}));
// Increase JSON limit to allow base64 attachments in compose API (tune per needs)
app.use(express.json({ limit: '35mb' }));
app.use(cookieParser());
app.use(passport.initialize());
// Configure Google OAuth strategy in a separate module
configureGoogleStrategy(passport);

// Mount routers
app.use(googleRouter);
app.use(authRouter);
app.use(gmailRouter);
app.use(mailRouter);


// Public home
app.get('/', redirectIfAuthenticated, (req, res) => {
  res.send('<a href="/google">Login with Google</a>');
});

app.listen(3000, () => {
    console.log('Server is running at Port 3000');
});
