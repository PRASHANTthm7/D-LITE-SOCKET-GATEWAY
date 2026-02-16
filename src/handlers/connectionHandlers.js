import { onlineUsers } from '../server.js';
import { updateUserStatus } from '../services/userService.js';
import { sendPresenceEvent } from '../services/presenceClient.js';
import { sendQuantumRoomEvent } from '../services/quantumRoomClient.js';

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
  console.log(`[Presence] Broadcasting online users: ${onlineUsersList.length} users online`);
};

export const registerConnectionHandlers = (io, socket) => {
  // ─── Initial connection - automatically register user as online ────────
  const userId = socket.userId;

  // Store user's socket ID in the map
  onlineUsers.set(userId, socket.id);

  // Update user status in database
  updateUserStatus(userId, 'online').catch(console.error);

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

  console.log(`[Connection] ✓ User ${userId} connected (socket: ${socket.id}), total online: ${onlineUsers.size}`);

  // ─── Manual user_connected event (legacy support) ──────────────────────
  socket.on('user_connected', async (data) => {
    try {
      // Already handled in auto-registration above, but keep for compatibility
      console.log(`[Connection] Manual user_connected event from ${userId}`);
    } catch (error) {
      console.error('[Connection] Error handling user_connected:', error);
    }
  });

  // ─── Join a room (for private conversations or groups) ────────────────
  socket.on('join_room', (data) => {
    try {
      const { room_id } = data;
      socket.join(room_id);
      console.log(`[Room] Socket ${socket.id} (user ${socket.userId}) joined room: ${room_id}`);

      // Send quantum room event for group rooms
      if (room_id.startsWith('group_')) {
        const groupId = room_id.replace('group_', '');
        sendQuantumRoomEvent(groupId, userId, 'user_join');
      }

      // Acknowledge join
      socket.emit('room_joined', { room_id, success: true });
    } catch (error) {
      console.error('[Room] Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room', error: error.message });
    }
  });

  // ─── Leave a room ──────────────────────────────────────────────────────
  socket.on('leave_room', (data) => {
    try {
      const { room_id } = data;
      socket.leave(room_id);
      console.log(`[Room] Socket ${socket.id} (user ${socket.userId}) left room: ${room_id}`);

      // Send quantum room event for group rooms
      if (room_id.startsWith('group_')) {
        const groupId = room_id.replace('group_', '');
        sendQuantumRoomEvent(groupId, userId, 'user_leave');
      }

      // Acknowledge leave
      socket.emit('room_left', { room_id, success: true });
    } catch (error) {
      console.error('[Room] Error leaving room:', error);
    }
  });

  // ─── Join a group (convenience method) ────────────────────────────────
  socket.on('join_group', (data) => {
    try {
      const { group_id } = data;
      const roomId = `group_${group_id}`;
      socket.join(roomId);
      console.log(`[Group] User ${socket.userId} joined group ${group_id} (room: ${roomId})`);

      // Send quantum room event
      sendQuantumRoomEvent(group_id, userId, 'user_join');

      // Notify other members in the group
      socket.to(roomId).emit('user_joined_group', {
        group_id,
        user_id: socket.userId
      });

      socket.emit('group_joined', { group_id, success: true });
    } catch (error) {
      console.error('[Group] Error joining group:', error);
      socket.emit('error', { message: 'Failed to join group', error: error.message });
    }
  });

  // ─── Leave a group (convenience method) ───────────────────────────────
  socket.on('leave_group', (data) => {
    try {
      const { group_id } = data;
      const roomId = `group_${group_id}`;
      socket.leave(roomId);
      console.log(`[Group] User ${socket.userId} left group ${group_id} (room: ${roomId})`);

      // Send quantum room event
      sendQuantumRoomEvent(group_id, userId, 'user_leave');

      // Notify other members in the group
      socket.to(roomId).emit('user_left_group', {
        group_id,
        user_id: socket.userId
      });

      socket.emit('group_left', { group_id, success: true });
    } catch (error) {
      console.error('[Group] Error leaving group:', error);
    }
  });

  // ─── Typing indicator (with debouncing on server side) ──────────────────
  const typingTimers = new Map(); // userId -> timer
  
  socket.on('typing', (data) => {
    try {
      const { receiver_id, group_id } = data;
      
      // Clear existing timer for this user
      const timerKey = socket.userId;
      if (typingTimers.has(timerKey)) {
        clearTimeout(typingTimers.get(timerKey));
      }

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
      } else if (receiver_id) {
        // Private typing indicator
        const receiverSocketId = onlineUsers.get(receiver_id);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('user_typing', {
            user_id: socket.userId,
            timestamp: new Date().toISOString(),
          });
        }
      }

      // Auto-stop typing after 3 seconds
      typingTimers.set(timerKey, setTimeout(() => {
        socket.emit('stop_typing', data);
      }, 3000));
    } catch (error) {
      console.error('[Typing] Error handling typing event:', error);
    }
  });

  socket.on('stop_typing', (data) => {
    try {
      const { receiver_id, group_id } = data;
      
      // Clear timer
      const timerKey = socket.userId;
      if (typingTimers.has(timerKey)) {
        clearTimeout(typingTimers.get(timerKey));
        typingTimers.delete(timerKey);
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
      console.error('[Typing] Error handling stop typing event:', error);
    }
  });

  // Cleanup typing timers on disconnect
  socket.on('disconnect', () => {
    const timerKey = socket.userId;
    if (typingTimers.has(timerKey)) {
      clearTimeout(typingTimers.get(timerKey));
      typingTimers.delete(timerKey);
    }
  });

  // ─── Request online users list ─────────────────────────────────────────
  socket.on('get_online_users', () => {
    const onlineUsersList = Array.from(onlineUsers.keys());
    socket.emit('online_users', onlineUsersList);
  });
};
