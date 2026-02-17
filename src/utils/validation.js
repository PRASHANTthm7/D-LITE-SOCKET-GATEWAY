/**
 * Input Validation Utilities
 * 
 * Provides validation functions for socket event data to prevent
 * malformed requests, injection attacks, and data corruption
 * All validation limits are configurable via environment variables
 */

import { createLogger } from '../middleware/logger.js';

const logger = createLogger('Validation');

// Validation limits from environment variables
const MAX_MESSAGE_LENGTH = parseInt(process.env.MAX_MESSAGE_LENGTH || '10000', 10);
const MAX_USER_ID_LENGTH = parseInt(process.env.MAX_USER_ID_LENGTH || '256', 10);
const MAX_RECEIVER_ID_LENGTH = parseInt(process.env.MAX_RECEIVER_ID_LENGTH || '256', 10);
const MAX_GROUP_ID_LENGTH = parseInt(process.env.MAX_GROUP_ID_LENGTH || '256', 10);
const MAX_ROOM_ID_LENGTH = parseInt(process.env.MAX_ROOM_ID_LENGTH || '256', 10);
const MAX_MESSAGE_EXPIRY_HOURS = parseInt(process.env.MAX_MESSAGE_EXPIRY_HOURS || '24', 10);
const MAX_MESSAGE_EXPIRY_MS = MAX_MESSAGE_EXPIRY_HOURS * 60 * 60 * 1000;

/**
 * Validate message data
 * @param {object} message - Message object to validate
 * @throws {Error} If validation fails
 */
export const validateMessage = (message) => {
  const errors = [];

  // Validate sender_id
  if (!message.sender_id) {
    errors.push('sender_id is required');
  } else if (typeof message.sender_id !== 'string' || message.sender_id.trim().length === 0) {
    errors.push('sender_id must be a non-empty string');
  } else if (message.sender_id.length > MAX_USER_ID_LENGTH) {
    errors.push(`sender_id must be less than ${MAX_USER_ID_LENGTH} characters`);
  }

  // Validate receiver OR group context
  if (!message.receiver_id && !message.group_id) {
    errors.push('Either receiver_id or group_id is required');
  }

  if (message.receiver_id && (typeof message.receiver_id !== 'string' || message.receiver_id.length > MAX_RECEIVER_ID_LENGTH)) {
    errors.push(`receiver_id must be a string less than ${MAX_RECEIVER_ID_LENGTH} characters`);
  }

  if (message.group_id && (typeof message.group_id !== 'string' || message.group_id.length > MAX_GROUP_ID_LENGTH)) {
    errors.push(`group_id must be a string less than ${MAX_GROUP_ID_LENGTH} characters`);
  }

  // Validate content
  if (!message.content) {
    errors.push('content is required');
  } else if (typeof message.content !== 'string') {
    errors.push('content must be a string');
  } else if (message.content.trim().length === 0) {
    errors.push('content cannot be empty');
  } else if (message.content.length > MAX_MESSAGE_LENGTH) {
    errors.push(`content must be less than ${MAX_MESSAGE_LENGTH} characters`);
  }

  // Validate message_type if provided
  if (message.message_type && !['text', 'image', 'file', 'video'].includes(message.message_type)) {
    errors.push('message_type must be one of: text, image, file, video');
  }

  // Validate expires_at if provided
  if (message.expires_at) {
    const expiryTime = new Date(message.expires_at).getTime();
    const now = Date.now();
    
    if (isNaN(expiryTime)) {
      errors.push('expires_at must be a valid ISO timestamp');
    } else if (expiryTime <= now) {
      errors.push('expires_at must be in the future');
    } else if (expiryTime - now > MAX_MESSAGE_EXPIRY_MS) {
      errors.push(`expires_at cannot be more than ${MAX_MESSAGE_EXPIRY_HOURS} hours in the future`);
    }
  }

  if (errors.length > 0) {
    logger.warn('Message validation failed', { errors, sender_id: message.sender_id });
    throw new Error(`Validation error: ${errors.join(', ')}`);
  }
};

/**
 * Validate typing indicator data
 * @param {object} data - Typing data to validate
 * @throws {Error} If validation fails
 */
export const validateTypingData = (data) => {
  const errors = [];

  if (!data.receiver_id && !data.group_id) {
    errors.push('Either receiver_id or group_id is required');
  }

  if (data.receiver_id && (typeof data.receiver_id !== 'string' || data.receiver_id.length > MAX_RECEIVER_ID_LENGTH)) {
    errors.push(`receiver_id must be a string less than ${MAX_RECEIVER_ID_LENGTH} characters`);
  }

  if (data.group_id && (typeof data.group_id !== 'string' || data.group_id.length > MAX_GROUP_ID_LENGTH)) {
    errors.push(`group_id must be a string less than ${MAX_GROUP_ID_LENGTH} characters`);
  }

  if (errors.length > 0) {
    throw new Error(`Validation error: ${errors.join(', ')}`);
  }
};

/**
 * Validate room data
 * @param {object} data - Room data to validate
 * @throws {Error} If validation fails
 */
export const validateRoomData = (data) => {
  const errors = [];

  if (!data.room_id) {
    errors.push('room_id is required');
  } else if (typeof data.room_id !== 'string' || data.room_id.length === 0) {
    errors.push('room_id must be a non-empty string');
  } else if (data.room_id.length > MAX_ROOM_ID_LENGTH) {
    errors.push(`room_id must be less than ${MAX_ROOM_ID_LENGTH} characters`);
  }

  if (errors.length > 0) {
    throw new Error(`Validation error: ${errors.join(', ')}`);
  }
};

/**
 * Validate group data
 * @param {object} data - Group data to validate
 * @throws {Error} If validation fails
 */
export const validateGroupData = (data) => {
  const errors = [];

  if (!data.group_id) {
    errors.push('group_id is required');
  } else if (typeof data.group_id !== 'string' || data.group_id.length === 0) {
    errors.push('group_id must be a non-empty string');
  } else if (data.group_id.length > MAX_GROUP_ID_LENGTH) {
    errors.push(`group_id must be less than ${MAX_GROUP_ID_LENGTH} characters`);
  }

  if (errors.length > 0) {
    throw new Error(`Validation error: ${errors.join(', ')}`);
  }
};

/**
 * Validate message status data
 * @param {object} data - Message status data to validate
 * @throws {Error} If validation fails
 */
export const validateMessageStatusData = (data) => {
  const errors = [];

  if (!data.message_id) {
    errors.push('message_id is required');
  } else if (typeof data.message_id !== 'string' || data.message_id.length === 0) {
    errors.push('message_id must be a non-empty string');
  }

  if (data.sender_id && (typeof data.sender_id !== 'string' || data.sender_id.length > MAX_USER_ID_LENGTH)) {
    errors.push(`sender_id must be a string less than ${MAX_USER_ID_LENGTH} characters`);
  }

  if (errors.length > 0) {
    throw new Error(`Validation error: ${errors.join(', ')}`);
  }
};
