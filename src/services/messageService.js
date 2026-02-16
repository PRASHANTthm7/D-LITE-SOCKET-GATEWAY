/**
 * Message Service
 * 
 * Architecture Decision:
 * - Handles communication between socket-gateway and chat-service
 * - Uses retry logic with exponential backoff for resilient inter-service communication
 * - Circuit breaker pattern prevents cascading failures
 * - Returns temporary IDs on failure to ensure message appears in UI (optimistic update)
 */

import { chatServiceClient, SERVICES } from '../config/apiGateway.js';
import { retryAxiosRequest, createCircuitBreaker } from '../utils/retry.js';
import { serviceLogger } from '../middleware/logger.js';

const logger = serviceLogger('ChatService');

// Create circuit breaker for chat service
const chatServiceBreaker = createCircuitBreaker('ChatService', {
  failureThreshold: 5,
  resetTimeout: 30000, // 30 seconds
  monitorInterval: 10000, // 10 seconds
});

/**
 * Save a message by forwarding it to the chat-service REST API with retry logic.
 * The chat-service requires a valid JWT in the Authorization header,
 * so we pass the sender's token obtained from the socket handshake.
 *
 * Architecture Decision:
 * - Uses retry logic to handle transient failures
 * - Circuit breaker prevents overwhelming a down service
 * - Returns temporary ID on permanent failures for optimistic UI updates
 *
 * @param {object} message  - Message payload (sender_id, receiver_id, content, …)
 * @param {string} [token]  - JWT token for authenticating with the chat-service
 * @returns {object}        - The persisted message returned by the chat-service
 */
export const saveMessage = async (message, token) => {
  try {
    logger.info('Saving message to chat service', {
      sender: message.sender_id,
      receiver: message.receiver_id,
      group: message.group_id,
    });

    // Execute request through circuit breaker with retry logic
    const response = await chatServiceBreaker.execute(
      async () => {
        return await retryAxiosRequest(
          () => chatServiceClient.post('/api/messages', message, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }),
          {
            maxRetries: 3,
            baseDelay: 1000,
          }
        );
      },
      // Fallback function if circuit is open
      () => {
        logger.warn('Circuit breaker open, using fallback for message save');
        return {
          data: {
            ...message,
            id: `temp_${Date.now()}`,
            _id: `temp_${Date.now()}`,
            status: 'pending',
          },
        };
      }
    );

    logger.info('Message saved successfully', {
      messageId: response.data._id || response.data.id,
    });

    return response.data;
  } catch (error) {
    logger.error('Failed to save message after retries', error, {
      sender: message.sender_id,
      receiver: message.receiver_id,
    });

    // Return message with temporary ID so the flow doesn't break
    // This enables optimistic UI updates even when backend is down
    return {
      ...message,
      id: `temp_${Date.now()}`,
      _id: `temp_${Date.now()}`,
      status: 'failed',
    };
  }
};

/**
 * Retrieve messages between two users with retry logic
 * 
 * @param {string} user1Id - First user ID
 * @param {string} user2Id - Second user ID
 * @param {string} [token] - JWT token for authentication
 * @returns {object} Messages data
 */
export const getMessages = async (user1Id, user2Id, token) => {
  try {
    logger.info('Fetching messages from chat service', {
      user1: user1Id,
      user2: user2Id,
    });

    const response = await retryAxiosRequest(
      () => chatServiceClient.get(`/api/messages/${user1Id}/${user2Id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
      {
        maxRetries: 2,
        baseDelay: 500,
      }
    );

    logger.info('Messages fetched successfully', {
      count: response.data.messages?.length || 0,
    });

    return response.data;
  } catch (error) {
    logger.error('Failed to fetch messages after retries', error, {
      user1: user1Id,
      user2: user2Id,
    });

    return { messages: [], count: 0 };
  }
};
