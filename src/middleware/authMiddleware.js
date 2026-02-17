import axios from 'axios';
import { createLogger } from './logger.js';
import { TIMEOUTS } from '../config/timeouts.js';

const logger = createLogger('Auth');
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001/api';

async function verifyTokenWithAuthService(token) {
  try {
    const response = await axios.post(
      `${AUTH_SERVICE_URL}/auth/verify-token`,
      { token },
      { timeout: TIMEOUTS.AUTH_SERVICE_TIMEOUT }
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    
    throw new Error('Invalid token response from Auth Service');
  } catch (error) {
    logger.error('Token verification failed', error, { token: token?.substring(0, 20) });
    throw new Error('Token verification failed');
  }
}

export const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    // Verify token with centralized Auth Service
    const user = await verifyTokenWithAuthService(token);
    
    // Attach user info to socket
    socket.userId = user.userId;
    socket.user = user;
    
    logger.info(`User authenticated`, { username: user.username, userId: user.userId });
    next();
  } catch (error) {
    logger.error('Authentication failed', error);
    next(new Error('Authentication error: ' + error.message));
  }
};
