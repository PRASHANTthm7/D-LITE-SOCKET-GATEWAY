/**
 * Logger Middleware
 * 
 * Architecture Decision:
 * - Provides consistent logging format across all services
 * - Includes request tracking with unique IDs for debugging
 * - Supports different log levels (info, warn, error)
 * - Integrates with persistent file-based logging for production audit trails
 * - Can be easily extended to integrate with external logging services (e.g., Winston, Datadog)
 */

import { v4 as uuidv4 } from 'uuid';
import { createPersistentLogger } from '../utils/persistentLogger.js';

/**
 * Log levels
 */
export const LogLevel = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
};

/**
 * Logger class for structured logging
 */
class Logger {
  constructor(context = 'App') {
    this.context = context;
    // Create persistent logger for this context
    this.persistentLogger = createPersistentLogger(context);
  }

  /**
   * Format log message with timestamp and context
   */
  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      context: this.context,
      message,
      ...(data && { data }),
    };

    return logEntry;
  }

  /**
   * Log info message
   */
  info(message, data = null) {
    const logEntry = this.formatMessage(LogLevel.INFO, message, data);
    console.log(`[${logEntry.level}] [${logEntry.context}]`, message, data || '');
    // Also write to persistent storage
    this.persistentLogger.info(message, data);
  }

  /**
   * Log warning message
   */
  warn(message, data = null) {
    const logEntry = this.formatMessage(LogLevel.WARN, message, data);
    console.warn(`[${logEntry.level}] [${logEntry.context}]`, message, data || '');
    // Also write to persistent storage
    this.persistentLogger.warn(message, data);
  }

  /**
   * Log error message
   */
  error(message, error = null, data = null) {
    const logEntry = this.formatMessage(LogLevel.ERROR, message, {
      error: error?.message,
      stack: error?.stack,
      ...data,
    });
    console.error(`[${logEntry.level}] [${logEntry.context}]`, message, {
      error: error?.message,
      ...data,
    });
    // Also write to persistent storage
    this.persistentLogger.error(message, error, data);
  }

  /**
   * Log debug message (only in development)
   */
  debug(message, data = null) {
    if (process.env.NODE_ENV === 'development') {
      const logEntry = this.formatMessage(LogLevel.DEBUG, message, data);
      console.debug(`[${logEntry.level}] [${logEntry.context}]`, message, data || '');
      // Also write to persistent storage
      this.persistentLogger.debug(message, data);
    }
  }
}

/**
 * Request logging middleware
 * Logs all incoming HTTP requests with unique request ID
 * 
 * Architecture Decision:
 * - Request IDs enable request tracing across microservices
 * - Response time tracking helps identify performance bottlenecks
 * - User and IP tracking assists with debugging and security
 */
export const requestLogger = (req, res, next) => {
  // Generate unique request ID
  const requestId = uuidv4();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  // Log request
  const startTime = Date.now();
  const logger = new Logger('HTTP');

  logger.info('Incoming request', {
    requestId,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent'),
    userId: req.user?.id,
  });

  // Log response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.id,
    };

    if (res.statusCode >= 500) {
      logger.error('Request failed', null, logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Request error', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });

  next();
};

/**
 * Socket connection logger
 * Logs socket connections, disconnections, and events
 */
export const socketLogger = (socket, eventName = null) => {
  const logger = new Logger('Socket');
  
  return {
    info: (message, data = null) => {
      logger.info(message, {
        socketId: socket.id,
        userId: socket.userId,
        event: eventName,
        ...data,
      });
    },
    warn: (message, data = null) => {
      logger.warn(message, {
        socketId: socket.id,
        userId: socket.userId,
        event: eventName,
        ...data,
      });
    },
    error: (message, error = null, data = null) => {
      logger.error(message, error, {
        socketId: socket.id,
        userId: socket.userId,
        event: eventName,
        ...data,
      });
    },
  };
};

/**
 * Service communication logger
 * Logs inter-service API calls
 */
export const serviceLogger = (serviceName) => {
  return new Logger(`Service:${serviceName}`);
};

/**
 * Create a logger instance for a specific context
 */
export const createLogger = (context) => {
  return new Logger(context);
};

/**
 * Export logger instances for different contexts
 */
export const authLogger = new Logger('Auth');
export const chatLogger = new Logger('Chat');
export const socketGatewayLogger = new Logger('SocketGateway');
export const dbLogger = new Logger('Database');
export const messagingLogger = new Logger('Messaging');

export default {
  Logger,
  LogLevel,
  requestLogger,
  socketLogger,
  serviceLogger,
  createLogger,
  authLogger,
  chatLogger,
  socketGatewayLogger,
  dbLogger,
  messagingLogger,
};
