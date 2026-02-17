/**
 * Timeout Configuration
 * 
 * Centralize all timeout settings to make them configurable via environment variables
 */

export const TIMEOUTS = {
  // Auth service timeout
  AUTH_SERVICE_TIMEOUT: parseInt(process.env.AUTH_SERVICE_TIMEOUT || '3000', 10),
  
  // Chat service timeout
  CHAT_SERVICE_TIMEOUT: parseInt(process.env.CHAT_SERVICE_TIMEOUT || '5000', 10),
  
  // Presence engine timeout
  PRESENCE_ENGINE_TIMEOUT: parseInt(process.env.PRESENCE_ENGINE_TIMEOUT || '3000', 10),
  
  // AI engine timeout
  AI_ENGINE_TIMEOUT: parseInt(process.env.AI_ENGINE_TIMEOUT || '2000', 10),
  
  // Quantum room engine timeout
  QUANTUM_ROOM_TIMEOUT: parseInt(process.env.QUANTUM_ROOM_TIMEOUT || '2000', 10),
  
  // Circuit breaker reset timeout
  CIRCUIT_BREAKER_RESET_TIMEOUT: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT || '30000', 10),
  
  // Circuit breaker monitor interval
  CIRCUIT_BREAKER_MONITOR_INTERVAL: parseInt(process.env.CIRCUIT_BREAKER_MONITOR_INTERVAL || '10000', 10),
  
  // Socket connection timeout
  SOCKET_CONNECTION_TIMEOUT: parseInt(process.env.SOCKET_CONNECTION_TIMEOUT || '10000', 10),
  
  // Auto-stop typing timeout (milliseconds)
  AUTO_STOP_TYPING_TIMEOUT: parseInt(process.env.AUTO_STOP_TYPING_TIMEOUT || '3000', 10),
  
  // Graceful shutdown timeout
  GRACEFUL_SHUTDOWN_TIMEOUT: parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT || '10000', 10),
};
