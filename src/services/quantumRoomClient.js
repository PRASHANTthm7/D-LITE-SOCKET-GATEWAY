import axios from 'axios';
import { createLogger } from '../middleware/logger.js';
import { TIMEOUTS } from '../config/timeouts.js';
import { getServiceAuthHeader } from '../utils/serviceAuth.js';
import { createCircuitBreaker } from '../utils/retry.js';

const QUANTUM_ROOM_ENGINE_URL = process.env.QUANTUM_ROOM_ENGINE_URL || 'http://localhost:3004';
const logger = createLogger('QuantumRoom');

// Create circuit breaker for quantum room engine
const quantumRoomBreaker = createCircuitBreaker('QuantumRoomEngine', {
  failureThreshold: 5,
  resetTimeout: 30000,
  monitorInterval: 10000,
});

/**
 * Send event to Quantum Room Engine
 * @param {string} roomId - Room/group ID
 * @param {string} userId - User ID
 * @param {string} eventType - Event type (message_sent, user_join, user_leave, typing_start)
 * @param {object} metadata - Additional event metadata
 */
export const sendQuantumRoomEvent = async (roomId, userId, eventType, metadata = {}) => {
  try {
    const response = await quantumRoomBreaker.execute(
      async () => {
        return await axios.post(
          `${QUANTUM_ROOM_ENGINE_URL}/quantum-room/event`,
          {
            roomId,
            userId,
            eventType,
            metadata,
            timestamp: new Date().toISOString()
          },
          {
            timeout: TIMEOUTS.QUANTUM_ROOM_TIMEOUT,
            headers: getServiceAuthHeader()
          }
        );
      },
      // Fallback function if circuit is open
      () => {
        logger.warn(`Quantum room engine unavailable, skipping event`, { eventType, roomId, userId });
        return null;
      }
    );
    
    if (response?.data?.success) {
      logger.info(`Event sent: ${eventType}`, { roomId, userId });
      return response.data.data;
    }
  } catch (error) {
    // Don't fail the main operation if quantum room engine is down
    logger.error(`Failed to send event`, error, { eventType, roomId, userId });
    return null;
  }
};

/**
 * Get room aura information
 * @param {string} roomId - Room/group ID
 */
export const getRoomAura = async (roomId) => {
  try {
    const response = await quantumRoomBreaker.execute(
      async () => {
        return await axios.get(
          `${QUANTUM_ROOM_ENGINE_URL}/quantum-room/aura/${roomId}`,
          { 
            timeout: TIMEOUTS.QUANTUM_ROOM_TIMEOUT,
            headers: getServiceAuthHeader()
          }
        );
      },
      // Fallback function if circuit is open
      () => {
        logger.warn('Quantum room engine unavailable, skipping aura retrieval', { roomId });
        return null;
      }
    );
    
    if (response?.data?.success) {
      return response.data.data;
    }
  } catch (error) {
    logger.error('Failed to get aura', error, { roomId });
    return null;
  }
};

/**
 * Get room insights
 * @param {string} roomId - Room/group ID
 */
export const getRoomInsight = async (roomId) => {
  try {
    const response = await quantumRoomBreaker.execute(
      async () => {
        return await axios.get(
          `${QUANTUM_ROOM_ENGINE_URL}/quantum-room/insight/${roomId}`,
          { 
            timeout: TIMEOUTS.QUANTUM_ROOM_TIMEOUT,
            headers: getServiceAuthHeader()
          }
        );
      },
      // Fallback function if circuit is open
      () => {
        logger.warn('Quantum room engine unavailable, skipping insight retrieval', { roomId });
        return null;
      }
    );
    
    if (response?.data?.success) {
      return response.data.data;
    }
  } catch (error) {
    logger.error('Failed to get insight', error, { roomId });
    return null;
  }
};
