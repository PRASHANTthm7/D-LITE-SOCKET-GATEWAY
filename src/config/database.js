/**
 * Database Configuration - REMOVED
 * 
 * Socket Gateway does NOT connect to MongoDB directly.
 * 
 * Architecture Decision:
 * ─────────────────────────
 * Socket Gateway is a stateless relay for real-time communication.
 * It delegates all persistence to other services via HTTP APIs:
 * 
 * • User status updates → auth-service via HTTP
 * • Message persistence → chat-service via HTTP
 * • Presence tracking → In-memory Map (onlineUsers)
 * 
 * Benefits:
 * • True separation of concerns
 * • Stateless architecture (easier horizontal scaling)
 * • No database coupling
 * • Each service owns its data domain
 * 
 * For horizontal scaling with multiple socket-gateway instances:
 * Use Redis for shared presence state instead of in-memory Map.
 */

import { createLogger } from '../middleware/logger.js';

const logger = createLogger('Database');

export const connectDB = async () => {
  logger.info('No database connection - using in-memory presence tracking');
  logger.info('User persistence delegated to auth-service');
  logger.info('Message persistence delegated to chat-service');
};
