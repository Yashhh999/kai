import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST || '0.0.0.0';
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

interface VoiceParticipant {
  userId: string;
  username: string;
  isMuted: boolean;
  isDeafened: boolean;
  joinedAt: number;
  lastActivity: number;
}

interface Room {
  users: Map<string, RoomUser>;
  createdAt: number;
  /** Protocol version of the room (1 = legacy room-code E2E, 2 = routingId + FS). */
  protocol: number;
  messageHistory: Array<{
    encryptedMessage: string;
    senderId: string;
    senderName: string;
    timestamp: number;
  }>;
  typingUsers: Map<string, TypingUser>;
  voiceChannel: Map<string, VoiceParticipant>;
}

const rooms = new Map<string, Room>();
const MAX_HISTORY = 50;
const MAX_ROOM_SIZE = 50;
const MAX_ROOMS = 1000;
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 100;

// --- Ephemeral in-RAM rendezvous (User-ID direct chat). No disk; wiped on restart.
interface PresenceEntry {
  socketId: string;
  fingerprint: string;
  bundle: string; // opaque public prekey bundle (server never interprets)
  registeredAt: number;
}
const presence = new Map<string, PresenceEntry>(); // fingerprint -> entry
const socketToFingerprint = new Map<string, string>();

// --- Ephemeral in-RAM invite registry. `inviteId` is SHA-256(nonce) — never a key.
interface InviteRecord {
  routingId: string;
  uses: number;
  maxUses?: number;
  expiresAt?: number;
  maxParticipants?: number;
}
const invites = new Map<string, InviteRecord>();

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

const cleanupRooms = (io?: any) => {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const threeMinutesAgo = Date.now() - 3 * 60 * 1000;
  
  for (const [roomId, data] of rooms.entries()) {
    if (data.createdAt < oneDayAgo) {
      rooms.delete(roomId);
      continue;
    }
    
    // Only check for AFK if there's exactly 1 person in voice (alone)
    // If 2+ people are in voice, they're actively in a call - don't kick anyone
    if (io && data.voiceChannel.size === 1) {
      for (const [userId, participant] of data.voiceChannel.entries()) {
        if (participant.lastActivity < threeMinutesAgo) {
          console.log(`[Voice] Kicking ${participant.username} for AFK (alone in voice for 3+ mins)`);
          data.voiceChannel.delete(userId);
          const participants = Array.from(data.voiceChannel.values());
          io.to(roomId).emit('voice-state-update', participants);
          io.to(userId).emit('voice-kicked-afk');
        }
      }
    }
  }
  
  if (rateLimitMap.size > 10000) {
    rateLimitMap.clear();
  }

  // Reclaim expired / exhausted invite records (RAM-only; safe to drop).
  const nowTs = Date.now();
  for (const [id, rec] of invites.entries()) {
    const expired = rec.expiresAt !== undefined && nowTs > rec.expiresAt;
    const exhausted = rec.maxUses !== undefined && rec.uses >= rec.maxUses;
    if (expired || (exhausted && !rooms.has(rec.routingId))) invites.delete(id);
  }
  if (invites.size > 10000) invites.clear();
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

  // Restrict CORS. Set ALLOWED_ORIGINS (comma-separated) in production; otherwise the
  // request origin is reflected (stricter than the previous wildcard '*').
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : true;

  const io = new SocketIOServer(server, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
    },
    // Direct files are capped at 10MB raw (~13MB base64); 20MB leaves headroom.
    maxHttpBufferSize: 20 * 1024 * 1024,
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    transports: ['websocket', 'polling'],
  });

  setInterval(() => cleanupRooms(io), 60 * 1000);

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join-room', ({ roomId, username, v }: { roomId: string; username: string; v?: number }) => {
      if (!checkRateLimit(socket.id)) {
        socket.emit('error', { message: 'Rate limit exceeded' });
        return;
      }

      if (rooms.size >= MAX_ROOMS && !rooms.has(roomId)) {
        socket.emit('error', { message: 'Server at capacity' });
        return;
      }

      const protocol = v ?? 1;
      socket.join(roomId);

      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          users: new Map([[socket.id, { id: socket.id, name: username, lastSeen: Date.now() }]]),
          createdAt: Date.now(),
          protocol,
          messageHistory: [],
          typingUsers: new Map(),
          voiceChannel: new Map(),
        });
      } else {
        const room = rooms.get(roomId)!;

        if (room.users.size >= MAX_ROOM_SIZE) {
          socket.emit('error', { message: 'Room is full' });
          return;
        }

        room.users.set(socket.id, { id: socket.id, name: username, lastSeen: Date.now() });

        // v2 rooms have per-epoch forward secrecy: replaying old ciphertext to a new
        // joiner is useless (they lack the prior epoch keys) and undermines FS, so we
        // only replay history for legacy (v1) rooms.
        if (room.protocol < 2 && room.messageHistory.length > 0) {
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
        room.voiceChannel.delete(socket.id);
        
        if (room.users.size === 0) {
          rooms.delete(roomId);
        } else {
          const usersList = Array.from(room.users.values());
          io.to(roomId).emit('users-update', usersList);
          
          const participants = Array.from(room.voiceChannel.values());
          io.to(roomId).emit('voice-state-update', participants);
        }
      }
      socket.to(roomId).emit('user-left', socket.id);
    });

    socket.on('voice-join', ({ roomId }: { roomId: string }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      const user = room.users.get(socket.id);
      if (!user) return;

      // Don't add if already in voice channel
      if (room.voiceChannel.has(socket.id)) {
        console.log(`User ${socket.id} already in voice channel`);
        return;
      }

      room.voiceChannel.set(socket.id, {
        userId: socket.id,
        username: user.name,
        isMuted: false,
        isDeafened: false,
        joinedAt: Date.now(),
        lastActivity: Date.now()
      });

      const participants = Array.from(room.voiceChannel.values());
      console.log(`User ${user.name} joined voice. Total participants:`, participants.length);
      
      // Broadcast to all users including the joiner
      io.to(roomId).emit('voice-state-update', participants);
    });

    socket.on('voice-leave', ({ roomId }: { roomId: string }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      room.voiceChannel.delete(socket.id);
      const participants = Array.from(room.voiceChannel.values());
      io.to(roomId).emit('voice-state-update', participants);
    });

    socket.on('voice-toggle-mute', ({ roomId }: { roomId: string }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      
      const participant = room.voiceChannel.get(socket.id);
      if (!participant) return;

      participant.isMuted = !participant.isMuted;
      participant.lastActivity = Date.now();
      
      const participants = Array.from(room.voiceChannel.values());
      io.to(roomId).emit('voice-state-update', participants);
    });

    socket.on('voice-toggle-deafen', ({ roomId }: { roomId: string }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      
      const participant = room.voiceChannel.get(socket.id);
      if (!participant) return;

      participant.isDeafened = !participant.isDeafened;
      if (participant.isDeafened) participant.isMuted = true;
      participant.lastActivity = Date.now();
      
      const participants = Array.from(room.voiceChannel.values());
      io.to(roomId).emit('voice-state-update', participants);
    });

    socket.on('voice-signal', ({ roomId, targetId, signal }: { roomId: string; targetId: string; signal: any }) => {
      io.to(targetId).emit('voice-signal', {
        from: socket.id,
        signal
      });
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
      // Only legacy (v1) rooms buffer history for replay. v2 rooms keep forward
      // secrecy by never retaining ciphertext server-side.
      if (room && room.protocol < 2) {
        room.messageHistory.push(messageData);
        if (room.messageHistory.length > MAX_HISTORY) {
          room.messageHistory.shift();
        }
      }

      socket.to(roomId).emit('receive-message', messageData);
    });

    // Relay an (already-encrypted) sender-key distribution. The payload is wrapped
    // under the room key by the client, so the server only ever sees ciphertext.
    socket.on('sender-key', ({ roomId, to, payload }: { roomId: string; to?: string; payload: string }) => {
      if (to) {
        io.to(to).emit('sender-key', { from: socket.id, payload });
      } else {
        socket.to(roomId).emit('sender-key', { from: socket.id, payload });
      }
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

    // ---- Ephemeral rendezvous: publish presence + public prekey bundle ----
    socket.on('id-register', ({ fingerprint, bundle }: { fingerprint: string; bundle: string }) => {
      if (!fingerprint || typeof bundle !== 'string') return;
      // Evict any stale entry that maps this socket to a different fingerprint.
      const prev = socketToFingerprint.get(socket.id);
      if (prev && prev !== fingerprint) presence.delete(prev);
      presence.set(fingerprint, { socketId: socket.id, fingerprint, bundle, registeredAt: Date.now() });
      socketToFingerprint.set(socket.id, fingerprint);
    });

    socket.on('id-unregister', () => {
      const fp = socketToFingerprint.get(socket.id);
      if (fp) presence.delete(fp);
      socketToFingerprint.delete(socket.id);
    });

    socket.on('id-lookup', ({ fingerprint }: { fingerprint: string }) => {
      const entry = presence.get(fingerprint);
      socket.emit('id-bundle', { fingerprint, bundle: entry ? entry.bundle : null });
    });

    // First X3DH/ratchet message to a peer identified by fingerprint.
    socket.on('dm-init', ({ to, init, envelope }: { to: string; init: unknown; envelope: unknown }) => {
      const from = socketToFingerprint.get(socket.id);
      const target = presence.get(to);
      if (from && target) io.to(target.socketId).emit('dm-init-receive', { from, init, envelope });
      else socket.emit('dm-error', { to, reason: 'offline' });
    });

    // Subsequent ratchet messages.
    socket.on('dm-relay', ({ to, envelope }: { to: string; envelope: unknown }) => {
      const from = socketToFingerprint.get(socket.id);
      const target = presence.get(to);
      if (from && target) io.to(target.socketId).emit('dm-receive', { from, envelope });
      else socket.emit('dm-error', { to, reason: 'offline' });
    });

    // ---- Ephemeral invite registry (uses/expiry/maxParticipants; hash, never a key) ----
    socket.on(
      'invite-register',
      ({ inviteId, routingId, maxUses, expiresAt, maxParticipants }: { inviteId: string; routingId: string; maxUses?: number; expiresAt?: number; maxParticipants?: number }) => {
        if (!inviteId || !routingId) return;
        invites.set(inviteId, { routingId, uses: 0, maxUses, expiresAt, maxParticipants });
      },
    );

    socket.on(
      'invite-consume',
      ({ inviteId }: { inviteId: string }, ack?: (r: { ok: boolean; reason?: string }) => void) => {
        const rec = invites.get(inviteId);
        if (!rec) return ack?.({ ok: true }); // unknown invite: no server-side limit to enforce
        if (rec.expiresAt && Date.now() > rec.expiresAt) return ack?.({ ok: false, reason: 'expired' });
        if (rec.maxUses !== undefined && rec.uses >= rec.maxUses) return ack?.({ ok: false, reason: 'exhausted' });
        const room = rooms.get(rec.routingId);
        if (rec.maxParticipants !== undefined && room && room.users.size >= rec.maxParticipants) {
          return ack?.({ ok: false, reason: 'full' });
        }
        // Keep the record after exhaustion so repeat attempts read 'exhausted'
        // rather than falling through to the unknown-invite (ok) path. Periodic
        // cleanup reclaims expired/exhausted invites.
        rec.uses += 1;
        ack?.({ ok: true });
      },
    );

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);

      // Remove any rendezvous presence for this socket.
      const fp = socketToFingerprint.get(socket.id);
      if (fp) presence.delete(fp);
      socketToFingerprint.delete(socket.id);

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
