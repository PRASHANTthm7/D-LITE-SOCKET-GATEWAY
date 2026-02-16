# Socket Gateway README

## Node.js + Socket.io WebSocket Gateway

Real-time WebSocket gateway for instant messaging.

### Features

- Real-time bidirectional communication
- JWT authentication for sockets
- Online user tracking
- Message broadcasting
- Typing indicators
- Room management
- Message delivery confirmation

### Tech Stack

- **Socket.io** - WebSocket library
- **Express** - HTTP server
- **MongoDB** - User status storage
- **JWT** - Socket authentication

### Socket Events

#### Client → Server

- `send_message` - Send a message
- `join_room` - Join a chat room
- `leave_room` - Leave a chat room
- `typing` - Start typing indicator
- `stop_typing` - Stop typing indicator
- `message_read` - Mark message as read

#### Server → Client

- `connected` - Connection confirmation
- `receive_message` - Incoming message
- `message_sent` - Send confirmation
- `online_users` - List of online users
- `user_connected` - User came online
- `user_disconnected` - User went offline
- `user_typing` - User is typing
- `user_stop_typing` - User stopped typing
- `message_read_receipt` - Message read confirmation

### Development

```bash
npm install
npm run dev
```

### Environment Variables

```env
PORT=3002
NODE_ENV=development
MONGODB_URI=mongodb+srv://...
JWT_SECRET=your-secret-key
CORS_ORIGINS=http://localhost:5173
CHAT_SERVICE_URL=http://localhost:8001
```

### Connection

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3002', {
  auth: {
    token: 'your-jwt-token'
  }
});

socket.on('connect', () => {
  console.log('Connected');
});
```

### Project Structure

```
src/
├── config/          # Configuration files
├── handlers/        # Socket event handlers
├── middleware/      # Socket middleware
├── services/        # Business logic
└── server.js        # Socket.io server
```
