import axios from 'axios';
import { createLogger } from '../middleware/logger.js';
import { TIMEOUTS } from '../config/timeouts.js';
import { getServiceAuthHeader } from '../utils/serviceAuth.js';
import { createCircuitBreaker } from '../utils/retry.js';

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8002';
const logger = createLogger('AIEngine');

// Create circuit breaker for AI engine
const aiEngineBreaker = createCircuitBreaker('AIEngine', {
  failureThreshold: 5,
  resetTimeout: 30000,
  monitorInterval: 10000,
});

/**
 * Send message analysis event to AI Engine
 */
export const analyzeMessage = async (userId, text) => {
  try {
    const response = await aiEngineBreaker.execute(
      async () => {
        return await axios.post(
          `${AI_ENGINE_URL}/ai/analyze-message`,
          {
            userId,
            text,
            timestamp: new Date().toISOString()
          },
          { 
            timeout: TIMEOUTS.AI_ENGINE_TIMEOUT,
            headers: getServiceAuthHeader()
          }
        );
      },
      // Fallback function if circuit is open
      () => {
        logger.warn('AI engine unavailable, skipping message analysis', { userId });
        return null;
      }
    );
    
    if (response?.data) {
      return response.data;
    }
  } catch (error) {
    logger.error('Failed to analyze message', error, { userId });
    return null;
  }
};

/**
 * Request presence prediction from AI Engine
 */
export const predictPresence = async (userId, activityData) => {
  try {
    const response = await aiEngineBreaker.execute(
      async () => {
        return await axios.post(
          `${AI_ENGINE_URL}/ai/predict-presence`,
          {
            userId,
            activityHistory: activityData
          },
          { 
            timeout: TIMEOUTS.AI_ENGINE_TIMEOUT,
            headers: getServiceAuthHeader()
          }
        );
      },
      // Fallback function if circuit is open
      () => {
        logger.warn('AI engine unavailable, skipping presence prediction', { userId });
        return null;
      }
    );
    
    if (response?.data) {
      return response.data;
    }
  } catch (error) {
    logger.error('Failed to predict presence', error, { userId });
    return null;
  }
};
