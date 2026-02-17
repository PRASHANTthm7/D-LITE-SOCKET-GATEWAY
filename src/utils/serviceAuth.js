/**
 * Service-to-Service Authentication Utility
 * 
 * Provides JWT token generation for authenticated communication between microservices.
 * Each service request includes a Bearer token to verify the request originates from
 * the socket-gateway and not from an external source.
 */

import jwt from 'jsonwebtoken';
import { createLogger } from '../middleware/logger.js';

const logger = createLogger('ServiceAuth');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  logger.error('JWT_SECRET environment variable is not set');
}

/**
 * Service token cache
 * Stores generated tokens to avoid re-generating on every request
 * Tokens are cached for 1 hour (3600 seconds) before regeneration
 */
let cachedServiceToken = null;
let tokenExpiryTime = null;

/**
 * Generate a JWT token for inter-service communication
 * Tokens include service identification and expiration
 * 
 * @returns {string} Signed JWT token
 */
const generateServiceToken = () => {
  try {
    const payload = {
      iss: 'socket-gateway', // Issuer
      service: 'socket-gateway',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour expiration
    };

    const token = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
    logger.debug('Generated new service token', { exp: new Date(payload.exp * 1000) });
    return token;
  } catch (error) {
    logger.error('Failed to generate service token', error);
    throw error;
  }
};

/**
 * Get a valid service token, using cache if available
 * Automatically regenerates token if expired
 * 
 * @returns {string} Valid JWT token for inter-service communication
 */
export const getServiceToken = () => {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid (with 5-minute buffer)
  if (cachedServiceToken && tokenExpiryTime && tokenExpiryTime > now + 300) {
    return cachedServiceToken;
  }

  // Generate new token if cache is expired or not set
  cachedServiceToken = generateServiceToken();
  
  // Extract expiration from token payload
  const decoded = jwt.decode(cachedServiceToken);
  tokenExpiryTime = decoded.exp;

  return cachedServiceToken;
};

/**
 * Configure axios instance with inter-service authentication headers
 * Adds a request interceptor that includes the Authorization header
 * 
 * @param {object} axiosInstance - Axios instance to configure
 * @returns {object} The configured axios instance
 */
export const attachServiceAuth = (axiosInstance) => {
  axiosInstance.interceptors.request.use(
    (config) => {
      try {
        const token = getServiceToken();
        config.headers.Authorization = `Bearer ${token}`;
        logger.debug('Added service auth header', { url: config.url });
      } catch (error) {
        logger.error('Failed to attach service auth', error);
        // Continue without auth header if token generation fails
      }
      return config;
    },
    (error) => {
      logger.error('Request interceptor error', error);
      return Promise.reject(error);
    }
  );

  return axiosInstance;
};

/**
 * Get Authorization header value for inline requests
 * Useful when not using an axios instance with interceptors
 * 
 * @returns {object} Object with Authorization header for axios config
 */
export const getServiceAuthHeader = () => {
  try {
    const token = getServiceToken();
    return { Authorization: `Bearer ${token}` };
  } catch (error) {
    logger.error('Failed to get service auth header', error);
    return {};
  }
};

/**
 * Force token refresh (useful for testing or emergency token rotation)
 */
export const refreshServiceToken = () => {
  cachedServiceToken = null;
  tokenExpiryTime = null;
  logger.info('Service token cache cleared, will regenerate on next request');
};

export default {
  getServiceToken,
  attachServiceAuth,
  getServiceAuthHeader,
  refreshServiceToken,
};
