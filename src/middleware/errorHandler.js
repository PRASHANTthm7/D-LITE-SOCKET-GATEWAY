/**
 * Centralized Error Handler
 * 
 * Architecture Decision:
 * - Provides consistent error handling across all services
 * - Standardizes error response format for easier client-side handling
 * - Includes proper logging for debugging and monitoring
 * - Handles both operational and programming errors appropriately
 */

/**
 * Custom Application Error class
 * Extends native Error to include HTTP status codes and additional context
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true, data = null) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.data = data;
    this.timestamp = new Date().toISOString();
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Predefined error types for common scenarios
 */
export const ErrorTypes = {
  VALIDATION_ERROR: (message, data) => new AppError(message, 400, true, data),
  AUTHENTICATION_ERROR: (message) => new AppError(message, 401, true),
  AUTHORIZATION_ERROR: (message) => new AppError(message, 403, true),
  NOT_FOUND_ERROR: (message) => new AppError(message, 404, true),
  CONFLICT_ERROR: (message) => new AppError(message, 409, true),
  RATE_LIMIT_ERROR: (message) => new AppError(message, 429, true),
  INTERNAL_ERROR: (message) => new AppError(message, 500, false),
  SERVICE_UNAVAILABLE: (message) => new AppError(message, 503, true),
  GATEWAY_TIMEOUT: (message) => new AppError(message, 504, true),
};

/**
 * Express error handler middleware
 * Should be the last middleware in the chain
 * 
 * @param {Error} err - Error object
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
export const errorHandler = (err, req, res, next) => {
  // Log error for debugging
  console.error('[Error Handler]', {
    message: err.message,
    statusCode: err.statusCode || 500,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  // Handle Mongoose validation errors
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors,
      timestamp: new Date().toISOString(),
    });
  }

  // Handle Mongoose duplicate key errors
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(409).json({
      success: false,
      message: `${field} already exists`,
      timestamp: new Date().toISOString(),
    });
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token',
      timestamp: new Date().toISOString(),
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired',
      timestamp: new Date().toISOString(),
    });
  }

  // Handle custom AppError
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      data: err.data,
      timestamp: err.timestamp,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  }

  // Handle Axios errors (from service-to-service calls)
  if (err.isAxiosError) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.message || 'Service communication error';
    
    return res.status(status).json({
      success: false,
      message,
      service: err.config?.baseURL || 'unknown',
      timestamp: new Date().toISOString(),
    });
  }

  // Default error response for unhandled errors
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    message,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

/**
 * Async error wrapper
 * Wraps async route handlers to catch errors and pass them to error handler
 * 
 * Usage:
 * router.get('/route', asyncHandler(async (req, res) => {
 *   // Your async code here
 * }));
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Not Found handler
 * Handles 404 errors for undefined routes
 */
export const notFoundHandler = (req, res, next) => {
  const error = new AppError(
    `Route not found: ${req.method} ${req.path}`,
    404,
    true
  );
  next(error);
};

/**
 * Socket error handler
 * Handles errors in socket event handlers
 * 
 * @param {object} socket - Socket.io socket instance
 * @param {Error} error - Error object
 */
export const handleSocketError = (socket, error) => {
  console.error('[Socket Error]', {
    socketId: socket.id,
    userId: socket.userId,
    message: error.message,
    timestamp: new Date().toISOString(),
  });

  socket.emit('error', {
    message: error.message || 'An error occurred',
    timestamp: new Date().toISOString(),
  });
};

/**
 * Wrap socket event handlers with error catching
 * 
 * Usage:
 * socket.on('event', socketAsyncHandler(socket, async (data) => {
 *   // Your async code here
 * }));
 */
export const socketAsyncHandler = (socket, fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (error) {
    handleSocketError(socket, error);
  }
};

export default {
  AppError,
  ErrorTypes,
  errorHandler,
  asyncHandler,
  notFoundHandler,
  handleSocketError,
  socketAsyncHandler,
};
