import axios from 'axios';
import dotenv from 'dotenv';
import { createLogger } from '../middleware/logger.js';
import { TIMEOUTS } from '../config/timeouts.js';
import { attachServiceAuth } from '../utils/serviceAuth.js';
import { createCircuitBreaker } from '../utils/retry.js';

dotenv.config();

const PRESENCE_ENGINE_URL = process.env.PRESENCE_ENGINE_URL || 'http://localhost:8003';
const logger = createLogger('Presence');

const presenceClient = axios.create({
  baseURL: `${PRESENCE_ENGINE_URL}/api`,
  timeout: TIMEOUTS.PRESENCE_ENGINE_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach service authentication to all requests
attachServiceAuth(presenceClient);

// Create circuit breaker for presence engine
const presenceBreaker = createCircuitBreaker('PresenceEngine', {
  failureThreshold: 5,
  resetTimeout: 30000,
  monitorInterval: 10000,
});

/**
 * Send presence event to presence-engine
 * Non-blocking - failures are logged but don't affect socket operations
 */
export const sendPresenceEvent = async (userId, eventType, metadata = null) => {
  try {
    await presenceBreaker.execute(
      async () => {
        await presenceClient.post('/presence/event', {
          userId,
          eventType,
          metadata
        });
      },
      // Fallback function - don't fail if presence engine is down
      () => {
        logger.warn(`Presence engine down, skipping event`, { eventType, userId });
        return null;
      }
    );
    logger.info(`Event sent: ${eventType}`, { userId });
  } catch (error) {
    // Non-critical: Socket operations continue even if presence engine is down
    if (error.code === 'ECONNREFUSED') {
      logger.warn(`Presence engine unavailable`, { eventType, userId });
    } else {
      logger.error(`Failed to send event`, error, { eventType, userId });
    }
  }
};

export default presenceClient;
