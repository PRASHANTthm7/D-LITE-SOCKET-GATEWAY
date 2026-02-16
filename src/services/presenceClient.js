import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const PRESENCE_ENGINE_URL = process.env.PRESENCE_ENGINE_URL || 'http://localhost:8003';

const presenceClient = axios.create({
  baseURL: `${PRESENCE_ENGINE_URL}/api`,
  timeout: 3000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Send presence event to presence-engine
 * Non-blocking - failures are logged but don't affect socket operations
 */
export const sendPresenceEvent = async (userId, eventType, metadata = null) => {
  try {
    await presenceClient.post('/presence/event', {
      userId,
      eventType,
      metadata
    });
    console.log(`[Presence] ✓ Event sent: ${eventType} for user ${userId}`);
  } catch (error) {
    // Non-critical: Socket operations continue even if presence engine is down
    if (error.code === 'ECONNREFUSED') {
      console.warn(`[Presence] ⚠ Presence engine unavailable (${eventType} for ${userId})`);
    } else {
      console.error(`[Presence] ✗ Failed to send event ${eventType}:`, error.message);
    }
  }
};

export default presenceClient;
