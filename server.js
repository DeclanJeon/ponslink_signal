require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
// [] const { createAdapter } = require('@socket.io/redis-adapter');
// [] const { createClient } = require('redis');

if (!process.env.CORS_ALLOWED_ORIGINS) {
  console.error("Error: CORS_ALLOWED_ORIGINS is not defined in .env file.");
  process.exit(1);
}

if (!process.env.PORT) {
  console.error("Error: PORT is not defined in .env file.");
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ALLOWED_ORIGINS.split(','), // 쉼표로 구분된 문자열을 배열로 변환
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // 100 MB
});

/* [] Redis Adapter 
const pubClient = createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();
Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
});
*/

app.use(cors());

// [] - Map       .
//     Redis  .
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`[CONNECT] User connected: ${socket.id}`);

  socket.on('join-room', ({ roomId, userId, nickname }) => {
    socket.join(roomId);
    socket.data.userId = userId;
    socket.data.roomId = roomId;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    const room = rooms.get(roomId);

    if (room.size >= 2) {
      socket.emit('room-full');
      socket.leave(roomId);
      return;
    }

    room.set(userId, { socketId: socket.id, nickname });

    const otherUsers = Array.from(room.entries())
      .filter(([id, _]) => id !== userId)
      .map(([id, data]) => ({ id, nickname: data.nickname }));

    socket.emit('room-users', otherUsers);
    socket.to(roomId).emit('user-joined', { id: userId, nickname });

    console.log(`[JOIN] User ${userId} (${nickname}) joined room ${roomId}`);
  });

  socket.on('signal', ({ to, signal }) => {
    const room = rooms.get(socket.data.roomId);
    if (room && room.has(to)) {
      const toSocketId = room.get(to).socketId;
      io.to(toSocketId).emit('signal', { from: socket.data.userId, signal });
    }
  });

  // []        
  socket.on('update-media-state', ({ kind, enabled }) => {
    const { userId, roomId } = socket.data;
    if (roomId) {
      socket.to(roomId).emit('peer-state-updated', { userId, kind, enabled });
    }
  });

  socket.on('chat-message', ({ message }) => {
    const { userId, roomId } = socket.data;
    if (roomId) {
      io.to(roomId).emit('chat-message', {
        ...message,
        senderId: userId,
      });
      console.log(`[CHAT FALLBACK] User ${userId} sent a message to room ${roomId}`);
    }
  });

  //     ( )
  const forwardFileEvent = (eventName) => {
    socket.on(eventName, (data) => {
      const { to } = data;
      const room = rooms.get(socket.data.roomId);
      if (room && room.has(to)) {
        const toSocketId = room.get(to).socketId;
        // 원본 발신자 정보를 추가하여 전달
        const payload = { ...data, from: socket.data.userId };
        io.to(toSocketId).emit(eventName, payload);
      }
    });
  };

  forwardFileEvent('file-meta');
  forwardFileEvent('file-accept');
  forwardFileEvent('file-decline');
  forwardFileEvent('file-cancel');


  socket.on('disconnect', () => {
    const { userId, roomId } = socket.data;
    if (userId && roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.delete(userId);
        socket.to(roomId).emit('user-left', userId);
        console.log(`[DISCONNECT] User ${userId} left room ${roomId}`);

        if (room.size === 0) {
          rooms.delete(roomId);
          console.log(`[CLEANUP] Room ${roomId} is empty and has been deleted.`);
        }
      }
    }
    console.log(`[DISCONNECT] User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
