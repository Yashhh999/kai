'use client';

import { formatRoomCode } from '@/lib/roomCode';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface RoomUser {
  id: string;
  name: string;
  lastSeen: number;
}

interface RoomHeaderProps {
  roomCode: string;
  users: RoomUser[];
  extendedRetention: boolean;
  onToggleRetention: () => void;
}

export default function RoomHeader({ roomCode, users, extendedRetention, onToggleRetention }: RoomHeaderProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const leaveRoom = () => {
    router.push('/');
  };

  return (
    <div className="border-b border-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Room</h2>
            <button
              onClick={copyRoomCode}
              className="text-sm text-gray-400 hover:text-white transition-colors font-mono"
              title="Click to copy"
            >
              {copied ? 'Copied!' : formatRoomCode(roomCode)}
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-neutral-900 rounded-full border border-gray-800">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-sm text-gray-400">
              {users.length} online
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleRetention}
            className={`text-xs px-3 py-1 rounded border transition-colors ${
              extendedRetention
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                : 'bg-neutral-900 border-gray-800 text-gray-500 hover:text-gray-300'
            }`}
            title={extendedRetention ? '7 weeks retention enabled' : 'Enable 7 weeks retention'}
          >
            {extendedRetention ? '7W' : '24H'}
          </button>
          
          <button
            onClick={leaveRoom}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-800 rounded-lg hover:border-gray-600 transition-colors"
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
