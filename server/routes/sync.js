// Gmail synchronization API endpoints
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const gmailSyncService = require('../lib/gmailSyncService');

const router = express.Router();

// Start Gmail sync for current user
router.post('/gmail/start', requireAuth, async (req, res) => {
  try {
    const userId = String(req.auth?.sub);
    const userEmail = req.auth?.email || req.body?.email;

    // Get OAuth tokens from session or request
    const { accessToken, refreshToken } = await getOAuthTokens(req);

    if (!accessToken || !refreshToken) {
      return res.status(401).json({
        error: 'OAuth tokens not found',
        message: 'Please authenticate with Google first'
      });
    }

    // Start Pub/Sub enhanced sync
    const result = await gmailSyncService.startSync(userId, accessToken, refreshToken, userEmail);

    res.json({
      message: 'Gmail Pub/Sub sync started successfully',
      ...result,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Failed to start Gmail sync:', error);
    res.status(500).json({
      error: 'Failed to start Gmail sync',
      message: error.message
    });
  }
});

// Stop Gmail sync for current user
router.post('/gmail/stop', requireAuth, async (req, res) => {
  try {
    const userId = String(req.auth?.sub);

    const result = await gmailSyncService.stopSync(userId);

    res.json({
      message: 'Gmail Pub/Sub sync stopped successfully',
      ...result,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Failed to stop Gmail sync:', error);
    res.status(500).json({
      error: 'Failed to stop Gmail sync',
      message: error.message
    });
  }
});

// Get Gmail sync status for current user
router.get('/gmail/status', requireAuth, async (req, res) => {
  try {
    const userId = String(req.auth?.sub);
    const status = gmailSyncService.getSyncStatus(userId);

    res.json({
      userId,
      status,
      pubsubEnabled: true,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Failed to get Gmail sync status:', error);
    res.status(500).json({
      error: 'Failed to get Gmail sync status',
      message: error.message
    });
  }
});

// Force sync Gmail for current user (manual trigger)
router.post('/gmail/force', requireAuth, async (req, res) => {
  try {
    const userId = String(req.auth?.sub);

    const result = await gmailSyncService.forceSync(userId);

    res.json({
      message: 'Gmail force sync completed',
      ...result,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Failed to force Gmail sync:', error);
    res.status(500).json({
      error: 'Failed to force Gmail sync',
      message: error.message
    });
  }
});

// Admin endpoint: Get all sync statuses (for monitoring)
router.get('/admin/all-status', requireAuth, async (req, res) => {
  try {
    // Basic auth check - in production you'd want proper admin role checking
    const userId = String(req.auth?.sub);

    const stats = gmailSyncService.getStats();
    const activeUsers = gmailSyncService.getActiveUsers();

    res.json({
      totalActiveUsers: activeUsers.length,
      activeUsers,
      stats,
      pubsubEnabled: true,
      timestamp: Date.now(),
      requestedBy: userId
    });
  } catch (error) {
    console.error('Failed to get all sync statuses:', error);
    res.status(500).json({
      error: 'Failed to get all sync statuses',
      message: error.message
    });
  }
});

/**
 * Helper function to extract OAuth tokens from request
 * This should be customized based on how you store OAuth tokens
 */
async function getOAuthTokens(req) {
  try {
    // Method 1: From session/cookies (most common)
    if (req.session && req.session.accessToken) {
      return {
        accessToken: req.session.accessToken,
        refreshToken: req.session.refreshToken
      };
    }

    // Method 2: From request headers
    if (req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        return {
          accessToken: authHeader.substring(7),
          refreshToken: req.headers['x-refresh-token']
        };
      }
    }

    // Method 3: From request body
    if (req.body && req.body.accessToken) {
      return {
        accessToken: req.body.accessToken,
        refreshToken: req.body.refreshToken
      };
    }

    // Method 4: From cookies (if using cookie-based auth)
    if (req.cookies && req.cookies.access_token) {
      return {
        accessToken: req.cookies.access_token,
        refreshToken: req.cookies.refresh_token
      };
    }

    // TODO: Add your specific OAuth token retrieval logic here
    // For example, you might need to:
    // 1. Query your database for user's tokens
    // 2. Decrypt stored tokens
    // 3. Validate token expiry and refresh if needed

    console.warn('⚠️  OAuth tokens not found in request');
    return { accessToken: null, refreshToken: null };

  } catch (error) {
    console.error('❌ Error extracting OAuth tokens:', error);
    return { accessToken: null, refreshToken: null };
  }
}

module.exports = router;