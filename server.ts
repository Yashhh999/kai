import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

interface RoomUser {
  id: string;
  name: string;
  lastSeen: number;
}

interface TypingUser {
  username: string;
  timeout: NodeJS.Timeout;
}

interface Room {
  users: Map<string, RoomUser>;
  createdAt: number;
  messageHistory: Array<{
    encryptedMessage: string;
    senderId: string;
    senderName: string;
    timestamp: number;
  }>;
  typingUsers: Map<string, TypingUser>;
}

const rooms = new Map<string, Room>();
const MAX_HISTORY = 50;
const MAX_ROOM_SIZE = 50;
const MAX_ROOMS = 1000;
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 100;

const checkRateLimit = (socketId: string): boolean => {
  const now = Date.now();
  const record = rateLimitMap.get(socketId);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(socketId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  record.count++;
  return true;
};

const cleanupRooms = () => {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const [roomId, data] of rooms.entries()) {
    if (data.createdAt < oneDayAgo) {
      rooms.delete(roomId);
    }
  }
  
  if (rateLimitMap.size > 10000) {
    rateLimitMap.clear();
  }
};

setInterval(cleanupRooms, 60 * 60 * 1000);

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: 100 * 1024 * 1024, // 100MB for larger files
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join-room', ({ roomId, username }: { roomId: string; username: string }) => {
      if (!checkRateLimit(socket.id)) {
        socket.emit('error', { message: 'Rate limit exceeded' });
        return;
      }

      if (rooms.size >= MAX_ROOMS && !rooms.has(roomId)) {
        socket.emit('error', { message: 'Server at capacity' });
        return;
      }

      socket.join(roomId);
      
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          users: new Map([[socket.id, { id: socket.id, name: username, lastSeen: Date.now() }]]),
          createdAt: Date.now(),
          messageHistory: [],
          typingUsers: new Map(),
        });
      } else {
        const room = rooms.get(roomId)!;
        
        if (room.users.size >= MAX_ROOM_SIZE) {
          socket.emit('error', { message: 'Room is full' });
          return;
        }
        
        room.users.set(socket.id, { id: socket.id, name: username, lastSeen: Date.now() });
        
        if (room.messageHistory.length > 0) {
          socket.emit('message-history', room.messageHistory);
        }
      }

      const room = rooms.get(roomId)!;
      const usersList = Array.from(room.users.values());
      
      io.to(roomId).emit('users-update', usersList);
      socket.to(roomId).emit('user-joined', { id: socket.id, name: username });
    });

    socket.on('leave-room', (roomId: string) => {
      socket.leave(roomId);
      const room = rooms.get(roomId);
      if (room) {
        room.users.delete(socket.id);
        if (room.users.size === 0) {
          rooms.delete(roomId);
        } else {
          const usersList = Array.from(room.users.values());
          io.to(roomId).emit('users-update', usersList);
        }
      }
      socket.to(roomId).emit('user-left', socket.id);
    });

    socket.on('typing-start', ({ roomId, username }: { roomId: string; username: string }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      if (room.typingUsers.has(socket.id)) {
        clearTimeout(room.typingUsers.get(socket.id)!.timeout);
      }

      const timeout = setTimeout(() => {
        room.typingUsers.delete(socket.id);
        socket.to(roomId).emit('user-typing', { userId: socket.id, username, isTyping: false });
      }, 4000);

      room.typingUsers.set(socket.id, { username, timeout });
      socket.to(roomId).emit('user-typing', { userId: socket.id, username, isTyping: true });
    });

    socket.on('typing-stop', (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room) return;

      const typingUser = room.typingUsers.get(socket.id);
      if (typingUser) {
        clearTimeout(typingUser.timeout);
        room.typingUsers.delete(socket.id);
        socket.to(roomId).emit('user-typing', { userId: socket.id, username: typingUser.username, isTyping: false });
      }
    });

    socket.on('send-message', ({ roomId, encryptedMessage, username, selfDestruct, timerStartedAt }) => {
      if (!checkRateLimit(socket.id)) {
        return;
      }

      const messageData = {
        encryptedMessage,
        senderId: socket.id,
        senderName: username,
        timestamp: Date.now(),
        selfDestruct,
        timerStartedAt,
      };
      
      const room = rooms.get(roomId);
      if (room) {
        room.messageHistory.push(messageData);
        if (room.messageHistory.length > MAX_HISTORY) {
          room.messageHistory.shift();
        }
      }
      
      socket.to(roomId).emit('receive-message', messageData);
    });

    socket.on('send-file', ({ roomId, encryptedFile, username }) => {
      socket.to(roomId).emit('receive-file', {
        encryptedFile,
        senderId: socket.id,
        senderName: username,
        timestamp: Date.now(),
      });
    });

    socket.on('p2p-signal', ({ to, roomId, signal }) => {
      io.to(to).emit('p2p-signal', {
        from: socket.id,
        signal,
      });
    });

    socket.on('p2p-request', ({ to, roomId }) => {
      io.to(to).emit('p2p-request', {
        from: socket.id,
      });
    });

    socket.on('heartbeat', ({ roomId }: { roomId: string }) => {
      const room = rooms.get(roomId);
      if (room?.users.has(socket.id)) {
        const user = room.users.get(socket.id)!;
        user.lastSeen = Date.now();
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      
      for (const [roomId, room] of rooms.entries()) {
        if (room.users.has(socket.id)) {
          room.users.delete(socket.id);
          
          const typingUser = room.typingUsers.get(socket.id);
          if (typingUser) {
            clearTimeout(typingUser.timeout);
            room.typingUsers.delete(socket.id);
          }
          
          if (room.users.size === 0) {
            rooms.delete(roomId);
          } else {
            const usersList = Array.from(room.users.values());
            io.to(roomId).emit('users-update', usersList);
            io.to(roomId).emit('user-left', socket.id);
          }
        }
      }
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
