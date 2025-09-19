// Gmail synchronization API endpoints
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const gmailSync = require('../lib/gmailSync');

const router = express.Router();

// Start Gmail sync for current user
router.post('/gmail/start', requireAuth, async (req, res) => {
  try {
    const userId = String(req.auth?.sub);

    // Start sync with user's cookies for OAuth
    await gmailSync.startSyncForUser(userId, req.cookies);

    const status = gmailSync.getSyncStatus(userId);

    res.json({
      message: 'Gmail sync started',
      status,
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

    gmailSync.stopSyncForUser(userId);

    res.json({
      message: 'Gmail sync stopped',
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
    const status = gmailSync.getSyncStatus(userId);

    res.json({
      userId,
      status,
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

    await gmailSync.forceSyncForUser(userId, req.cookies);

    res.json({
      message: 'Gmail force sync completed',
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

    const allStatuses = gmailSync.getAllSyncStatuses();

    res.json({
      totalActiveUsers: Object.keys(allStatuses).length,
      statuses: allStatuses,
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

module.exports = router;