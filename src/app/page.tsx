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
        <div className="text-center space-y-2">
          <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight">kai</h1>
          <p className="text-sm text-neutral-500">Ephemeral conversations. Zero traces.</p>
        </div>

        {showSettings ? (
          <div className="bg-neutral-900/70 backdrop-blur-xl border border-neutral-800 rounded-2xl p-6 space-y-4 shadow-2xl">
            <h2 className="text-lg font-semibold text-white">Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-neutral-400 mb-2 block font-medium">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your display name"
                  className="w-full bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/50 transition-all"
                  maxLength={20}
                />
              </div>
              <div className="space-y-3 pt-4 border-t border-neutral-800">
                <div>
                  <p className="text-sm font-medium text-white">Session Lock</p>
                  <p className="text-xs text-neutral-500 mt-1">Secure your session with a 4-digit PIN</p>
                </div>
                {hasSessionPin ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setIsLocked(true)}
                      className="flex-1 bg-white text-black py-2.5 rounded-xl font-medium hover:bg-neutral-200 active:scale-95 transition-all text-sm shadow-lg"
                    >
                      🔒 Lock Now
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Remove session lock?')) {
                          localStorage.removeItem('session_pin');
                          setHasSessionPin(false);
                        }
                      }}
                      className="px-4 py-2.5 text-red-400 hover:text-red-300 border border-red-500/30 rounded-xl text-sm hover:bg-red-500/10 transition-all"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowLockSetup(true)}
                    className="w-full bg-neutral-800 text-white py-2.5 rounded-xl font-medium hover:bg-neutral-700 active:scale-95 transition-all text-sm border border-neutral-700"
                  >
                    🔓 Setup PIN
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-neutral-800">
                <div>
                  <div className="text-sm text-neutral-300 font-medium">Extended Retention</div>
                  <div className="text-xs text-neutral-600">7 weeks instead of 24 hours</div>
                </div>
                <button
                  onClick={() => setExtendedRetention(!extendedRetention)}
                  className={`w-12 h-6 rounded-full transition-all ${
                    extendedRetention ? 'bg-white' : 'bg-neutral-700'
                  }`}
                >
                  <div className={`w-5 h-5 bg-black rounded-full transition-transform shadow-lg ${
                    extendedRetention ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>
              {error && <p className="text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={savePreferences}
                  className="flex-1 bg-white text-black py-2.5 rounded-xl font-medium hover:bg-neutral-200 active:scale-95 transition-all text-sm shadow-lg"
                >
                  Save
                </button>
                {getUserPreferences().username && (
                  <button
                    onClick={() => { setShowSettings(false); setError(''); }}
                    className="px-4 py-2.5 text-neutral-400 hover:text-white border border-neutral-800 rounded-xl hover:bg-neutral-800/50 transition-all"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-neutral-900/70 backdrop-blur-xl border border-neutral-800 rounded-2xl p-6 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">New Room</h2>
                  <p className="text-sm text-neutral-500 mt-0.5">Logged in as <span className="text-white font-medium">{username}</span></p>
                </div>
                <button
                  onClick={() => setShowSettings(true)}
                  className="text-xs text-neutral-500 hover:text-white border border-neutral-800 rounded-lg px-3 py-1.5 hover:bg-neutral-800/50 transition-all font-medium"
                >
                  Settings
                </button>
              </div>
              <button
                onClick={handleCreateRoom}
                className="w-full bg-white text-black py-3 rounded-xl font-medium hover:bg-neutral-200 active:scale-95 transition-all text-sm shadow-lg"
              >
                Create Room
              </button>
            </div>

            <div className="bg-neutral-900/70 backdrop-blur-xl border border-neutral-800 rounded-2xl p-6 space-y-4 shadow-2xl">
              <h2 className="text-lg font-semibold text-white">Join Room</h2>
              <div className="space-y-3">
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => { setJoinCode(e.target.value); setError(''); }}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  className="w-full bg-black/50 border border-neutral-800 rounded-xl px-4 py-3 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/50 font-mono text-sm transition-all"
                  maxLength={19}
                />
                {error && !showSettings && <p className="text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
                <button
                  onClick={() => handleJoinRoom()}
                  className="w-full bg-neutral-800 text-white py-3 rounded-xl font-medium hover:bg-neutral-700 active:scale-95 transition-all border border-neutral-700 shadow-lg"
                >
                  Join
                </button>
              </div>
            </div>

            {recentRooms.length > 0 && (
              <div className="bg-neutral-900/70 backdrop-blur-xl border border-neutral-800 rounded-2xl p-6 space-y-4 shadow-2xl">
                <h2 className="text-lg font-semibold text-white">Recent Rooms</h2>
                <div className="space-y-2">
                  {recentRooms.slice(0, 3).map((roomCode) => (
                    <button
                      key={roomCode}
                      onClick={() => handleJoinRoom(roomCode)}
                      className="w-full bg-black/50 border border-neutral-800 rounded-xl px-4 py-3 text-neutral-100 hover:border-neutral-700 hover:bg-neutral-800/50 transition-all text-left font-mono text-sm group"
                    >
                      <span className="group-hover:tracking-wider transition-all duration-200">{formatRoomCode(roomCode)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-3 gap-6 text-center pt-2">
          <div className="p-3 rounded-xl bg-neutral-900/50 border border-neutral-800/50">
            <div className="text-2xl mb-1.5">🔒</div>
            <p className="text-xs text-neutral-500 font-medium">End-to-End</p>
          </div>
          <div className="p-3 rounded-xl bg-neutral-900/50 border border-neutral-800/50">
            <div className="text-2xl mb-1.5">💾</div>
            <p className="text-xs text-neutral-500 font-medium">Local First</p>
          </div>
          <div className="p-3 rounded-xl bg-neutral-900/50 border border-neutral-800/50">
            <div className="text-2xl mb-1.5">⏱️</div>
            <p className="text-xs text-neutral-500 font-medium">Ephemeral</p>
          </div>
        </div>

        <div className="flex justify-center gap-6 text-xs text-neutral-600 pt-4">
          <a href="/terms" className="hover:text-neutral-400 transition-colors">
            Terms
          </a>
          <a href="/privacy" className="hover:text-neutral-400 transition-colors">
            Privacy
          </a>
        </div>
      </div>
    </div>
    </>
  );
}
