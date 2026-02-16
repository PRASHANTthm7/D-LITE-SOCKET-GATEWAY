/**
 * Retry Logic Utility
 * 
 * Architecture Decision:
 * - Implements exponential backoff for failed requests to prevent overwhelming downstream services
 * - Configurable retry attempts and delays for different use cases
 * - Includes circuit breaker pattern to fail fast during widespread outages
 * - Logs all retry attempts for monitoring and debugging
 */

import { API_CONFIG } from '../config/apiGateway.js';
import { createLogger } from '../middleware/logger.js';

const logger = createLogger('RetryLogic');

/**
 * Sleep for specified milliseconds
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Check if error is retryable based on status code
 */
const isRetryableError = (error) => {
  if (!error.response) {
    // Network errors (no response) are retryable
    return true;
  }

  const status = error.response.status;
  return API_CONFIG.retryableStatusCodes.includes(status);
};

/**
 * Calculate delay for next retry attempt using exponential backoff
 * 
 * @param {number} attempt - Current attempt number (1-indexed)
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {number} multiplier - Exponential backoff multiplier
 * @returns {number} Delay in milliseconds
 */
const calculateBackoff = (attempt, baseDelay, multiplier) => {
  // Add jitter to prevent thundering herd problem
  const jitter = Math.random() * 0.3 * baseDelay; // 0-30% jitter
  return Math.min(
    baseDelay * Math.pow(multiplier, attempt - 1) + jitter,
    30000 // Maximum 30 seconds
  );
};

/**
 * Retry a function with exponential backoff
 * 
 * @param {Function} fn - Async function to retry
 * @param {object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retry attempts
 * @param {number} options.baseDelay - Initial delay between retries (ms)
 * @param {number} options.multiplier - Exponential backoff multiplier
 * @param {Function} options.onRetry - Callback called before each retry
 * @param {Function} options.shouldRetry - Custom retry condition
 * @returns {Promise} Result of the function
 */
export const retryWithBackoff = async (
  fn,
  {
    maxRetries = API_CONFIG.maxRetries,
    baseDelay = API_CONFIG.retryDelay,
    multiplier = API_CONFIG.retryBackoffMultiplier,
    onRetry = null,
    shouldRetry = isRetryableError,
  } = {}
) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      // Execute the function
      const result = await fn();
      
      // Success - log if it took multiple attempts
      if (attempt > 1) {
        logger.info('Request succeeded after retries', {
          attempt,
          totalAttempts: maxRetries + 1,
        });
      }
      
      return result;
    } catch (error) {
      lastError = error;
      
      // Check if we should retry
      const isLastAttempt = attempt === maxRetries + 1;
      const canRetry = !isLastAttempt && shouldRetry(error);
      
      if (!canRetry) {
        logger.error('Request failed, no more retries', lastError, {
          attempt,
          maxRetries,
          errorType: error.name,
          statusCode: error.response?.status,
        });
        throw lastError;
      }
      
      // Calculate delay for next attempt
      const delay = calculateBackoff(attempt, baseDelay, multiplier);
      
      logger.warn('Request failed, retrying...', {
        attempt,
        maxRetries,
        nextRetryIn: `${delay}ms`,
        errorType: error.name,
        statusCode: error.response?.status,
        errorMessage: error.message,
      });
      
      // Call onRetry callback if provided
      if (onRetry) {
        await onRetry(attempt, delay, error);
      }
      
      // Wait before next attempt
      await sleep(delay);
    }
  }
  
  // This should never be reached, but just in case
  throw lastError;
};

/**
 * Retry an axios request with exponential backoff
 * 
 * @param {Function} axiosRequest - Function that returns an axios promise
 * @param {object} options - Retry options
 * @returns {Promise} Axios response
 */
export const retryAxiosRequest = async (axiosRequest, options = {}) => {
  return retryWithBackoff(
    axiosRequest,
    {
      ...options,
      shouldRetry: (error) => {
        // Don't retry client errors (4xx) except 408, 429
        if (error.response?.status >= 400 && error.response?.status < 500) {
          return [408, 429].includes(error.response.status);
        }
        // Retry all 5xx errors and network errors
        return true;
      },
      onRetry: (attempt, delay, error) => {
        logger.warn('Retrying axios request', {
          attempt,
          delay: `${delay}ms`,
          url: error.config?.url,
          method: error.config?.method?.toUpperCase(),
          statusCode: error.response?.status,
        });
      },
    }
  );
};

/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures by failing fast when a service is down
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5; // Number of failures before opening
    this.resetTimeout = options.resetTimeout || 60000; // Time before trying again (ms)
    this.monitorInterval = options.monitorInterval || 10000; // Time window for counting failures
    
    this.failures = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.nextAttemptTime = null;
    
    this.logger = createLogger('CircuitBreaker');
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute(fn, fallback = null) {
    // Check if circuit is open
    if (this.state === 'OPEN') {
      const now = Date.now();
      
      // Check if it's time to try again
      if (now < this.nextAttemptTime) {
        this.logger.warn('Circuit breaker is OPEN, failing fast', {
          nextAttempt: new Date(this.nextAttemptTime).toISOString(),
        });
        
        if (fallback) {
          return fallback();
        }
        throw new Error('Service unavailable - circuit breaker is OPEN');
      }
      
      // Try to close the circuit (half-open state)
      this.state = 'HALF_OPEN';
      this.logger.info('Circuit breaker entering HALF_OPEN state');
    }

    try {
      const result = await fn();
      
      // Success - reset failure count
      if (this.state === 'HALF_OPEN') {
        this.logger.info('Circuit breaker closing after successful request');
        this.close();
      }
      
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Record a failure and potentially open the circuit
   */
  recordFailure() {
    const now = Date.now();
    
    // Reset counter if monitor interval has passed
    if (this.lastFailureTime && now - this.lastFailureTime > this.monitorInterval) {
      this.failures = 0;
    }
    
    this.failures++;
    this.lastFailureTime = now;
    
    // Open circuit if threshold is reached
    if (this.failures >= this.failureThreshold) {
      this.open();
    }
  }

  /**
   * Open the circuit breaker
   */
  open() {
    this.state = 'OPEN';
    this.nextAttemptTime = Date.now() + this.resetTimeout;
    
    this.logger.error('Circuit breaker OPENED', null, {
      failures: this.failures,
      nextAttempt: new Date(this.nextAttemptTime).toISOString(),
    });
  }

  /**
   * Close the circuit breaker
   */
  close() {
    this.state = 'CLOSED';
    this.failures = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }

  /**
   * Get current circuit breaker status
   */
  getStatus() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }
}

/**
 * Create a circuit breaker instance for a service
 */
export const createCircuitBreaker = (serviceName, options = {}) => {
  const breaker = new CircuitBreaker(options);
  const logger = createLogger(`CircuitBreaker:${serviceName}`);
  
  return {
    execute: (fn, fallback) => breaker.execute(fn, fallback),
    getStatus: () => breaker.getStatus(),
  };
};

export default {
  retryWithBackoff,
  retryAxiosRequest,
  CircuitBreaker,
  createCircuitBreaker,
};
