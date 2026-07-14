'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { generateRoomCode, isValidRoomCode, formatRoomCode } from '@/lib/roomCode';
import { cleanupExpiredRooms, getAllStoredRooms, getUserPreferences, saveUserPreferences } from '@/lib/storage';
import LegalDisclaimer from '@/components/LegalDisclaimer';
import SessionLock from '@/components/SessionLock';
import SessionLockSetup from '@/components/SessionLockSetup';
import { getKeyManager } from '@/lib/crypto/keyManager';
import { formatFingerprint } from '@/lib/crypto/identity';
import { parseInvite, redeemInvite } from '@/lib/crypto/invite';
import { stashInvite } from '@/lib/inviteSession';

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [recentRooms, setRecentRooms] = useState<string[]>([]);
  const [username, setUsername] = useState('');
  const [extendedRetention, setExtendedRetention] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [identityReady, setIdentityReady] = useState(false);
  const [myUserId, setMyUserId] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [invitePwFragment, setInvitePwFragment] = useState<string | null>(null);
  const [invitePassword, setInvitePassword] = useState('');
  const inviteHandledRef = useRef(false);

  useEffect(() => {
    cleanupExpiredRooms();
    setRecentRooms(getAllStoredRooms());

    const prefs = getUserPreferences();
    setUsername(prefs.username);
    setExtendedRetention(prefs.extendedRetention);

    // Identity gate: first run must create an identity (PIN-sealed); a returning
    // user must unlock it. The identity is required before entering any room.
    const km = getKeyManager();
    if (!km.hasSealedStore()) {
      setNeedsSetup(true);
    } else if (!km.isUnlocked()) {
      setIsLocked(true);
    } else {
      setIdentityReady(true);
    }

    if (!prefs.username) {
      setShowSettings(true);
    }
  }, []);

  useEffect(() => {
    if (identityReady) {
      try {
        setMyUserId(getKeyManager().getPublicIdentity().fingerprint);
      } catch {
        /* locked */
      }
    }
  }, [identityReady]);

  const processInvite = async (fragment: string, password?: string) => {
    setInviteBusy(true);
    setInviteError('');
    try {
      const parsed = parseInvite(fragment);
      if (parsed.token.pwSalt && !password) {
        setInvitePwFragment(fragment); // ask for the password
        setInviteBusy(false);
        return;
      }
      const { roomKeyBytes, routingId, issuerFingerprint } = await redeemInvite(parsed, { password });
      stashInvite(routingId, roomKeyBytes, issuerFingerprint);
      history.replaceState(null, '', window.location.pathname); // scrub the secret from the URL
      router.push(`/room/${routingId}`);
    } catch (e) {
      console.error('Invite redemption failed:', e);
      setInviteError(password ? 'Wrong password or invalid invite.' : 'This invite is invalid or expired.');
      setInviteBusy(false);
    }
  };

  // Redeem an invite link (#i=…) once the identity is unlocked.
  useEffect(() => {
    if (!identityReady || inviteHandledRef.current) return;
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (hash.includes('i=')) {
      inviteHandledRef.current = true;
      processInvite(hash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityReady]);

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
    if (!getKeyManager().isUnlocked()) {
      setIsLocked(true);
      return;
    }
    if (!username.trim()) {
      setShowSettings(true);
      setError('Set your username first');
      return;
    }
    const roomCode = generateRoomCode();
    router.push(`/room/${roomCode}`);
  };

  const handleJoinRoom = (code?: string) => {
    if (!getKeyManager().isUnlocked()) {
      setIsLocked(true);
      return;
    }
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
      {needsSetup && (
        <SessionLockSetup
          onComplete={() => {
            setNeedsSetup(false);
            setIdentityReady(true);
          }}
          onCancel={() => { /* identity setup is mandatory */ }}
        />
      )}
      {isLocked && (
        <SessionLock
          onUnlock={() => {
            setIsLocked(false);
            setIdentityReady(true);
          }}
        />
      )}
      {(invitePwFragment || inviteBusy) && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-1">Joining via invite</h2>
            {inviteBusy && !invitePwFragment ? (
              <p className="text-neutral-400 text-sm">Unlocking the room…</p>
            ) : (
              <>
                <p className="text-neutral-400 text-xs mb-4">This invite is password-protected.</p>
                <input
                  type="password"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  placeholder="Invite password"
                  className="w-full bg-black/50 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/40 mb-3"
                  autoFocus
                />
                {inviteError && <p className="text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded-lg mb-3">{inviteError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => invitePwFragment && processInvite(invitePwFragment, invitePassword)}
                    disabled={inviteBusy || !invitePassword}
                    className="flex-1 bg-white text-black py-2.5 rounded-xl font-medium hover:bg-neutral-200 active:scale-95 transition-all text-sm disabled:opacity-50"
                  >
                    {inviteBusy ? 'Joining…' : 'Join'}
                  </button>
                  <button
                    onClick={() => {
                      setInvitePwFragment(null);
                      setInviteError('');
                      history.replaceState(null, '', window.location.pathname);
                    }}
                    className="px-4 py-2.5 text-neutral-400 hover:text-white border border-neutral-800 rounded-xl text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {inviteError && !invitePwFragment && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-4 py-2 rounded-lg">
          {inviteError}
        </div>
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
                  <p className="text-sm font-medium text-white">Your User ID</p>
                  <p className="text-xs text-neutral-500 mt-1">
                    Your cryptographic identity. Share it to let others verify you.
                  </p>
                </div>
                {myUserId && (
                  <div className="bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 font-mono text-xs text-emerald-300 break-all select-all">
                    {formatFingerprint(myUserId)}
                  </div>
                )}
                <button
                  onClick={() => {
                    getKeyManager().lock();
                    setIdentityReady(false);
                    setIsLocked(true);
                  }}
                  className="w-full bg-white text-black py-2.5 rounded-xl font-medium hover:bg-neutral-200 active:scale-95 transition-all text-sm shadow-lg"
                >
                  🔒 Lock Now
                </button>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-neutral-800">
                <div>
                  <div className="text-sm text-neutral-300 font-medium">Extended Retention</div>
                  <div className="text-xs text-neutral-600">7 days instead of 24 hours</div>
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

            <button
              onClick={() => {
                if (!getKeyManager().isUnlocked()) { setIsLocked(true); return; }
                router.push('/dm');
              }}
              className="w-full bg-neutral-900/70 backdrop-blur-xl border border-neutral-800 rounded-2xl p-4 text-left hover:border-neutral-700 hover:bg-neutral-800/50 transition-all shadow-2xl flex items-center justify-between"
            >
              <div>
                <h2 className="text-sm font-semibold text-white">Direct Messages</h2>
                <p className="text-xs text-neutral-500 mt-0.5">1:1 chat by User ID (forward-secret)</p>
              </div>
              <span className="text-neutral-500">→</span>
            </button>

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
