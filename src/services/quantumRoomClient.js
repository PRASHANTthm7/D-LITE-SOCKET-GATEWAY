import axios from 'axios';

const QUANTUM_ROOM_ENGINE_URL = process.env.QUANTUM_ROOM_ENGINE_URL || 'http://localhost:3004';

/**
 * Send event to Quantum Room Engine
 * @param {string} roomId - Room/group ID
 * @param {string} userId - User ID
 * @param {string} eventType - Event type (message_sent, user_join, user_leave, typing_start)
 * @param {object} metadata - Additional event metadata
 */
export const sendQuantumRoomEvent = async (roomId, userId, eventType, metadata = {}) => {
  try {
    const response = await axios.post(
      `${QUANTUM_ROOM_ENGINE_URL}/quantum-room/event`,
      {
        roomId,
        userId,
        eventType,
        metadata,
        timestamp: new Date().toISOString()
      },
      {
        timeout: 2000 // 2 second timeout
      }
    );
    
    if (response.data?.success) {
      console.log(`[QuantumRoom] Event sent: ${eventType} for room ${roomId} by user ${userId}`);
      return response.data.data;
    }
  } catch (error) {
    // Don't fail the main operation if quantum room engine is down
    console.error(`[QuantumRoom] Failed to send event: ${error.message}`);
    return null;
  }
};

/**
 * Get room aura information
 * @param {string} roomId - Room/group ID
 */
export const getRoomAura = async (roomId) => {
  try {
    const response = await axios.get(
      `${QUANTUM_ROOM_ENGINE_URL}/quantum-room/aura/${roomId}`,
      { timeout: 2000 }
    );
    
    if (response.data?.success) {
      return response.data.data;
    }
  } catch (error) {
    console.error(`[QuantumRoom] Failed to get aura: ${error.message}`);
    return null;
  }
};

/**
 * Get room insights
 * @param {string} roomId - Room/group ID
 */
export const getRoomInsight = async (roomId) => {
  try {
    const response = await axios.get(
      `${QUANTUM_ROOM_ENGINE_URL}/quantum-room/insight/${roomId}`,
      { timeout: 2000 }
    );
    
    if (response.data?.success) {
      return response.data.data;
    }
  } catch (error) {
    console.error(`[QuantumRoom] Failed to get insight: ${error.message}`);
    return null;
  }
};
