/**
 * Pattern Learning API Routes
 * Handles tracking user suggestion interactions and learning patterns
 */

const express = require('express');
const router = express.Router();
const PatternLearning = require('../lib/patternLearning');
const { requireAuth } = require('../middleware/auth');

// Initialize pattern learning system
const patternLearning = new PatternLearning();

/**
 * Track when a suggestion is shown to user
 * POST /api/patterns/track-shown
 */
router.post('/track-shown', requireAuth, async (req, res) => {
  try {
    const { userId, suggestion, context } = req.body;

    if (!userId || !suggestion) {
      return res.status(400).json({
        error: 'Missing required fields: userId, suggestion'
      });
    }

    // Validate user owns this request
    if (parseInt(req.auth.sub) !== userId) {
      return res.status(403).json({
        error: 'Unauthorized: Can only track your own suggestions'
      });
    }

    await patternLearning.trackSuggestionShown(userId, suggestion, context || {});

    res.json({
      success: true,
      message: 'Suggestion shown tracked successfully'
    });

  } catch (error) {
    console.error('Error tracking suggestion shown:', error);
    res.status(500).json({
      error: 'Internal server error tracking suggestion'
    });
  }
});

/**
 * Track when user accepts a suggestion (Tab key)
 * POST /api/patterns/track-accepted
 */
router.post('/track-accepted', requireAuth, async (req, res) => {
  try {
    const { userId, suggestion, context, responseTime } = req.body;

    if (!userId || !suggestion) {
      return res.status(400).json({
        error: 'Missing required fields: userId, suggestion'
      });
    }

    // Validate user owns this request
    if (parseInt(req.auth.sub) !== userId) {
      return res.status(403).json({
        error: 'Unauthorized: Can only track your own suggestions'
      });
    }

    await patternLearning.trackSuggestionAccepted(
      userId,
      suggestion,
      context || {},
      responseTime
    );

    res.json({
      success: true,
      message: 'Suggestion acceptance tracked successfully',
      learned: true
    });

  } catch (error) {
    console.error('Error tracking suggestion accepted:', error);
    res.status(500).json({
      error: 'Internal server error tracking acceptance'
    });
  }
});

/**
 * Track when user rejects a suggestion (Escape key)
 * POST /api/patterns/track-rejected
 */
router.post('/track-rejected', requireAuth, async (req, res) => {
  try {
    const { userId, suggestion, context, responseTime } = req.body;

    if (!userId || !suggestion) {
      return res.status(400).json({
        error: 'Missing required fields: userId, suggestion'
      });
    }

    // Validate user owns this request
    if (parseInt(req.auth.sub) !== userId) {
      return res.status(403).json({
        error: 'Unauthorized: Can only track your own suggestions'
      });
    }

    await patternLearning.trackSuggestionRejected(
      userId,
      suggestion,
      context || {},
      responseTime
    );

    res.json({
      success: true,
      message: 'Suggestion rejection tracked successfully'
    });

  } catch (error) {
    console.error('Error tracking suggestion rejected:', error);
    res.status(500).json({
      error: 'Internal server error tracking rejection'
    });
  }
});

/**
 * Get personalized suggestions for user
 * POST /api/patterns/suggestions
 */
router.post('/suggestions', requireAuth, async (req, res) => {
  try {
    const { currentText, context, limit = 5 } = req.body;
    const userId = parseInt(req.auth.sub);

    if (!currentText) {
      return res.status(400).json({
        error: 'Missing required field: currentText'
      });
    }

    const personalizedSuggestions = await patternLearning.getPersonalizedSuggestions(
      userId,
      currentText,
      context || {},
      limit
    );

    res.json({
      success: true,
      suggestions: personalizedSuggestions,
      count: personalizedSuggestions.length,
      personalized: true
    });

  } catch (error) {
    console.error('Error getting personalized suggestions:', error);
    res.status(500).json({
      error: 'Internal server error getting suggestions'
    });
  }
});

/**
 * Get user pattern statistics
 * GET /api/patterns/stats
 */
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);

    const stats = await patternLearning.getUserStats(userId);

    if (!stats) {
      return res.json({
        success: true,
        stats: {
          patterns: { total_patterns: 0, avg_acceptance_rate: 0, total_frequency: 0 },
          metrics: []
        },
        message: 'No patterns learned yet'
      });
    }

    res.json({
      success: true,
      stats: stats,
      message: 'User pattern statistics retrieved successfully'
    });

  } catch (error) {
    console.error('Error getting user stats:', error);
    res.status(500).json({
      error: 'Internal server error getting stats'
    });
  }
});

/**
 * Clear user patterns (for testing/reset)
 * DELETE /api/patterns/clear
 */
router.delete('/clear', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.auth.sub);

    // Note: This would need to be implemented in PatternLearning class
    // For now, just clear the cache
    patternLearning.clearUserCache(userId);

    res.json({
      success: true,
      message: 'User pattern cache cleared successfully'
    });

  } catch (error) {
    console.error('Error clearing user patterns:', error);
    res.status(500).json({
      error: 'Internal server error clearing patterns'
    });
  }
});

/**
 * Health check endpoint
 * GET /api/patterns/health
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'Pattern Learning API',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;