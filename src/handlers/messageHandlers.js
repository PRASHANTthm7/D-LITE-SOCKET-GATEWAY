import { onlineUsers } from '../server.js';
import { saveMessage } from '../services/messageService.js';
import { sendPresenceEvent } from '../services/presenceClient.js';
import { sendQuantumRoomEvent } from '../services/quantumRoomClient.js';
import { analyzeMessage } from '../services/aiEngineClient.js';

export const registerMessageHandlers = (io, socket) => {
  // ─── Send message (private or group) ───────────────────────────────────
  socket.on('send_message', async (data) => {
    try {
      const { sender_id, receiver_id, group_id, content, message_type = 'text', expires_at } = data;

      // Validate message data
      if (!sender_id || !content) {
        socket.emit('error', { message: 'Invalid message data: sender_id and content required' });
        return;
      }

      // Check if it's a group message or private message
      const isGroupMessage = !!group_id;

      if (!isGroupMessage && !receiver_id) {
        socket.emit('error', { message: 'Invalid message data: receiver_id or group_id required' });
        return;
      }

      // Build message payload
      const message = {
        sender_id,
        content,
        message_type,
        timestamp: new Date().toISOString(),
        read: false,
        chat_type: isGroupMessage ? 'group' : 'private'
      };

      // Add receiver_id or group_id
      if (isGroupMessage) {
        message.group_id = group_id;
      } else {
        message.receiver_id = receiver_id;
      }

      // Add expires_at if Live Thought Mode is enabled
      if (expires_at) {
        message.expires_at = expires_at;
      }

      // Forward to chat-service API for persistence in MongoDB.
      // Pass the socket's auth token so the chat-service can authenticate
      // the request through its JWT middleware.
      const token = socket.handshake?.auth?.token;
      const savedMessage = await saveMessage(message, token);

      // Analyze message with AI Engine (non-blocking)
      analyzeMessage(sender_id, content).catch(err => {
        console.log('[AI] Message analysis failed:', err.message);
      });

      // Send presence event for message sent
      if (!isGroupMessage && receiver_id) {
        sendPresenceEvent(sender_id, 'message_sent', { receiver_id });
      }

      if (isGroupMessage) {
        // ── Group message: broadcast to all members in the room ────────
        const roomId = `group_${group_id}`;
        io.to(roomId).emit('receive_message', savedMessage);
        console.log(`[Group] Message sent to group ${group_id} by ${sender_id}`);

        // Send quantum room event
        sendQuantumRoomEvent(group_id, sender_id, 'message_sent', {
          messageType: message_type,
          hasExpiry: !!expires_at
        });

        // Schedule auto-deletion if expires_at is set
        if (savedMessage.expires_at) {
          const expiryTime = new Date(savedMessage.expires_at).getTime() - Date.now();
          if (expiryTime > 0) {
            setTimeout(() => {
              io.to(roomId).emit('delete_message', {
                message_id: savedMessage._id || savedMessage.id,
                group_id: group_id,
                reason: 'expired'
              });
              console.log(`[LiveThought] Auto-deleted expired group message ${savedMessage._id}`);
            }, expiryTime);
          }
        }
      } else {
        // ── Private message: send to specific receiver ─────────────────
        const receiverSocketId = onlineUsers.get(receiver_id);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('receive_message', savedMessage);
          console.log(`[Private] Message sent from ${sender_id} to ${receiver_id}`);
        } else {
          console.log(`[Private] Receiver ${receiver_id} is offline, message saved to database`);
        }

        // Schedule auto-deletion if expires_at is set
        if (savedMessage.expires_at) {
          const expiryTime = new Date(savedMessage.expires_at).getTime() - Date.now();
          if (expiryTime > 0) {
            setTimeout(() => {
              // Notify both sender and receiver
              socket.emit('delete_message', {
                message_id: savedMessage._id || savedMessage.id,
                receiver_id: receiver_id,
                reason: 'expired'
              });
              if (receiverSocketId) {
                io.to(receiverSocketId).emit('delete_message', {
                  message_id: savedMessage._id || savedMessage.id,
                  sender_id: sender_id,
                  reason: 'expired'
                });
              }
              console.log(`[LiveThought] Auto-deleted expired private message ${savedMessage._id}`);
            }, expiryTime);
          }
        }
      }

      // ── Confirm to sender ─────────────────────────────────────────────
      socket.emit('message_sent', {
        success: true,
        message: savedMessage
      });

    } catch (error) {
      console.error('[Message] Error handling send_message:', error);
      socket.emit('error', {
        message: 'Failed to send message',
        error: error.message
      });
    }
  });

  // ─── Send group message (dedicated event) ─────────────────────────────
  socket.on('send_group_message', async (data) => {
    try {
      const { sender_id, group_id, content, message_type = 'text', expires_at } = data;

      // Validate message data
      if (!sender_id || !group_id || !content) {
        socket.emit('error', { message: 'Invalid group message data: sender_id, group_id, and content required' });
        return;
      }

      // Build group message payload
      const message = {
        sender_id,
        group_id,
        content,
        message_type,
        chat_type: 'group',
        timestamp: new Date().toISOString(),
        read: false
      };

      // Add expires_at if Live Thought Mode is enabled
      if (expires_at) {
        message.expires_at = expires_at;
      }

      // Forward to chat-service API for persistence
      const token = socket.handshake?.auth?.token;
      const savedMessage = await saveMessage(message, token);

      // Analyze message with AI Engine (non-blocking)
      analyzeMessage(sender_id, content).catch(err => {
        console.log('[AI] Message analysis failed:', err.message);
      });

      // Broadcast to all members in the group room
      const roomId = `group_${group_id}`;
      io.to(roomId).emit('receive_message', savedMessage);
      console.log(`[Group] Message sent to group ${group_id} by ${sender_id}`);

      // Schedule auto-deletion if expires_at is set
      if (savedMessage.expires_at) {
        const expiryTime = new Date(savedMessage.expires_at).getTime() - Date.now();
        if (expiryTime > 0) {
          setTimeout(() => {
            io.to(roomId).emit('delete_message', {
              message_id: savedMessage._id || savedMessage.id,
              group_id: group_id,
              reason: 'expired'
            });
            console.log(`[LiveThought] Auto-deleted expired message ${savedMessage._id} from group ${group_id}`);
          }, expiryTime);
        }
      }

      // Confirm to sender
      socket.emit('message_sent', {
        success: true,
        message: savedMessage
      });

    } catch (error) {
      console.error('[Group] Error handling send_group_message:', error);
      socket.emit('error', {
        message: 'Failed to send group message',
        error: error.message
      });
    }
  });


  // ─── Mark message as read ──────────────────────────────────────────────
  socket.on('message_read', async (data) => {
    try {
      const { message_id, sender_id } = data;

      // Get sender's socket ID
      const senderSocketId = onlineUsers.get(sender_id);

      // Notify sender that message was read
      if (senderSocketId) {
        io.to(senderSocketId).emit('message_read_receipt', {
          message_id,
          read_by: socket.userId,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error handling message_read:', error);
    }
  });

  // ─── Delete message ────────────────────────────────────────────────────
  socket.on('delete_message', async (data) => {
    try {
      const { message_id, receiver_id } = data;

      // Notify receiver about message deletion
      const receiverSocketId = onlineUsers.get(receiver_id);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('message_deleted', {
          message_id
        });
      }

      socket.emit('message_deleted_confirmation', {
        success: true,
        message_id
      });
    } catch (error) {
      console.error('Error handling delete_message:', error);
    }
  });

  // ============================================================================
  // Typing Indicators
  // ============================================================================

  /**
   * Handle typing indicator
   * 
   * Architecture Decision:
   * - Typing indicators are ephemeral and not persisted
   * - Only sent to online recipients for real-time feedback
   * - Includes sender info so UI can display "User X is typing..."
   */
  socket.on('typing', (data) => {
    try {
      const { receiver_id, group_id } = data;

      if (group_id) {
        // Group typing indicator
        const roomId = `group_${group_id}`;
        socket.to(roomId).emit('user_typing', {
          user_id: socket.userId,
          group_id,
          timestamp: new Date().toISOString(),
        });

        // Send quantum room event for group typing
        sendQuantumRoomEvent(group_id, socket.userId, 'typing_start');
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
    } catch (error) {
      console.error('[Typing] Error handling typing event:', error);
    }
  });

  /**
   * Handle stop typing indicator
   */
  socket.on('stop_typing', (data) => {
    try {
      const { receiver_id, group_id } = data;

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
      console.error('[Typing] Error handling stop_typing event:', error);
    }
  });

  // ============================================================================
  // Message Status Updates
  // ============================================================================

  /**
   * Handle message delivered status
   * 
   * Architecture Decision:
   * - Sent when message arrives at recipient's client
   * - Provides sender with delivery confirmation (single checkmark)
   * - Status updates can be batched for efficiency in high-volume chats
   */
  socket.on('message_delivered', (data) => {
    try {
      const { message_id, sender_id } = data;

      // Notify sender that message was delivered
      const senderSocketId = onlineUsers.get(sender_id);
      if (senderSocketId) {
        io.to(senderSocketId).emit('message_status_update', {
          message_id,
          status: 'delivered',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('[Status] Error handling message_delivered:', error);
    }
  });

  /**
   * Handle message read status
   * 
   * Architecture Decision:
   * - Sent when recipient actually views the message
   * - Provides sender with read confirmation (double checkmark)
   * - Respects user privacy settings (if implemented)
   */
  socket.on('message_read_status', (data) => {
    try {
      const { message_id, sender_id } = data;

      // Notify sender that message was read
      const senderSocketId = onlineUsers.get(sender_id);
      if (senderSocketId) {
        io.to(senderSocketId).emit('message_status_update', {
          message_id,
          status: 'read',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('[Status] Error handling message_read_status:', error);
    }
  });
};
