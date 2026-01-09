'use client';

import { formatRoomCode } from '@/lib/roomCode';
import { useRouter } from 'next/navigation';
import { useState, RefObject } from 'react';
import { VoiceChannelRef } from './VoiceChannel';

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
  voiceChannelRef: RefObject<VoiceChannelRef | null>;
  isInVoice: boolean;
  voiceParticipantCount: number;
}

export default function RoomHeader({ roomCode, users, extendedRetention, onToggleRetention, voiceChannelRef, isInVoice, voiceParticipantCount }: RoomHeaderProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [showUsers, setShowUsers] = useState(false);

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border-b border-neutral-900 bg-black/50 backdrop-blur-xl p-3 sm:p-4 relative">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm sm:text-base font-medium text-white/90">Room</h2>
            <button
              onClick={copyRoomCode}
              className="text-xs sm:text-sm text-neutral-500 hover:text-white transition-all duration-200 font-mono truncate block max-w-full group"
              title="Click to copy"
            >
              <span className="group-hover:tracking-wider transition-all duration-200">
                {copied ? '✓ Copied!' : formatRoomCode(roomCode)}
              </span>
            </button>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowUsers(!showUsers)}
              className="flex items-center gap-2 px-3 py-1.5 bg-neutral-900/50 rounded-full border border-neutral-800/50 backdrop-blur hover:bg-neutral-800/50 transition-all cursor-pointer"
              title="View users in room"
            >
              <div className={`w-2 h-2 rounded-full ${users.length > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-600'}`}></div>
              <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-xs sm:text-sm text-neutral-400 font-medium">{users.length}</span>
            </button>
            
            {showUsers && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowUsers(false)}
                ></div>
                <div className="absolute top-full right-0 mt-2 w-56 bg-neutral-900/95 backdrop-blur-xl border border-neutral-800 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="p-3 border-b border-neutral-800">
                    <p className="text-xs font-semibold text-neutral-400">USERS IN ROOM</p>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {users.length === 0 ? (
                      <div className="p-4 text-center text-neutral-500 text-sm">
                        No users online
                      </div>
                    ) : (
                      users.map((user) => (
                        <div 
                          key={user.id}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/50 transition-colors"
                        >
                          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                          <span className="text-sm text-neutral-200 font-medium truncate flex-1">{user.name}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 ml-2 sm:ml-3">
          <button
            onClick={() => voiceChannelRef.current?.toggle()}
            className={`relative px-2.5 sm:px-3 py-1.5 rounded-lg border transition-all duration-200 ${
              isInVoice
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 shadow-lg shadow-emerald-500/20'
                : voiceParticipantCount > 0
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/20'
                  : 'bg-neutral-900/50 border-neutral-800/50 text-neutral-500 hover:text-neutral-300 hover:border-neutral-700'
            }`}
            title={
              isInVoice 
                ? 'You are in voice' 
                : voiceParticipantCount > 0
                  ? `${voiceParticipantCount} user(s) in voice - Click to view`
                  : 'Voice Channel - Click to open'
            }
          >
            {/* Green indicator dot when anyone is in voice but you're not */}
            {voiceParticipantCount > 0 && !isInVoice && (
              <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-black shadow-lg shadow-emerald-500/50 animate-pulse"></div>
            )}
            {/* Solid green ring when you're in voice */}
            {isInVoice && (
              <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-black shadow-lg"></div>
            )}
            <div className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              {voiceParticipantCount > 0 && (
                <span className="text-xs font-bold">{voiceParticipantCount}</span>
              )}
            </div>
          </button>
          
          <button
            onClick={onToggleRetention}
            className={`text-xs px-2.5 sm:px-3 py-1.5 rounded-full border transition-all duration-200 font-medium ${
              extendedRetention
                ? 'bg-blue-500/20 border-blue-500/40 text-blue-400 shadow-lg shadow-blue-500/20'
                : 'bg-neutral-900/50 border-neutral-800/50 text-neutral-500 hover:text-neutral-300 hover:border-neutral-700'
            }`}
            title={extendedRetention ? '7 days retention' : '24 hours retention'}
          >
            {extendedRetention ? '7D' : '24H'}
          </button>
          
          <button
            onClick={() => router.push('/')}
            className="px-2.5 sm:px-4 py-1.5 text-xs sm:text-sm text-neutral-500 hover:text-white border border-neutral-800/50 rounded-lg hover:border-neutral-700 hover:bg-neutral-900/50 transition-all duration-200"
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
