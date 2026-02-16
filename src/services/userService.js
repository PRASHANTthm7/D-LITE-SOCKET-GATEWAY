/**
 * User Service - HTTP-Based Implementation
 * 
 * Architecture Decision:
 * ─────────────────────────
 * Socket Gateway does NOT access the database directly.
 * Instead, it delegates user operations to auth-service via HTTP API.
 * 
 * This ensures:
 * • Separation of concerns (auth-service owns user data)
 * • Stateless socket-gateway (no database coupling)
 * • Resilience via retry logic
 * • Non-blocking operations (failures don't crash socket connections)
 */

import { authServiceClient } from '../config/apiGateway.js';
import { retryAxiosRequest } from '../utils/retry.js';
import { serviceLogger } from '../middleware/logger.js';

const logger = serviceLogger('UserService');

/**
 * Updates user online/offline status via auth-service HTTP API
 * 
 * @param {string} userId - User ID to update
 * @param {string} status - New status: 'online', 'offline', or 'away'
 */
export const updateUserStatus = async (userId, status) => {
  try {
    logger.info('Updating user status via auth-service', { userId, status });
    
    await retryAxiosRequest(
      () => authServiceClient.patch(`/api/users/${userId}/status`, { 
        status,
        lastSeen: new Date()
      }),
      { 
        maxRetries: 2, 
        baseDelay: 500,
        maxDelay: 2000
      }
    );
    
    logger.info('✓ User status updated successfully', { userId, status });
  } catch (error) {
    // Non-critical: Socket operations should continue even if status update fails
    logger.error('✗ Failed to update user status (non-critical, socket continues)', { 
      userId, 
      status, 
      error: error.message 
    });
  }
};

/**
 * Fetches user details via auth-service HTTP API
 * 
 * @param {string} userId - User ID to fetch
 * @returns {Object|null} User object or null if not found
 */
export const getUserById = async (userId) => {
  try {
    logger.info('Fetching user via auth-service', { userId });
    
    const response = await retryAxiosRequest(
      () => authServiceClient.get(`/api/users/${userId}`),
      { maxRetries: 2, baseDelay: 500 }
    );
    
    return response.data;
  } catch (error) {
    logger.error('Failed to fetch user', { userId, error: error.message });
    return null;
  }
};
