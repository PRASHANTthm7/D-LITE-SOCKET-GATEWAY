import axios from 'axios';

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001/api';

/**
 * Verify token with Auth Service
 * Delegates JWT verification to centralized Auth Service
 */
async function verifyTokenWithAuthService(token) {
  try {
    const response = await axios.post(
      `${AUTH_SERVICE_URL}/auth/verify-token`,
      { token },
      { timeout: 3000 }
    );

    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    
    throw new Error('Invalid token response from Auth Service');
  } catch (error) {
    console.error('[Auth Service] Token verification failed:', error.message);
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
    
    console.log(`[Socket Auth] User authenticated: ${user.username} (${user.userId})`);
    next();
  } catch (error) {
    console.error('[Socket Auth] Authentication failed:', error.message);
    next(new Error('Authentication error: ' + error.message));
  }
};
