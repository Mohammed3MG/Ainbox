// Background Job Queue System for Email Processing
const EventEmitter = require('events');

class JobQueue extends EventEmitter {
  constructor() {
    super();

    // Priority queues
    this.queues = {
      high: [],     // Real-time updates (new emails, read/unread)
      medium: [],   // Email syncing, content loading
      low: []       // Cleanup, search indexing
    };

    // Worker management
    this.workers = {
      high: { count: 3, active: 0, processing: [] },
      medium: { count: 5, active: 0, processing: [] },
      low: { count: 2, active: 0, processing: [] }
    };

    // Job tracking
    this.jobId = 0;
    this.completedJobs = new Map(); // jobId -> result
    this.failedJobs = new Map(); // jobId -> error
    this.jobStats = {
      processed: 0,
      failed: 0,
      avgProcessingTime: 0,
      totalProcessingTime: 0
    };

    // Rate limiting per user
    this.userJobCounts = new Map(); // userId -> { lastReset: timestamp, count: number }
    this.maxJobsPerUserPerMinute = 60; // Prevent spam

    this.startWorkers();
    this.startCleanup();
  }

  // Add job to appropriate queue
  async addJob(priority, type, userId, data, options = {}) {
    // Rate limiting check
    if (!this.checkRateLimit(userId)) {
      throw new Error(`Rate limit exceeded for user ${userId}`);
    }

    const jobId = ++this.jobId;
    const job = {
      id: jobId,
      type,
      userId,
      data,
      options,
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: options.maxAttempts || 3,
      timeout: options.timeout || 30000, // 30 seconds default
      priority
    };

    // Add to appropriate queue
    if (!this.queues[priority]) {
      throw new Error(`Invalid priority: ${priority}`);
    }

    this.queues[priority].push(job);
    this.emit('jobAdded', job);

    console.log(`📋 Added ${priority} priority job ${jobId} (${type}) for user ${userId}`);
    return jobId;
  }

  // Check rate limit for user
  checkRateLimit(userId) {
    const now = Date.now();
    const userLimits = this.userJobCounts.get(userId) || { lastReset: now, count: 0 };

    // Reset counter if minute has passed
    if (now - userLimits.lastReset > 60000) {
      userLimits.lastReset = now;
      userLimits.count = 0;
    }

    // Check if under limit
    if (userLimits.count >= this.maxJobsPerUserPerMinute) {
      return false;
    }

    // Increment counter
    userLimits.count++;
    this.userJobCounts.set(userId, userLimits);
    return true;
  }

  // Start workers for all priority levels
  startWorkers() {
    for (const priority of ['high', 'medium', 'low']) {
      const workerCount = this.workers[priority].count;

      for (let i = 0; i < workerCount; i++) {
        this.startWorker(priority, i);
      }
    }
  }

  // Start individual worker
  async startWorker(priority, workerId) {
    const worker = async () => {
      while (true) {
        try {
          // Get next job from queue
          const job = this.getNextJob(priority);
          if (!job) {
            // No jobs, wait a bit
            await this.sleep(100);
            continue;
          }

          // Process the job
          await this.processJob(job, `${priority}-${workerId}`);

        } catch (error) {
          console.error(`Worker ${priority}-${workerId} error:`, error);
          await this.sleep(1000); // Wait before retrying
        }
      }
    };

    // Start the worker
    worker().catch(error => {
      console.error(`Fatal worker error for ${priority}-${workerId}:`, error);
    });

    console.log(`👷 Started worker ${priority}-${workerId}`);
  }

  // Get next job from queue
  getNextJob(priority) {
    const queue = this.queues[priority];
    if (queue.length === 0) return null;

    // Sort by creation time (FIFO within priority)
    queue.sort((a, b) => a.createdAt - b.createdAt);

    return queue.shift();
  }

  // Process individual job
  async processJob(job, workerId) {
    const startTime = Date.now();

    try {
      this.workers[job.priority].active++;
      this.workers[job.priority].processing.push(job.id);

      console.log(`⚡ Processing job ${job.id} (${job.type}) on worker ${workerId}`);

      // Set timeout for job
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Job timeout')), job.timeout);
      });

      // Process the job based on type
      const jobPromise = this.executeJob(job);
      const result = await Promise.race([jobPromise, timeoutPromise]);

      // Job completed successfully
      const processingTime = Date.now() - startTime;
      this.jobStats.processed++;
      this.jobStats.totalProcessingTime += processingTime;
      this.jobStats.avgProcessingTime = this.jobStats.totalProcessingTime / this.jobStats.processed;

      this.completedJobs.set(job.id, { result, completedAt: Date.now(), processingTime });
      this.emit('jobCompleted', job, result);

      console.log(`✅ Job ${job.id} completed in ${processingTime}ms`);

    } catch (error) {
      // Job failed
      job.attempts++;
      const processingTime = Date.now() - startTime;

      console.error(`❌ Job ${job.id} failed (attempt ${job.attempts}):`, error.message);

      if (job.attempts < job.maxAttempts) {
        // Retry with exponential backoff
        const delay = Math.pow(2, job.attempts) * 1000; // 2s, 4s, 8s...
        setTimeout(() => {
          this.queues[job.priority].push(job);
          console.log(`🔄 Retrying job ${job.id} in ${delay}ms`);
        }, delay);
      } else {
        // Max attempts reached
        this.jobStats.failed++;
        this.failedJobs.set(job.id, { error: error.message, failedAt: Date.now(), processingTime });
        this.emit('jobFailed', job, error);
        console.error(`💀 Job ${job.id} failed permanently after ${job.attempts} attempts`);
      }

    } finally {
      // Cleanup worker state
      this.workers[job.priority].active--;
      const processingIndex = this.workers[job.priority].processing.indexOf(job.id);
      if (processingIndex > -1) {
        this.workers[job.priority].processing.splice(processingIndex, 1);
      }
    }
  }

  // Execute job based on type
  async executeJob(job) {
    const { type, userId, data } = job;

    switch (type) {
      case 'sync_emails':
        return await this.syncUserEmails(userId, data);

      case 'mark_read':
        return await this.markEmailsRead(userId, data.emailIds);

      case 'mark_unread':
        return await this.markEmailsUnread(userId, data.emailIds);

      case 'delete_emails':
        return await this.deleteEmails(userId, data.emailIds);

      case 'send_email':
        return await this.sendEmail(userId, data);

      case 'process_webhook':
        return await this.processWebhook(userId, data);

      case 'cleanup_cache':
        return await this.cleanupCache(userId, data);

      case 'index_search':
        return await this.indexForSearch(userId, data);

      default:
        throw new Error(`Unknown job type: ${type}`);
    }
  }

  // Job implementations (to be expanded based on your needs)
  async syncUserEmails(userId, data) {
    // Import your sync logic here
    const gmailSync = require('./gmailSync');
    return await gmailSync.syncUser(userId, data);
  }

  async markEmailsRead(userId, emailIds) {
    // Import your email marking logic
    const { markEmailAsRead } = require('../services/emailService');
    return await markEmailAsRead(userId, emailIds);
  }

  async markEmailsUnread(userId, emailIds) {
    const { markEmailAsUnread } = require('../services/emailService');
    return await markEmailAsUnread(userId, emailIds);
  }

  async deleteEmails(userId, emailIds) {
    const { deleteEmails } = require('../services/emailService');
    return await deleteEmails(userId, emailIds);
  }

  async sendEmail(userId, emailData) {
    const { sendEmail } = require('../services/emailService');
    return await sendEmail(userId, emailData);
  }

  async processWebhook(userId, webhookData) {
    // Process Gmail/Outlook webhook
    const { processWebhook } = require('../services/webhookService');
    return await processWebhook(userId, webhookData);
  }

  async cleanupCache(userId, data) {
    const smartCache = require('./smartCache');
    return await smartCache.invalidateUser(userId);
  }

  async indexForSearch(userId, data) {
    // Search indexing logic
    return { indexed: true };
  }

  // Utility methods
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cleanup old completed/failed jobs
  startCleanup() {
    setInterval(() => {
      const cutoff = Date.now() - 3600000; // 1 hour

      // Clean completed jobs
      for (const [jobId, data] of this.completedJobs) {
        if (data.completedAt < cutoff) {
          this.completedJobs.delete(jobId);
        }
      }

      // Clean failed jobs
      for (const [jobId, data] of this.failedJobs) {
        if (data.failedAt < cutoff) {
          this.failedJobs.delete(jobId);
        }
      }

      // Reset user rate limits
      const now = Date.now();
      for (const [userId, limits] of this.userJobCounts) {
        if (now - limits.lastReset > 3600000) { // 1 hour
          this.userJobCounts.delete(userId);
        }
      }

    }, 300000); // Every 5 minutes
  }

  // Public methods for adding specific job types
  async scheduleEmailSync(userId, provider, options = {}) {
    return await this.addJob('medium', 'sync_emails', userId, { provider }, options);
  }

  async scheduleMarkRead(userId, emailIds, options = {}) {
    return await this.addJob('high', 'mark_read', userId, { emailIds }, options);
  }

  async scheduleMarkUnread(userId, emailIds, options = {}) {
    return await this.addJob('high', 'mark_unread', userId, { emailIds }, options);
  }

  async scheduleDeleteEmails(userId, emailIds, options = {}) {
    return await this.addJob('medium', 'delete_emails', userId, { emailIds }, options);
  }

  async scheduleSendEmail(userId, emailData, options = {}) {
    return await this.addJob('high', 'send_email', userId, emailData, options);
  }

  async scheduleWebhookProcessing(userId, webhookData, options = {}) {
    return await this.addJob('high', 'process_webhook', userId, webhookData, options);
  }

  async scheduleCacheCleanup(userId, options = {}) {
    return await this.addJob('low', 'cleanup_cache', userId, {}, options);
  }

  // Get queue statistics
  getStats() {
    const totalQueueSize = Object.values(this.queues).reduce((sum, queue) => sum + queue.length, 0);
    const totalActiveWorkers = Object.values(this.workers).reduce((sum, worker) => sum + worker.active, 0);

    return {
      queues: {
        high: this.queues.high.length,
        medium: this.queues.medium.length,
        low: this.queues.low.length,
        total: totalQueueSize
      },
      workers: {
        high: { configured: this.workers.high.count, active: this.workers.high.active },
        medium: { configured: this.workers.medium.count, active: this.workers.medium.active },
        low: { configured: this.workers.low.count, active: this.workers.low.active },
        totalActive: totalActiveWorkers
      },
      jobs: {
        processed: this.jobStats.processed,
        failed: this.jobStats.failed,
        avgProcessingTime: Math.round(this.jobStats.avgProcessingTime),
        completedInMemory: this.completedJobs.size,
        failedInMemory: this.failedJobs.size
      },
      rateLimits: {
        activeUsers: this.userJobCounts.size,
        maxJobsPerUserPerMinute: this.maxJobsPerUserPerMinute
      }
    };
  }
}

module.exports = new JobQueue();