'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { generateRoomCode, isValidRoomCode } from '@/lib/roomCode';
import { cleanupExpiredRooms, getUserPreferences } from '@/lib/storage';
import LegalDisclaimer from '@/components/LegalDisclaimer';
import SessionLock from '@/components/SessionLock';
import SessionLockSetup from '@/components/SessionLockSetup';
import ProfilePanel from '@/components/ProfilePanel';
import { getKeyManager, ConversationMeta } from '@/lib/crypto/keyManager';
import { parseInvite, redeemInvite } from '@/lib/crypto/invite';
import { stashInvite } from '@/lib/inviteSession';
import { Identicon } from '@/lib/identicon';
import { base64ToBytes } from '@/lib/crypto/wire';

const relTime = (ts: number): string => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');
  const [dmId, setDmId] = useState('');
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [identityReady, setIdentityReady] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [myUserId, setMyUserId] = useState('');
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [invitePwFragment, setInvitePwFragment] = useState<string | null>(null);
  const [invitePassword, setInvitePassword] = useState('');
  const inviteHandledRef = useRef(false);

  useEffect(() => {
    cleanupExpiredRooms();
    const prefs = getUserPreferences();
    setUsername(prefs.username);

    const km = getKeyManager();
    if (!km.hasSealedStore()) setNeedsSetup(true);
    else if (!km.isUnlocked()) setIsLocked(true);
    else setIdentityReady(true);
  }, []);

  const refresh = () => {
    const km = getKeyManager();
    if (!km.isUnlocked()) return;
    setMyUserId(km.getPublicIdentity().fingerprint);
    setConversations(km.getConversations());
    setUsername(getUserPreferences().username);
  };

  useEffect(() => {
    if (identityReady) {
      refresh();
      if (!getUserPreferences().username) setShowProfile(true); // first run: set a name
    }
  }, [identityReady]);

  const processInvite = async (fragment: string, password?: string) => {
    setInviteBusy(true);
    setInviteError('');
    try {
      const parsed = parseInvite(fragment);
      if (parsed.token.pwSalt && !password) {
        setInvitePwFragment(fragment);
        setInviteBusy(false);
        return;
      }
      const { roomKeyBytes, routingId, issuerFingerprint } = await redeemInvite(parsed, { password });
      stashInvite(routingId, roomKeyBytes, issuerFingerprint);
      history.replaceState(null, '', window.location.pathname);
      router.push(`/room/${routingId}`);
    } catch (e) {
      console.error('Invite redemption failed:', e);
      setInviteError(password ? 'Wrong password or invalid invite.' : 'This invite is invalid or expired.');
      setInviteBusy(false);
    }
  };

  useEffect(() => {
    if (!identityReady || inviteHandledRef.current) return;
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (hash.includes('i=')) {
      inviteHandledRef.current = true;
      processInvite(hash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityReady]);

  const requireUnlocked = () => {
    if (!getKeyManager().isUnlocked()) {
      setIsLocked(true);
      return false;
    }
    return true;
  };

  const handleCreateRoom = () => {
    if (!requireUnlocked()) return;
    if (!username.trim()) { setShowProfile(true); return; }
    router.push(`/room/${generateRoomCode()}`);
  };

  const handleJoinRoom = () => {
    if (!requireUnlocked()) return;
    if (!username.trim()) { setShowProfile(true); return; }
    const code = joinCode.replace(/-/g, '').toUpperCase();
    if (!isValidRoomCode(code)) { setError('Invalid room code'); return; }
    setError('');
    router.push(`/room/${code}`);
  };

  const handleNewDm = () => {
    if (!requireUnlocked()) return;
    const peer = dmId.replace(/[-\s]/g, '').toUpperCase();
    router.push(peer ? `/dm?peer=${peer}` : '/dm');
  };

  const openConversation = (c: ConversationMeta) => {
    if (!requireUnlocked()) return;
    if (c.kind === 'dm' && c.peer) return void router.push(`/dm?peer=${c.peer}`);
    if (c.kind === 'room') {
      if (c.code) return void router.push(`/room/${c.code}`);
      if (c.routingId && c.roomKeyBytes) {
        stashInvite(c.routingId, base64ToBytes(c.roomKeyBytes), '');
        router.push(`/room/${c.routingId}`);
      }
    }
  };

  const removeConversation = async (id: string) => {
    await getKeyManager().removeConversation(id);
    refresh();
  };

  const card = 'bg-neutral-900/70 backdrop-blur-xl border border-neutral-800 rounded-2xl shadow-2xl';

  return (
    <>
      {needsSetup && (
        <SessionLockSetup onComplete={() => { setNeedsSetup(false); setIdentityReady(true); }} onCancel={() => {}} />
      )}
      {isLocked && (
        <SessionLock onUnlock={() => { setIsLocked(false); setIdentityReady(true); }} />
      )}
      {showProfile && (
        <ProfilePanel
          onClose={() => { setShowProfile(false); refresh(); }}
          onLocked={() => { setShowProfile(false); setIdentityReady(false); setIsLocked(true); }}
          onUsernameChange={(n) => setUsername(n)}
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
                    className="flex-1 bg-white text-black py-2.5 rounded-xl font-medium hover:bg-neutral-200 text-sm disabled:opacity-50"
                  >
                    {inviteBusy ? 'Joining…' : 'Join'}
                  </button>
                  <button
                    onClick={() => { setInvitePwFragment(null); setInviteError(''); history.replaceState(null, '', window.location.pathname); }}
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
        <div className="max-w-md w-full space-y-5">
          {/* Brand */}
          <div className="text-center space-y-1 pt-2">
            <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight">kai</h1>
            <p className="text-sm text-neutral-500">Ephemeral, end-to-end encrypted chat.</p>
          </div>

          {/* Profile row */}
          <button
            onClick={() => setShowProfile(true)}
            className={`${card} w-full p-3 flex items-center gap-3 hover:border-neutral-700 transition-all text-left`}
          >
            {myUserId ? <Identicon seed={myUserId} size={44} /> : <div className="w-11 h-11 rounded-xl bg-neutral-800" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">{username || 'Set up your profile'}</p>
              <p className="text-xs text-neutral-500">Profile &amp; settings</p>
            </div>
            <span className="text-neutral-600 text-xs border border-neutral-800 rounded-lg px-2.5 py-1">Profile</span>
          </button>

          {/* Primary actions */}
          <div className={`${card} p-5 space-y-4`}>
            <button
              onClick={handleCreateRoom}
              className="w-full bg-white text-black py-3 rounded-xl font-semibold hover:bg-neutral-200 active:scale-[0.98] transition-all text-sm shadow-lg"
            >
              + Create a Room
            </button>

            <div className="flex items-center gap-3 text-[11px] text-neutral-600">
              <div className="h-px bg-neutral-800 flex-1" /> OR JOIN ONE <div className="h-px bg-neutral-800 flex-1" />
            </div>

            <div className="flex gap-2">
              <input
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value); setError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
                placeholder="Room code"
                className="flex-1 bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/40 font-mono text-sm"
                maxLength={19}
              />
              <button onClick={handleJoinRoom} className="px-5 bg-neutral-800 text-white rounded-xl text-sm font-medium hover:bg-neutral-700 border border-neutral-700">
                Join
              </button>
            </div>

            <div className="flex gap-2 pt-1">
              <input
                value={dmId}
                onChange={(e) => setDmId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleNewDm()}
                placeholder="Direct message a User ID"
                className="flex-1 bg-black/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/40 font-mono text-sm"
              />
              <button onClick={handleNewDm} className="px-5 bg-neutral-800 text-white rounded-xl text-sm font-medium hover:bg-neutral-700 border border-neutral-700">
                Chat
              </button>
            </div>
            {error && <p className="text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
          </div>

          {/* Recent conversations */}
          {conversations.length > 0 && (
            <div className={`${card} p-4 space-y-1`}>
              <h2 className="text-xs font-semibold text-neutral-400 px-1 mb-1">RECENT</h2>
              {conversations.slice(0, 8).map((c) => (
                <div key={c.id} className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-neutral-800/50 transition-colors">
                  <button onClick={() => openConversation(c)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <Identicon seed={c.kind === 'room' ? c.routingId || c.id : c.peer || c.id} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-neutral-100 truncate font-medium">
                        {c.kind === 'dm' ? `DM · ${c.label}` : c.label}
                      </p>
                      <p className="text-[11px] text-neutral-500">{relTime(c.lastActivity)}</p>
                    </div>
                  </button>
                  <button
                    onClick={() => removeConversation(c.id)}
                    className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 px-2 transition-all"
                    title="Remove from recents"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-center gap-4 text-[11px] text-neutral-600 pt-1">
            <span>🔒 E2E encrypted</span>
            <span>·</span>
            <span>💾 Local-first</span>
            <span>·</span>
            <span>⏱️ Ephemeral</span>
          </div>
          <div className="flex justify-center gap-6 text-xs text-neutral-600">
            <a href="/terms" className="hover:text-neutral-400 transition-colors">Terms</a>
            <a href="/privacy" className="hover:text-neutral-400 transition-colors">Privacy</a>
          </div>
        </div>
      </div>
    </>
  );
}
