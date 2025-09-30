const express = require('express');
const router = express.Router();
const NotificationService = require('../lib/notificationService');
const { requireAuth } = require('../middleware/auth');

const notificationService = new NotificationService();

// Get notifications for the authenticated user
router.get('/', requireAuth, async (req, res) => {
  try {
    const { limit = 50, unreadOnly = false } = req.query;
    const notifications = await notificationService.getUserNotifications(
      req.user.id,
      parseInt(limit),
      unreadOnly === 'true'
    );

    res.json({
      success: true,
      notifications
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
});

// Get notification count for the authenticated user
router.get('/count', requireAuth, async (req, res) => {
  try {
    const { unreadOnly = true } = req.query;
    const count = await notificationService.getNotificationCount(
      req.user.id,
      unreadOnly === 'true'
    );

    res.json({
      success: true,
      count
    });
  } catch (error) {
    console.error('Error fetching notification count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification count'
    });
  }
});

// Mark notification as read
router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const notificationId = parseInt(req.params.id);
    const notification = await notificationService.markAsRead(notificationId, req.user.id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      notification
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
});

// Mark all notifications as read
router.patch('/mark-all-read', requireAuth, async (req, res) => {
  try {
    await notificationService.markAllAsRead(req.user.id);

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read'
    });
  }
});

// Handle RSVP response
router.post('/rsvp/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { response, attendeeName } = req.body;

    if (!['accepted', 'maybe', 'declined'].includes(response)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid response. Must be accepted, maybe, or declined'
      });
    }

    const invitation = await notificationService.handleRSVPResponse(
      token,
      response,
      attendeeName
    );

    res.json({
      success: true,
      invitation,
      message: `RSVP response "${response}" recorded successfully`
    });
  } catch (error) {
    console.error('Error handling RSVP response:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to process RSVP response'
    });
  }
});

// Get user invitations
router.get('/invitations', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const invitations = await notificationService.getUserInvitations(req.user.id, status);

    res.json({
      success: true,
      invitations
    });
  } catch (error) {
    console.error('Error fetching invitations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invitations'
    });
  }
});

module.exports = router;