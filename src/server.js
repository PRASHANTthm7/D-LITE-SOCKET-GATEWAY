/**
 * Socket Gateway Server - Stateless Real-Time Communication Hub
 * 
 * Architecture Decision:
 * ─────────────────────────
 * Socket Gateway is a STATELESS relay that handles real-time WebSocket communication.
 * It does NOT connect to MongoDB - all persistence is delegated to other services.
 * 
 * Key Components:
 * ───────────────
 * • Express app for REST endpoints (health checks, metrics)
 * • Socket.IO server for WebSocket connections
 * • JWT authentication middleware
 * • In-memory presence tracking (onlineUsers Map)
 * 
 * Service Delegation:
 * ───────────────────
 * • User status updates → auth-service via HTTP API
 * • Message persistence → chat-service via HTTP API
 * • Presence tracking → In-memory Map (onlineUsers)
 * 
 * Benefits:
 * ─────────
 * ✓ True separation of concerns
 * ✓ Stateless (easy horizontal scaling)
 * ✓ No database coupling
 * ✓ Each service owns its data domain
 * 
 * For horizontal scaling with multiple instances:
 * Use Redis for shared presence state + Socket.IO Redis adapter
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import cors from 'cors';
import { connectDB } from './config/database.js'; // No actual DB connection
import { authenticateSocket } from './middleware/authMiddleware.js';
import { requestLogger, socketGatewayLogger } from './middleware/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { registerMessageHandlers } from './handlers/messageHandlers.js';
import { registerConnectionHandlers } from './handlers/connectionHandlers.js';
import { sendPresenceEvent } from './services/presenceClient.js';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'CHAT_SERVICE_URL', 'AUTH_SERVICE_URL'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const app = express();
const httpServer = createServer(app);

// ============================================================================
// Express Middleware
// ============================================================================

app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
  credentials: true
}));
app.use(express.json());
app.use(requestLogger); // Log all HTTP requests

// Initialize (no database connection - socket-gateway is stateless)
connectDB(); // Logs that we're using in-memory presence only

// ============================================================================
// Socket.IO Configuration
// ============================================================================

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

/**
 * Track online users
 * Maps userId to socketId for quick lookup when routing messages
 * 
 * Architecture Decision:
 * - In-memory map provides O(1) lookup for presence checks
 * - Could be moved to Redis for horizontal scaling across multiple gateway instances
 */
export const onlineUsers = new Map(); // userId -> socketId

// ============================================================================
// Socket Event Handlers
// ============================================================================

// Socket authentication middleware - verifies JWT before accepting connection
io.use(authenticateSocket);

// Socket connection handler
io.on('connection', (socket) => {
  socketGatewayLogger.info('Socket connected', {
    socketId: socket.id,
    userId: socket.userId,
  });

  // Register event handlers for this socket (includes disconnect handler)
  registerConnectionHandlers(io, socket);
  registerMessageHandlers(io, socket);

  // Centralized disconnect handler (moved to connectionHandlers for better organization)
  socket.on('disconnect', (reason) => {
    socketGatewayLogger.info('Socket disconnecting', {
      socketId: socket.id,
      userId: socket.userId,
      reason,
    });

    // Find and remove from online users
    let disconnectedUserId = null;
    for (const [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        disconnectedUserId = userId;
        onlineUsers.delete(userId);
        socketGatewayLogger.info('User went offline', {
          userId,
          remainingOnline: onlineUsers.size,
        });
        break;
      }
    }

    // Notify all clients about the disconnection
    if (disconnectedUserId) {
      // Send presence event to presence-engine
      sendPresenceEvent(disconnectedUserId, 'user_disconnected').catch(err => {
        socketGatewayLogger.error('Failed to send presence disconnect event', err);
      });
      
      io.emit('user_disconnected', { user_id: disconnectedUserId });

      // Broadcast updated online users list to all remaining clients
      const onlineUsersList = Array.from(onlineUsers.keys());
      io.emit('online_users', onlineUsersList);
    }
  });
});

// ============================================================================
// REST API Endpoints
// ============================================================================

/**
 * Health check endpoint
 * Used by load balancers and monitoring systems to verify service health
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'socket-gateway',
    connections: io.engine.clientsCount,
    onlineUsers: onlineUsers.size,
    timestamp: new Date().toISOString()
  });
});

/**
 * Metrics endpoint
 * Provides detailed metrics for monitoring and alerting
 */
app.get('/metrics', (req, res) => {
  res.json({
    connections: {
      total: io.engine.clientsCount,
      online: onlineUsers.size,
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Error Handling Middleware (must be last)
// ============================================================================

app.use(notFoundHandler); // Handle 404s
app.use(errorHandler); // Handle all errors

// ============================================================================
// Server Startup
// ============================================================================

const PORT = process.env.PORT || 3002;
httpServer.listen(PORT, () => {
  socketGatewayLogger.info('Socket Gateway started', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  socketGatewayLogger.info('SIGTERM received, shutting down gracefully');
  httpServer.close(() => {
    socketGatewayLogger.info('Server closed');
    process.exit(0);
  });
});

export { io };
