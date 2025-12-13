'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { generateRoomCode, isValidRoomCode, formatRoomCode } from '@/lib/roomCode';
import { cleanupExpiredRooms, getAllStoredRooms, getUserPreferences, saveUserPreferences } from '@/lib/storage';
import LegalDisclaimer from '@/components/LegalDisclaimer';
import SessionLock from '@/components/SessionLock';
import SessionLockSetup from '@/components/SessionLockSetup';

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [recentRooms, setRecentRooms] = useState<string[]>([]);
  const [username, setUsername] = useState('');
  const [extendedRetention, setExtendedRetention] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [showLockSetup, setShowLockSetup] = useState(false);
  const [hasSessionPin, setHasSessionPin] = useState(false);

  useEffect(() => {
    cleanupExpiredRooms();
    setRecentRooms(getAllStoredRooms());
    
    const prefs = getUserPreferences();
    setUsername(prefs.username);
    setExtendedRetention(prefs.extendedRetention);
    
    // Check for session PIN and auto-lock
    const pin = localStorage.getItem('session_pin');
    if (pin) {
      setHasSessionPin(true);
      setIsLocked(true);
    }
    
    if (!prefs.username) {
      setShowSettings(true);
    }
  }, []);

  const savePreferences = () => {
    if (!username.trim()) {
      setError('Username is required');
      return;
    }
    saveUserPreferences({ username: username.trim(), extendedRetention });
    setShowSettings(false);
    setError('');
  };

  const handleCreateRoom = () => {
    if (!username.trim()) {
      setShowSettings(true);
      setError('Set your username first');
      return;
    }
    const roomCode = generateRoomCode();
    router.push(`/room/${roomCode}`);
  };

  const handleJoinRoom = (code?: string) => {
    if (!username.trim()) {
      setShowSettings(true);
      setError('Set your username first');
      return;
    }

    const codeToJoin = code || joinCode.replace(/-/g, '').toUpperCase();
    
    if (!isValidRoomCode(codeToJoin)) {
      setError('Invalid room code');
      return;
    }

    setError('');
    router.push(`/room/${codeToJoin}`);
  };

  return (
    <>
      {isLocked && <SessionLock onUnlock={() => setIsLocked(false)} />}
      {showLockSetup && (
        <SessionLockSetup 
          onComplete={() => {
            setHasSessionPin(true);
            setShowLockSetup(false);
          }}
          onCancel={() => setShowLockSetup(false)}
        />
      )}
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <LegalDisclaimer />
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-2">kai</h1>
          <p className="text-gray-400">Messages so private, they ghost themselves.</p>
        </div>

        {showSettings ? (
          <div className="bg-neutral-900 border border-gray-800 rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Settings</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full bg-black border border-gray-800 rounded-lg px-4 py-2 text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-white"
                  maxLength={20}
                />
              </div>
              <div className="space-y-3 pt-3 border-t border-gray-800">
                <div>
                  <p className="text-sm font-medium text-white mb-1">Session Lock</p>
                  <p className="text-xs text-gray-500 mb-3">Protect your account with a 4-digit PIN</p>
                </div>
                {hasSessionPin ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setIsLocked(true)}
                      className="flex-1 bg-white text-black py-2 rounded-lg font-medium hover:bg-gray-200 text-sm"
                    >
                      🔒 Lock Now
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Remove session lock? You will need to set it up again.')) {
                          localStorage.removeItem('session_pin');
                          setHasSessionPin(false);
                        }
                      }}
                      className="px-4 py-2 text-red-400 hover:text-red-300 border border-red-400/30 rounded-lg text-sm"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowLockSetup(true)}
                    className="w-full bg-neutral-800 text-white py-2 rounded-lg font-medium hover:bg-neutral-700 text-sm border border-gray-700"
                  >
                    🔓 Setup PIN Lock
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-gray-800">
                <div>
                  <div className="text-sm text-gray-400">Extended Retention</div>
                  <div className="text-xs text-gray-600">Store chats for 7 weeks</div>
                </div>
                <button
                  onClick={() => setExtendedRetention(!extendedRetention)}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    extendedRetention ? 'bg-white' : 'bg-gray-700'
                  }`}
                >
                  <div className={`w-5 h-5 bg-black rounded-full transition-transform ${
                    extendedRetention ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={savePreferences}
                  className="flex-1 bg-white text-black py-2 rounded-lg font-medium hover:bg-gray-200"
                >
                  Save
                </button>
                {getUserPreferences().username && (
                  <button
                    onClick={() => {
                      setShowSettings(false);
                      setError('');
                    }}
                    className="px-4 py-2 text-gray-400 hover:text-white border border-gray-800 rounded-lg"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-neutral-900 border border-gray-800 rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">New Room</h2>
                  <p className="text-sm text-gray-400">Logged in as {username}</p>
                </div>
                <button
                  onClick={() => setShowSettings(true)}
                  className="text-xs text-gray-500 hover:text-gray-300 border border-gray-400 rounded-lg px-2 py-1"
                >
                  Settings
                </button>
              </div>
              <button
                onClick={handleCreateRoom}
                className="w-full bg-white text-black py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors"
              >
                Create Room
              </button>
            </div>

            <div className="bg-neutral-900 border border-gray-800 rounded-lg p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white">Join Room</h2>
              <div className="space-y-2">
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value);
                    setError('');
                  }}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-white font-mono"
                  maxLength={19}
                />
                {error && !showSettings && <p className="text-sm text-red-400">{error}</p>}
                <button
                  onClick={() => handleJoinRoom()}
                  className="w-full bg-gray-800 text-white py-3 rounded-lg font-medium hover:bg-gray-700 transition-colors border border-gray-700"
                >
                  Join
                </button>
              </div>
            </div>

            {recentRooms.length > 0 && (
              <div className="bg-neutral-900 border border-gray-800 rounded-lg p-6 space-y-4">
                <h2 className="text-lg font-semibold text-white">Recent</h2>
                <div className="space-y-2">
                  {recentRooms.slice(0, 3).map((roomCode) => (
                    <button
                      key={roomCode}
                      onClick={() => handleJoinRoom(roomCode)}
                      className="w-full bg-black border border-gray-800 rounded-lg px-4 py-3 text-gray-100 hover:border-gray-600 transition-colors text-left font-mono text-sm"
                    >
                      {formatRoomCode(roomCode)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl mb-1">🔒</div>
            <p className="text-xs text-gray-500">Encrypted</p>
          </div>
          <div>
            <div className="text-2xl mb-1">💾</div>
            <p className="text-xs text-gray-500">Local Storage</p>
          </div>
          <div>
            <div className="text-2xl mb-1">⏱️</div>
            <p className="text-xs text-gray-500">Auto-Expire</p>
          </div>
        </div>

        <div className="flex justify-center gap-6 text-xs text-gray-600 pt-4">
          <a href="/terms" className="hover:text-gray-400">
            Terms
          </a>
          <a href="/privacy" className="hover:text-gray-400">
            Privacy
          </a>
        </div>
      </div>
    </div>
    </>
  );
}
