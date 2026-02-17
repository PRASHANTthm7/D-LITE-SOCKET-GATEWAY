import { onlineUsers } from '../server.js';
import { updateUserStatus } from '../services/userService.js';
import { sendPresenceEvent } from '../services/presenceClient.js';
import { sendQuantumRoomEvent } from '../services/quantumRoomClient.js';
import { createLogger } from '../middleware/logger.js';
import { validateRoomData, validateGroupData, validateTypingData } from '../utils/validation.js';
import { rateLimiters } from '../utils/rateLimiter.js';
import { setTypingTimer, clearTypingTimer, clearUserTypingTimers } from '../utils/typingTimers.js';

const logger = createLogger('Connection');

/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                      Connection Handlers                                 │
 * │                                                                          │
 * │ Manages WebSocket connections, disconnections, and presence tracking.   │
 * │                                                                          │
 * │ Architecture Decisions:                                                 │
 * │ ─────────────────────────                                               │
 * │ • Auto-registration: Users are marked online immediately on connect     │
 * │ • In-memory tracking: onlineUsers Map for fast O(1) lookups            │
 * │ • Room-based routing: Socket.IO rooms for private/group chats          │
 * │ • Broadcast patterns: emit (all), socket.to() (specific), broadcast    │
 * │                                                                          │
 * │ User Journey:                                                           │
 * │ ──────────────                                                          │
 * │ 1. Client connects with JWT → middleware verifies → socket.userId set  │
 * │ 2. onlineUsers.set(userId, socketId) → fast message routing            │
 * │ 3. Emit 'user_connected' → other clients update UI                     │
 * │ 4. Join rooms → enable private/group messaging                          │
 * │ 5. On disconnect → cleanup, emit 'user_disconnected'                   │
 * │                                                                          │
 * │ Scalability Note:                                                       │
 * │ ────────────────────                                                    │
 * │ For horizontal scaling, replace in-memory Map with Redis:              │
 * │   await redis.hset('online_users', userId, socketId)                   │
 * │   const socketId = await redis.hget('online_users', userId)            │
 * │                                                                          │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Helper function to broadcast the current online users list to all connected clients
 */
const broadcastOnlineUsers = (io) => {
  const onlineUsersList = Array.from(onlineUsers.keys());
  io.emit('online_users', onlineUsersList);
  logger.info(`Broadcasting online users`, { count: onlineUsersList.length });
};

export const registerConnectionHandlers = (io, socket) => {
  // ─── Initial connection - automatically register user as online ────────
  const userId = socket.userId;

  // Store user's socket ID in the map
  onlineUsers.set(userId, socket.id);

  // Update user status in database
  updateUserStatus(userId, 'online').catch(err => {
    logger.error('Failed to update user status on connection', err, { userId });
  });

  // Send presence event to presence-engine
  sendPresenceEvent(userId, 'user_connected');

  // Notify the connecting user with their connection info
  socket.emit('connected', {
    socket_id: socket.id,
    user_id: userId
  });

  // Notify all OTHER users that this user came online
  socket.broadcast.emit('user_connected', { user_id: userId });

  // Broadcast updated online users list to ALL clients (including this one)
  broadcastOnlineUsers(io);

  logger.info(`User connected`, { userId, socketId: socket.id, totalOnline: onlineUsers.size });

  // ─── Manual user_connected event (legacy support) ──────────────────────
  socket.on('user_connected', async (data) => {
    try {
      // Already handled in auto-registration above, but keep for compatibility
      logger.debug(`Manual user_connected event from ${userId}`);
    } catch (error) {
      logger.error('Error handling user_connected', error);
    }
  });

  // ─── Join a room (for private conversations or groups) ────────────────
  socket.on('join_room', (data) => {
    // Check rate limit
    if (!rateLimiters.join_room(socket)) return;

    try {
      const { room_id } = data;

      // Validate room data
      try {
        validateRoomData({ room_id });
      } catch (validationError) {
        socket.emit('error', { message: validationError.message });
        return;
      }

      socket.join(room_id);
      logger.info(`Socket joined room`, { socketId: socket.id, userId: socket.userId, room_id });

      // Send quantum room event for group rooms
      if (room_id.startsWith('group_')) {
        const groupId = room_id.replace('group_', '');
        sendQuantumRoomEvent(groupId, userId, 'user_join');
      }

      // Acknowledge join
      socket.emit('room_joined', { room_id, success: true });
    } catch (error) {
      logger.error('Error joining room', error, { room_id });
      socket.emit('error', { message: 'Failed to join room', error: error.message });
    }
  });

  // ─── Leave a room ──────────────────────────────────────────────────────
  socket.on('leave_room', (data) => {
    // Check rate limit
    if (!rateLimiters.leave_room(socket)) return;

    try {
      const { room_id } = data;

      // Validate room data
      try {
        validateRoomData({ room_id });
      } catch (validationError) {
        socket.emit('error', { message: validationError.message });
        return;
      }

      socket.leave(room_id);
      logger.info(`Socket left room`, { socketId: socket.id, userId: socket.userId, room_id });

      // Send quantum room event for group rooms
      if (room_id.startsWith('group_')) {
        const groupId = room_id.replace('group_', '');
        sendQuantumRoomEvent(groupId, userId, 'user_leave');
      }

      // Acknowledge leave
      socket.emit('room_left', { room_id, success: true });
    } catch (error) {
      logger.error('Error leaving room', error, { room_id });
    }
  });

  // ─── Join a group (convenience method) ────────────────────────────────
  socket.on('join_group', (data) => {    // Check rate limit
    if (!rateLimiters.join_group(socket)) return;
    try {
      const { group_id } = data;

      // Validate group data
      try {
        validateGroupData({ group_id });
      } catch (validationError) {
        socket.emit('error', { message: validationError.message });
        return;
      }

      const roomId = `group_${group_id}`;
      socket.join(roomId);
      logger.info(`User joined group`, { userId: socket.userId, group_id, roomId });

      // Send quantum room event
      sendQuantumRoomEvent(group_id, userId, 'user_join');

      // Notify other members in the group
      socket.to(roomId).emit('user_joined_group', {
        group_id,
        user_id: socket.userId
      });

      socket.emit('group_joined', { group_id, success: true });
    } catch (error) {
      logger.error('Error joining group', error, { group_id });
      socket.emit('error', { message: 'Failed to join group', error: error.message });
    }
  });

  // ─── Leave a group (convenience method) ───────────────────────────────
  socket.on('leave_group', (data) => {    // Check rate limit
    if (!rateLimiters.leave_group(socket)) return;
    try {
      const { group_id } = data;

      // Validate group data
      try {
        validateGroupData({ group_id });
      } catch (validationError) {
        socket.emit('error', { message: validationError.message });
        return;
      }

      const roomId = `group_${group_id}`;
      socket.leave(roomId);
      logger.info(`User left group`, { userId: socket.userId, group_id, roomId });

      // Send quantum room event
      sendQuantumRoomEvent(group_id, userId, 'user_leave');

      // Notify other members in the group
      socket.to(roomId).emit('user_left_group', {
        group_id,
        user_id: socket.userId
      });

      socket.emit('group_left', { group_id, success: true });
    } catch (error) {
      logger.error('Error leaving group', error, { group_id });
    }
  });

  // ─── Typing indicator (with debouncing on server side) ──────────────────
  socket.on('typing', (data) => {
    try {
      if (!rateLimiters.typing(socket)) return;

      const { receiver_id, group_id } = data;
      validateTypingData({ receiver_id, group_id });

      // Send presence event (debounced - only if not sent recently)
      sendPresenceEvent(socket.userId, 'typing_start', { receiver_id, group_id });

      if (group_id) {
        // Group typing indicator
        const roomId = `group_${group_id}`;
        socket.to(roomId).emit('user_typing', {
          user_id: socket.userId,
          group_id,
          timestamp: new Date().toISOString(),
        });

        // Set timer with group context
        setTypingTimer(
          socket.id,
          socket.userId,
          () => socket.emit('stop_typing', data),
          `group:${group_id}`
        );
      } else if (receiver_id) {
        // Private typing indicator
        const receiverSocketId = onlineUsers.get(receiver_id);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('user_typing', {
            user_id: socket.userId,
            timestamp: new Date().toISOString(),
          });
        }

        // Set timer with receiver context
        setTypingTimer(
          socket.id,
          socket.userId,
          () => socket.emit('stop_typing', data),
          `user:${receiver_id}`
        );
      }
    } catch (error) {
      logger.error('Error handling typing event', error, { user_id: socket.userId });
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('stop_typing', (data) => {
    try {
      if (!rateLimiters.stop_typing(socket)) return;

      const { receiver_id, group_id } = data;
      
      // Clear timers for this user
      if (group_id) {
        clearTypingTimer(socket.userId, `group:${group_id}`);
      } else if (receiver_id) {
        clearTypingTimer(socket.userId, `user:${receiver_id}`);
      }

      // Send presence event
      sendPresenceEvent(socket.userId, 'typing_stop', { receiver_id, group_id });

      if (group_id) {
        // Group stop typing
        const roomId = `group_${group_id}`;
        socket.to(roomId).emit('user_stopped_typing', {
          user_id: socket.userId,
          group_id,
        });
      } else if (receiver_id) {
        // Private stop typing
        const receiverSocketId = onlineUsers.get(receiver_id);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('user_stopped_typing', {
            user_id: socket.userId,
          });
        }
      }
    } catch (error) {
      logger.error('Error handling stop typing event', error, { user_id: socket.userId });
      socket.emit('error', { message: error.message });
    }
  });

  // Cleanup typing timers on disconnect
  socket.on('disconnect', () => {
    // Clear all typing timers for this user
    clearUserTypingTimers(socket.userId);
  });

  // ─── Request online users list ─────────────────────────────────────────
  socket.on('get_online_users', () => {
    const onlineUsersList = Array.from(onlineUsers.keys());
    socket.emit('online_users', onlineUsersList);
  });
};
