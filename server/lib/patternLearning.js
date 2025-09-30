/**
 * Smart Pattern Learning System
 * Learns from user behavior to improve text suggestions
 */

const { pool } = require('./db');

class PatternLearning {
  constructor() {
    this.userPatterns = new Map(); // Cache for active user patterns
    this.suggestionMetrics = new Map(); // Cache for recent metrics
    this.cacheTimeout = 30 * 60 * 1000; // 30 minutes cache
  }

  /**
   * Track when a suggestion is shown to user
   */
  async trackSuggestionShown(userId, suggestion, context = {}) {
    try {
      const metrics = {
        user_id: userId,
        suggestion_text: suggestion,
        action: 'shown',
        context_data: context,
        cursor_position: context.cursorPosition || 0,
        text_length: context.textLength || 0,
        created_at: new Date()
      };

      // Store in database
      await pool.query(`
        INSERT INTO suggestion_metrics
        (user_id, suggestion_text, action, context_data, cursor_position, text_length)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        metrics.user_id,
        metrics.suggestion_text,
        metrics.action,
        JSON.stringify(metrics.context_data),
        metrics.cursor_position,
        metrics.text_length
      ]);

      // Update pattern shown count
      await this.updatePatternShownCount(userId, suggestion);

      console.log(`📊 Tracked suggestion shown: "${suggestion}" for user ${userId}`);
    } catch (error) {
      console.error('Error tracking suggestion shown:', error);
    }
  }

  /**
   * Track when user accepts a suggestion (Tab key)
   */
  async trackSuggestionAccepted(userId, suggestion, context = {}, responseTime = null) {
    try {
      const metrics = {
        user_id: userId,
        suggestion_text: suggestion,
        action: 'accepted',
        context_data: context,
        response_time_ms: responseTime,
        cursor_position: context.cursorPosition || 0,
        text_length: context.textLength || 0
      };

      // Store acceptance in database
      await pool.query(`
        INSERT INTO suggestion_metrics
        (user_id, suggestion_text, action, context_data, response_time_ms, cursor_position, text_length)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        metrics.user_id,
        metrics.suggestion_text,
        metrics.action,
        JSON.stringify(metrics.context_data),
        metrics.response_time_ms,
        metrics.cursor_position,
        metrics.text_length
      ]);

      // Learn this as a positive pattern
      await this.learnPositivePattern(userId, suggestion, context);

      console.log(`✅ Tracked suggestion accepted: "${suggestion}" for user ${userId}`);
    } catch (error) {
      console.error('Error tracking suggestion accepted:', error);
    }
  }

  /**
   * Track when user rejects a suggestion (Escape key)
   */
  async trackSuggestionRejected(userId, suggestion, context = {}, responseTime = null) {
    try {
      const metrics = {
        user_id: userId,
        suggestion_text: suggestion,
        action: 'rejected',
        context_data: context,
        response_time_ms: responseTime
      };

      await pool.query(`
        INSERT INTO suggestion_metrics
        (user_id, suggestion_text, action, context_data, response_time_ms, cursor_position, text_length)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        metrics.user_id,
        metrics.suggestion_text,
        metrics.action,
        JSON.stringify(metrics.context_data),
        metrics.response_time_ms,
        context.cursorPosition || 0,
        context.textLength || 0
      ]);

      // Learn this as a negative pattern
      await this.learnNegativePattern(userId, suggestion, context);

      console.log(`❌ Tracked suggestion rejected: "${suggestion}" for user ${userId}`);
    } catch (error) {
      console.error('Error tracking suggestion rejected:', error);
    }
  }

  /**
   * Learn from positive feedback (user accepted suggestion)
   */
  async learnPositivePattern(userId, suggestion, context) {
    try {
      const patternType = this.classifyPatternType(suggestion, context);

      // Check if pattern already exists
      const existingPattern = await pool.query(`
        SELECT id, frequency, total_shown, total_accepted
        FROM user_patterns
        WHERE user_id = $1 AND pattern_text = $2
      `, [userId, suggestion]);

      if (existingPattern.rows.length > 0) {
        // Update existing pattern
        const pattern = existingPattern.rows[0];
        const newFrequency = pattern.frequency + 1;
        const newAccepted = pattern.total_accepted + 1;
        const newAcceptanceRate = newAccepted / pattern.total_shown;

        await pool.query(`
          UPDATE user_patterns
          SET frequency = $1, total_accepted = $2, acceptance_rate = $3,
              last_used = NOW(), updated_at = NOW()
          WHERE id = $4
        `, [newFrequency, newAccepted, newAcceptanceRate, pattern.id]);

      } else {
        // Create new pattern
        await pool.query(`
          INSERT INTO user_patterns
          (user_id, pattern_text, pattern_type, context_data, frequency, total_accepted, total_shown, acceptance_rate)
          VALUES ($1, $2, $3, $4, 1, 1, 1, 1.0000)
        `, [
          userId,
          suggestion,
          patternType,
          JSON.stringify(context)
        ]);
      }

      // Clear cache to force refresh
      this.clearUserCache(userId);

      console.log(`📚 Learned positive pattern: "${suggestion}" (${patternType}) for user ${userId}`);
    } catch (error) {
      console.error('Error learning positive pattern:', error);
    }
  }

  /**
   * Learn from negative feedback (user rejected suggestion)
   */
  async learnNegativePattern(userId, suggestion, context) {
    try {
      // For now, we don't create negative patterns, but we could implement
      // a blacklist or reduce scoring for similar patterns
      console.log(`🚫 Learned negative pattern: "${suggestion}" for user ${userId}`);
    } catch (error) {
      console.error('Error learning negative pattern:', error);
    }
  }

  /**
   * Update pattern shown count when suggestion is displayed
   */
  async updatePatternShownCount(userId, suggestion) {
    try {
      const result = await pool.query(`
        UPDATE user_patterns
        SET total_shown = total_shown + 1,
            acceptance_rate = CASE
              WHEN total_shown + 1 > 0 THEN total_accepted::DECIMAL / (total_shown + 1)
              ELSE 0.0000
            END,
            updated_at = NOW()
        WHERE user_id = $1 AND pattern_text = $2
        RETURNING id
      `, [userId, suggestion]);

      if (result.rows.length === 0) {
        // Pattern doesn't exist yet, create it with shown count
        const patternType = this.classifyPatternType(suggestion, {});
        await pool.query(`
          INSERT INTO user_patterns
          (user_id, pattern_text, pattern_type, total_shown, total_accepted, acceptance_rate)
          VALUES ($1, $2, $3, 1, 0, 0.0000)
        `, [userId, suggestion, patternType]);
      }
    } catch (error) {
      console.error('Error updating pattern shown count:', error);
    }
  }

  /**
   * Get personalized suggestions for user based on learned patterns
   */
  async getPersonalizedSuggestions(userId, currentText, context, limit = 5) {
    try {
      // Get user's top patterns based on acceptance rate and frequency
      const userPatterns = await pool.query(`
        SELECT pattern_text, pattern_type, acceptance_rate, frequency, context_data,
               (acceptance_rate * 0.6 + (frequency / 100.0) * 0.4) as smart_score
        FROM user_patterns
        WHERE user_id = $1
          AND acceptance_rate > 0.1
          AND frequency >= 1
        ORDER BY smart_score DESC, last_used DESC
        LIMIT $2
      `, [userId, limit * 2]); // Get more to filter

      if (userPatterns.rows.length === 0) {
        return []; // No learned patterns yet
      }

      // Filter patterns based on current context
      const contextualPatterns = userPatterns.rows.filter(pattern => {
        return this.isPatternRelevant(pattern, currentText, context);
      });

      // Return top suggestions
      return contextualPatterns
        .slice(0, limit)
        .map(pattern => ({
          text: pattern.pattern_text,
          type: pattern.pattern_type,
          score: pattern.smart_score,
          acceptanceRate: pattern.acceptance_rate,
          frequency: pattern.frequency
        }));

    } catch (error) {
      console.error('Error getting personalized suggestions:', error);
      return [];
    }
  }

  /**
   * Classify what type of pattern this is
   */
  classifyPatternType(suggestion, context) {
    const text = suggestion.toLowerCase();

    if (text.includes('dear') || text.includes('hello') || text.includes('hi')) {
      return 'greeting';
    }
    if (text.includes('regards') || text.includes('sincerely') || text.includes('best')) {
      return 'closing';
    }
    if (text.includes('thank') || text.includes('appreciate')) {
      return 'gratitude';
    }
    if (text.includes('please') || text.includes('could you') || text.includes('would you')) {
      return 'request';
    }
    if (text.includes('hope') || text.includes('trust')) {
      return 'opening';
    }

    return 'phrase'; // Default type
  }

  /**
   * Check if a pattern is relevant to current context
   */
  isPatternRelevant(pattern, currentText, context) {
    const currentTextLower = currentText.toLowerCase();
    const currentLength = currentText.length;

    // Don't suggest greetings if we're deep in the email
    if (pattern.pattern_type === 'greeting' && currentLength > 100) {
      return false;
    }

    // Don't suggest closings if we're at the beginning
    if (pattern.pattern_type === 'closing' && currentLength < 50) {
      return false;
    }

    // Don't suggest same pattern if it already exists in text
    if (currentTextLower.includes(pattern.pattern_text.toLowerCase().substring(0, 10))) {
      return false;
    }

    return true;
  }

  /**
   * Clear user cache to force refresh
   */
  clearUserCache(userId) {
    this.userPatterns.delete(userId);
    this.suggestionMetrics.delete(userId);
  }

  /**
   * Get user statistics
   */
  async getUserStats(userId) {
    try {
      const stats = await pool.query(`
        SELECT
          COUNT(*) as total_patterns,
          AVG(acceptance_rate) as avg_acceptance_rate,
          SUM(frequency) as total_frequency,
          MAX(last_used) as last_pattern_used
        FROM user_patterns
        WHERE user_id = $1
      `, [userId]);

      const metrics = await pool.query(`
        SELECT
          action,
          COUNT(*) as count
        FROM suggestion_metrics
        WHERE user_id = $1
        GROUP BY action
      `, [userId]);

      return {
        patterns: stats.rows[0],
        metrics: metrics.rows
      };
    } catch (error) {
      console.error('Error getting user stats:', error);
      return null;
    }
  }
}

module.exports = PatternLearning;