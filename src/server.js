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
import { startPeriodicCleanup } from './utils/typingTimers.js';
import { getRecentLogs, clearOldLogs } from './utils/persistentLogger.js';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'CHAT_SERVICE_URL', 'AUTH_SERVICE_URL'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Parse CORS origins - must be explicitly configured, no default in production
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : [];

const app = express();
const httpServer = createServer(app);

// ============================================================================
// Express Middleware
// ============================================================================

app.use(cors({
  origin: CORS_ORIGINS,
  credentials: true
}));
app.use(express.json());
app.use(requestLogger); // Log all HTTP requests

// Initialize (no database connection - socket-gateway is stateless)
connectDB(); // Logs that we're using in-memory presence only

// ============================================================================
// Socket.IO Configuration
// ============================================================================

const SOCKET_TRANSPORTS = (process.env.SOCKET_TRANSPORTS || 'websocket,polling').split(',');

const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: SOCKET_TRANSPORTS
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

/**
 * Recent logs endpoint (for debugging, should be restricted in production)
 * Returns the most recent log entries
 */
app.get('/logs', (req, res) => {
  const lines = parseInt(req.query.lines || '100', 10);
  const recentLogs = getRecentLogs(Math.min(lines, 1000)); // Max 1000 lines
  
  res.json({
    count: recentLogs.length,
    logs: recentLogs,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Error Handling Middleware (must be last)
// ============================================================================

app.use(notFoundHandler); // Handle 404s
app.use(errorHandler); // Handle all errors

// ============================================================================
// Stale Connection Cleanup
// ============================================================================

/**
 * Periodically remove stale entries from onlineUsers Map.
 * Prevents memory leaks if disconnect handlers fail to execute.
 */
const STALE_CONNECTION_CLEANUP_INTERVAL = parseInt(process.env.STALE_CONNECTION_CLEANUP_INTERVAL || '60000', 10);

const startStaleConnectionCleanup = () => {
  setInterval(() => {
    const activeSocketIds = new Set();
    io.sockets.sockets.forEach(socket => {
      activeSocketIds.add(socket.id);
    });

    let staleCount = 0;
    for (const [userId, socketId] of onlineUsers.entries()) {
      if (!activeSocketIds.has(socketId)) {
        onlineUsers.delete(userId);
        staleCount++;
        socketGatewayLogger.warn('Removed stale connection', { userId, socketId });
      }
    }

    if (staleCount > 0) {
      socketGatewayLogger.info('Stale connection cleanup completed', {
        removed: staleCount,
        remaining: onlineUsers.size,
      });
    }
  }, STALE_CONNECTION_CLEANUP_INTERVAL);
};

// ============================================================================
// Server Startup
// ============================================================================

const PORT = parseInt(process.env.PORT || '3002', 10);
const LOG_CLEANUP_INTERVAL = parseInt(process.env.LOG_CLEANUP_INTERVAL || '86400000', 10);
const OLD_LOG_RETENTION_DAYS = parseInt(process.env.OLD_LOG_RETENTION_DAYS || '7', 10);

httpServer.listen(PORT, () => {
  socketGatewayLogger.info('Socket Gateway started', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    persistentLogging: true,
    logLevel: process.env.LOG_LEVEL || 'info',
    logDir: process.env.LOG_DIR || './logs',
  });
  
  // Start stale connection cleanup
  startStaleConnectionCleanup();
  
  // Start periodic cleanup of stale typing timers
  startPeriodicCleanup();
  
  // Schedule old log cleanup with configurable interval and retention
  setInterval(() => {
    clearOldLogs(OLD_LOG_RETENTION_DAYS);
  }, LOG_CLEANUP_INTERVAL);
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

process.on('SIGTERM', () => {
  socketGatewayLogger.info('SIGTERM received, initiating graceful shutdown');
  
  // Disconnect all socket clients gracefully
  io.disconnectSockets();
  socketGatewayLogger.info('Socket.IO connections closed');
  
  // Close HTTP server
  httpServer.close(() => {
    socketGatewayLogger.info('HTTP server closed');
    onlineUsers.clear();
    socketGatewayLogger.info('Shutdown complete');
    process.exit(0);
  });
  
  // Force exit after 10 seconds if graceful shutdown is taking too long
  setTimeout(() => {
    socketGatewayLogger.error('Graceful shutdown timeout, forcing exit');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', () => {
  socketGatewayLogger.info('SIGINT received, initiating graceful shutdown');
  process.emit('SIGTERM');
});

// ============================================================================
// Process-Level Error Handlers
// ============================================================================

/**
 * Handle uncaught exceptions
 * These are errors thrown outside of any try-catch block
 */
process.on('uncaughtException', (error) => {
  socketGatewayLogger.error('UNCAUGHT EXCEPTION', error, {
    type: 'uncaughtException',
    fatal: true,
  });
  
  // Exit process to prevent zombie state
  process.exit(1);
});

/**
 * Handle unhandled promise rejections
 * These are promises rejected without a .catch() handler
 */
process.on('unhandledRejection', (reason, promise) => {
  socketGatewayLogger.error('UNHANDLED PROMISE REJECTION', reason, {
    type: 'unhandledRejection',
    promise: promise.toString(),
    fatal: true,
  });
  
  // Exit process to prevent zombie state
  process.exit(1);
});

export { io };
