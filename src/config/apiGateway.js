/**
 * API Gateway Configuration
 * 
 * This file centralizes all service endpoints to ensure consistent communication
 * between microservices. All services use environment variables for URLs,
 * enabling easy configuration across development, staging, and production environments.
 * 
 * Architecture Decision:
 * - Centralized configuration prevents hardcoded URLs scattered across the codebase
 * - Environment-based URLs allow seamless deployment across different environments
 * - Timeout and retry settings ensure resilient inter-service communication
 */

import axios from 'axios';
import { createLogger } from '../middleware/logger.js';
import { attachServiceAuth } from '../utils/serviceAuth.js';

const logger = createLogger('APIGateway');

// ============================================================================
// Service URLs from Environment Variables
// ============================================================================

export const SERVICES = {
  AUTH: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  CHAT: process.env.CHAT_SERVICE_URL || 'http://localhost:8001',
  SOCKET: process.env.SOCKET_GATEWAY_URL || 'http://localhost:3002',
};

// ============================================================================
// API Gateway Configuration
// ============================================================================

export const API_CONFIG = {
  // Timeout for all HTTP requests (milliseconds)
  timeout: parseInt(process.env.API_TIMEOUT || '10000', 10),
  
  // Maximum number of retry attempts for failed requests
  maxRetries: parseInt(process.env.API_MAX_RETRIES || '3', 10),
  
  // Initial delay between retries (milliseconds)
  retryDelay: parseInt(process.env.API_RETRY_DELAY || '1000', 10),
  
  // Exponential backoff multiplier for retries
  retryBackoffMultiplier: parseFloat(process.env.API_RETRY_BACKOFF || '2'),
  
  // HTTP status codes that should trigger a retry
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
};

// ============================================================================
// Axios Instance Factory
// ============================================================================

/**
 * Create a configured axios instance for inter-service communication
 * 
 * @param {string} baseURL - Base URL for the service
 * @param {object} options - Additional axios configuration
 * @returns {object} Configured axios instance
 */
export const createServiceClient = (baseURL, options = {}) => {
  const client = axios.create({
    baseURL,
    timeout: API_CONFIG.timeout,
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  // Request interceptor for logging
  client.interceptors.request.use(
    (config) => {
      logger.debug(`Sending request`, { method: config.method?.toUpperCase(), url: `${config.baseURL}${config.url}` });
      return config;
    },
    (error) => {
      logger.error('Request preparation error', error);
      return Promise.reject(error);
    }
  );

  // Response interceptor for logging
  client.interceptors.response.use(
    (response) => {
      logger.debug(`Response received`, { method: response.config.method?.toUpperCase(), url: response.config.url, status: response.status });
      return response;
    },
    (error) => {
      const status = error.response?.status || 'N/A';
      logger.error('Response error', error, { method: error.config?.method?.toUpperCase(), url: error.config?.url, status });
      return Promise.reject(error);
    }
  );

  return client;
};

// ============================================================================
// Pre-configured Service Clients
// ============================================================================

export const authServiceClient = attachServiceAuth(createServiceClient(SERVICES.AUTH));
export const chatServiceClient = attachServiceAuth(createServiceClient(SERVICES.CHAT));
export const socketServiceClient = createServiceClient(SERVICES.SOCKET);

// ============================================================================
// Health Check Endpoints
// ============================================================================

export const HEALTH_ENDPOINTS = {
  AUTH: `${SERVICES.AUTH}/health`,
  CHAT: `${SERVICES.CHAT}/health`,
  SOCKET: `${SERVICES.SOCKET}/health`,
};

/**
 * Check health status of all services
 * 
 * @returns {Promise<object>} Health status of all services
 */
export const checkServicesHealth = async () => {
  const results = {};

  for (const [service, endpoint] of Object.entries(HEALTH_ENDPOINTS)) {
    try {
      const response = await axios.get(endpoint, { timeout: 5000 });
      results[service] = {
        status: 'healthy',
        data: response.data,
      };
    } catch (error) {
      results[service] = {
        status: 'unhealthy',
        error: error.message,
      };
    }
  }

  return results;
};

// ============================================================================
// Export Configuration
// ============================================================================

export default {
  SERVICES,
  API_CONFIG,
  createServiceClient,
  authServiceClient,
  chatServiceClient,
  socketServiceClient,
  HEALTH_ENDPOINTS,
  checkServicesHealth,
};
