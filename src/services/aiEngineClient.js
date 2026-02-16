import axios from 'axios';

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8002';

/**
 * Send message analysis event to AI Engine
 */
export const analyzeMessage = async (userId, text) => {
  try {
    const response = await axios.post(
      `${AI_ENGINE_URL}/ai/analyze-message`,
      {
        userId,
        text,
        timestamp: new Date().toISOString()
      },
      { timeout: 2000 }
    );
    
    if (response.data) {
      return response.data;
    }
  } catch (error) {
    console.error(`[AI Engine] Failed to analyze message: ${error.message}`);
    return null;
  }
};

/**
 * Request presence prediction from AI Engine
 */
export const predictPresence = async (userId, activityData) => {
  try {
    const response = await axios.post(
      `${AI_ENGINE_URL}/ai/predict-presence`,
      {
        userId,
        activityHistory: activityData
      },
      { timeout: 2000 }
    );
    
    if (response.data) {
      return response.data;
    }
  } catch (error) {
    console.error(`[AI Engine] Failed to predict presence: ${error.message}`);
    return null;
  }
};
