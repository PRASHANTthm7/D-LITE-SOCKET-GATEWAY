/**
 * Rate Limiting Utilities
 * 
 * Provides rate limiting for socket events to prevent spam and DoS attacks
 */

import { createLogger } from '../middleware/logger.js';

const logger = createLogger('RateLimit');

/**
 * In-memory store for rate limit tracking
 * Maps: `${userId}:${eventName}` -> { count, resetTime }
 */
const rateLimitStore = new Map();

/**
 * Cleanup old entries periodically to prevent memory leaks
 */
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Cleanup every 60 seconds

/**
 * Create a rate limiter for a specific event
 * 
 * @param {string} eventName - Name of the event (e.g., 'send_message')
 * @param {object} options - Rate limit options
 * @param {number} options.maxRequests - Maximum requests allowed (default: 100)
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000 = 1 minute)
 * @returns {Function} Rate limit checker function
 * 
 * Usage:
 * const checkLimit = createRateLimiter('send_message', { maxRequests: 10, windowMs: 60000 });
 * socket.on('send_message', (data) => {
 *   if (!checkLimit(socket)) return;
 *   // Handle the event...
 * });
 */
export const createRateLimiter = (eventName, options = {}) => {
  const {
    maxRequests = 100,
    windowMs = 60000,
  } = options;

  return (socket) => {
    const userId = socket.userId;
    const key = `${userId}:${eventName}`;
    const now = Date.now();

    // Initialize or get existing rate limit entry
    let entry = rateLimitStore.get(key);
    
    if (!entry || entry.resetTime < now) {
      // Create new entry if expired or doesn't exist
      entry = {
        count: 1,
        resetTime: now + windowMs,
      };
      rateLimitStore.set(key, entry);
      return true;
    } else {
      // Increment existing counter
      entry.count++;
      
      // Check if limit exceeded
      if (entry.count > maxRequests) {
        logger.warn('Rate limit exceeded', { userId, eventName, limit: maxRequests, window: windowMs });
        socket.emit('error', {
          message: `Rate limit exceeded for ${eventName}. Max ${maxRequests} requests per ${Math.round(windowMs / 1000)} seconds.`,
        });
        return false;
      }
    }
    
    return true;
  };
};

/**
 * Pre-configured rate limiters for common socket events
 * All limits are configurable via environment variables
 */
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10);
const RATE_LIMIT_TYPING_WINDOW = parseInt(process.env.RATE_LIMIT_TYPING_WINDOW || '10000', 10);

export const rateLimiters = {
  // Message events
  send_message: createRateLimiter('send_message', { 
    maxRequests: parseInt(process.env.RATE_LIMIT_SEND_MESSAGE || '30', 10),
    windowMs: RATE_LIMIT_WINDOW
  }),
  send_group_message: createRateLimiter('send_group_message', { 
    maxRequests: parseInt(process.env.RATE_LIMIT_SEND_GROUP_MESSAGE || '50', 10),
    windowMs: RATE_LIMIT_WINDOW
  }),
  
  // Typing indicators - can be more frequent
  typing: createRateLimiter('typing', { 
    maxRequests: parseInt(process.env.RATE_LIMIT_TYPING || '100', 10),
    windowMs: RATE_LIMIT_TYPING_WINDOW
  }),
  stop_typing: createRateLimiter('stop_typing', { 
    maxRequests: parseInt(process.env.RATE_LIMIT_STOP_TYPING || '100', 10),
    windowMs: RATE_LIMIT_TYPING_WINDOW
  }),
  
  // Room events
  join_room: createRateLimiter('join_room', { 
    maxRequests: parseInt(process.env.RATE_LIMIT_JOIN_ROOM || '20', 10),
    windowMs: RATE_LIMIT_WINDOW
  }),
  leave_room: createRateLimiter('leave_room', { 
    maxRequests: parseInt(process.env.RATE_LIMIT_LEAVE_ROOM || '20', 10),
    windowMs: RATE_LIMIT_WINDOW
  }),
  join_group: createRateLimiter('join_group', { 
    maxRequests: parseInt(process.env.RATE_LIMIT_JOIN_GROUP || '20', 10),
    windowMs: RATE_LIMIT_WINDOW
  }),
  leave_group: createRateLimiter('leave_group', { 
    maxRequests: parseInt(process.env.RATE_LIMIT_LEAVE_GROUP || '20', 10),
    windowMs: RATE_LIMIT_WINDOW
  }),
  
  // Status updates
  message_read: createRateLimiter('message_read', { 
    maxRequests: parseInt(process.env.RATE_LIMIT_MESSAGE_READ || '100', 10),
    windowMs: RATE_LIMIT_WINDOW
  }),
  message_delivered: createRateLimiter('message_delivered', { 
    maxRequests: parseInt(process.env.RATE_LIMIT_MESSAGE_DELIVERED || '100', 10),
    windowMs: RATE_LIMIT_WINDOW
  }),
  message_read_status: createRateLimiter('message_read_status', { 
    maxRequests: parseInt(process.env.RATE_LIMIT_MESSAGE_READ_STATUS || '100', 10),
    windowMs: RATE_LIMIT_WINDOW
  }),
  delete_message: createRateLimiter('delete_message', { 
    maxRequests: parseInt(process.env.RATE_LIMIT_DELETE_MESSAGE || '20', 10),
    windowMs: RATE_LIMIT_WINDOW
  }),
};

/**
 * Cleanup function - call on server shutdown
 */
export const cleanupRateLimiter = () => {
  clearInterval(cleanupInterval);
  rateLimitStore.clear();
};
