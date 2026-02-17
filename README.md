# Socket Gateway - Real-Time WebSocket Server

A stateless, horizontally-scalable WebSocket gateway for real-time messaging with JWT authentication and in-memory presence tracking.

## Architecture

Socket Gateway is a **stateless relay** for real-time communication. It does not connect to databases directly. All persistence is delegated to other services:

- **User Status** → auth-service via HTTP API
- **Message Persistence** → chat-service via HTTP API  
- **Presence Tracking** → In-memory Map (or Redis for horizontal scaling)

This design enables true separation of concerns, stateless operation, and easy horizontal scaling.

## Features

- ✓ Real-time bidirectional WebSocket communication via Socket.IO
- ✓ JWT authentication for secure connections
- ✓ Online user presence tracking (in-memory or Redis-backed)
- ✓ Private and group message broadcasting
- ✓ Typing indicators
- ✓ Message delivery & read confirmations
- ✓ Room-based message routing
- ✓ Graceful shutdown with connection cleanup
- ✓ Circuit breaker pattern for resilient inter-service communication
- ✓ Retry logic with exponential backoff
- ✓ Health check and metrics endpoints

## Tech Stack

- **Socket.io 4.6+** - Real-time communication
- **Express.js** - HTTP server for health checks & metrics
- **JWT** - Socket authentication (delegated to auth-service)
- **Axios** - Inter-service HTTP communication
- **Structured Logging** - Consistent application logging

## Microservices Integration

This service communicates with:

- `AUTH_SERVICE_URL` - Token verification & user status updates
- `CHAT_SERVICE_URL` - Message persistence
- `PRESENCE_ENGINE_URL` - Presence event tracking (optional)
- `AI_ENGINE_URL` - Message analysis (optional, non-blocking)
- `QUANTUM_ROOM_ENGINE_URL` - Group room analytics (optional)

## Socket Events

### Client → Server

- `send_message` - Send a private or group message
- `send_group_message` - Send a message to a group
- `join_room` - Join a room (private chat or group)
- `leave_room` - Leave a room
- `typing` - Start typing indicator
- `stop_typing` - Stop typing indicator
- `message_read` - Mark message as read
- `message_delivered` - Confirm message delivery
- `message_read_status` - Notify sender of read status
- `delete_message` - Delete a message

### Server → Client

- `connected` - Connection confirmation with socket ID
- `receive_message` - Incoming message
- `message_sent` - Send confirmation
- `online_users` - List of currently online users
- `user_connected` - User came online
- `user_disconnected` - User went offline
- `user_typing` - User is typing
- `user_stop_typing` - User stopped typing
- `message_read_receipt` - Message read confirmation
- `message_status_update` - Message delivery/read status
- `error` - Error notification

## Getting Started

### Prerequisites

- Node.js 18+ or Node.js 20 LTS
- Access to auth-service for JWT token verification
- Access to chat-service for message persistence

### Installation

```bash
npm install
```

### Environment Setup

Copy `.env.example` to `.env` and update values:

```bash
cp .env.example .env
```

See [.env.example](.env.example) for all configuration options.

### Development

```bash
npm install
npm run dev
```

### Production Build & Run

```bash
npm install --omit=dev
NODE_ENV=production node src/server.js
```

### Docker

```bash
docker build -t socket-gateway:latest .
docker run -p 3002:3002 --env-file .env socket-gateway:latest
```

## API Endpoints

### Health Check

```
GET /health
```

Response:
```json
{
  "status": "ok",
  "service": "socket-gateway",
  "connections": 42,
  "onlineUsers": 35,
  "timestamp": "2026-02-17T10:30:00.000Z"
}
```

### Metrics

```
GET /metrics
```

Response:
```json
{
  "connections": {
    "total": 42,
    "online": 35
  },
  "uptime": 3600,
  "memory": {
    "rss": 104857600,
    "heapTotal": 52428800,
    "heapUsed": 26214400
  },
  "timestamp": "2026-02-17T10:30:00.000Z"
}
```

## Connection Example

```javascript
import io from 'socket.io-client';

const socket = io('https://your-domain.com', {
  auth: {
    token: 'your-jwt-token'
  },
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5
});

socket.on('connect', () => {
  console.log('Connected!');
});

socket.on('connected', (data) => {
  console.log('Socket ID:', data.socket_id);
});

socket.on('receive_message', (message) => {
  console.log('New message:', message);
});

socket.emit('send_message', {
  sender_id: 'user123',
  receiver_id: 'user456',
  content: 'Hello!',
  message_type: 'text'
});
```

## Project Structure

```
src/
├── config/                # Service configuration
│   ├── apiGateway.js     # API gateway & axios instances
│   └── database.js       # Database config (stateless, no real DB)
├── handlers/             # Socket event handlers
│   ├── connectionHandlers.js
│   └── messageHandlers.js
├── middleware/           # Middleware & utilities
│   ├── authMiddleware.js     # JWT authentication
│   ├── errorHandler.js       # Error handling
│   └── logger.js             # Structured logging
├── services/             # Microservice clients
│   ├── aiEngineClient.js
│   ├── messageService.js
│   ├── presenceClient.js
│   ├── quantumRoomClient.js
│   └── userService.js
├── utils/
│   └── retry.js          # Retry & circuit breaker logic
└── server.js             # Main Socket.IO server
```

## Error Handling

The gateway implements comprehensive error handling:

- **Circuit Breaker** - Prevents cascading failures when downstream services are unavailable
- **Retry Logic** - Exponential backoff for transient failures
- **Graceful Degradation** - Socket operations continue even if optional services fail
- **Process-Level Handlers** - Catches uncaught exceptions and unhandled rejections

## Scaling

### Single Instance

By default, Socket Gateway uses an in-memory `Map` for presence tracking.

### Multiple Instances (Horizontal Scaling)

For multiple gateway instances, use Redis with Socket.IO adapter:

```javascript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient();
const subClient = pubClient.duplicate();

await Promise.all([pubClient.connect(), subClient.connect()]);

io.adapter(createAdapter(pubClient, subClient));
```

And switch to Redis for presence:

```javascript
const onlineUsers = await redis.hgetall('online_users');
```

## Monitoring

Monitor these metrics for production health:

- **Active Connections** - Current WebSocket connection count
- **Memory Usage** - Heap size and RSS memory
- **Error Rate** - Failed operations and exceptions
- **Service Latency** - Response times from downstream services
- **Circuit Breaker State** - Open/closed state of service circuit breakers

Use `/metrics` endpoint for programmatic monitoring.

## License

MIT

