import { NextRequest } from 'next/server';
import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';

export const dynamic = 'force-dynamic';

interface RoomData {
  users: Set<string>;
  createdAt: number;
}

const rooms = new Map<string, RoomData>();

// Cleanup old rooms (older than 24 hours)
const cleanupRooms = () => {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const [roomId, data] of rooms.entries()) {
    if (data.createdAt < oneDayAgo) {
      rooms.delete(roomId);
    }
  }
};

setInterval(cleanupRooms, 60 * 60 * 1000); // Cleanup every hour

export async function GET(req: NextRequest) {
  // This endpoint is needed to initialize the Socket.IO server
  // The actual server setup happens in server.ts
  return new Response(JSON.stringify({ message: 'Socket.IO server endpoint' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
