/**
 * Typing Timers Manager
 * 
 * Provides global management of typing indicator debounce timers.
 * Each user's typing indicator timer is tracked globally to ensure
 * cleanup on disconnect and prevent memory leaks.
 * 
 * Architecture Decision:
 * ──────────────────────
 * • Global Map: Centralized tracking prevents per-socket leaks
 * • Per-socket keys: socket.userId + optional roomId for multi-window support
 * • Auto-cleanup: Disconnect handler removes all timers for that user
 * • Stale cleanup: Periodic sweep removes timers without active sockets
 */

import { createLogger } from '../middleware/logger.js';
import { TIMEOUTS } from '../config/timeouts.js';

const logger = createLogger('TypingTimers');

/**
 * Global store of typing timers
 * Format: Map<key, { timeout: NodeJS.Timeout, socketId: string, createdAt: Date } >
 * Key format: "userId:socketId" or "userId:socketId:roomId"
 */
const typingTimers = new Map();

/**
 * Set a typing timer for a user in a specific context (1-on-1 or group)
 * Automatically clears any existing timer for this user first
 * 
 * @param {string} socketId - Socket ID of the connection
 * @param {string} userId - User ID
 * @param {Function} callback - Callback to execute when timer expires
 * @param {string} [context] - Optional context (receiver_id, group_id, room_id, etc)
 * @returns {void}
 */
export const setTypingTimer = (socketId, userId, callback, context = '') => {
  try {
    const key = context ? `${userId}:${context}` : userId;
    
    // Clear existing timer
    if (typingTimers.has(key)) {
      const existingTimer = typingTimers.get(key);
      clearTimeout(existingTimer.timeout);
      logger.debug('Cleared existing typing timer', { userId, context });
    }

    // Set new timer
    const timeout = setTimeout(() => {
      callback();
      typingTimers.delete(key);
      logger.debug('Typing timer expired and cleaned up', { userId, context });
    }, TIMEOUTS.AUTO_STOP_TYPING_TIMEOUT || 3000);

    typingTimers.set(key, {
      timeout,
      socketId,
      userId,
      context,
      createdAt: new Date(),
    });

    logger.debug('Set typing timer', { userId, context, duration: TIMEOUTS.AUTO_STOP_TYPING_TIMEOUT || 3000 });
  } catch (error) {
    logger.error('Failed to set typing timer', error, { userId });
  }
};

/**
 * Clear a typing timer for a specific context
 * 
 * @param {string} userId - User ID
 * @param {string} [context] - Optional context (receiver_id, group_id, etc)
 * @returns {void}
 */
export const clearTypingTimer = (userId, context = '') => {
  try {
    const key = context ? `${userId}:${context}` : userId;
    
    if (typingTimers.has(key)) {
      const timerEntry = typingTimers.get(key);
      clearTimeout(timerEntry.timeout);
      typingTimers.delete(key);
      logger.debug('Cleared typing timer', { userId, context });
    }
  } catch (error) {
    logger.error('Failed to clear typing timer', error, { userId });
  }
};

/**
 * Clear all typing timers for a specific user (called on disconnect)
 * 
 * @param {string} userId - User ID
 * @returns {number} Number of timers cleared
 */
export const clearUserTypingTimers = (userId) => {
  try {
    let cleared = 0;
    
    for (const [key, timerEntry] of typingTimers.entries()) {
      if (timerEntry.userId === userId) {
        clearTimeout(timerEntry.timeout);
        typingTimers.delete(key);
        cleared++;
      }
    }
    
    if (cleared > 0) {
      logger.info('Cleared user typing timers on disconnect', { userId, count: cleared });
    }
    
    return cleared;
  } catch (error) {
    logger.error('Failed to clear user typing timers', error, { userId });
    return 0;
  }
};

/**
 * Periodic cleanup of stale typing timers (e.g., for orphaned sockets)
 * Should be called periodically (e.g., every minute) to prevent memory leaks
 * if socket disconnect events don't always fire reliably
 * 
 * @returns {void}
 */
export const cleanupStaleTypingTimers = () => {
  try {
    const now = new Date();
    const maxAge = 5 * 60 * 1000; // 5 minutes
    let cleaned = 0;

    for (const [key, timerEntry] of typingTimers.entries()) {
      const age = now - timerEntry.createdAt;
      if (age > maxAge) {
        clearTimeout(timerEntry.timeout);
        typingTimers.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.warn('Cleaned up stale typing timers', { count: cleaned });
    }
  } catch (error) {
    logger.error('Failed to cleanup stale typing timers', error);
  }
};

/**
 * Get current typing timers count (for monitoring/debugging)
 * 
 * @returns {number} Current number of active typing timers
 */
export const getTypingTimersCount = () => {
  return typingTimers.size;
};

/**
 * Start periodic cleanup of stale typing timers
 * Should be called once on server startup
 * 
 * @returns {NodeJS.Timer} Interval ID for cleanup task
 */
export const startPeriodicCleanup = () => {
  const cleanupInterval = setInterval(() => {
    cleanupStaleTypingTimers();
  }, 60000); // Run every minute

  logger.info('Started periodic typing timer cleanup', { interval: '60s' });
  return cleanupInterval;
};

export default {
  setTypingTimer,
  clearTypingTimer,
  clearUserTypingTimers,
  cleanupStaleTypingTimers,
  getTypingTimersCount,
  startPeriodicCleanup,
};
