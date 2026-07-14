'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import { createInvite, inviteId, InviteFlags } from '@/lib/crypto/invite';
import { getKeyManager } from '@/lib/crypto/keyManager';

interface InviteModalProps {
  routingId: string;
  roomKeyBytes: Uint8Array;
  socket: Socket | null;
  onClose: () => void;
}

export default function InviteModal({ routingId, roomKeyBytes, socket, onClose }: InviteModalProps) {
  const [expiryHours, setExpiryHours] = useState<number>(24);
  const [maxUses, setMaxUses] = useState<string>('');
  const [oneTime, setOneTime] = useState(false);
  const [maxParticipants, setMaxParticipants] = useState<string>('');
  const [password, setPassword] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const flags: InviteFlags = {};
      if (expiryHours > 0) flags.expiresAt = Date.now() + expiryHours * 3600_000;
      if (oneTime) {
        flags.oneTime = true;
        flags.maxUses = 1;
      } else if (maxUses && Number(maxUses) > 0) {
        flags.maxUses = Number(maxUses);
      }
      if (maxParticipants && Number(maxParticipants) > 0) flags.maxParticipants = Number(maxParticipants);

      const identity = getKeyManager().getIdentity();
      const created = await createInvite(roomKeyBytes, routingId, identity, flags, password || undefined);

      // Register uses/expiry limits with the ephemeral server registry (hash, not key).
      if (socket && (flags.maxUses !== undefined || flags.expiresAt !== undefined || flags.maxParticipants !== undefined)) {
        socket.emit('invite-register', {
          inviteId: inviteId(created.token),
          routingId,
          maxUses: flags.maxUses,
          expiresAt: flags.expiresAt,
          maxParticipants: flags.maxParticipants,
        });
      }

      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setLink(created.link(origin, '/'));
    } catch (e) {
      console.error('Invite creation failed:', e);
      setError('Could not create invite.');
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center backdrop-blur-sm p-4">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex justify-between items-start mb-5">
          <div>
            <h2 className="text-lg font-bold text-white">Create invite</h2>
            <p className="text-neutral-400 text-xs mt-0.5">
              The room key is embedded in the link fragment and never sent to the server.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-neutral-800 rounded-lg transition-colors">
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>

        {!link ? (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-neutral-300 block mb-1">Expires in (hours, 0 = never)</label>
              <input
                type="number"
                min={0}
                value={expiryHours}
                onChange={(e) => setExpiryHours(Number(e.target.value))}
                className="w-full bg-black/50 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-white/40"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input type="checkbox" checked={oneTime} onChange={(e) => setOneTime(e.target.checked)} />
              Single use (one-time)
            </label>
            {!oneTime && (
              <div>
                <label className="text-xs font-medium text-neutral-300 block mb-1">Max uses (blank = unlimited)</label>
                <input
                  type="number"
                  min={1}
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  className="w-full bg-black/50 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-white/40"
                />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-neutral-300 block mb-1">Max participants (blank = no limit)</label>
              <input
                type="number"
                min={1}
                value={maxParticipants}
                onChange={(e) => setMaxParticipants(e.target.value)}
                className="w-full bg-black/50 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-white/40"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-300 block mb-1">Password (optional)</label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Adds Argon2id protection"
                className="w-full bg-black/50 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/40"
              />
            </div>
            {error && <p className="text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
            <button
              onClick={generate}
              disabled={busy}
              className="w-full bg-white text-black py-2.5 rounded-xl font-medium hover:bg-neutral-200 active:scale-95 transition-all text-sm shadow-lg disabled:opacity-50"
            >
              {busy ? 'Generating…' : 'Generate invite link'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="bg-black/50 border border-neutral-800 rounded-lg p-3 font-mono text-[11px] text-emerald-300 break-all select-all max-h-40 overflow-y-auto">
              {link}
            </div>
            <button
              onClick={copy}
              className="w-full bg-white text-black py-2.5 rounded-xl font-medium hover:bg-neutral-200 active:scale-95 transition-all text-sm shadow-lg"
            >
              {copied ? '✓ Copied' : 'Copy link'}
            </button>
            <p className="text-[11px] text-neutral-500 leading-relaxed">
              Anyone with this link (and the password, if set) can join. Share it over a
              trusted channel — the fragment after <span className="font-mono">#</span> is the secret.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
